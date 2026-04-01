# Command Foundry

Command Foundry is an Electron desktop workspace for running CLI-based coding agents through one clean interface.

Today it is wired to GitHub Copilot CLI. The longer-term goal is a shared GUI for multiple agent backends such as Copilot CLI, Codex, Claude Code, and other command-line tools that benefit from the same workspace-aware experience.

## What It Does

- Workspace-first chat UI for agent interactions
- File explorer sidebar tied to the active workspace
- Persistent local session history
- Raw CLI output streamed directly into the transcript
- Catalog for skills, agents, MCP integrations, and sync sources
- Managed GitHub CLI/Copilot runtime checks from the desktop app

## Tech Stack

- Electron
- React
- Vite
- TypeScript
- Tailwind CSS
- Vitest

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+
- GitHub account with access to GitHub Copilot CLI if you want to run the Copilot-backed flows

### Install

```bash
npm install
```

### Run In Development

```bash
npm run dev
```

### Verify

```bash
npm run typecheck
npm run build
npm run test
```

## Project Structure

```text
src/
  main/       Electron main process, IPC, services
  preload/    Secure renderer bridge
  renderer/   React UI
  shared/     Shared contracts and types
scripts/      Development helpers
assets/       Packaged app assets
public/       Renderer static assets
```

## Development Notes

- The renderer is intentionally workspace-aware. The selected workspace is used to scope CLI operations.
- The UI is optimized around raw CLI output rather than post-processed summaries.
- The app is designed to support multiple agent runtimes over time behind a shared shell.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
