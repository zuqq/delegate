import {
	type AgentToolResult,
	type ExtensionAPI,
	keyHint,
	type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { emptySubagentState, type SubagentSnapshot, snapshotSubagentState } from "./events.ts";
import { renderCall, renderResult, type SubagentRenderState } from "./render.ts";
import { runSubagent } from "./run.ts";
import { ParamsSchema } from "./schema.ts";

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

export default function (pi: ExtensionAPI): void {
	pi.on("tool_result", handleToolResult);

	pi.registerTool<typeof ParamsSchema, SubagentSnapshot, SubagentRenderState>({
		name: "subagent",
		label: "Subagent",
		description:
			"Run one task in a subagent with an isolated context window. For coordination (sequencing, branching, fan-out), emit multiple subagent calls; sibling tool calls run in parallel by default.",
		parameters: ParamsSchema,
		renderCall,
		renderResult: (result, options, theme, context) =>
			renderResult(result, options, theme, context, keyHint("app.tools.expand", "to expand")),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const initial = snapshotSubagentState(params, emptySubagentState(), "running");
			// Update immediately so the renderer shows something before the
			// child emits.
			onUpdate?.(buildResult(initial));

			const final = await runSubagent(params, ctx.cwd, signal, (live) => {
				onUpdate?.(buildResult(live));
			});
			return buildResult(final);
		},
	});
}
