import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentCatalog, AgentConfig, AgentSource, SkippedAgent } from "./types.ts";

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

/** Load project (`cwd` and all ancestors) and user agent configs. */
export function loadAgents(cwd: string): AgentCatalog {
	const merged = new Map<string, AgentConfig>();
	const skipped: SkippedAgent[] = [];

	let cur = path.resolve(cwd);
	while (true) {
		const project = loadAgentsFromDir(path.join(cur, ".pi", "agents"), "project");
		for (const a of project.loaded) {
			// Definitions closer to `cwd` take precedence.
			if (!merged.has(a.name)) merged.set(a.name, a);
		}
		skipped.push(...project.skipped);
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}

	const user = loadAgentsFromDir(path.join(getAgentDir(), "agents"), "user");
	for (const a of user.loaded) {
		if (!merged.has(a.name)) merged.set(a.name, a);
	}
	skipped.push(...user.skipped);

	return { loaded: Array.from(merged.values()), skipped };
}
