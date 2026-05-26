export type AgentSource = "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export interface SkippedAgent {
	filePath: string;
	reason: string;
}

export interface AgentCatalog {
	loaded: AgentConfig[];
	skipped: SkippedAgent[];
}

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
