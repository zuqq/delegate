import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { SubagentSnapshot, SubagentStatus } from "../src/events.ts";
import { buildResult, handleToolResult } from "../src/index.ts";
import { PARAMS } from "./fixtures.ts";

function makeSubagentSnapshot(status: SubagentStatus): SubagentSnapshot {
	return { ...PARAMS, contextTokens: 0, cost: 0, model: "m", trail: [], ...status };
}

describe("handleToolResult", () => {
	it.each([
		[{ toolName: "subagent", details: { status: "aborted" } }, { isError: true }],
		[{ toolName: "subagent", details: { status: "failed" } }, { isError: true }],
		[{ toolName: "subagent", details: { status: "succeeded" } }, undefined],
		[{ toolName: "subagent", details: { status: "running" } }, undefined],
		[{ toolName: "bash", details: { status: "failed" } }, undefined],
		[{ toolName: "subagent", details: undefined }, undefined],
		[{ toolName: "subagent", details: {} }, undefined],
	] as const)("handleToolResult(%j) === %j", (event, expected) => {
		expect(handleToolResult(event as ToolResultEvent)).toEqual(expected);
	});
});

describe("buildResult", () => {
	it.each([
		[{ status: "running" }, ""],
		[{ status: "succeeded", finalText: "the final answer is 42" }, "the final answer is 42"],
		[{ status: "succeeded" }, ""],
		[{ status: "failed", errorMessage: "No models available" }, "No models available"],
		[{ status: "failed" }, "subagent failed"],
		[{ status: "aborted" }, "subagent aborted"],
	] as const)("buildResult(%j): content === %j, details === snapshot", (status, text) => {
		const snapshot = makeSubagentSnapshot(status);
		const result = buildResult(snapshot);
		expect(result.details).toBe(snapshot);
		expect(result.content).toEqual([{ type: "text", text }]);
	});
});
