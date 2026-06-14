import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildDescription, buildResult, handleToolResult } from "../src/index.ts";
import { makeAgentConfig, makeSubagentSnapshot } from "./fixtures.ts";

describe("buildDescription", () => {
	it("appends available agents to the description", () => {
		const description = buildDescription([
			makeAgentConfig("scout", "investigate the codebase"),
			makeAgentConfig("planner", "produce step-by-step plans"),
		]);
		expect(description).toContain("Available agents:");
		expect(description).toContain("- scout: investigate the codebase");
		expect(description).toContain("- planner: produce step-by-step plans");
	});
});

describe("handleToolResult", () => {
	it.each([
		["aborted", { isError: true }],
		["failed", { isError: true }],
		["succeeded", undefined],
		["running", undefined],
	] as const)("status %s → %j", (status, expected) => {
		expect(handleToolResult({ toolName: "subagent", details: { status } } as ToolResultEvent)).toEqual(expected);
	});

	it("ignores other tools' results", () => {
		expect(handleToolResult({ toolName: "bash", details: { status: "failed" } } as ToolResultEvent)).toBeUndefined();
	});

	// Pi can clobber `details` on a thrown error.
	it("tolerates missing/empty details", () => {
		expect(handleToolResult({ toolName: "subagent", details: undefined } as ToolResultEvent)).toBeUndefined();
		expect(handleToolResult({ toolName: "subagent", details: {} } as ToolResultEvent)).toBeUndefined();
	});
});

describe("buildResult", () => {
	it("returns the snapshot as details and a single text block", () => {
		const snapshot = makeSubagentSnapshot({ status: "succeeded" });
		const result = buildResult(snapshot);
		expect(result.details).toBe(snapshot);
		expect(result.content).toHaveLength(1);
	});

	it("succeeded returns finalText verbatim, including empty", () => {
		expect(
			buildResult(makeSubagentSnapshot({ status: "succeeded", finalText: "the final answer is 42" })).content,
		).toEqual([{ type: "text", text: "the final answer is 42" }]);
		expect(buildResult(makeSubagentSnapshot({ status: "succeeded" })).content).toEqual([{ type: "text", text: "" }]);
	});

	it("failed returns errorMessage, or a default if missing", () => {
		expect(
			buildResult(makeSubagentSnapshot({ status: "failed", errorMessage: "Pi exited with code 1" })).content,
		).toEqual([{ type: "text", text: "Pi exited with code 1" }]);
		expect(buildResult(makeSubagentSnapshot({ status: "failed" })).content).toEqual([
			{ type: "text", text: "subagent failed" },
		]);
	});

	it("aborted returns 'subagent aborted'", () => {
		expect(buildResult(makeSubagentSnapshot({ status: "aborted" })).content).toEqual([
			{ type: "text", text: "subagent aborted" },
		]);
	});
});
