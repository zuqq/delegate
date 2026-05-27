import * as os from "node:os";
import {
	type AgentToolResult,
	getMarkdownTheme,
	type Theme,
	type ThemeColor,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { AgentSource } from "./agents.ts";
import { formatCost, formatDuration, formatTokenCount } from "./format.ts";
import type { SubagentSnapshot, ToolCallTrailEntry, UsageStats } from "./runner.ts";
import type { Params } from "./schema.ts";

/** The subset of Pi's `Theme` we depend on, to simplify testing. */
export interface MinimalTheme {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
}

function formatAgent(agent: string | undefined, source: AgentSource | undefined): string | undefined {
	if (!agent) return agent;
	return source === "project" ? `project:${agent}` : agent;
}

function formatHeader(description: string | undefined, agent: string | undefined, theme: MinimalTheme): string {
	const placeholder = theme.fg("toolOutput", "...");
	const display = description ? theme.fg("accent", description) : placeholder;
	const agentDisplay = agent || "...";
	return `${theme.fg("toolTitle", theme.bold("subagent"))} ${display}${theme.fg("muted", ` (${agentDisplay})`)}`;
}

function tildify(p: string): string {
	const home = os.homedir();
	if (p === home) return "~";
	return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

function formatToolCall(name: string, args: Record<string, unknown>, theme: MinimalTheme): string {
	const fg = theme.fg.bind(theme);
	switch (name) {
		case "bash":
			return fg("muted", "$ ") + fg("toolOutput", (args.command as string) || "...");
		case "read": {
			const path = tildify((args.file_path || args.path || "...") as string);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let out = fg("muted", "read ") + fg("accent", path);
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				out += fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return out;
		}
		case "write": {
			const path = tildify((args.file_path || args.path || "...") as string);
			const content = (args.content as string) || "";
			const lines = content ? content.split("\n").length : 0;
			let out = fg("muted", "write ") + fg("accent", path);
			if (lines > 1) out += fg("dim", ` (${lines} lines)`);
			return out;
		}
		case "edit":
			return fg("muted", "edit ") + fg("accent", tildify((args.file_path || args.path || "...") as string));
		case "ls":
			return fg("muted", "ls ") + fg("accent", tildify((args.file_path || args.path || ".") as string));
		case "find":
			return (
				fg("muted", "find ") +
				fg("accent", (args.pattern as string) || "*") +
				fg("dim", ` in ${tildify((args.file_path || args.path || ".") as string)}`)
			);
		case "grep":
			return (
				fg("muted", "grep ") +
				fg("accent", `/${(args.pattern as string) || ""}/`) +
				fg("dim", ` in ${tildify((args.file_path || args.path || ".") as string)}`)
			);
		case "subagent": {
			const description = (args.description as string) || "...";
			const agent = (args.agent as string) || "...";
			return fg("muted", "subagent ") + fg("accent", description) + fg("dim", ` (${agent})`);
		}
		default:
			return fg("accent", name) + fg("dim", ` ${JSON.stringify(args)}`);
	}
}

/** The maximal number of tool calls to show when collapsed. */
const TRAIL_DISPLAY_LIMIT = 4;

/** The list of tool calls issued by a subagent. */
function formatTrailLines(
	trail: ToolCallTrailEntry[],
	expanded: boolean,
	theme: MinimalTheme,
	expandHint: string | undefined,
): string[] {
	if (trail.length === 0) return [];
	const fg = theme.fg.bind(theme);
	const lines: string[] = [];
	let entries = trail;
	if (!expanded && trail.length > TRAIL_DISPLAY_LIMIT) {
		const earlier = trail.length - TRAIL_DISPLAY_LIMIT;
		const noun = `tool call${earlier === 1 ? "" : "s"}`;
		lines.push(
			expandHint
				? `${fg("muted", `... (${earlier} earlier ${noun},`)} ${expandHint})`
				: fg("muted", `... (${earlier} earlier ${noun})`),
		);
		entries = trail.slice(-TRAIL_DISPLAY_LIMIT);
	}
	for (const e of entries) {
		lines.push(formatToolCall(e.name, e.args, theme));
	}
	return lines;
}

/** A terminal status row, or `undefined` while running or on success. */
function formatTerminalStatus(snapshot: SubagentSnapshot, theme: MinimalTheme): string | undefined {
	switch (snapshot.status) {
		case "running":
		case "succeeded":
			return undefined;
		case "aborted":
			return theme.fg("muted", "Operation aborted");
		case "failed":
			return theme.fg("muted", snapshot.errorMessage ?? "Operation failed");
	}
}

/** The resource summary at the end of the footer. */
function formatSummary(usage: UsageStats, model: string | undefined, theme: MinimalTheme): string {
	const parts: string[] = [];
	if (model) parts.push(model);
	// `contextTokens` is a snapshot
	if (usage.contextTokens > 0) {
		parts.push(`${formatTokenCount(usage.contextTokens)} context token${usage.contextTokens === 1 ? "" : "s"}`);
	}
	if (usage.cost) parts.push(formatCost(usage.cost));
	if (parts.length === 0) return "";
	return theme.fg("dim", parts.join(", "));
}

/** The per-frame state persisted by Pi between `renderCall` and `renderResult`. */
export interface SubagentRenderState {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
	source?: AgentSource;
}

/** The subset of Pi's `ToolRenderContext` we depend on, to simplify testing. */
interface MinimalRenderContext {
	invalidate: () => void;
	state: SubagentRenderState;
	executionStarted: boolean;
	isError: boolean;
	expanded: boolean;
}

const NEWLINE_GLYPH = "⏎";
const TAB_GLYPH = "⇥";

/** Replace `\n` and `\t` with single-cell glyphs. */
function flatten(s: string): string {
	return s.replace(/\n/g, NEWLINE_GLYPH).replace(/\t/g, TAB_GLYPH);
}

function formatRow(text: string, width: number, expanded: boolean): string[] {
	text = flatten(text);
	return expanded ? wrapTextWithAnsi(text, width) : [truncateToWidth(text, width, "...")];
}

/** The header for the subagent tool. */
export function renderCall(args: Partial<Params>, theme: Theme, context: MinimalRenderContext): Component {
	const state = context.state;
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}
	const name = formatAgent(args.agent, state.source);
	const headerText = formatHeader(args.description, name, theme);
	const expanded = context.expanded;
	return {
		render: (width: number): string[] => formatRow(headerText, width, expanded),
		invalidate: () => {},
	};
}

function renderMarkdown(text: string): Markdown {
	return new Markdown(text, 1, 0, getMarkdownTheme());
}

/** The body of the subagent tool, beneath the header. */
export function renderResult(
	result: AgentToolResult<SubagentSnapshot>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: MinimalRenderContext,
	// Inject `expandHint` for testing.
	expandHint?: string,
): Container {
	const snapshot = result.details;
	const state = context.state;
	// Mirror source so the next `renderCall` frame can badge the header.
	state.source = snapshot.source;
	const container = new Container();

	const running = options.isPartial && !context.isError;
	if (state.startedAt !== undefined && running && !state.interval) {
		state.interval = setInterval(() => context.invalidate(), 1000);
	}
	if (!running) {
		state.endedAt ??= Date.now();
		if (state.interval) {
			clearInterval(state.interval);
			state.interval = undefined;
		}
	}

	if (options.expanded && snapshot.task) {
		container.addChild(new Spacer(1));
		container.addChild(renderMarkdown(snapshot.task));
	}

	const trailLines = formatTrailLines(snapshot.trail, options.expanded, theme, expandHint);
	if (trailLines.length > 0) {
		container.addChild(new Spacer(1));
		container.addChild({
			render: (width: number): string[] => trailLines.flatMap((l) => formatRow(l, width, options.expanded)),
			invalidate: () => {},
		});
	}

	if (options.expanded && snapshot.finalText) {
		container.addChild(new Spacer(1));
		container.addChild(renderMarkdown(snapshot.finalText));
	}

	const terminalStatus = formatTerminalStatus(snapshot, theme);
	if (terminalStatus) {
		container.addChild(new Spacer(1));
		container.addChild({
			render: (width: number): string[] => formatRow(terminalStatus, width, options.expanded),
			invalidate: () => {},
		});
	}

	const startedAt = state.startedAt;
	const endedAt = state.endedAt;
	const summary = formatSummary(snapshot.usage, snapshot.model || undefined, theme);
	// Decide footer presence outside the closure: Pi's `Box` reserves spacing
	// for present children, so an empty `render` still leaves a gap.
	if (startedAt !== undefined || summary !== "") {
		container.addChild(new Spacer(1));
		container.addChild({
			render: (width: number): string[] => {
				let footer = summary;
				if (startedAt !== undefined) {
					const durationMs = (endedAt ?? Date.now()) - startedAt;
					const verb = running ? "Elapsed" : "Took";
					const duration = theme.fg("dim", `${verb} ${formatDuration(durationMs)}`);
					footer = summary ? `${duration}${theme.fg("muted", " • ")}${summary}` : duration;
				}
				return formatRow(footer, width, options.expanded);
			},
			invalidate: () => {},
		});
	}

	return container;
}
