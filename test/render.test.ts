import type { ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentSnapshot } from "../src/events.ts";
import { buildResult } from "../src/index.ts";
import {
	formatCost,
	formatDuration,
	formatTokenCount,
	type MinimalRenderContext,
	type MinimalTheme,
	renderCall,
	renderResult,
	type SubagentRenderState,
	tildify,
} from "../src/render.ts";
import { PARAMS } from "./fixtures.ts";

const USAGE = { contextTokens: 200, cost: 0.02 };

const HOME = "/home/user";

const EXPAND_HINT = "ctrl+o to expand";

const collapsed: ToolRenderResultOptions = { expanded: false, isPartial: false };
const expanded: ToolRenderResultOptions = { expanded: true, isPartial: false };
const collapsedPartial: ToolRenderResultOptions = { expanded: false, isPartial: true };
const expandedPartial: ToolRenderResultOptions = { expanded: true, isPartial: true };

const plain: MinimalTheme = { fg: (_c, t) => t, bold: (t) => t };

function makeContext(state: Partial<SubagentRenderState>): MinimalRenderContext {
	return {
		invalidate: () => {},
		state: { ...state },
		executionStarted: true,
		isError: false,
		expanded: false,
	};
}

// `truncateToWidth` emits a bare reset around its ellipsis even under `plain`.
function stripAnsiCsi(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR escape sequences
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// `Markdown` right-pads each line to the viewport.
function stripTrailingSpaces(s: string): string {
	return s.trimEnd();
}

function renderComponent(c: Component, width: number): string {
	return c.render(width).map(stripAnsiCsi).map(stripTrailingSpaces).join("\n");
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
	it.each([
		[{ description: "recon" }, "subagent recon"],
		[{}, "subagent ..."],
	] as const)("renderCall(%j) === %s", (args, expected) => {
		const c = renderCall(args, plain, makeContext({}));
		expect(renderComponent(c, 80)).toBe(expected);
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
			...PARAMS,
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`""`);
	});

	it("collapsed, running with usage but no trail", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			...USAGE,
			model: "test-model",
			trail: [],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, succeeded", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "succeeded",
			...USAGE,
			model: "test-model",
			trail,
			finalText: "the final answer is 42",
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), collapsed, plain, makeContext({}), HOME, EXPAND_HINT), 80),
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
			...PARAMS,
			status: "aborted",
			...USAGE,
			model: "test-model",
			trail: trail.slice(0, 2),
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), collapsed, plain, makeContext({}), HOME, EXPAND_HINT), 80),
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
			...PARAMS,
			status: "failed",
			errorMessage: "Pi exited with code 1",
			...USAGE,
			model: "test-model",
			trail: trail.slice(0, 2),
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), collapsed, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			$ cargo check
			read /x.ts

			Pi exited with code 1

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, 2 trail entries past `TRAIL_DISPLAY_LIMIT`", () => {
		const many = [
			{ name: "bash", args: { command: "first" } },
			{ name: "bash", args: { command: "second" } },
			...trail,
			{ name: "bash", args: { command: "cargo build" } },
		];
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			...USAGE,
			model: "test-model",
			trail: many,
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			... (2 earlier tool calls, ctrl+o to expand)
			$ cargo check
			read /x.ts
			edit /y.ts
			$ cargo build

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, 1 trail entry past `TRAIL_DISPLAY_LIMIT` (singular label)", () => {
		const many = [
			{ name: "bash", args: { command: "first" } },
			...trail,
			{ name: "bash", args: { command: "cargo build" } },
		];
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			...USAGE,
			model: "test-model",
			trail: many,
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			... (1 earlier tool call, ctrl+o to expand)
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
			...PARAMS,
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [
				{ name: "bash", args: { command: long("a") } },
				{ name: "bash", args: { command: long("b") } },
				{ name: "bash", args: { command: long("c") } },
			],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			$ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...
			$ bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb...
			$ ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc..."
		`);
	});

	it("collapsed, multi-line `bash` command", () => {
		const cmd = "cd /a && python3 -c \"\n\tdata = open('x').read()\n\"";
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [{ name: "bash", args: { command: cmd } }],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			$ cd /a && python3 -c "⏎⇥data = open('x').read()⏎""
		`);
	});

	it("expanded, multi-line `bash` command", () => {
		const cmd = 'python3 -c "\n\tprint(1)\n"';
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [{ name: "bash", args: { command: cmd } }],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), expandedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$ python3 -c "
			 	print(1)
			 ""
		`);
	});

	it("collapsed, long status row", () => {
		const longErr = `Pi exited with code 1: ${"e".repeat(500)}`;
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "failed",
			errorMessage: longErr,
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [],
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), collapsed, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Pi exited with code 1: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee..."
		`);
	});

	const errorMessageWithStackTrace =
		"Error [ERR_MODULE_NOT_FOUND]: Cannot find module\n\tat finalizeResolution\n\tat moduleResolve";

	it("collapsed, status row with newlines and tabs", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "failed",
			errorMessage: errorMessageWithStackTrace,
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsed, plain, makeContext({}), HOME, EXPAND_HINT),
				120,
			),
		).toMatchInlineSnapshot(`
			"
			Error [ERR_MODULE_NOT_FOUND]: Cannot find module⏎⇥at finalizeResolution⏎⇥at moduleResolve"
		`);
	});

	it("expanded, status row with newlines and tabs", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "failed",
			errorMessage: errorMessageWithStackTrace,
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [],
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), expanded, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			Error [ERR_MODULE_NOT_FOUND]: Cannot find module
				at finalizeResolution
				at moduleResolve"
		`);
	});

	it("collapsed, long footer row", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "succeeded",
			contextTokens: 99_999,
			cost: 0.99,
			model: "a-very-long-provider/model-name",
			trail: [],
		};
		expect(
			renderComponent(
				renderResult(
					buildResult(snapshot),
					collapsed,
					plain,
					makeContext({ startedAt: 0, endedAt: 10_000 }),
					HOME,
					EXPAND_HINT,
				),
				40,
			),
		).toMatchInlineSnapshot(`
			"
			Took 10.0s • a-very-long-provider/mod..."
		`);
	});

	it("expanded, long `bash` command", () => {
		const long = "x".repeat(200);
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [{ name: "bash", args: { command: long } }],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), expandedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$
			 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
			 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
			 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
		`);
	});

	it("expanded, narrow widths never overflow", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			task: "",
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [
				{ name: "bash", args: { command: 'echo hi; grep -rn "Result" src' } },
				{ name: "grep", args: { pattern: "Result", path: "src" } },
			],
		};
		for (const width of [1, 2, 3, 5]) {
			const container = renderResult(
				buildResult(snapshot),
				expandedPartial,
				plain,
				makeContext({}),
				HOME,
				EXPAND_HINT,
			);
			const lines = container.render(width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	it("expanded, indents wrapped continuation lines", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [
				{
					name: "bash",
					args: { command: 'echo "searching the typescript sources in repository"; grep -rn "Result" src' },
				},
				{ name: "grep", args: { pattern: "Result", path: "src" } },
			],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), expandedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				60,
			),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$ echo "searching the typescript sources in repository";
			 grep -rn "Result" src
			grep /Result/ in src"
		`);
	});

	it("expanded, succeeded with `finalText`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "succeeded",
			...USAGE,
			model: "test-model",
			trail,
			finalText: "# Hello\n\nthe final answer is 42",
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), expanded, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$ cargo check
			read /x.ts
			edit /y.ts

			Response:
			 Hello

			 the final answer is 42

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, succeeded without `finalText`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "succeeded",
			...USAGE,
			model: "test-model",
			trail,
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), expanded, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$ cargo check
			read /x.ts
			edit /y.ts

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, running with a prompt but no trail yet", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			...USAGE,
			model: "test-model",
			trail: [],
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), expandedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, shows all trail entries past `TRAIL_DISPLAY_LIMIT`", () => {
		const many = [];
		for (let i = 0; i < 10; i++) many.push({ name: "bash", args: { command: `c${i}` } });
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "succeeded",
			...USAGE,
			model: "test-model",
			trail: many,
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), expanded, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

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
			...PARAMS,
			status: "aborted",
			...USAGE,
			model: "test-model",
			trail,
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), expanded, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$ cargo check
			read /x.ts
			edit /y.ts

			Operation aborted

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, multi-line Markdown `task`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			task: "# Task\n\nDo the thing",
			status: "succeeded",
			...USAGE,
			model: "test-model",
			trail,
			finalText: "done",
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), expanded, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 Task

			 Do the thing

			$ cargo check
			read /x.ts
			edit /y.ts

			Response:
			 done

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, tool call rendering reference", () => {
		const variants = [
			{ name: "bash", args: { command: "ls -la" } },
			{ name: "bash", args: {} },
			{ name: "read", args: { path: "/x.ts" } },
			{ name: "read", args: { path: `${HOME}/src/foo.ts` } },
			{ name: "write", args: { path: "/x.ts" } },
			{ name: "edit", args: { path: "/y.ts" } },
			{ name: "ls", args: {} },
			{ name: "ls", args: { path: "/etc" } },
			{ name: "find", args: { pattern: "*.ts", path: "src" } },
			{ name: "find", args: {} },
			{ name: "grep", args: { pattern: "TODO", path: "src" } },
			{ name: "subagent", args: { description: "recon" } },
			{ name: "subagent", args: {} },
			{ name: "custom_tool", args: { foo: 1, bar: "x" } },
		];
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "succeeded",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: variants,
		};
		expect(
			renderComponent(renderResult(buildResult(snapshot), expanded, plain, makeContext({}), HOME, EXPAND_HINT), 80),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$ ls -la
			$ ...
			read /x.ts
			read ~/src/foo.ts
			write /x.ts
			edit /y.ts
			ls .
			ls /etc
			find *.ts in src
			find * in .
			grep /TODO/ in src
			subagent recon
			subagent ...
			custom_tool {"foo":1,"bar":"x"}"
		`);
	});
});

