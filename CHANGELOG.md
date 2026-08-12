# vscode_music_player_sym1018 Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.1.23] - 2026-08-12

### Added
- Add first-run guidance, FFmpeg dependency checks, cancellable scans, progress reporting, and scan diagnostics.
- Add embedded metadata and cover extraction with cached artwork and folder-cover fallback.
- Add playback position recovery without autoplay, an explicit stop command, and random playback history.
- Add sidebar search and media filtering with single-click preview and double-click playback.
- Add detail-view progress, volume, and speed controls, keyboard labels, and responsive narrow-editor layouts.
- Add compact and full status bar modes.

### Changed
- Reuse a single detail Webview and keep it synchronized when tracks change manually or automatically.
- Preserve playback position when pausing, seeking, changing volume, or changing speed.
- Make random-mode Previous Track follow actual listening history.
- Document the current module architecture and require unique version numbers for releases.

### Fixed
- Prevent cancelled or stale folder scans from replacing the current playlist.
- Prevent stale `ffplay` processes and spawn failures from advancing playback.
- Correct LRC offset handling, fractional timestamps, sorting, and pre-first-line lookup.
- Keep playback and UI state consistent when the configured folder is cleared.

## [0.1.22] - 2026-07-28

### Added
- Add `AGENTS.md` contributor guidance for repository workflow and release checks.

### Fixed
- Keep the main detail view synchronized when playback automatically switches songs.

## [0.1.0] - 2026-03-04

### Added
- Add local MP3, FLAC, WAV, and OGG playback through `ffplay`.
- Add synchronized LRC lyrics in the status bar and detail view.
- Add status bar controls, sidebar folder hierarchy, play modes, and configurable settings.

### Fixed
- Support Windows pause/resume without `SIGSTOP` or `SIGCONT`.
- Prevent duplicate audio streams during rapid song changes.
- Skip dependency and cache directories during recursive scans.
