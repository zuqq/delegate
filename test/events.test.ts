import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	emptySubagentState,
	finalizeSubagentState,
	isSubagentEvent,
	snapshotSubagentState,
	updateSubagentState,
} from "../src/events.ts";
import { PARAMS } from "./fixtures.ts";

const USER_MESSAGE = {
	role: "user",
	content: [
		{
			type: "text",
			text: "Run `echo hello` with the bash tool, then reply with exactly the word: done",
		},
	],
	timestamp: 1785710677834,
} satisfies UserMessage;

const BASH_TOOL_RESULT_MESSAGE = {
	role: "toolResult",
	toolCallId: "toolu_01TTDRbdn3U3V5uTeXRXSMBP",
	toolName: "bash",
	content: [
		{
			type: "text",
			text: "hello\n",
		},
	],
	isError: false,
	timestamp: 1785710678988,
} satisfies ToolResultMessage;

const TEXT_START_PARTIAL = {
	role: "assistant",
	content: [
		{
			type: "text",
			text: "done",
		},
	],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-haiku-4-5",
	usage: {
		input: 2874,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2875,
		cost: {
			input: 0.002874,
			output: 5e-6,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.0028789999999999996,
		},
		cacheWrite1h: 0,
	},
	stopReason: "pending",
	timestamp: 1785710678989,
	responseId: "msg_011CdejQsDKT2MRjBnaT8qRG",
} satisfies AssistantMessage;

const TOOL_EXECUTION_START = {
	type: "tool_execution_start",
	toolCallId: "toolu_01TTDRbdn3U3V5uTeXRXSMBP",
	toolName: "bash",
	args: {
		command: "echo hello",
	},
} satisfies AgentSessionEvent;

const TOOL_USE_ASSISTANT_MESSAGE = {
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: "toolu_01TTDRbdn3U3V5uTeXRXSMBP",
			name: "bash",
			arguments: {
				command: "echo hello",
			},
		},
	],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-haiku-4-5",
	usage: {
		input: 2806,
		output: 54,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2860,
		cost: {
			input: 0.002806,
			output: 0.00027,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.0030759999999999997,
		},
		cacheWrite1h: 0,
	},
	stopReason: "toolUse",
	timestamp: 1785710677870,
	responseId: "msg_011CdejQnrsykqG7UDNA4vcJ",
	rawStopReason: "tool_use",
} satisfies AssistantMessage;

const TOOL_USE_MESSAGE_END = {
	type: "message_end",
	message: TOOL_USE_ASSISTANT_MESSAGE,
} satisfies AgentSessionEvent;

const FINAL_ASSISTANT_MESSAGE = {
	role: "assistant",
	content: [
		{
			type: "text",
			text: "done",
		},
	],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-haiku-4-5",
	usage: {
		input: 2874,
		output: 4,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2878,
		cost: {
			input: 0.002874,
			output: 2e-5,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.002894,
		},
		cacheWrite1h: 0,
	},
	stopReason: "stop",
	timestamp: 1785710678989,
	responseId: "msg_011CdejQsDKT2MRjBnaT8qRG",
	rawStopReason: "end_turn",
} satisfies AssistantMessage;

const FINAL_MESSAGE_END = {
	type: "message_end",
	message: FINAL_ASSISTANT_MESSAGE,
} satisfies AgentSessionEvent;

const ERRORED_MESSAGE_END = {
	type: "message_end",
	message: {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-haiku-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "error",
		timestamp: 1783364717657,
		errorMessage:
			'400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 200698 tokens > 200000 maximum"},"request_id":"req_011CcmKqz815WbYLxNQhtp82"}',
	},
} satisfies AgentSessionEvent;

describe("isSubagentEvent", () => {
	it.each([
		["an `agent_start` event", { type: "agent_start" } satisfies AgentSessionEvent],
		["a `turn_start` event", { type: "turn_start" } satisfies AgentSessionEvent],
		["a `message_start` event", { type: "message_start", message: USER_MESSAGE } satisfies AgentSessionEvent],
		[
			"a `session_info_changed` event",
			{
				type: "session_info_changed",
				name: "User requests execution of echo hello command via bash tool followed by response of the word done",
			} satisfies AgentSessionEvent,
		],
		[
			"a `message_update` event",
			{
				type: "message_update",
				assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: TEXT_START_PARTIAL },
				message: TEXT_START_PARTIAL,
			} satisfies AgentSessionEvent,
		],
		[
			"a `tool_execution_update` event",
			{
				type: "tool_execution_update",
				toolCallId: "toolu_01TTDRbdn3U3V5uTeXRXSMBP",
				toolName: "bash",
				args: {
					command: "echo hello",
				},
				partialResult: {
					content: [],
				},
			} satisfies AgentSessionEvent,
		],
		[
			"a `tool_execution_end` event",
			{
				type: "tool_execution_end",
				toolCallId: "toolu_01TTDRbdn3U3V5uTeXRXSMBP",
				toolName: "bash",
				result: {
					content: [
						{
							type: "text",
							text: "hello\n",
						},
					],
				},
				isError: false,
			} satisfies AgentSessionEvent,
		],
		[
			"a `turn_end` event",
			{
				type: "turn_end",
				message: TOOL_USE_ASSISTANT_MESSAGE,
				toolResults: [BASH_TOOL_RESULT_MESSAGE],
			} satisfies AgentSessionEvent,
		],
		[
			"an `agent_end` event",
			{
				type: "agent_end",
				messages: [USER_MESSAGE, TOOL_USE_ASSISTANT_MESSAGE, BASH_TOOL_RESULT_MESSAGE, FINAL_ASSISTANT_MESSAGE],
				willRetry: false,
			} satisfies AgentSessionEvent,
		],
		[
			"an `agent_settled` event",
			{
				type: "agent_settled",
			} satisfies AgentSessionEvent,
		],
		["a user `message_end` event", { type: "message_end", message: USER_MESSAGE } satisfies AgentSessionEvent],
		[
			"a `toolResult` `message_end` event",
			{ type: "message_end", message: BASH_TOOL_RESULT_MESSAGE } satisfies AgentSessionEvent,
		],
	] as const)("rejects %s", (_label, event) => {
		expect(isSubagentEvent(event)).toBe(false);
	});

	it.each([
		["a `tool_execution_start` event", TOOL_EXECUTION_START],
		["an assistant `message_end` event", TOOL_USE_MESSAGE_END],
	] as const)("accepts %s", (_label, event) => {
		expect(isSubagentEvent(event)).toBe(true);
	});
});

