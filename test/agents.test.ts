import * as fs from "node:fs";
import * as path from "node:path";
import { err, ok } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import { type Agent, loadAgents, loadAgentsFromDir, parseAgent } from "../src/agents.ts";
import { it } from "./fixtures.ts";

const FILE = "/agents/a.md";

function wrapFrontmatter(frontmatter: string): string {
	return `---\n${frontmatter}\n---\nbody\n`;
}

function makeAgent(overrides: Partial<Agent>): Agent {
	return {
		name: "a",
		description: "x",
		tools: undefined,
		model: undefined,
		systemPrompt: "body",
		source: "user",
		filePath: FILE,
		...overrides,
	};
}

function makeDiagnostic(message: string) {
	return { filePath: FILE, message };
}

describe("parseAgent", () => {
	test.each([
		{
			name: "parses every field",
			frontmatter: `name: scout
description: investigate
tools: read, grep
model: anthropic/sonnet`,
			expected: ok(
				makeAgent({
					name: "scout",
					description: "investigate",
					tools: ["read", "grep"],
					model: "anthropic/sonnet",
				}),
			),
		},
		{
			name: "absent tools stay undefined",
			frontmatter: `name: a
description: x`,
			expected: ok(makeAgent({})),
		},
		{
			name: "null tools become empty",
			frontmatter: `name: a
description: x
tools:`,
			expected: ok(makeAgent({ tools: [] })),
		},
		{
			name: "empty-string tools become empty",
			frontmatter: `name: a
description: x
tools: ""`,
			expected: ok(makeAgent({ tools: [] })),
		},
		{
			name: "empty-list tools become empty",
			frontmatter: `name: a
description: x
tools: []`,
			expected: ok(makeAgent({ tools: [] })),
		},
		{
			name: "tools as a YAML list",
			frontmatter: `name: a
description: x
tools: [read, grep]`,
			expected: ok(makeAgent({ tools: ["read", "grep"] })),
		},
		{
			name: "trims name and description",
			frontmatter: `name: "  a  "
description: "  x  "`,
			expected: ok(makeAgent({})),
		},
		{
			name: "non-string name is missing",
			frontmatter: `name: 123
description: x`,
			expected: err([makeDiagnostic("name is required")]),
		},
		{
			name: "non-string model",
			frontmatter: `name: a
description: x
model: [a, b]`,
			expected: err([makeDiagnostic("model must be a string")]),
		},
		{
			name: "tools neither string nor list",
			frontmatter: `name: a
description: x
tools: 42`,
			expected: err([makeDiagnostic("tools must be a string or a list of strings")]),
		},
		{
			name: "tools list with a non-string",
			frontmatter: `name: a
description: x
tools: [read, 42]`,
			expected: err([makeDiagnostic("tools must contain only strings")]),
		},
		{
			name: "non-mapping frontmatter is missing name and description",
			frontmatter: "just a string",
			expected: err([makeDiagnostic("name is required"), makeDiagnostic("description is required")]),
		},
		{
			name: "malformed YAML",
			frontmatter: `name: "oops
description: x`,
			expected: err([{ filePath: FILE, message: expect.stringMatching(/^invalid frontmatter: /) }]),
		},
	])("$name", ({ frontmatter, expected }) => {
		expect(parseAgent(wrapFrontmatter(frontmatter), "user", FILE)).toStrictEqual(expected);
	});
});

describe("loadAgentsFromDir", () => {
	it("returns empty for a missing directory", ({ tmpDir }) => {
		expect(loadAgentsFromDir(path.join(tmpDir, "does-not-exist"), "user")).toEqual({
			agents: new Map(),
			diagnostics: [],
		});
	});

	it("reads a valid agent file into the catalog", ({ tmpDir }) => {
		const filePath = path.join(tmpDir, "scout.md");
		fs.writeFileSync(filePath, wrapFrontmatter("name: scout\ndescription: investigate"));
		expect(loadAgentsFromDir(tmpDir, "user")).toEqual({
			agents: new Map([["scout", makeAgent({ name: "scout", description: "investigate", filePath })]]),
			diagnostics: [],
		});
	});

	it("aggregates diagnostics across files, sorted by path", ({ tmpDir }) => {
		fs.writeFileSync(path.join(tmpDir, "no-name.md"), wrapFrontmatter("description: missing name"));
		fs.writeFileSync(path.join(tmpDir, "no-description.md"), wrapFrontmatter("name: orphan"));
		fs.writeFileSync(path.join(tmpDir, "no-frontmatter.md"), "no frontmatter at all\n");
		expect(loadAgentsFromDir(tmpDir, "user")).toEqual({
			agents: new Map(),
			diagnostics: [
				{ filePath: path.join(tmpDir, "no-description.md"), message: "description is required" },
				{ filePath: path.join(tmpDir, "no-frontmatter.md"), message: "name is required" },
				{ filePath: path.join(tmpDir, "no-frontmatter.md"), message: "description is required" },
				{ filePath: path.join(tmpDir, "no-name.md"), message: "name is required" },
			],
		});
	});

	it("reports files that cannot be read", ({ tmpDir }) => {
		fs.mkdirSync(path.join(tmpDir, "target-dir"));
		fs.symlinkSync(path.join(tmpDir, "target-dir"), path.join(tmpDir, "link.md"), "dir");
		expect(loadAgentsFromDir(tmpDir, "user")).toEqual({
			agents: new Map(),
			diagnostics: [
				{ filePath: path.join(tmpDir, "link.md"), message: expect.stringMatching(/^could not read file: /) },
			],
		});
	});

	it("ignores non-`.md` files", ({ tmpDir }) => {
		fs.writeFileSync(path.join(tmpDir, "scout.txt"), wrapFrontmatter("name: scout\ndescription: investigate"));
		expect(loadAgentsFromDir(tmpDir, "user")).toEqual({ agents: new Map(), diagnostics: [] });
	});
});

