import type { AgentSource } from "./agents.ts";

export interface UsageStats {
	contextTokens: number;
	cost: number;
}

export function emptyUsage(): UsageStats {
	return { contextTokens: 0, cost: 0 };
}

export interface ToolCallTrailEntry {
	name: string;
	args: Record<string, unknown>;
}

export interface SubagentCall {
	agent: string;
	source?: AgentSource;
	description: string;
	task: string;
}

export interface SubagentSnapshot extends SubagentCall {
	status: "running" | "succeeded" | "failed" | "aborted";
	/** Set on "failed" only. */
	errorMessage?: string;

	usage: UsageStats;
	model: string;

	trail: ToolCallTrailEntry[];
	finalText: string;
}

export interface SubagentState {
	usage: UsageStats;
	model: string;

	trail: ToolCallTrailEntry[];
	finalText: string;

	stopReason?: string;
	errorMessage?: string;
}

export function emptySubagentState(): SubagentState {
	return { usage: emptyUsage(), model: "", trail: [], finalText: "" };
}

interface ToolExecutionStartEvent {
	type: "tool_execution_start";
	toolName: string;
	args: Record<string, unknown>;
}

interface MessageEndEvent {
	type: "message_end";
	contextTokens?: number;
	cost?: number;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	finalText?: string;
}

export type PiEvent = ToolExecutionStartEvent | MessageEndEvent;

interface RawEvent {
	type?: string;
	toolName?: string;
	args?: Record<string, unknown>;
	message?: RawMessage;
}

interface RawMessage {
	role?: string;
	usage?: { cost?: { total?: number }; totalTokens?: number };
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	content?: RawContentPart[];
}

interface RawContentPart {
	type?: string;
	text?: string;
}

export function parseEvent(line: string): PiEvent | undefined {
	let raw: RawEvent | null;
	try {
		raw = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (raw === null) return undefined;

	if (raw.type === "tool_execution_start") return parseToolExecutionStart(raw);
	if (raw.type === "message_end") return parseMessageEnd(raw);
	return undefined;
}

function parseToolExecutionStart(raw: RawEvent): ToolExecutionStartEvent | undefined {
	if (!raw.toolName) return undefined;
	return {
		type: "tool_execution_start",
		toolName: raw.toolName,
		args: raw.args ?? {},
	};
}

function parseMessageEnd(raw: RawEvent): MessageEndEvent | undefined {
	const message = raw.message;
	if (message?.role !== "assistant") return undefined;

	const event: MessageEndEvent = { type: "message_end" };

	const totalTokens = message.usage?.totalTokens;
	if (Number.isFinite(totalTokens)) event.contextTokens = totalTokens;

	const total = message.usage?.cost?.total;
	if (Number.isFinite(total)) event.cost = total;

	if (message.model) event.model = message.model;
	if (message.stopReason) event.stopReason = message.stopReason;
	if (message.errorMessage) event.errorMessage = message.errorMessage;

	if (message.content) event.finalText = extractAssistantMessageText(message.content);

	return event;
}

function extractAssistantMessageText(content: RawContentPart[]): string | undefined {
	let text = "";
	for (const part of content) {
		if (part.type === "text" && typeof part.text === "string") {
			text += part.text;
		}
	}
	return text.trim() || undefined;
}

export function updateSubagentState(state: SubagentState, event: PiEvent): void {
	switch (event.type) {
		case "tool_execution_start":
			state.trail.push({ name: event.toolName, args: event.args });
			return;
		case "message_end":
			// snapshot, not a running sum
			if (event.contextTokens !== undefined) state.usage.contextTokens = event.contextTokens;
			if (event.cost !== undefined) state.usage.cost += event.cost;
			if (event.model) state.model = event.model;
			if (event.finalText !== undefined) state.finalText = event.finalText;
			if (event.stopReason) state.stopReason = event.stopReason;
			if (event.errorMessage) state.errorMessage = event.errorMessage;
			return;
	}
}

export function snapshotSubagentState(
	call: SubagentCall,
	state: SubagentState,
	status: SubagentSnapshot["status"],
	errorMessage?: string,
): SubagentSnapshot {
	return {
		...call,
		status,
		errorMessage,
		usage: { ...state.usage },
		model: state.model,
		trail: state.trail.slice(),
		// Suppress intermediate assistant text.
		finalText: status === "succeeded" ? state.finalText : "",
	};
}

export type SubagentTermination =
	| { type: "exit"; code: number | null; stderr: string }
	| { type: "aborted" }
	| { type: "spawnError"; message: string };

export function finalizeSubagentState(
	call: SubagentCall,
	state: SubagentState,
	termination: SubagentTermination,
): SubagentSnapshot {
	if (termination.type === "aborted") return snapshotSubagentState(call, state, "aborted");
	if (termination.type === "spawnError") return snapshotSubagentState(call, state, "failed", termination.message);

	const { code, stderr } = termination;
	const failed = (code !== null && code !== 0) || state.stopReason === "error" || state.stopReason === "aborted";
	if (failed) {
		const message = state.errorMessage ?? (stderr.trim() || `Pi exited with code ${code ?? "(null)"}`);
		return snapshotSubagentState(call, state, "failed", message);
	}
	return snapshotSubagentState(call, state, "succeeded");
}
