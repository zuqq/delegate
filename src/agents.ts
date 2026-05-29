import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentSource = "user" | "project" | "builtin";

const BUILTIN_AGENTS: AgentConfig[] = [
	{
		name: "general-purpose",
		description: "A general-purpose subagent that can perform any task.",
		systemPrompt: "",
		source: "builtin",
	},
];

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath?: string;
}

export interface SkippedAgent {
	filePath: string;
	reason: string;
}

export interface AgentCatalog {
	loaded: AgentConfig[];
	skipped: SkippedAgent[];
}

function isMissingPathError(err: unknown): boolean {
	if (!(err instanceof Error) || !("code" in err)) return false;
	const code = (err as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

/** Load agent configs from `*.md` files in `dir`. */
export function loadAgentsFromDir(dir: string, source: AgentSource): AgentCatalog {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (err) {
		if (isMissingPathError(err)) return { loaded: [], skipped: [] };
		throw err;
	}

	const loaded: AgentConfig[] = [];
	const skipped: SkippedAgent[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch (err) {
			// TOCTOU avoidance
			if (isMissingPathError(err)) continue;
			throw err;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
		const missing: string[] = [];
		if (!frontmatter.name) missing.push("name");
		if (!frontmatter.description) missing.push("description");
		if (missing.length > 0) {
			skipped.push({ filePath, reason: `missing ${missing.join(" and ")} in frontmatter` });
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		loaded.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}
	return { loaded, skipped };
}

function collectProjectDirs(startDir: string): string[] {
	const ancestors: string[] = [];
	let cur = startDir;
	while (true) {
		ancestors.push(cur);
		// Stop at the repository root.
		if (fs.existsSync(path.join(cur, ".git"))) return ancestors;
		const parent = path.dirname(cur);
		// No repository found: keep only `startDir`.
		if (parent === cur) return [startDir];
		cur = parent;
	}
}

/** Load project (`cwd` up to the repository root) and user agent configs. */
export function loadAgents(cwd: string, agentDir: string): AgentCatalog {
	const merged = new Map<string, AgentConfig>();
	const skipped: SkippedAgent[] = [];

	function mergeCatalog(catalog: AgentCatalog) {
		for (const a of catalog.loaded) {
			if (!merged.has(a.name)) merged.set(a.name, a);
		}
		skipped.push(...catalog.skipped);
	}

	// The first definition of a name wins, so merge nearest-first.
	for (const dir of collectProjectDirs(cwd)) {
		mergeCatalog(loadAgentsFromDir(path.join(dir, ".pi", "agents"), "project"));
	}
	mergeCatalog(loadAgentsFromDir(path.join(agentDir, "agents"), "user"));
	mergeCatalog({ loaded: BUILTIN_AGENTS, skipped: [] });

	return { loaded: Array.from(merged.values()), skipped };
}
