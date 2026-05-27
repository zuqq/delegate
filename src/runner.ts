import { type ChildProcess, spawn } from "node:child_process";
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
	snapshotSubagentState,
	updateSubagentState,
} from "./events.ts";

export async function runSubagent(
	agent: AgentConfig,
	call: SubagentCall,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate: (snapshot: SubagentSnapshot) => void,
): Promise<SubagentSnapshot> {
	const cleanups: (() => void)[] = [];

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

		return await consumeSubagent(call, proc, signal, onUpdate);
	} finally {
		for (const fn of cleanups) {
			try {
				fn();
			} catch {
				// best effort
			}
		}
	}
}

const SIGKILL_GRACE_MS = 5_000;

function consumeSubagent(
	call: SubagentCall,
	proc: ChildProcess,
	signal: AbortSignal | undefined,
	onUpdate: (snapshot: SubagentSnapshot) => void,
): Promise<SubagentSnapshot> {
	const stdout = proc.stdout;
	const stderr = proc.stderr;
	if (!stdout || !stderr) {
		throw new Error("consumeSubagent: child must be spawned with stdout and stderr as pipes");
	}
	stderr.setEncoding("utf8");

	return new Promise((resolve) => {
		const state = emptySubagentState();
		let stderrText = "";
		let settled = false;
		let aborted = false;

		const settle = (snapshot: SubagentSnapshot) => {
			if (settled) return;
			settled = true;
			resolve(snapshot);
		};

		const lines = createInterface({ input: stdout });
		lines.on("line", (line) => {
			const event = parseEvent(line);
			if (!event) return;
			updateSubagentState(state, event);
			onUpdate(snapshotSubagentState(call, state, "running"));
		});

		stderr.on("data", (chunk: string) => {
			stderrText += chunk;
		});

		proc.on("close", (code) => {
			if (aborted) return settle(finalizeSubagentState(call, state, { type: "aborted" }));
			settle(finalizeSubagentState(call, state, { type: "exit", code, stderr: stderrText }));
		});

		proc.on("error", (err) => {
			if (aborted) return settle(finalizeSubagentState(call, state, { type: "aborted" }));
			settle(finalizeSubagentState(call, state, { type: "spawnError", message: err.message }));
		});

		if (signal) {
			const onAbort = () => {
				aborted = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
				}, SIGKILL_GRACE_MS).unref();
			};
			if (signal.aborted) {
				onAbort();
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
				// `signal` is shared across tool calls; detach on exit.
				const drop = () => signal.removeEventListener("abort", onAbort);
				proc.once("close", drop);
				proc.once("error", drop);
			}
		}
	});
}

async function writePromptToTmpFile(prompt: string): Promise<string> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const filePath = path.join(tmpDir, "prompt.md");
	await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return filePath;
}

function removeTmpFile(filePath: string): void {
	try {
		fs.unlinkSync(filePath);
	} catch {
		// best effort
	}
	try {
		fs.rmdirSync(path.dirname(filePath));
	} catch {
		// best effort
	}
}
