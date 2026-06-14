import type { AgentSource } from "./agents.ts";

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

interface SubagentTrace {
	trail: ToolCallTrailEntry[];
	contextTokens: number;
	cost: number;
	model?: string;
}

export type SubagentStatus =
	| { status: "running" }
	| { status: "succeeded"; finalText?: string }
	| { status: "failed"; errorMessage?: string }
	| { status: "aborted" };

export type SubagentSnapshot = SubagentCall & SubagentTrace & SubagentStatus;

export interface SubagentState {
	trail: ToolCallTrailEntry[];
	contextTokens: number;
	cost: number;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	finalText?: string;
}

export function emptySubagentState(): SubagentState {
	return { trail: [], contextTokens: 0, cost: 0 };
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

type Event = ToolExecutionStartEvent | MessageEndEvent;

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
	content?: RawContent[];
}

interface RawContent {
	type?: string;
	text?: string;
}

export function parseEvent(line: string): Event | undefined {
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

function extractAssistantMessageText(content: RawContent[]): string | undefined {
	let text = "";
	for (const part of content) {
		if (part.type === "text" && typeof part.text === "string") {
			text += part.text;
		}
	}
	return text.trim() || undefined;
}

export function updateSubagentState(state: SubagentState, event: Event): void {
	switch (event.type) {
		case "tool_execution_start":
			state.trail.push({ name: event.toolName, args: event.args });
			return;
		case "message_end":
			// snapshot, not a running sum
			if (event.contextTokens !== undefined) state.contextTokens = event.contextTokens;
			if (event.cost !== undefined) state.cost += event.cost;
			if (event.model) state.model = event.model;
			if (event.finalText) state.finalText = event.finalText;
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
		trail: state.trail.slice(),
		contextTokens: state.contextTokens,
		cost: state.cost,
		model: state.model,
		status,
		// Suppress intermediate assistant text.
		finalText: status === "succeeded" ? state.finalText : undefined,
		errorMessage,
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
