// src/index.ts
import {
  keyHint
} from "@earendil-works/pi-coding-agent";

// src/events.ts
function emptySubagentState() {
  return { trail: [], contextTokens: 0, cost: 0 };
}
function parseEvent(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return void 0;
  }
  if (raw === null) return void 0;
  if (raw.type === "tool_execution_start") return parseToolExecutionStart(raw);
  if (raw.type === "message_end") return parseMessageEnd(raw);
  return void 0;
}
function parseToolExecutionStart(raw) {
  if (!raw.toolName) return void 0;
  return {
    type: "tool_execution_start",
    toolName: raw.toolName,
    args: raw.args ?? {}
  };
}
function parseMessageEnd(raw) {
  const message = raw.message;
  if (message?.role !== "assistant") return void 0;
  const event = { type: "message_end" };
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
function extractAssistantMessageText(content) {
  let text = "";
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text.trim() || void 0;
}
function updateSubagentState(state, event) {
  switch (event.type) {
    case "tool_execution_start":
      state.trail.push({ name: event.toolName, args: event.args });
      return;
    case "message_end":
      if (event.contextTokens !== void 0) state.contextTokens = event.contextTokens;
      if (event.cost !== void 0) state.cost += event.cost;
      if (event.model) state.model = event.model;
      if (event.finalText) state.finalText = event.finalText;
      if (event.stopReason) state.stopReason = event.stopReason;
      if (event.errorMessage) state.errorMessage = event.errorMessage;
      return;
  }
}
function snapshotSubagentState(params, state, status, errorMessage) {
  return {
    ...params,
    // Alias the append-only `state.trail`.
    trail: state.trail,
    contextTokens: state.contextTokens,
    cost: state.cost,
    model: state.model,
    status,
    // Suppress intermediate assistant text.
    finalText: status === "succeeded" ? state.finalText : void 0,
    errorMessage
  };
}
function finalizeSubagentState(params, state, termination) {
  if (termination.type === "aborted") return snapshotSubagentState(params, state, "aborted");
  if (termination.type === "spawnError") return snapshotSubagentState(params, state, "failed", termination.message);
  const { code, stderr } = termination;
  const failed = code !== null && code !== 0 || state.stopReason === "error" || state.stopReason === "aborted";
  if (failed) {
    const message = state.errorMessage ?? (stderr.trim() || `Pi exited with code ${code ?? "(null)"}`);
    return snapshotSubagentState(params, state, "failed", message);
  }
  return snapshotSubagentState(params, state, "succeeded");
}

// src/render.ts
import * as os from "node:os";
import {
  getMarkdownTheme
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
function stripZeroFraction(s) {
  return s.replace(/\.0+$/, "");
}
function formatTokenCount(count) {
  if (count < 1e3) return count.toString();
  const k = Math.round(count / 100) / 10;
  if (k < 1e3) return `${stripZeroFraction(k.toFixed(1))}k`;
  const m = Math.round(count / 1e5) / 10;
  return `${stripZeroFraction(m.toFixed(1))}M`;
}
function formatCost(cost) {
  const two = cost.toFixed(2);
  if (cost === 0 || two !== "0.00") return `$${two}`;
  const three = cost.toFixed(3);
  if (three !== "0.000") return `$${three}`;
  return `$${cost.toFixed(4)}`;
}
function formatDuration(ms) {
  const tenths = Math.round(ms / 100);
  return `${(tenths / 10).toFixed(1)}s`;
}
function formatHeader(description, theme) {
  const toolDisplay = theme.fg("toolTitle", theme.bold("subagent"));
  const descriptionDisplay = theme.fg("accent", description || "...");
  return `${toolDisplay} ${descriptionDisplay}`;
}
function tildify(p) {
  const home = os.homedir();
  if (p === home) return "~";
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}
function formatToolCall(name, args, theme) {
  const fg = theme.fg.bind(theme);
  switch (name) {
    case "bash":
      return fg("muted", "$ ") + fg("toolOutput", args.command || "...");
    case "read": {
      const path = tildify(args.file_path || args.path || "...");
      const offset = args.offset;
      const limit = args.limit;
      let out = fg("muted", "read ") + fg("accent", path);
      if (offset !== void 0 || limit !== void 0) {
        const start = offset ?? 1;
        const end = limit !== void 0 ? start + limit - 1 : "";
        out += fg("warning", `:${start}${end ? `-${end}` : ""}`);
      }
      return out;
    }
    case "write": {
      const path = tildify(args.file_path || args.path || "...");
      const content = args.content || "";
      const lines = content ? content.split("\n").length : 0;
      let out = fg("muted", "write ") + fg("accent", path);
      if (lines > 1) out += fg("dim", ` (${lines} lines)`);
      return out;
    }
    case "edit":
      return fg("muted", "edit ") + fg("accent", tildify(args.file_path || args.path || "..."));
    case "ls":
      return fg("muted", "ls ") + fg("accent", tildify(args.file_path || args.path || "."));
    case "find":
      return fg("muted", "find ") + fg("accent", args.pattern || "*") + fg("dim", ` in ${tildify(args.file_path || args.path || ".")}`);
    case "grep":
      return fg("muted", "grep ") + fg("accent", `/${args.pattern || ""}/`) + fg("dim", ` in ${tildify(args.file_path || args.path || ".")}`);
    case "subagent": {
      const description = args.description || "...";
      return fg("muted", "subagent ") + fg("accent", description);
    }
    default:
      return fg("accent", name) + fg("dim", ` ${JSON.stringify(args)}`);
  }
}
var TRAIL_DISPLAY_LIMIT = 4;
var TRAIL_CONTINUATION_INDENTATION = 1;
function formatTrailLines(trail, expanded, theme, expandHint) {
  if (trail.length === 0) return [];
  const fg = theme.fg.bind(theme);
  const lines = [];
  let entries = trail;
  if (!expanded && trail.length > TRAIL_DISPLAY_LIMIT) {
    const earlier = trail.length - TRAIL_DISPLAY_LIMIT;
    const noun = `tool call${earlier === 1 ? "" : "s"}`;
    lines.push(
      expandHint ? `${fg("muted", `... (${earlier} earlier ${noun},`)} ${expandHint})` : fg("muted", `... (${earlier} earlier ${noun})`)
    );
    entries = trail.slice(-TRAIL_DISPLAY_LIMIT);
  }
  for (const e of entries) {
    lines.push(formatToolCall(e.name, e.args, theme));
  }
  return lines;
}
function formatTerminalStatus(snapshot, theme) {
  switch (snapshot.status) {
    case "running":
    case "succeeded":
      return void 0;
    case "aborted":
      return theme.fg("muted", "Operation aborted");
    case "failed":
      return theme.fg("muted", snapshot.errorMessage ?? "Operation failed");
  }
}
function formatSummary(contextTokens, cost, model, theme) {
  if (!model) return "";
  const parts = [];
  parts.push(model);
  parts.push(`${formatTokenCount(contextTokens)} context token${contextTokens === 1 ? "" : "s"}`);
  parts.push(formatCost(cost));
  return theme.fg("dim", parts.join(", "));
}
var NEWLINE_GLYPH = "\u23CE";
var TAB_GLYPH = "\u21E5";
function flatten(s) {
  return s.replace(/\n/g, NEWLINE_GLYPH).replace(/\t/g, TAB_GLYPH);
}
function formatRow(text, width, expanded) {
  return expanded ? wrapTextWithAnsi(text, width) : [truncateToWidth(flatten(text), width, "...")];
}
function wrapTrailRow(text, width) {
  const indentation = Math.max(0, Math.min(TRAIL_CONTINUATION_INDENTATION, width - 1));
  const prefix = " ".repeat(indentation);
  const wrapped = wrapTextWithAnsi(text, Math.max(1, width - indentation));
  return wrapped.map((line, i) => i === 0 ? line : prefix + line);
}
function renderCall(args, theme, context) {
  const state = context.state;
  if (context.executionStarted && state.startedAt === void 0) {
    state.startedAt = Date.now();
    state.endedAt = void 0;
  }
  const headerText = formatHeader(args.description, theme);
  const expanded = context.expanded;
  return {
    render: (width) => formatRow(headerText, width, expanded),
    invalidate: () => {
    }
  };
}
function renderMarkdown(text) {
  return new Markdown(text, 1, 0, getMarkdownTheme());
}
function renderLabel(label, theme) {
  const text = theme.fg("muted", label);
  return {
    render: (width) => formatRow(text, width, true),
    invalidate: () => {
    }
  };
}
function renderResult(result, options, theme, context, expandHint) {
  const snapshot = result.details;
  const state = context.state;
  const container = new Container();
  const running = options.isPartial && !context.isError;
  if (state.startedAt !== void 0 && running && !state.interval) {
    state.interval = setInterval(() => context.invalidate(), 1e3);
  }
  if (!running) {
    state.endedAt ??= Date.now();
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = void 0;
    }
  }
  if (options.expanded && snapshot.task) {
    container.addChild(new Spacer(1));
    container.addChild(renderLabel("Prompt:", theme));
    container.addChild(renderMarkdown(snapshot.task));
  }
  const trailLines = formatTrailLines(snapshot.trail, options.expanded, theme, expandHint);
  if (trailLines.length > 0) {
    container.addChild(new Spacer(1));
    container.addChild({
      render: (width) => trailLines.flatMap((l) => options.expanded ? wrapTrailRow(l, width) : formatRow(l, width, false)),
      invalidate: () => {
      }
    });
  }
  if (options.expanded && snapshot.status === "succeeded" && snapshot.finalText) {
    container.addChild(new Spacer(1));
    container.addChild(renderLabel("Response:", theme));
    container.addChild(renderMarkdown(snapshot.finalText));
  }
  const terminalStatus = formatTerminalStatus(snapshot, theme);
  if (terminalStatus) {
    container.addChild(new Spacer(1));
    container.addChild({
      render: (width) => formatRow(terminalStatus, width, options.expanded),
      invalidate: () => {
      }
    });
  }
  const startedAt = state.startedAt;
  const endedAt = state.endedAt;
  const summary = formatSummary(snapshot.contextTokens, snapshot.cost, snapshot.model, theme);
  if (startedAt !== void 0 || summary !== "") {
    container.addChild(new Spacer(1));
    container.addChild({
      render: (width) => {
        let footer = summary;
        if (startedAt !== void 0) {
          const durationMs = (endedAt ?? Date.now()) - startedAt;
          const verb = running ? "Elapsed" : "Took";
          const duration = theme.fg("dim", `${verb} ${formatDuration(durationMs)}`);
          footer = summary ? `${duration}${theme.fg("muted", " \u2022 ")}${summary}` : duration;
        }
        return formatRow(footer, width, options.expanded);
      },
      invalidate: () => {
      }
    });
  }
  return container;
}

// src/run.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
var SIGKILL_GRACE_MS = 5e3;
async function runSubagent(params, cwd, signal, onUpdate) {
  const script = process.argv[1];
  const piArgs = ["--mode", "json", "-p", "--no-session", params.task];
  const args = script.startsWith("/$bunfs/root/") ? piArgs : [script, ...piArgs];
  const proc = spawn(process.execPath, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = proc.stdout;
  const stderr = proc.stderr;
  let stderrText = "";
  stderr.setEncoding("utf8");
  stderr.on("data", (chunk) => {
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
  const termination = await new Promise((resolve) => {
    proc.once("close", (code) => {
      resolve(aborted ? { type: "aborted" } : { type: "exit", code, stderr: stderrText });
    });
    proc.once("error", (err) => {
      resolve(aborted ? { type: "aborted" } : { type: "spawnError", message: err.message });
    });
  });
  signal?.removeEventListener("abort", onAbort);
  return finalizeSubagentState(params, state, termination);
}

// src/schema.ts
import { Type } from "typebox";
var ParamsSchema = Type.Object({
  task: Type.String({
    description: "The task for the subagent to perform. It shares no history, so include everything it needs.",
    minLength: 1
  }),
  description: Type.String({
    description: "A short description of the task, used to identify this subagent call in the transcript.",
    minLength: 1
  })
});

// src/index.ts
function buildResult(snapshot) {
  let text;
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
function handleToolResult(event) {
  if (event.toolName !== "subagent") return;
  const snapshot = event.details;
  if (snapshot?.status === "failed" || snapshot?.status === "aborted") {
    return { isError: true };
  }
}
function index_default(pi) {
  pi.on("tool_result", handleToolResult);
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run one task in a subagent with an isolated context window. For coordination (sequencing, branching, fan-out), emit multiple subagent calls; sibling tool calls run in parallel by default.",
    parameters: ParamsSchema,
    renderCall,
    renderResult: (result, options, theme, context) => renderResult(result, options, theme, context, keyHint("app.tools.expand", "to expand")),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const initial = snapshotSubagentState(params, emptySubagentState(), "running");
      onUpdate?.(buildResult(initial));
      const final = await runSubagent(params, ctx.cwd, signal, (live) => {
        onUpdate?.(buildResult(live));
      });
      return buildResult(final);
    }
  });
}
export {
  buildResult,
  index_default as default,
  handleToolResult
};
