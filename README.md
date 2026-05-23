# `delegate`

`delegate` is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that adds support for subagents with isolated context windows.

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
