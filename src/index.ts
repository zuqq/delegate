/**
 * delegate — pi extension entry point.
 *
 * Registers the `delegate` tool, which spawns a separate `pi` process per
 * subagent invocation to provide an isolated context window.
 *
 * The factory is intentionally tiny: it wires together modules from `src/`
 * rather than inlining the implementation here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI): void {
	// TODO: register the `delegate` tool, command, and any prompt/agent paths.
}
