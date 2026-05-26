import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgents, loadAgentsFromDir } from "../src/agents.ts";
import { useTmpDir, useUserAgentsDir } from "./fixtures.ts";

describe("loadAgentsFromDir", () => {
	const tmp = useTmpDir();

	it("returns empty for a missing directory", () => {
		expect(loadAgentsFromDir(path.join(tmp(), "does-not-exist"), "user")).toEqual({
			loaded: [],
			skipped: [],
		});
	});

	it("parses frontmatter and body", () => {
		fs.writeFileSync(
			path.join(tmp(), "scout.md"),
			`---
name: scout
description: investigate
tools: read, grep
model: anthropic/sonnet
---
Do the thing.
`,
		);
		const { loaded, skipped } = loadAgentsFromDir(tmp(), "user");
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
		expect(loaded[0].filePath).toBe(path.join(tmp(), "scout.md"));
	});

	it("skips files without name or description in frontmatter", () => {
		fs.writeFileSync(
			path.join(tmp(), "no-name.md"),
			`---
description: missing name
---
body
`,
		);
		fs.writeFileSync(
			path.join(tmp(), "no-description.md"),
			`---
name: orphan
---
body
`,
		);
		fs.writeFileSync(path.join(tmp(), "no-frontmatter.md"), "no frontmatter at all\n");
		const { loaded, skipped } = loadAgentsFromDir(tmp(), "user");
		expect(loaded).toEqual([]);
		expect(skipped).toEqual([
			{ filePath: path.join(tmp(), "no-description.md"), reason: "missing description in frontmatter" },
			{ filePath: path.join(tmp(), "no-frontmatter.md"), reason: "missing name and description in frontmatter" },
			{ filePath: path.join(tmp(), "no-name.md"), reason: "missing name in frontmatter" },
		]);
	});

	it("ignores non-.md files", () => {
		fs.writeFileSync(
			path.join(tmp(), "scout.txt"),
			`---
name: scout
description: investigate
---
body
`,
		);
		expect(loadAgentsFromDir(tmp(), "user")).toEqual({ loaded: [], skipped: [] });
	});

	it("normalizes an empty tools field to undefined", () => {
		fs.writeFileSync(
			path.join(tmp(), "empty-tools.md"),
			`---
name: e
description: e
tools:
---
body
`,
		);
		const { loaded } = loadAgentsFromDir(tmp(), "user");
		expect(loaded[0].tools).toBeUndefined();
	});
});

describe("loadAgents", () => {
	const userHome = useUserAgentsDir("subagent-discover-user-");
	const projectRoot = useTmpDir("subagent-discover-project-");

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

	it("loads user agents", () => {
		writeAgent(path.join(userHome(), "agents"), "a", "alpha", "body");
		const cwd = path.join(projectRoot(), "x", "y");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({ name: "a", source: "user" });
	});

	it("loads user and project agents", () => {
		writeAgent(path.join(userHome(), "agents"), "a", "alpha", "body");
		writeAgent(path.join(projectRoot(), ".pi", "agents"), "b", "beta", "body");

		const { loaded } = loadAgents(projectRoot());
		const byName = new Map(loaded.map((agent) => [agent.name, agent]));
		expect(byName.get("a")?.source).toBe("user");
		expect(byName.get("b")?.source).toBe("project");
		expect(loaded).toHaveLength(2);
	});

	it("prefers project agents to user agents", () => {
		writeAgent(path.join(userHome(), "agents"), "dup", "user-version", "body u");
		writeAgent(path.join(projectRoot(), ".pi", "agents"), "dup", "project-version", "body p");

		const { loaded } = loadAgents(projectRoot());
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({
			name: "dup",
			source: "project",
			description: "project-version",
		});
	});

	it("prefers nearer project agents to farther ones", () => {
		writeAgent(path.join(projectRoot(), ".pi", "agents"), "dup", "far", "body far");
		writeAgent(path.join(projectRoot(), "sub", ".pi", "agents"), "dup", "near", "body near");
		const cwd = path.join(projectRoot(), "sub", "deep");
		fs.mkdirSync(cwd, { recursive: true });

		const { loaded } = loadAgents(cwd);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({ name: "dup", source: "project", description: "near" });
	});

	it("collects skipped files from user and project dirs", () => {
		fs.writeFileSync(
			path.join(userHome(), "agents", "u.md"),
			`---
description: no name here
---
body
`,
		);
		fs.mkdirSync(path.join(projectRoot(), ".pi", "agents"), { recursive: true });
		fs.writeFileSync(
			path.join(projectRoot(), ".pi", "agents", "p.md"),
			`---
name: nodesc
---
body
`,
		);

		const { loaded, skipped } = loadAgents(projectRoot());
		expect(loaded).toEqual([]);
		expect(skipped).toEqual([
			{ filePath: path.join(projectRoot(), ".pi", "agents", "p.md"), reason: "missing description in frontmatter" },
			{ filePath: path.join(userHome(), "agents", "u.md"), reason: "missing name in frontmatter" },
		]);
	});
});
