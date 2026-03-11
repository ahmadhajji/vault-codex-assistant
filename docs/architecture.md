# Architecture

## Base

This codebase is rebuilt on top of [`takeshy/obsidian-gemini-helper`](https://github.com/takeshy/obsidian-gemini-helper).

We kept:
- Obsidian plugin shell and sidebar chat structure
- desktop CLI execution pattern
- vault context helpers
- edit confirmation and diff/history primitives

We intentionally changed:
- plugin identity to `chatgpt-sidebar-for-obsidian`
- backend posture to Codex CLI only
- runtime architecture to in-plugin CLI execution, not a localhost bridge
- durable instruction source to vault-root `AGENTS.md`
- visible feature surface to a reduced Codex-focused subset

## Runtime shape

- `src/plugin.ts`
  Entry point, command registration, settings loading, workspace state, edit history, encryption, and chat view registration.

- `src/ui/ChatView.tsx`
  Sidebar view wrapper.

- `src/ui/components/Chat.tsx`
  Main chat runtime. Handles Codex CLI chat, session resume, vault context, AGENTS injection, and note proposal/apply flows.

- `src/core/cliProvider.ts`
  CLI provider abstraction. `CodexCliProvider` is the intended active provider in this fork.

- `src/vault/*`
  Vault note operations, safe note mutation helpers, and proposal/apply behavior.

## Safety model

- vault-scoped only
- desktop only
- Codex CLI only
- no active bridge server
- no active Drive Sync or RAG runtime path
- note mutations continue to rely on explicit confirmation flows from the imported base

## Current constraints

- Some Gemini-era modules still exist in the tree but are hidden or excluded from the active build surface.
- Some inherited legacy docs from the upstream base still exist in this repository and should not be treated as authoritative for the current plugin surface.