describe("updateSubagentState", () => {
	it("appends `tool_execution_start` events to the trail", () => {
		const s = emptySubagentState();
		updateSubagentState(s, TOOL_EXECUTION_START);
		updateSubagentState(s, TOOL_EXECUTION_START);
		expect(s.trail).toEqual([
			{ name: "bash", args: { command: "echo hello" } },
			{ name: "bash", args: { command: "echo hello" } },
		]);
	});

	it("folds a tool-use assistant `message_end` into the usage fields, without `finalText`", () => {
		const s = emptySubagentState();
		updateSubagentState(s, TOOL_USE_MESSAGE_END);
		expect(s).toEqual({
			trail: [],
			contextTokens: 2860,
			cost: 0.0030759999999999997,
			model: "claude-haiku-4-5",
			stopReason: "toolUse",
		});
	});

	it("does not fold assistant text into the state (the final text comes from the session)", () => {
		const s = emptySubagentState();
		updateSubagentState(s, FINAL_MESSAGE_END);
		expect(s).toEqual({
			trail: [],
			contextTokens: 2878,
			cost: 0.002894,
			model: "claude-haiku-4-5",
			stopReason: "stop",
		});
	});

	it("records `errorMessage` from an errored assistant `message_end`", () => {
		const s = emptySubagentState();
		updateSubagentState(s, ERRORED_MESSAGE_END);
		expect(s).toMatchObject({
			stopReason: "error",
			errorMessage:
				'400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 200698 tokens > 200000 maximum"},"request_id":"req_011CcmKqz815WbYLxNQhtp82"}',
		});
	});

	it("keeps `errorMessage` when a later `message_end` lacks it", () => {
		const s = emptySubagentState();
		updateSubagentState(s, ERRORED_MESSAGE_END);
		updateSubagentState(s, TOOL_USE_MESSAGE_END);
		expect(s.errorMessage).toMatch(/prompt is too long/);
	});

	it("sums `cost` across `message_end` events but keeps only the latest `contextTokens`", () => {
		const s = emptySubagentState();
		updateSubagentState(s, TOOL_USE_MESSAGE_END);
		updateSubagentState(s, FINAL_MESSAGE_END);
		expect(s.cost).toBe(0.0030759999999999997 + 0.002894);
		expect(s.contextTokens).toBe(2878);
	});
});

describe("finalizeSubagentState", () => {
	it("returns `succeeded` on a clean completion", () => {
		const s = { ...emptySubagentState(), stopReason: "stop" as const };
		const d = finalizeSubagentState(PARAMS, s, { type: "completed" });
		expect(d.status).toBe("succeeded");
	});

	it("returns `failed` when `stopReason` is `error`, preferring the recorded `errorMessage`", () => {
		const s = { ...emptySubagentState(), stopReason: "error" as const, errorMessage: "provider 500" };
		const d = finalizeSubagentState(PARAMS, s, { type: "completed" });
		expect(d).toMatchObject({ status: "failed", errorMessage: "provider 500" });
	});

	it("returns `failed` when `stopReason` is `error`, with a generic message when no `errorMessage` was recorded", () => {
		const s = { ...emptySubagentState(), stopReason: "error" as const };
		const d = finalizeSubagentState(PARAMS, s, { type: "completed" });
		expect(d).toMatchObject({ status: "failed", errorMessage: 'Pi stopped with stopReason "error"' });
	});

	it("returns `aborted` when `stopReason` is `aborted`, even without our signal", () => {
		const s = { ...emptySubagentState(), stopReason: "aborted" as const };
		const d = finalizeSubagentState(PARAMS, s, { type: "completed" });
		expect(d.status).toBe("aborted");
	});

	it("returns `aborted` even when `stopReason` is `error`", () => {
		const s = { ...emptySubagentState(), stopReason: "error" as const };
		const d = finalizeSubagentState(PARAMS, s, { type: "aborted" });
		expect(d.status).toBe("aborted");
	});

	it("returns `failed` on a session error, with its message", () => {
		const d = finalizeSubagentState(PARAMS, emptySubagentState(), {
			type: "error",
			message: "No models available",
		});
		expect(d).toMatchObject({ status: "failed", errorMessage: "No models available" });
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
