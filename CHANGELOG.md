# vscode_music_player_sym1018 Changelog

## [0.1.22] - 2026-07-28

### Added
- Add `AGENTS.md` contributor guide for repository workflow and release checks.

### Fixed
- Keep the main detail view in sync when playback automatically switches to the next song.

## [0.1.0] - 2026-03-04

### Added
- Local music playback via ffplay (MP3, FLAC, WAV, OGG)
- LRC lyrics sync with status bar display
- Status bar controls: previous, play/pause, next, volume, lyrics toggle, play mode
- Progress bar with elapsed/total time display and click-to-seek
- Sidebar TreeView with folder hierarchy and song list
- Play modes: sequence, loop all, single loop, random
- Cross-platform support (Linux, macOS, Windows)
- Configurable music folder, volume, and play mode

### Fixed
- Windows compatibility: SIGSTOP/SIGCONT replaced with kill-and-restart for pause/resume
- Multiple audio streams on rapid song switching (SIGKILL + generation counter + loadToken)
- Directory scan performance with SKIP_DIRS filter
