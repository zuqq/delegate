import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { loadAgents, loadAgentsFromDir } from "../src/agents.ts";
import { it } from "./fixtures.ts";

describe("loadAgentsFromDir", () => {
	it("returns empty for a missing directory", ({ tmpDir }) => {
		expect(loadAgentsFromDir(path.join(tmpDir, "does-not-exist"), "user")).toEqual({
			loaded: [],
			skipped: [],
		});
	});

	it("parses frontmatter and body", ({ tmpDir }) => {
		fs.writeFileSync(
			path.join(tmpDir, "scout.md"),
			`---
name: scout
description: investigate
tools: read, grep
model: anthropic/sonnet
---
Do the thing.
`,
		);
		const { loaded, skipped } = loadAgentsFromDir(tmpDir, "user");
		expect(skipped).toEqual([]);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({
			name: "scout",
			description: "investigate",
			tools: ["read", "grep"],
			model: "anthropic/sonnet",
			source: "user",
		});
		expect(loaded[0].systemPrompt).toBe("Do the thing.");
		expect(loaded[0].filePath).toBe(path.join(tmpDir, "scout.md"));
	});

	it("skips files without name or description in frontmatter", ({ tmpDir }) => {
		fs.writeFileSync(
			path.join(tmpDir, "no-name.md"),
			`---
description: missing name
---
body
`,
		);
		fs.writeFileSync(
			path.join(tmpDir, "no-description.md"),
			`---
name: orphan
---
body
`,
		);
		fs.writeFileSync(path.join(tmpDir, "no-frontmatter.md"), "no frontmatter at all\n");
		const { loaded, skipped } = loadAgentsFromDir(tmpDir, "user");
		expect(loaded).toEqual([]);
		expect(skipped).toEqual([
			{ filePath: path.join(tmpDir, "no-description.md"), reason: "missing description in frontmatter" },
			{ filePath: path.join(tmpDir, "no-frontmatter.md"), reason: "missing name and description in frontmatter" },
			{ filePath: path.join(tmpDir, "no-name.md"), reason: "missing name in frontmatter" },
		]);
	});

	it("ignores non-.md files", ({ tmpDir }) => {
		fs.writeFileSync(
			path.join(tmpDir, "scout.txt"),
			`---
name: scout
description: investigate
---
body
`,
		);
		expect(loadAgentsFromDir(tmpDir, "user")).toEqual({ loaded: [], skipped: [] });
	});

	it("normalizes an empty tools field to undefined", ({ tmpDir }) => {
		fs.writeFileSync(
			path.join(tmpDir, "empty-tools.md"),
			`---
name: e
description: e
tools:
---
body
`,
		);
		const { loaded } = loadAgentsFromDir(tmpDir, "user");
		expect(loaded[0].tools).toBeUndefined();
	});
});

