import * as fs from "node:fs";
import * as path from "node:path";
import { err, ok, type Result, toError } from "@earendil-works/pi-agent-core";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentSource = "user" | "project" | "builtin";

export interface Agent {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath?: string;
}

export interface AgentDiagnostic {
	filePath: string;
	message: string;
}

interface AgentCatalog {
	agents: Map<string, Agent>;
	diagnostics: AgentDiagnostic[];
}

const BUILTIN_AGENTS: Agent[] = [
	{
		name: "general-purpose",
		description: "A general-purpose subagent that can perform any task.",
		systemPrompt: "",
		source: "builtin",
	},
];

function isMissingPathError(error: unknown): boolean {
	if (!(error instanceof Error) || !("code" in error)) return false;
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

function parseName(raw: unknown): Result<string, string> {
	const name = typeof raw === "string" ? raw.trim() : "";
	return name ? ok(name) : err("name is required");
}

function parseDescription(raw: unknown): Result<string, string> {
	const description = typeof raw === "string" ? raw.trim() : "";
	return description ? ok(description) : err("description is required");
}

function parseTools(raw: unknown): Result<string[] | undefined, string> {
	if (raw === undefined) return ok(undefined);
	if (raw === null) return ok([]);

	let parts: unknown[];
	if (typeof raw === "string") parts = raw.split(",");
	else if (Array.isArray(raw)) parts = raw;
	else return err("tools must be a string or a list of strings");

	const tools: string[] = [];
	for (const part of parts) {
		if (typeof part !== "string") return err("tools must contain only strings");
		const trimmed = part.trim();
		if (trimmed) tools.push(trimmed);
	}
	return ok(tools);
}

function parseModel(raw: unknown): Result<string | undefined, string> {
	if (raw === undefined || raw === null || raw === "") return ok(undefined);
	if (typeof raw !== "string") return err("model must be a string");
	return ok(raw);
}

export function parseAgent(content: string, source: AgentSource, filePath: string): Result<Agent, AgentDiagnostic[]> {
	let frontmatter: Record<string, unknown>;
	let body: string;
	try {
		({ frontmatter, body } = parseFrontmatter(content));
	} catch (error) {
		return err([{ filePath, message: `invalid frontmatter: ${toError(error).message}` }]);
	}

	const name = parseName(frontmatter.name);
	const description = parseDescription(frontmatter.description);
	const tools = parseTools(frontmatter.tools);
	const model = parseModel(frontmatter.model);

	const diagnostics: AgentDiagnostic[] = [];
	for (const result of [name, description, tools, model]) {
		if (!result.ok) diagnostics.push({ filePath, message: result.error });
	}
	if (!name.ok || !description.ok || !tools.ok || !model.ok) return err(diagnostics);

	return ok({
		name: name.value,
		description: description.value,
		tools: tools.value,
		model: model.value,
		systemPrompt: body,
		source,
		filePath,
	});
}

/** Load agents from `*.md` files in `dir`. */
export function loadAgentsFromDir(dir: string, source: AgentSource): AgentCatalog {
	const agents = new Map<string, Agent>();
	const diagnostics: AgentDiagnostic[] = [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if (!isMissingPathError(error)) {
			diagnostics.push({ filePath: dir, message: `could not read directory: ${toError(error).message}` });
		}
		return { agents, diagnostics };
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch (error) {
			if (isMissingPathError(error)) continue;
			diagnostics.push({ filePath, message: `could not read file: ${toError(error).message}` });
			continue;
		}

		const result = parseAgent(content, source, filePath);
		if (result.ok) {
			const agent = result.value;
			agents.set(agent.name, agent);
		} else {
			diagnostics.push(...result.error);
		}
	}
	return { agents, diagnostics };
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

/** Load project (`cwd` up to the repository root) and user agents. */
export function loadAgents(cwd: string, agentDir: string): AgentCatalog {
	const agents = new Map<string, Agent>();
	const diagnostics: AgentDiagnostic[] = [];

	function mergeCatalog(catalog: AgentCatalog) {
		for (const [name, agent] of catalog.agents) {
			if (!agents.has(name)) agents.set(name, agent);
		}
		diagnostics.push(...catalog.diagnostics);
	}

	// The first definition of a name wins, so merge nearest-first.
	for (const dir of collectProjectDirs(cwd)) {
		mergeCatalog(loadAgentsFromDir(path.join(dir, ".pi", "agents"), "project"));
	}
	mergeCatalog(loadAgentsFromDir(path.join(agentDir, "agents"), "user"));
	for (const agent of BUILTIN_AGENTS) {
		if (!agents.has(agent.name)) agents.set(agent.name, agent);
	}

	return { agents, diagnostics };
}
