import {
	type AgentToolResult,
	type ExtensionAPI,
	getAgentDir,
	keyHint,
	type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { type Agent, loadAgents } from "./agents.ts";
import { emptySubagentState, type SubagentSnapshot, snapshotSubagentState } from "./events.ts";
import { renderCall, renderResult, type SubagentRenderState } from "./render.ts";
import { runSubagent } from "./run.ts";
import { type Params, ParamsSchema } from "./schema.ts";

function buildAvailableAgents(agents: Map<string, Agent>): string {
	const lines = [];
	for (const [name, agent] of agents) {
		lines.push(`- ${name}: ${agent.description}`);
	}
	return lines.sort().join("\n");
}

export function buildDescription(agents: Map<string, Agent>): string {
	const preamble =
		"Run one task in a specialized subagent with an isolated context window. Each agent has its own system prompt, model, and tools. For coordination (sequencing, branching, fan-out), emit multiple subagent calls; sibling tool calls run in parallel by default.";
	return `${preamble}\n\nAvailable agents:\n\n${buildAvailableAgents(agents)}`;
}

export function buildResult(snapshot: SubagentSnapshot): AgentToolResult<SubagentSnapshot> {
	let text: string;
	switch (snapshot.status) {
		case "running":
			text = "";
			break;
		case "succeeded":
			text = snapshot.finalText || "";
			break;
		case "failed":
			text = snapshot.errorMessage ?? "subagent failed";
			break;
		case "aborted":
			text = "subagent aborted";
			break;
	}
	return { content: [{ type: "text", text }], details: snapshot };
}

// Override `isError` via hook because throwing clobbers `details` and
// `execute`'s return can't set it.
export function handleToolResult(event: ToolResultEvent): { isError: true } | undefined {
	if (event.toolName !== "subagent") return;
	const snapshot = event.details as SubagentSnapshot | undefined;
	if (snapshot?.status === "failed" || snapshot?.status === "aborted") {
		return { isError: true };
	}
}

function buildUnknownAgentResult(params: Params, agents: Map<string, Agent>): AgentToolResult<SubagentSnapshot> {
	const errorMessage = `Unknown agent: ${params.agent}\n\nAvailable agents:\n\n${buildAvailableAgents(agents)}`;
	const snapshot = snapshotSubagentState(params, emptySubagentState(), "failed", errorMessage);
	return buildResult(snapshot);
}

export default function (pi: ExtensionAPI): void {
	const { agents, diagnostics } = loadAgents(process.cwd(), getAgentDir());

	if (diagnostics.length > 0) {
		pi.on("session_start", (_event, ctx) => {
			for (const { filePath, message } of diagnostics) {
				ctx.ui.notify(`${filePath}: ${message}`, "warning");
			}
		});
	}

	pi.on("tool_result", handleToolResult);

	pi.registerTool<typeof ParamsSchema, SubagentSnapshot, SubagentRenderState>({
		name: "subagent",
		label: "Subagent",
		description: buildDescription(agents),
		parameters: ParamsSchema,
		renderCall,
		renderResult: (result, options, theme, context) =>
			renderResult(result, options, theme, context, keyHint("app.tools.expand", "to expand")),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agent = agents.get(params.agent);
			if (!agent) return buildUnknownAgentResult(params, agents);

			const call = {
				agent: agent.name,
				source: agent.source,
				description: params.description,
				task: params.task,
			} as const;

			const initial = snapshotSubagentState(call, emptySubagentState(), "running");
			// Update immediately so the renderer shows something before the
			// child emits.
			onUpdate?.(buildResult(initial));

			const final = await runSubagent(agent, call, ctx.cwd, signal, (live) => {
				onUpdate?.(buildResult(live));
			});
			return buildResult(final);
		},
	});
}
