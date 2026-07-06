import { formatThrownValue } from "@earendil-works/pi-ai";
import { type AgentSession, createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	emptySubagentState,
	finalizeSubagentState,
	isSubagentEvent,
	type SubagentSnapshot,
	snapshotSubagentState,
	updateSubagentState,
} from "./events.ts";
import type { Params } from "./schema.ts";

export async function runSubagent(
	params: Params,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate: (snapshot: SubagentSnapshot) => void,
): Promise<SubagentSnapshot> {
	const state = emptySubagentState();
	// Update immediately so the renderer shows something before the
	// child emits.
	onUpdate(snapshotSubagentState(params, state, "running"));
	if (signal?.aborted) return finalizeSubagentState(params, state, { type: "aborted" });

	let session: AgentSession | undefined;
	const onAbort = () => {
		void session?.abort();
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		({ session } = await createAgentSession({ cwd, sessionManager: SessionManager.inMemory(cwd) }));
		session.subscribe((event) => {
			if (!isSubagentEvent(event)) return;
			updateSubagentState(state, event);
			onUpdate(snapshotSubagentState(params, state, "running"));
		});
		if (!signal?.aborted) await session.prompt(params.task);
		state.finalText = session.getLastAssistantText();
		return finalizeSubagentState(params, state, signal?.aborted ? { type: "aborted" } : { type: "completed" });
	} catch (err) {
		if (signal?.aborted) return finalizeSubagentState(params, state, { type: "aborted" });
		return finalizeSubagentState(params, state, { type: "error", message: formatThrownValue(err) });
	} finally {
		// `signal` may be shared across tool calls; detach our listener.
		signal?.removeEventListener("abort", onAbort);
		session?.dispose();
	}
}
