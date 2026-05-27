import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import type { AgentConfig } from "./agents.ts";
import {
	emptySubagentState,
	finalizeSubagentState,
	parseEvent,
	type SubagentCall,
	type SubagentSnapshot,
	type SubagentTermination,
	snapshotSubagentState,
	updateSubagentState,
} from "./events.ts";

const SIGKILL_GRACE_MS = 5_000;

export async function runSubagent(
	agent: AgentConfig,
	call: SubagentCall,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate: (snapshot: SubagentSnapshot) => void,
): Promise<SubagentSnapshot> {
	const cleanups: (() => Promise<void>)[] = [];

	try {
		const cliArgs: string[] = ["--mode", "json", "-p", "--no-session"];
		if (agent.model) cliArgs.push("--model", agent.model);
		if (agent.tools?.length) cliArgs.push("--tools", agent.tools.join(","));
		if (agent.systemPrompt) {
			const promptPath = await writePromptToTmpFile(agent.systemPrompt);
			cleanups.push(() => removeTmpFile(promptPath));
			cliArgs.push("--append-system-prompt", promptPath);
		}
		cliArgs.push(call.task);

		const proc = spawn("pi", cliArgs, {
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
			onUpdate(snapshotSubagentState(call, state, "running"));
		});

		try {
			const termination = await new Promise<SubagentTermination>((resolve) => {
				proc.once("close", (code) => {
					resolve(aborted ? { type: "aborted" } : { type: "exit", code, stderr: stderrText });
				});
				proc.once("error", (err) => {
					resolve(aborted ? { type: "aborted" } : { type: "spawnError", message: err.message });
				});
			});
			return finalizeSubagentState(call, state, termination);
		} finally {
			// `signal` may be shared across tool calls; detach our listener.
			signal?.removeEventListener("abort", onAbort);
		}
	} finally {
		for (const fn of cleanups) {
			try {
				await fn();
			} catch {
				// best effort
			}
		}
	}
}

async function writePromptToTmpFile(prompt: string): Promise<string> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const filePath = path.join(tmpDir, "prompt.md");
	await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return filePath;
}

async function removeTmpFile(filePath: string): Promise<void> {
	await fs.promises.rm(path.dirname(filePath), { recursive: true, force: true });
}
