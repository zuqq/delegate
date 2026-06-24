import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
	emptySubagentState,
	finalizeSubagentState,
	parseEvent,
	type SubagentSnapshot,
	type SubagentTermination,
	snapshotSubagentState,
	updateSubagentState,
} from "./events.ts";
import type { Params } from "./schema.ts";

const SIGKILL_GRACE_MS = 5_000;

export async function runSubagent(
	params: Params,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate: (snapshot: SubagentSnapshot) => void,
): Promise<SubagentSnapshot> {
	const cliArgs = ["--mode", "json", "-p", "--no-session", params.task];

	// Bun's `--compile` standalone sets `argv[1]` to a `/$bunfs/root/...`
	// virtual path; spawn `execPath` directly in that case.
	const script = process.argv[1];
	const piArgs = !script || script.startsWith("/$bunfs/root/") ? cliArgs : [script, ...cliArgs];
	const proc = spawn(process.execPath, piArgs, {
		cwd,
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stdout = proc.stdout;
	const stderr = proc.stderr;
	if (!stdout || !stderr) throw new Error("runSubagent: expected stdout and stderr to be piped");

	let stderrText = "";
	stderr.setEncoding("utf8");
	stderr.on("data", (chunk: string) => {
		stderrText += chunk;
	});

	let aborted = false;
	const onAbort = () => {
		aborted = true;
		proc.kill("SIGTERM");
		setTimeout(() => {
			if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
		}, SIGKILL_GRACE_MS).unref();
	};
	if (signal?.aborted) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });

	const state = emptySubagentState();
	createInterface({ input: stdout }).on("line", (line) => {
		const event = parseEvent(line);
		if (!event) return;
		updateSubagentState(state, event);
		onUpdate(snapshotSubagentState(params, state, "running"));
	});

	const termination = await new Promise<SubagentTermination>((resolve) => {
		proc.once("close", (code) => {
			resolve(aborted ? { type: "aborted" } : { type: "exit", code, stderr: stderrText });
		});
		proc.once("error", (err) => {
			resolve(aborted ? { type: "aborted" } : { type: "spawnError", message: err.message });
		});
	});
	// `signal` may be shared across tool calls; detach our listener.
	signal?.removeEventListener("abort", onAbort);
	return finalizeSubagentState(params, state, termination);
}
