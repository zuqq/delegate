import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import register, { buildDescription, buildResult } from "../src/index.ts";
import { makeAgentConfig, makeSubagentSnapshot } from "./fixtures.ts";

/** Register the extension against a stub API and return the captured `tool_result` handler. */
function getToolResultHandler(): (event: unknown) => unknown {
	const handlers = new Map<string, (event: unknown) => unknown>();
	const api = {
		registerTool: vi.fn(),
		on: vi.fn((event: string, handler: (event: unknown) => unknown) => {
			handlers.set(event, handler);
		}),
	} as unknown as ExtensionAPI;
	register(api);
	const handler = handlers.get("tool_result");
	if (!handler) throw new Error("tool_result handler not registered");
	return handler;
}

describe("buildDescription", () => {
	it("returns the preamble alone when no agents are discovered", () => {
		const description = buildDescription([]);
		expect(description).toContain("Run one task in a specialized subagent");
		expect(description).not.toContain("Available agents:");
	});

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

describe("tool_result hook", () => {
	it.each([
		["aborted", { isError: true }],
		["failed", { isError: true }],
		["succeeded", undefined],
		["running", undefined],
	] as const)("status %s → %j", (status, expected) => {
		const handler = getToolResultHandler();
		expect(handler({ toolName: "subagent", details: makeSubagentSnapshot({ status }) })).toEqual(expected);
	});

	it("ignores other tools' results", () => {
		const handler = getToolResultHandler();
		expect(handler({ toolName: "bash", details: { status: "failed" } })).toBeUndefined();
	});

	// Pi can clobber `details` on a thrown error.
	it("tolerates missing/empty details", () => {
		const handler = getToolResultHandler();
		expect(handler({ toolName: "subagent", details: undefined })).toBeUndefined();
		expect(handler({ toolName: "subagent", details: {} })).toBeUndefined();
	});
});

describe("buildResult", () => {
	it("returns the snapshot as details and a single text block", () => {
		const snapshot = makeSubagentSnapshot();
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

	it("running returns finalText (in-flight content is unread by the LLM)", () => {
		expect(buildResult(makeSubagentSnapshot({ status: "running", finalText: "partial" })).content).toEqual([
			{ type: "text", text: "partial" },
		]);
	});
});
