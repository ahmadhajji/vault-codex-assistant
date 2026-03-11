# ChatGPT Sidebar for Obsidian

ChatGPT Sidebar for Obsidian is an Obsidian desktop plugin that brings a ChatGPT-style assistant into the vault sidebar. It is local-first, scoped to the currently open vault, and designed around Codex CLI rather than a hosted multi-provider setup.

This project is derived from [`takeshy/obsidian-gemini-helper`](https://github.com/takeshy/obsidian-gemini-helper), with the product surface intentionally narrowed and reworked for a Codex-first Obsidian workflow.

## Features

- Vault-scoped chat in an Obsidian sidebar
- Codex CLI as the only supported backend
- Automatic vault-root `AGENTS.md` loading by default
- Active-note and vault-file context integration
- `@file.md` references for vault files
- `/model`, `/fast`, and `/status` chat commands
- Structured thinking/progress display with a clearly separated final answer
- Desktop-only runtime with local CLI execution

## Scope and Requirements

- Obsidian desktop `1.10.0` or newer
- A working local [`codex`](https://github.com/openai/codex) installation
- A vault where you want the assistant confined to the current workspace

This plugin is intentionally desktop-only and local-first. It does not use a localhost bridge in the active runtime path, and it does not expose the broader Gemini Helper feature surface such as Gemini API, Claude CLI, Drive Sync, RAG, or workflow-first UI.

## Install

### Manual install from GitHub releases

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create this folder in your vault:

```text
.obsidian/plugins/chatgpt-sidebar-for-obsidian/
```

3. Copy those release files into that folder.
4. In Obsidian, open `Settings -> Community plugins`.
5. Reload plugins and enable `ChatGPT Sidebar for Obsidian`.

### Local development install

```bash
npm install
npm run build
```

Then copy:

- `main.js`
- `manifest.json`
- `styles.css`

into `.obsidian/plugins/chatgpt-sidebar-for-obsidian/` in a test vault.

## Usage

1. Open the ChatGPT sidebar from the command palette or ribbon.
2. Confirm the plugin can find your `codex` executable in settings.
3. Optionally add an `AGENTS.md` file to the vault root for durable vault instructions.
4. Start chatting about the current vault.

Useful chat affordances:

- `@some-note.md` to reference a vault file
- `/model <name>` to set the current runtime model
- `/fast` to toggle the fast-mode shortcut
- `/status` to show the current Codex runtime state

## Attribution

This repository builds on the upstream architecture and earlier work in [`takeshy/obsidian-gemini-helper`](https://github.com/takeshy/obsidian-gemini-helper). The fork keeps that project’s useful Obsidian plugin foundation while changing the runtime model, branding, and product direction for a vault-scoped Codex assistant.

This project is not affiliated with Obsidian, OpenAI, or the upstream project maintainer.

## Development

```bash
npm install
npm run build
npm test
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