describe("loadAgents", () => {
	function writeAgent(dir: string, name: string, description: string, body: string) {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, `${name}.md`),
			`---
name: ${name}
description: ${description}
---
${body}
`,
		);
	}

	it("loads user agents", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "a", "alpha", "body");
		const cwd = path.join(tmpDir, "x", "y");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd, agentDir);
		expect(loaded).toContainEqual(expect.objectContaining({ name: "a", source: "user" }));
	});

	it("loads user and project agents", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "a", "alpha", "body");
		writeAgent(path.join(tmpDir, ".pi", "agents"), "b", "beta", "body");

		const { loaded } = loadAgents(tmpDir, agentDir);
		const byName = new Map(loaded.map((agent) => [agent.name, agent]));
		expect(byName.get("a")?.source).toBe("user");
		expect(byName.get("b")?.source).toBe("project");
	});

	it("prefers project agents to user agents", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "dup", "user-version", "body u");
		writeAgent(path.join(tmpDir, ".pi", "agents"), "dup", "project-version", "body p");

		const { loaded } = loadAgents(tmpDir, agentDir);
		const dups = loaded.filter((a) => a.name === "dup");
		expect(dups).toHaveLength(1);
		expect(dups[0]).toMatchObject({
			name: "dup",
			source: "project",
			description: "project-version",
		});
	});

	it("prefers nearer project agents to farther ones", ({ tmpDir, agentDir }) => {
		fs.writeFileSync(path.join(tmpDir, ".git"), "");
		writeAgent(path.join(tmpDir, ".pi", "agents"), "dup", "far", "body far");
		writeAgent(path.join(tmpDir, "sub", ".pi", "agents"), "dup", "near", "body near");
		const cwd = path.join(tmpDir, "sub", "deep");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd, agentDir);
		const dups = loaded.filter((a) => a.name === "dup");
		expect(dups).toHaveLength(1);
		expect(dups[0]).toMatchObject({ name: "dup", source: "project", description: "near" });
	});

	it("collects skipped files from user and project dirs", ({ tmpDir, agentDir }) => {
		fs.writeFileSync(
			path.join(agentDir, "agents", "u.md"),
			`---
description: no name here
---
body
`,
		);
		fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "agents", "p.md"),
			`---
name: nodesc
---
body
`,
		);

		const { loaded, skipped } = loadAgents(tmpDir, agentDir);
		expect(loaded.filter((a) => a.source !== "builtin")).toEqual([]);
		expect(skipped).toEqual([
			{ filePath: path.join(tmpDir, ".pi", "agents", "p.md"), reason: "missing description in frontmatter" },
			{ filePath: path.join(agentDir, "agents", "u.md"), reason: "missing name in frontmatter" },
		]);
	});

	it("always includes the built-in general-purpose agent", ({ tmpDir, agentDir }) => {
		const cwd = path.join(tmpDir, "x", "y");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd, agentDir);
		const builtin = loaded.find((a) => a.name === "general-purpose");
		expect(builtin).toMatchObject({ name: "general-purpose", source: "builtin", systemPrompt: "" });
	});

	it("prefers user-defined agents to built-ins", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(agentDir, "agents"), "general-purpose", "user override", "body");

		const { loaded } = loadAgents(tmpDir, agentDir);
		const matches = loaded.filter((a) => a.name === "general-purpose");
		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ source: "user", description: "user override" });
	});

	it("prefers project-defined agents to built-ins", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(tmpDir, ".pi", "agents"), "general-purpose", "project override", "body");

		const { loaded } = loadAgents(tmpDir, agentDir);
		const matches = loaded.filter((a) => a.name === "general-purpose");
		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ source: "project", description: "project override" });
	});

	it("walks up to a `.git` ancestor inclusive", ({ tmpDir, agentDir }) => {
		fs.mkdirSync(path.join(tmpDir, ".git"));
		writeAgent(path.join(tmpDir, ".pi", "agents"), "root", "at root", "body");
		const cwd = path.join(tmpDir, "a", "b");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd, agentDir);
		expect(loaded).toContainEqual(expect.objectContaining({ name: "root", source: "project" }));
	});

	it("does not walk past a `.git` ancestor", ({ tmpDir, agentDir }) => {
		fs.mkdirSync(path.join(tmpDir, "repo", ".git"), { recursive: true });
		writeAgent(path.join(tmpDir, ".pi", "agents"), "outer", "outside repo", "body");
		const cwd = path.join(tmpDir, "repo", "x");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd, agentDir);
		expect(loaded.find((a) => a.name === "outer")).toBeUndefined();
	});

	it("does not walk when no `.git` ancestor exists", ({ tmpDir, agentDir }) => {
		writeAgent(path.join(tmpDir, ".pi", "agents"), "above", "above cwd", "body");
		const cwd = path.join(tmpDir, "sub");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd, agentDir);
		expect(loaded.find((a) => a.name === "above")).toBeUndefined();
	});
});
