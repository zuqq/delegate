import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "vitest";
import type { AgentConfig } from "../src/agents.ts";
import type { SubagentSnapshot, SubagentStatus } from "../src/events.ts";
import type { MinimalTheme } from "../src/render.ts";

/** No-op theme: returns text unchanged. */
export const plain: MinimalTheme = { fg: (_c, t) => t, bold: (t) => t };

export const CALL = { agent: "scout", source: "user" as const, description: "lbl", task: "do thing" };

export const USAGE = { contextTokens: 200, cost: 0.02 };

export function makeAgentConfig(name: string, description = ""): AgentConfig {
	return { name, description, systemPrompt: "", source: "user", filePath: `/x/${name}.md` };
}

export function makeSubagentSnapshot(status: SubagentStatus): SubagentSnapshot {
	return { ...CALL, contextTokens: 0, cost: 0, model: "m", trail: [], ...status };
}

interface AgentDirs {
	/** A temp dir. */
	tmpDir: string;
	/** A temp dir with an empty `agents/` subdir, to pass as a user agent dir. */
	agentDir: string;
}

async function withTmpDir(prefix: string, use: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
	try {
		await use(dir);
	} finally {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
}

export const it = test.extend<AgentDirs>({
	// biome-ignore lint/correctness/noEmptyPattern: Vitest requires object destructuring
	tmpDir: ({}, use) => withTmpDir("delegate-tmp-", use),
	// biome-ignore lint/correctness/noEmptyPattern: Vitest requires object destructuring
	agentDir: ({}, use) =>
		withTmpDir("delegate-user-", async (dir) => {
			await fs.promises.mkdir(path.join(dir, "agents"));
			await use(dir);
		}),
});
