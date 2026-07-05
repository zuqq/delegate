import { describe, expect, it } from "vitest";
import {
	emptySubagentState,
	finalizeSubagentState,
	parseEvent,
	snapshotSubagentState,
	updateSubagentState,
} from "../src/events.ts";
import { PARAMS } from "./fixtures.ts";

describe("parseEvent", () => {
	it.each([
		[""],
		["   "],
		["not json"],
		["null"],
		['{"type":"message_update"}'],
		['{"type":"tool_execution_end"}'],
		['{"type":"tool_execution_start"}'],
		['{"type":"message_end","message":{"role":"user"}}'],
	] as const)("parseEvent(%j) === undefined", (line) => {
		expect(parseEvent(line)).toBeUndefined();
	});

	it("parses `tool_execution_start`, defaulting `args` to `{}`", () => {
		const event = parseEvent(JSON.stringify({ type: "tool_execution_start", toolName: "bash" }));
		expect(event).toEqual({ type: "tool_execution_start", toolName: "bash", args: {} });
	});

	it("concatenates the `text` parts of an assistant message, ignoring other parts", () => {
		const line = JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "Hello " },
					{ type: "toolCall", id: "1", name: "noop", arguments: {} },
					{ type: "text", text: "world." },
				],
			},
		});
		expect(parseEvent(line)).toEqual({ type: "message_end", finalText: "Hello world." });
	});

	it("extracts usage, `model`, `stopReason`, and `errorMessage` from `message_end`", () => {
		const line = JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				usage: { totalTokens: 200, cost: { total: 0.02 } },
				model: "m",
				stopReason: "error",
				errorMessage: "provider 500",
			},
		});
		expect(parseEvent(line)).toEqual({
			type: "message_end",
			contextTokens: 200,
			cost: 0.02,
			model: "m",
			stopReason: "error",
			errorMessage: "provider 500",
		});
	});
});

describe("updateSubagentState", () => {
	it("appends `tool_execution_start` events to the trail, in order", () => {
		const s = emptySubagentState();
		updateSubagentState(s, { type: "tool_execution_start", toolName: "A", args: { x: 1 } });
		updateSubagentState(s, { type: "tool_execution_start", toolName: "B", args: {} });
		expect(s.trail.map((e) => e.name)).toEqual(["A", "B"]);
		expect(s.trail[0].args).toEqual({ x: 1 });
	});

	it("sums `cost` across `message_end` events but keeps only the latest `contextTokens`", () => {
		const s = emptySubagentState();
		updateSubagentState(s, { type: "message_end", contextTokens: 100, cost: 0.01 });
		updateSubagentState(s, { type: "message_end", contextTokens: 200, cost: 0.02 });
		expect(s).toMatchObject({ contextTokens: 200, cost: 0.03 });
	});

	it("records `model`, `stopReason`, `errorMessage`, and `finalText` from `message_end`", () => {
		const s = emptySubagentState();
		updateSubagentState(s, {
			type: "message_end",
			model: "m",
			stopReason: "stop",
			errorMessage: "oops",
			finalText: "hi",
		});
		expect(s).toMatchObject({ model: "m", stopReason: "stop", errorMessage: "oops", finalText: "hi" });
	});

	it("does not clobber recorded fields with a sparse `message_end`", () => {
		const s = emptySubagentState();
		updateSubagentState(s, {
			type: "message_end",
			contextTokens: 100,
			cost: 0.01,
			model: "m",
			stopReason: "stop",
			errorMessage: "oops",
			finalText: "hi",
		});
		updateSubagentState(s, { type: "message_end" });
		expect(s).toEqual({
			trail: [],
			contextTokens: 100,
			cost: 0.01,
			model: "m",
			stopReason: "stop",
			errorMessage: "oops",
			finalText: "hi",
		});
	});
});

describe("finalizeSubagentState", () => {
	it("returns `succeeded` on a clean exit", () => {
		const d = finalizeSubagentState(PARAMS, emptySubagentState(), { type: "exit", code: 0, stderr: "" });
		expect(d.status).toBe("succeeded");
	});

	it("returns `failed` on a non-zero exit code, with a generic message", () => {
		const d = finalizeSubagentState(PARAMS, emptySubagentState(), { type: "exit", code: 7, stderr: "" });
		expect(d).toMatchObject({ status: "failed", errorMessage: "Pi exited with code 7" });
	});

	it("returns `failed` when `stopReason` is `aborted`, even on a clean exit", () => {
		const s = { ...emptySubagentState(), stopReason: "aborted" };
		const d = finalizeSubagentState(PARAMS, s, { type: "exit", code: 0, stderr: "" });
		expect(d).toMatchObject({ status: "failed", errorMessage: "Pi exited with code 0" });
	});

	it("returns `failed` when `stopReason` is `error`, preferring the recorded `errorMessage` over `stderr`", () => {
		const s = { ...emptySubagentState(), stopReason: "error", errorMessage: "provider 500" };
		const d = finalizeSubagentState(PARAMS, s, { type: "exit", code: 0, stderr: "ignored" });
		expect(d).toMatchObject({ status: "failed", errorMessage: "provider 500" });
	});

	it("returns `failed` with the trimmed `stderr` when no `errorMessage` was recorded", () => {
		const d = finalizeSubagentState(PARAMS, emptySubagentState(), { type: "exit", code: 2, stderr: "bad config\n" });
		expect(d).toMatchObject({ status: "failed", errorMessage: "bad config" });
	});

	it("returns `aborted` even when `stopReason` is `error`", () => {
		const d = finalizeSubagentState(PARAMS, { ...emptySubagentState(), stopReason: "error" }, { type: "aborted" });
		expect(d.status).toBe("aborted");
	});

	it("returns `failed` on a spawn error, with its message", () => {
		const d = finalizeSubagentState(PARAMS, emptySubagentState(), { type: "spawnError", message: "ENOENT: pi" });
		expect(d).toMatchObject({ status: "failed", errorMessage: "ENOENT: pi" });
	});
});

describe("snapshotSubagentState", () => {
	it.each([
		["succeeded", "the final answer is 42"],
		["running", undefined],
		["failed", undefined],
		["aborted", undefined],
	] as const)("snapshotSubagentState(%j): finalText === %j", (status, finalText) => {
		const s = { ...emptySubagentState(), finalText: "the final answer is 42" };
		expect(snapshotSubagentState(PARAMS, s, status)).toMatchObject({ finalText });
	});

	it("copies usage, `model`, and the trail from the state", () => {
		const s = {
			...emptySubagentState(),
			contextTokens: 42,
			cost: 0.5,
			model: "m",
			finalText: "done",
			trail: [{ name: "bash", args: {} }],
		};
		expect(snapshotSubagentState(PARAMS, s, "succeeded")).toMatchObject({
			contextTokens: 42,
			cost: 0.5,
			model: "m",
			finalText: "done",
			trail: [{ name: "bash", args: {} }],
		});
	});
});
