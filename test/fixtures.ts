import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { AgentConfig } from "../src/agents.ts";
import { emptyUsage, type SubagentSnapshot, type UsageStats } from "../src/events.ts";
import type { MinimalTheme } from "../src/render.ts";

/** No-op theme: returns text unchanged. */
export const plain: MinimalTheme = { fg: (_c, t) => t, bold: (t) => t };

export const CALL = { agent: "scout", source: "user" as const, description: "lbl", task: "do thing" };

export const USAGE: UsageStats = { contextTokens: 200, cost: 0.02 };

export function makeAgentConfig(name: string, description = ""): AgentConfig {
	return { name, description, systemPrompt: "", source: "user", filePath: `/x/${name}.md` };
}

export function makeSubagentSnapshot(overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
	return {
		...CALL,
		status: "succeeded",
		usage: emptyUsage(),
		model: "m",
		trail: [],
		finalText: "",
		...overrides,
	};
}

/** Create a tmp dir for the current test; cleaned up in `afterEach`. */
export function useTmpDir(prefix = "subagent-test-"): () => string {
	let dir = "";
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});
	return () => dir;
}

/** Point `PI_CODING_AGENT_DIR` at a tmp dir with an `agents/` subdir. */
export function useUserAgentsDir(prefix = "subagent-user-"): () => string {
	const getDir = useTmpDir(prefix);
	let previousEnv: string | undefined;
	beforeEach(() => {
		fs.mkdirSync(path.join(getDir(), "agents"));
		previousEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = getDir();
	});
	afterEach(() => {
		if (previousEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousEnv;
	});
	return getDir;
}
