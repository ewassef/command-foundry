# Contributing to Command Foundry

Thanks for contributing.

## Ground Rules

- Keep the app workspace-aware. New agent integrations should respect the active workspace rather than working from arbitrary directories.
- Prefer simple, composable UI changes over adding more chrome.
- Preserve the secure Electron boundary: privileged filesystem, process, and auth operations belong in `src/main` and are exposed through typed preload APIs.
- Keep raw CLI output trustworthy. Do not hide important tool output behind excessive rewriting.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Run validation before opening a pull request:

```bash
npm run typecheck
npm run build
npm run test
```

## Pull Requests

- Make focused changes.
- Include a short description of the problem and the approach you took.
- Add or update tests when behavior changes.
- If you change the UI, include screenshots or a short video when possible.

## Code Style

- TypeScript everywhere practical
- Shared types go in `src/shared`
- Renderer code should stay light-theme, clean, and component-driven
- Avoid weakening Electron security boundaries for convenience

## Release Expectations

- Pull requests are validated by GitHub Actions
- Releases are created from `main`
- Keep release-facing changes documented in the PR description
