# `delegate`

`delegate` is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that adds support for subagents with isolated context windows.
Architecturally, `delegate` borrows heavily from Pi's [`subagent` extension example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent).
The crucial difference between these two extensions is that `delegate` leaves coordination (sequencing, branching, fan-out) to the agent, whereas the upstream extension exposes `chain` and `parallel` primitives.
This works because the agent can sequence tool calls across turns, and Pi executes tool calls from a single assistant message in parallel.
`delegate` accepts the same agent `.md` format as the upstream extension.

## Installation

```bash
pi install git:github.com/zuqq/delegate
```

For local development, clone `delegate` and reference it in `~/.pi/agent/settings.json`:

```json
{
	"packages": ["/absolute/path/to/delegate"]
}
```

## Development

```bash
npm install
npm run check
npm run lint:fix
npm run typecheck
npm test
```

## License

[MIT](./LICENSE)
