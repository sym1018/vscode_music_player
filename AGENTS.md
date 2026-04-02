# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript VS Code extension for local music playback. Source code lives in `src/`: `extension.ts` registers commands and wires services, while `player.ts`, `playlist.ts`, `lrcParser.ts`, `statusBar.ts`, `sidebarProvider.ts`, and `detailViewProvider.ts` hold focused runtime modules. Shared types are in `src/types.ts`.

Extension assets and sample media are under `media/`; keep package icons and activity bar SVGs there. Planning notes live in `docs/plans/`. `out/` is generated build output from TypeScript/esbuild and should not be edited directly. `node_modules/`, `*.vsix`, temp files, and local sample libraries are ignored or excluded from packaging.

## Build, Test, and Development Commands

- `npm run compile` runs `tsc -p ./` and type-checks/emits the extension into `out/`.
- `npm run watch` runs TypeScript in watch mode during active development.
- `npm run build` bundles `src/extension.ts` to `out/extension.js` with esbuild, leaving `vscode` external.
- `npm run package` creates a VSIX package via `@vscode/vsce`.

There is no configured `npm test`, lint, Jest, Vitest, ESLint, or Prettier script in this project.

## Coding Style & Naming Conventions

Use TypeScript strict mode and follow the existing style: 2-space indentation, semicolons, single quotes, and concise module-level helpers. Use PascalCase for classes and interfaces, camelCase for methods/properties, and underscore-prefixed private fields where the existing modules do so. Keep filenames descriptive and camelCase, for example `statusBar.ts` or `detailViewProvider.ts`.

## Testing Guidelines

Before considering a change ready, run `npm run compile` and `npm run build`. Manually smoke test in a VS Code Extension Host: select a music folder, verify recursive scanning, play/pause, next/previous, seek, volume, speed controls, sidebar selection, detail view, and LRC lyric sync. Include no-lyrics and empty-folder cases when changing playback or playlist behavior.

## Commit & Pull Request Guidelines

Git history uses short conventional prefixes such as `feat:` and `fix:`, with occasional versioned release messages like `feat: v0.1.21 - seek, fast playback, folder improvements`. Keep commits focused and imperative. Pull requests should include a summary, validation commands, manual test notes, linked issues when relevant, and screenshots or GIFs for visible UI changes.

## Security & Configuration Tips

The extension depends on `ffmpeg` tools, especially `ffplay` and `ffprobe`, being available on `PATH`. Do not commit personal music libraries, generated `out/` files, packaged VSIX artifacts, `node_modules/`, or temporary files.
