import * as os from "node:os";
import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Component, Container } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCall, renderResult, type SubagentRenderState } from "../src/render.ts";
import { emptyUsage, type SubagentSnapshot } from "../src/types.ts";
import { CALL, plain, USAGE } from "./fixtures.ts";

const collapsed: ToolRenderResultOptions = { expanded: false, isPartial: false };
const expanded: ToolRenderResultOptions = { expanded: true, isPartial: false };
const collapsedPartial: ToolRenderResultOptions = { expanded: false, isPartial: true };

const theme = plain as unknown as Parameters<typeof renderResult>[2];

function makeContext(
	state: Partial<SubagentRenderState> = {},
	flags: { executionStarted?: boolean; isError?: boolean; expanded?: boolean } = {},
) {
	return {
		invalidate: () => {},
		state: { ...state },
		executionStarted: flags.executionStarted ?? true,
		isError: flags.isError ?? false,
		expanded: flags.expanded ?? false,
	};
}

function makeResult(snapshot: SubagentSnapshot): AgentToolResult<SubagentSnapshot> {
	return { content: [{ type: "text", text: snapshot.finalText }], details: snapshot };
}

// `truncateToWidth` emits a bare reset around its ellipsis even under `plain`.
function stripAnsiCsi(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR escape sequences
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Markdown right-pads each line to the viewport.
function stripTrailingSpaces(s: string): string {
	return s.trimEnd();
}

function renderComponent(c: Component, width = 80): string {
	return c.render(width).map(stripAnsiCsi).map(stripTrailingSpaces).join("\n");
}

function renderContainer(c: Container, width = 80): string {
	return c.children
		.flatMap((child) => child.render(width))
		.map(stripAnsiCsi)
		.map(stripTrailingSpaces)
		.join("\n");
}

// The footer uses `Date.now()`.
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(10_000);
});
afterEach(() => {
	vi.useRealTimers();
});

describe("renderCall", () => {
	it("source=project", () => {
		const c = renderCall({ description: "recon", agent: "worker" }, theme, makeContext({ source: "project" }));
		expect(renderComponent(c)).toMatchInlineSnapshot(`"subagent recon (project:worker)"`);
	});

	it("source=user", () => {
		const c = renderCall({ description: "recon", agent: "worker" }, theme, makeContext({ source: "user" }));
		expect(renderComponent(c)).toMatchInlineSnapshot(`"subagent recon (worker)"`);
	});

	it("source=undefined", () => {
		const c = renderCall({ description: "recon", agent: "worker" }, theme, makeContext({}));
		expect(renderComponent(c)).toMatchInlineSnapshot(`"subagent recon (worker)"`);
	});

	it("description not yet streamed", () => {
		const c = renderCall({ agent: "worker" }, theme, makeContext());
		expect(renderComponent(c)).toMatchInlineSnapshot(`"subagent ... (worker)"`);
	});
});

