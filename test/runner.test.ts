import { describe, expect, it } from "vitest";
import {
	emptySubagentState,
	finalizeSubagentState,
	parseEvent,
	type SubagentState,
	updateSubagentState,
} from "../src/runner.ts";
import { CALL } from "./fixtures.ts";

describe("parseEvent", () => {
	it("returns undefined for blank lines and malformed JSON", () => {
		expect(parseEvent("")).toBeUndefined();
		expect(parseEvent("   ")).toBeUndefined();
		expect(parseEvent("not json")).toBeUndefined();
		expect(parseEvent("null")).toBeUndefined();
	});

	it("returns undefined for unknown event types and non-assistant messages", () => {
		expect(parseEvent(JSON.stringify({ type: "message_update" }))).toBeUndefined();
		expect(parseEvent(JSON.stringify({ type: "tool_execution_end" }))).toBeUndefined();
		expect(parseEvent(JSON.stringify({ type: "message_end", message: { role: "user" } }))).toBeUndefined();
	});

	it("parses tool_execution_start with default empty args", () => {
		const event = parseEvent(JSON.stringify({ type: "tool_execution_start", toolName: "bash" }));
		expect(event).toEqual({ type: "tool_execution_start", toolName: "bash", args: {} });
	});

	it("concatenates text parts in an assistant message and ignores other parts", () => {
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
		expect(parseEvent(line)).toMatchObject({ type: "message_end", finalText: "Hello world." });
	});
});

describe("step", () => {
	it("appends tool_execution_start to the trail, in order", () => {
		const s = emptySubagentState();
		updateSubagentState(s, { type: "tool_execution_start", toolName: "A", args: { x: 1 } });
		updateSubagentState(s, { type: "tool_execution_start", toolName: "B", args: {} });
		expect(s.trail.map((e) => e.name)).toEqual(["A", "B"]);
		expect(s.trail[0].args).toEqual({ x: 1 });
	});

	it("sums cost across message_end events but snapshots contextTokens", () => {
		const s = emptySubagentState();
		updateSubagentState(s, { type: "message_end", contextTokens: 100, cost: 0.01 });
		updateSubagentState(s, { type: "message_end", contextTokens: 200, cost: 0.02 });
		expect(s.usage).toEqual({ contextTokens: 200, cost: 0.03 });
	});

	it("records model, stopReason, errorMessage, finalText from message_end", () => {
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
});

const stateWith = (overrides: Partial<SubagentState> = {}): SubagentState => ({
	...emptySubagentState(),
	...overrides,
});

describe("finalize", () => {
	it("returns succeeded on clean exit", () => {
		const d = finalizeSubagentState(CALL, stateWith(), { type: "exit", code: 0, stderr: "" });
		expect(d.status).toBe("succeeded");
		expect(d.errorMessage).toBeUndefined();
	});

	it("returns failed when the exit code is non-zero, with a generic message", () => {
		const d = finalizeSubagentState(CALL, stateWith(), { type: "exit", code: 7, stderr: "" });
		expect(d.status).toBe("failed");
		expect(d.errorMessage).toContain("Pi exited with code 7");
	});

	it("returns failed when stopReason is 'error', preferring the recorded errorMessage", () => {
		const s = stateWith({ stopReason: "error", errorMessage: "provider 500" });
		const d = finalizeSubagentState(CALL, s, { type: "exit", code: 0, stderr: "ignored" });
		expect(d.status).toBe("failed");
		expect(d.errorMessage).toBe("provider 500");
	});

	it("falls back to stderr when no errorMessage was recorded", () => {
		const d = finalizeSubagentState(CALL, stateWith(), { type: "exit", code: 2, stderr: "bad config\n" });
		expect(d.status).toBe("failed");
		expect(d.errorMessage).toBe("bad config");
	});

	it("returns aborted regardless of exit details", () => {
		const d = finalizeSubagentState(CALL, stateWith({ stopReason: "error" }), { type: "aborted" });
		expect(d.status).toBe("aborted");
		expect(d.errorMessage).toBeUndefined();
	});

	it("returns failed with the spawn error message", () => {
		const d = finalizeSubagentState(CALL, stateWith(), { type: "spawnError", message: "ENOENT: pi" });
		expect(d.status).toBe("failed");
		expect(d.errorMessage).toBe("ENOENT: pi");
	});

	it("copies state fields into the SubagentSnapshot", () => {
		const s = stateWith({
			usage: { contextTokens: 42, cost: 0.5 },
			model: "m",
			finalText: "done",
			trail: [{ name: "bash", args: {} }],
		});
		const d = finalizeSubagentState(CALL, s, { type: "exit", code: 0, stderr: "" });
		expect(d).toMatchObject({
			usage: { contextTokens: 42, cost: 0.5 },
			model: "m",
			finalText: "done",
			trail: [{ name: "bash", args: {} }],
		});
	});
});
