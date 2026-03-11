# Contributing

Thanks for contributing to ChatGPT Sidebar for Obsidian.

## Before you start

- Open an issue for significant product or architectural changes before writing a large patch.
- Keep the plugin scoped to the currently open Obsidian vault.
- Preserve the local-first, desktop-only, Codex-first product direction.
- Do not reintroduce inactive upstream surfaces such as Gemini API, Drive Sync, or multi-provider UI without an explicit product decision.

## Development setup

```bash
npm install
npm run build
npm test
```

For iterative work, build the plugin and copy `main.js`, `manifest.json`, and `styles.css` into a test vault at:

```text
.obsidian/plugins/chatgpt-sidebar/
```

## Pull request guidelines

- Keep changes focused and well-scoped.
- Prefer small, reviewable pull requests over large rewrites.
- Include screenshots or short videos for user-facing UI changes.
- Update documentation when behavior, install steps, or settings change.
- Preserve attribution when adapting code or structure from the upstream project.

## Release expectations

- `manifest.json`, `package.json`, and `versions.json` must stay in sync for releases.
- GitHub releases should attach `main.js`, `manifest.json`, and `styles.css`.
- Community Plugins submission metadata must continue to match the plugin id `chatgpt-sidebar`.

## Code of conduct

Be respectful, direct, and constructive in issues and pull requests.