describe("renderResult", () => {
	const trail = [
		{ name: "bash", args: { command: "cargo check" } },
		{ name: "read", args: { path: "/x.ts" } },
		{ name: "edit", args: { path: "/y.ts" } },
	];

	it("collapsed, running with nothing yet", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: emptyUsage(),
			model: "",
			trail: [],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext())),
		).toMatchInlineSnapshot(`""`);
	});

	it("collapsed, running with usage but no trail", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: USAGE,
			model: "test-model",
			trail: [],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, succeeded", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "succeeded",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "the final answer is 42",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			$ cargo check
			read /x.ts
			edit /y.ts

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, aborted", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "aborted",
			usage: USAGE,
			model: "test-model",
			trail: trail.slice(0, 2),
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			$ cargo check
			read /x.ts

			Operation aborted

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, failed", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "failed",
			errorMessage: "Pi exited with code 1",
			usage: USAGE,
			model: "test-model",
			trail: trail.slice(0, 2),
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			$ cargo check
			read /x.ts

			Pi exited with code 1

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, > TRAIL_DISPLAY_LIMIT entries", () => {
		const many = [
			{ name: "bash", args: { command: "first" } },
			{ name: "bash", args: { command: "second" } },
			...trail,
			{ name: "bash", args: { command: "cargo build" } },
		];
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: USAGE,
			model: "test-model",
			trail: many,
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			... (2 earlier tool calls)
			$ cargo check
			read /x.ts
			edit /y.ts
			$ cargo build

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, 1 earlier tool call (singular)", () => {
		const many = [
			{ name: "bash", args: { command: "first" } },
			...trail,
			{ name: "bash", args: { command: "cargo build" } },
		];
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: USAGE,
			model: "test-model",
			trail: many,
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			... (1 earlier tool call)
			$ cargo check
			read /x.ts
			edit /y.ts
			$ cargo build

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, long trail entries", () => {
		const long = (ch: string) => ch.repeat(500);
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: emptyUsage(),
			model: "",
			trail: [
				{ name: "bash", args: { command: long("a") } },
				{ name: "bash", args: { command: long("b") } },
				{ name: "bash", args: { command: long("c") } },
			],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext()), 80),
		).toMatchInlineSnapshot(`
			"
			$ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...
			$ bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb...
			$ ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc..."
		`);
	});

	it("collapsed, multi-line bash command", () => {
		const cmd = "cd /a && python3 -c \"\n\tdata = open('x').read()\n\"";
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: emptyUsage(),
			model: "",
			trail: [{ name: "bash", args: { command: cmd } }],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext()), 120),
		).toMatchInlineSnapshot(`
			"
			$ cd /a && python3 -c "⏎⇥data = open('x').read()⏎""
		`);
	});

	it("expanded, multi-line bash command", () => {
		const cmd = 'python3 -c "\n\tprint(1)\n"';
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: emptyUsage(),
			model: "",
			trail: [{ name: "bash", args: { command: cmd } }],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext()), 120),
		).toMatchInlineSnapshot(`
			"
			 do thing

			$ python3 -c "⏎⇥print(1)⏎""
		`);
	});

	it("collapsed, long status row", () => {
		const longErr = `Pi exited with code 1: ${"e".repeat(500)}`;
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "failed",
			errorMessage: longErr,
			usage: emptyUsage(),
			model: "",
			trail: [],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsed, theme, makeContext()), 80),
		).toMatchInlineSnapshot(`
			"
			Pi exited with code 1: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee..."
		`);
	});

	it("collapsed, long footer row", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "succeeded",
			usage: { contextTokens: 99_999, cost: 0.99 },
			model: "a-very-long-provider/model-name",
			trail: [],
			finalText: "",
		};
		expect(
			renderContainer(
				renderResult(makeResult(snapshot), collapsed, theme, makeContext({ startedAt: 0, endedAt: 10_000 })),
				40,
			),
		).toMatchInlineSnapshot(`
			"
			Took 10.0s • a-very-long-provider/mod..."
		`);
	});

	it("expanded, long bash command", () => {
		const long = "x".repeat(200);
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: emptyUsage(),
			model: "",
			trail: [{ name: "bash", args: { command: long } }],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext()), 80),
		).toMatchInlineSnapshot(`
			"
			 do thing

			$
			xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
			xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
			xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
		`);
	});

	it("expanded, succeeded with finalText", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "succeeded",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "# Hello\n\nthe final answer is 42",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			 do thing

			$ cargo check
			read /x.ts
			edit /y.ts

			 Hello

			 the final answer is 42

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, empty finalText", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "succeeded",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			 do thing

			$ cargo check
			read /x.ts
			edit /y.ts

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, running with prompt but no trail yet", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: USAGE,
			model: "test-model",
			trail: [],
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			 do thing

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, > TRAIL_DISPLAY_LIMIT entries", () => {
		const many = [];
		for (let i = 0; i < 10; i++) many.push({ name: "bash", args: { command: `c${i}` } });
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "succeeded",
			usage: USAGE,
			model: "test-model",
			trail: many,
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			 do thing

			$ c0
			$ c1
			$ c2
			$ c3
			$ c4
			$ c5
			$ c6
			$ c7
			$ c8
			$ c9

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, aborted", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "aborted",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			 do thing

			$ cargo check
			read /x.ts
			edit /y.ts

			Operation aborted

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, multi-line markdown task", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			task: "# Task\n\nDo the thing",
			status: "succeeded",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "done",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext())),
		).toMatchInlineSnapshot(`
			"
			 Task

			 Do the thing

			$ cargo check
			read /x.ts
			edit /y.ts

			 done

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("tool rendering reference", () => {
		const variants = [
			{ name: "bash", args: { command: "ls -la" } },
			{ name: "bash", args: {} },
			{ name: "read", args: { path: "/x.ts" } },
			{ name: "read", args: { path: "/x.ts", offset: 10, limit: 5 } },
			{ name: "read", args: { path: "/x.ts", offset: 42 } },
			{ name: "read", args: { path: `${os.homedir()}/src/foo.ts` } },
			{ name: "write", args: { path: "/x.ts", content: "a\nb\nc" } },
			{ name: "write", args: { path: "/x.ts", content: "single line" } },
			{ name: "write", args: { path: "/x.ts" } },
			{ name: "edit", args: { path: "/y.ts" } },
			{ name: "ls", args: {} },
			{ name: "ls", args: { path: "/etc" } },
			{ name: "find", args: { pattern: "*.ts", path: "src" } },
			{ name: "find", args: {} },
			{ name: "grep", args: { pattern: "TODO", path: "src" } },
			{ name: "subagent", args: { agent: "scout", description: "recon" } },
			{ name: "subagent", args: { agent: "scout" } },
			{ name: "subagent", args: { description: "recon" } },
			{ name: "subagent", args: {} },
			{ name: "custom_tool", args: { foo: 1, bar: "x" } },
		];
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "succeeded",
			usage: emptyUsage(),
			model: "",
			trail: variants,
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), expanded, theme, makeContext()), 120),
		).toMatchInlineSnapshot(`
			"
			 do thing

			$ ls -la
			$ ...
			read /x.ts
			read /x.ts:10-14
			read /x.ts:42
			read ~/src/foo.ts
			write /x.ts (3 lines)
			write /x.ts
			write /x.ts
			edit /y.ts
			ls .
			ls /etc
			find *.ts in src
			find * in .
			grep /TODO/ in src
			subagent recon (scout)
			subagent ... (scout)
			subagent recon (...)
			subagent ... (...)
			custom_tool {"foo":1,"bar":"x"}"
		`);
	});
});

describe("renderResult: duration footer", () => {
	const trail = [{ name: "bash", args: { command: "cargo check" } }];

	it("running, with startedAt", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "",
		};
		expect(
			renderContainer(
				renderResult(makeResult(snapshot), collapsedPartial, theme, makeContext({ startedAt: 6_000 })),
			),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			Elapsed 4.0s • test-model, 200 context tokens, $0.02"
		`);
	});

	it("succeeded, with frozen state", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "succeeded",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "",
		};
		expect(
			renderContainer(
				renderResult(makeResult(snapshot), collapsed, theme, makeContext({ startedAt: 1_000, endedAt: 11_000 })),
			),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			Took 10.0s • test-model, 200 context tokens, $0.02"
		`);
	});

	it("failed, terminal frame", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "failed",
			errorMessage: "Pi exited with code 1",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "",
		};
		expect(
			renderContainer(
				renderResult(makeResult(snapshot), collapsed, theme, makeContext({ startedAt: 0, endedAt: 10_000 })),
			),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			Pi exited with code 1

			Took 10.0s • test-model, 200 context tokens, $0.02"
		`);
	});

	it("running, no startedAt", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: USAGE,
			model: "test-model",
			trail,
			finalText: "",
		};
		expect(
			renderContainer(renderResult(makeResult(snapshot), collapsedPartial, theme, makeContext({}))),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("running, only startedAt, no usage/model", () => {
		const snapshot: SubagentSnapshot = {
			...CALL,
			status: "running",
			usage: emptyUsage(),
			model: "",
			trail: [],
			finalText: "",
		};
		expect(
			renderContainer(
				renderResult(makeResult(snapshot), collapsedPartial, theme, makeContext({ startedAt: 9_000 })),
			),
		).toMatchInlineSnapshot(`
			"
			Elapsed 1.0s"
		`);
	});
});
