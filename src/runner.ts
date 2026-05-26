import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import {
	type AgentConfig,
	emptyUsage,
	type SubagentCall,
	type SubagentSnapshot,
	type ToolCallTrailEntry,
	type UsageStats,
} from "./types.ts";

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

type PiEvent = ToolExecutionStartEvent | MessageEndEvent;

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
		finalText: state.finalText,
	};
}

type SubagentTermination =
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