describe("renderResult: duration footer", () => {
	const trail = [{ name: "bash", args: { command: "cargo check" } }];

	it("collapsed, running with `startedAt`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			...USAGE,
			model: "test-model",
			trail,
		};
		expect(
			renderComponent(
				renderResult(
					buildResult(snapshot),
					collapsedPartial,
					plain,
					makeContext({ startedAt: 6_000 }),
					HOME,
					EXPAND_HINT,
				),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			Elapsed 4.0s • test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, succeeded with `startedAt` and `endedAt`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "succeeded",
			...USAGE,
			model: "test-model",
			trail,
		};
		expect(
			renderComponent(
				renderResult(
					buildResult(snapshot),
					collapsed,
					plain,
					makeContext({ startedAt: 1_000, endedAt: 11_000 }),
					HOME,
					EXPAND_HINT,
				),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			Took 10.0s • test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, failed with `startedAt` and `endedAt`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "failed",
			errorMessage: "Pi exited with code 1",
			...USAGE,
			model: "test-model",
			trail,
		};
		expect(
			renderComponent(
				renderResult(
					buildResult(snapshot),
					collapsed,
					plain,
					makeContext({ startedAt: 0, endedAt: 10_000 }),
					HOME,
					EXPAND_HINT,
				),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			Pi exited with code 1

			Took 10.0s • test-model, 200 context tokens, $0.02"
		`);
	});

	it("collapsed, running without `startedAt`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			...USAGE,
			model: "test-model",
			trail,
		};
		expect(
			renderComponent(
				renderResult(buildResult(snapshot), collapsedPartial, plain, makeContext({}), HOME, EXPAND_HINT),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			$ cargo check

			test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, running with `startedAt`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			...USAGE,
			model: "test-model",
			trail: [
				{ name: "bash", args: { command: "cargo check" } },
				{ name: "read", args: { path: "/x.ts" } },
				{ name: "edit", args: { path: "/y.ts" } },
			],
		};
		expect(
			renderComponent(
				renderResult(
					buildResult(snapshot),
					expandedPartial,
					plain,
					makeContext({ startedAt: 6_000 }),
					HOME,
					EXPAND_HINT,
				),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			$ cargo check
			read /x.ts
			edit /y.ts

			Elapsed 4.0s • test-model, 200 context tokens, $0.02"
		`);
	});

	it("expanded, long footer row", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			contextTokens: 99_999,
			cost: 0.99,
			model: "a-very-long-provider/model-name",
			trail: [],
		};
		expect(
			renderComponent(
				renderResult(
					buildResult(snapshot),
					expandedPartial,
					plain,
					makeContext({ startedAt: 0 }),
					HOME,
					EXPAND_HINT,
				),
				40,
			),
		).toMatchInlineSnapshot(`
			"
			Prompt:
			 do the thing

			Elapsed 10.0s •
			a-very-long-provider/model-name, 100k
			context tokens, $0.99"
		`);
	});

	it("collapsed, running with only `startedAt`", () => {
		const snapshot: SubagentSnapshot = {
			...PARAMS,
			status: "running",
			contextTokens: 0,
			cost: 0,
			model: "",
			trail: [],
		};
		expect(
			renderComponent(
				renderResult(
					buildResult(snapshot),
					collapsedPartial,
					plain,
					makeContext({ startedAt: 9_000 }),
					HOME,
					EXPAND_HINT,
				),
				80,
			),
		).toMatchInlineSnapshot(`
			"
			Elapsed 1.0s"
		`);
	});
});

