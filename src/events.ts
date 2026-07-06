import type { AssistantMessage, StopReason } from "@earendil-works/pi-ai";
import { type AgentSessionEvent, calculateContextTokens } from "@earendil-works/pi-coding-agent";
import type { Params } from "./schema.ts";

export interface ToolCallTrailEntry {
	name: string;
	args: Record<string, unknown>;
}

interface SubagentTrace {
	trail: ToolCallTrailEntry[];
	contextTokens: number;
	cost: number;
	model: string | undefined;
}

export type SubagentStatus =
	| { status: "running" }
	| { status: "succeeded"; finalText?: string }
	| { status: "failed"; errorMessage?: string }
	| { status: "aborted" };

export type SubagentSnapshot = Params & SubagentTrace & SubagentStatus;

export interface SubagentState extends SubagentTrace {
	stopReason?: StopReason;
	errorMessage?: string;
	finalText?: string;
}

export function emptySubagentState(): SubagentState {
	return { trail: [], contextTokens: 0, cost: 0, model: undefined };
}

export type SubagentEvent =
	| Extract<AgentSessionEvent, { type: "tool_execution_start" }>
	| { type: "message_end"; message: AssistantMessage };

export function isSubagentEvent(event: AgentSessionEvent): event is SubagentEvent {
	return event.type === "tool_execution_start" || (event.type === "message_end" && event.message.role === "assistant");
}

export function updateSubagentState(state: SubagentState, event: SubagentEvent): void {
	switch (event.type) {
		case "tool_execution_start":
			state.trail.push({ name: event.toolName, args: event.args });
			return;
		case "message_end": {
			const message = event.message;
			// `contextTokens` is a snapshot, not a delta.
			state.contextTokens = calculateContextTokens(message.usage);
			state.cost += message.usage.cost.total;
			state.model = message.model;
			state.stopReason = message.stopReason;
			if (message.errorMessage) state.errorMessage = message.errorMessage;
			return;
		}
	}
}

export function snapshotSubagentState(
	params: Params,
	state: SubagentState,
	status: SubagentSnapshot["status"],
	errorMessage?: string,
): SubagentSnapshot {
	return {
		...params,
		// Alias the append-only `state.trail`.
		trail: state.trail,
		contextTokens: state.contextTokens,
		cost: state.cost,
		model: state.model,
		status,
		// Suppress intermediate assistant text.
		finalText: status === "succeeded" ? state.finalText : undefined,
		errorMessage,
	};
}

type SubagentTermination = { type: "completed" } | { type: "aborted" } | { type: "error"; message: string };

export function finalizeSubagentState(
	params: Params,
	state: SubagentState,
	termination: SubagentTermination,
): SubagentSnapshot {
	switch (termination.type) {
		case "completed": {
			if (state.stopReason === "aborted") {
				return snapshotSubagentState(params, state, "aborted");
			}
			if (state.stopReason === "error") {
				const message = state.errorMessage ?? 'Pi stopped with stopReason "error"';
				return snapshotSubagentState(params, state, "failed", message);
			}
			return snapshotSubagentState(params, state, "succeeded");
		}
		case "aborted":
			return snapshotSubagentState(params, state, "aborted");
		case "error":
			return snapshotSubagentState(params, state, "failed", termination.message);
	}
}
