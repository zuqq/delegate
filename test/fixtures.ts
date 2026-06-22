import type { SubagentSnapshot, SubagentStatus } from "../src/events.ts";
import type { MinimalTheme } from "../src/render.ts";

/** No-op theme: returns text unchanged. */
export const plain: MinimalTheme = { fg: (_c, t) => t, bold: (t) => t };

export const CALL = {
	description: "the thing",
	task: "do the thing",
};

export const USAGE = { contextTokens: 200, cost: 0.02 };

export function makeSubagentSnapshot(status: SubagentStatus): SubagentSnapshot {
	return { ...CALL, contextTokens: 0, cost: 0, model: "m", trail: [], ...status };
}