describe("loadAgents", () => {
	function writeAgent(dir: string, name: string, description: string) {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, `${name}.md`), wrapFrontmatter(`name: ${name}\ndescription: ${description}`));
	}

	it("loads user agents", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "a", "alpha");
		const cwd = path.join(tmpDir, "x", "y");
		fs.mkdirSync(cwd, { recursive: true });

		const { agents } = loadAgents(cwd, agentDir);
		expect(agents.get("a")).toMatchObject({ name: "a", source: "user" });
	});

	it("loads user and project agents", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "a", "alpha");
		writeAgent(path.join(tmpDir, ".pi", "agents"), "b", "beta");

		const { agents } = loadAgents(tmpDir, agentDir);
		expect(agents.get("a")).toMatchObject({ source: "user" });
		expect(agents.get("b")).toMatchObject({ source: "project" });
	});

	it("prefers project agents to user agents", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "dup", "user-version");
		writeAgent(path.join(tmpDir, ".pi", "agents"), "dup", "project-version");

		const { agents } = loadAgents(tmpDir, agentDir);
		expect(agents.get("dup")).toMatchObject({
			name: "dup",
			source: "project",
			description: "project-version",
		});
	});

	it("prefers nearer project agents to farther ones", ({ tmpDir, agentDir }) => {
		fs.writeFileSync(path.join(tmpDir, ".git"), "");
		writeAgent(path.join(tmpDir, ".pi", "agents"), "dup", "far");
		writeAgent(path.join(tmpDir, "sub", ".pi", "agents"), "dup", "near");
		const cwd = path.join(tmpDir, "sub", "deep");
		fs.mkdirSync(cwd, { recursive: true });

		const { agents } = loadAgents(cwd, agentDir);
		expect(agents.get("dup")).toMatchObject({ name: "dup", source: "project", description: "near" });
	});

	it("collects errors from user and project dirs", ({ tmpDir, agentDir }) => {
		fs.writeFileSync(path.join(agentDir, "agents", "u.md"), wrapFrontmatter("description: no name here"));
		fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, ".pi", "agents", "p.md"), wrapFrontmatter("name: nodesc"));

		const { diagnostics } = loadAgents(tmpDir, agentDir);
		expect(diagnostics).toEqual([
			{ filePath: path.join(tmpDir, ".pi", "agents", "p.md"), message: "description is required" },
			{ filePath: path.join(agentDir, "agents", "u.md"), message: "name is required" },
		]);
	});

	it("always includes the built-in general-purpose agent", ({ tmpDir, agentDir }) => {
		const cwd = path.join(tmpDir, "x", "y");
		fs.mkdirSync(cwd, { recursive: true });

		const { agents } = loadAgents(cwd, agentDir);
		expect(agents.get("general-purpose")).toMatchObject({
			name: "general-purpose",
			source: "builtin",
			systemPrompt: "",
		});
	});

	it("prefers user-defined agents to built-ins", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "general-purpose", "user override");

		const { agents } = loadAgents(tmpDir, agentDir);
		expect(agents.get("general-purpose")).toMatchObject({ source: "user", description: "user override" });
	});

	it("prefers project-defined agents to built-ins", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(tmpDir, ".pi", "agents"), "general-purpose", "project override");

		const { agents } = loadAgents(tmpDir, agentDir);
		expect(agents.get("general-purpose")).toMatchObject({ source: "project", description: "project override" });
	});

	it("walks up to a `.git` ancestor inclusive", ({ tmpDir, agentDir }) => {
		fs.mkdirSync(path.join(tmpDir, ".git"));
		writeAgent(path.join(tmpDir, ".pi", "agents"), "root", "at root");
		const cwd = path.join(tmpDir, "a", "b");
		fs.mkdirSync(cwd, { recursive: true });

		const { agents } = loadAgents(cwd, agentDir);
		expect(agents.get("root")).toMatchObject({ name: "root", source: "project" });
	});

	it("does not walk past a `.git` ancestor", ({ tmpDir, agentDir }) => {
		fs.mkdirSync(path.join(tmpDir, "repo", ".git"), { recursive: true });
		writeAgent(path.join(tmpDir, ".pi", "agents"), "outer", "outside repo");
		const cwd = path.join(tmpDir, "repo", "x");
		fs.mkdirSync(cwd, { recursive: true });

		const { agents } = loadAgents(cwd, agentDir);
		expect(agents.get("outer")).toBeUndefined();
	});

	it("does not walk when no `.git` ancestor exists", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(tmpDir, ".pi", "agents"), "above", "above cwd");
		const cwd = path.join(tmpDir, "sub");
		fs.mkdirSync(cwd, { recursive: true });

		const { agents } = loadAgents(cwd, agentDir);
		expect(agents.get("above")).toBeUndefined();
	});
});