describe("formatCost", () => {
	it.each([
		[0.187, "$0.19"],
		[0.004, "$0.004"],
		[0.0001, "$0.0001"],
		[0, "$0.00"],
		[0.01, "$0.01"],
		[0.001, "$0.001"],
	] as const)("formatCost(%f) === %s", (input, expected) => {
		expect(formatCost(input)).toBe(expected);
	});
});

describe("formatTokenCount", () => {
	it.each([
		[0, "0"],
		[999, "999"],
		[1_000, "1k"],
		[1_500, "1.5k"],
		[9_999, "10k"],
		[10_000, "10k"],
		[12_345, "12.3k"],
		[99_999, "100k"],
		[200_000, "200k"],
		[999_499, "999.5k"],
		[999_500, "999.5k"],
		[999_949, "999.9k"],
		[999_950, "1M"],
		[999_999, "1M"],
		[1_000_000, "1M"],
		[1_500_000, "1.5M"],
		[9_999_999, "10M"],
		[10_000_000, "10M"],
		[99_999_999, "100M"],
	] as const)("formatTokenCount(%i) === %s", (input, expected) => {
		expect(formatTokenCount(input)).toBe(expected);
	});
});

describe("formatDuration", () => {
	it.each([
		[0, "0.0s"],
		[49, "0.0s"],
		[50, "0.1s"],
		[51, "0.1s"],
		[999, "1.0s"],
		[1_000, "1.0s"],
		[4_000, "4.0s"],
		[4_049, "4.0s"],
		[4_050, "4.1s"],
		[4_051, "4.1s"],
		[4_500, "4.5s"],
		[10_000, "10.0s"],
		[60_000, "60.0s"],
		[-500, "-0.5s"],
	] as const)("formatDuration(%i) === %s", (input, expected) => {
		expect(formatDuration(input)).toBe(expected);
	});
});

describe("tildify", () => {
	it.each([
		["/home/user/delegate/src", "/home/user", "~/delegate/src"],
		["/home/user/x/", "/home/user", "~/x"],
		["/home/user//x", "/home/user", "~/x"],
		["/home/user", "/home/user", "~"],
		["/home/user/", "/home/user", "~"],
		["/home/username/x.ts", "/home/user", "/home/username/x.ts"],
		["/home/user/../root/x", "/home/user", "/home/user/../root/x"],
		["./x", "/home/user", "./x"],
		["src/render.ts", "/home/user", "src/render.ts"],
		["/", "/home/user", "/"],
		["/home/user/x", "/home/user/", "~/x"],
		["/x", "", "/x"],
	] as const)("tildify(%s, %s) === %s", (p, home, expected) => {
		expect(tildify(p, home)).toBe(expected);
	});
});
