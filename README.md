# VS Code Music Player

A Windows x64 local music player for Visual Studio Code with synchronized LRC lyrics, media metadata, album art, playback recovery, and editor-native controls.

[View on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=sym1018.vscode-music-player-sym1018)

## Features

- Play MP3, FLAC, WAV, and OGG files through the bundled `ffplay` runtime.
- Browse audio, image, and video files in a recursive folder tree.
- Search by title, artist, album, or filename and filter by media type.
- Single-click audio to preview details; double-click to start playback.
- Read embedded title, artist, album, duration, and cover art with folder-cover fallback.
- Display synchronized `.lrc` lyrics in the detail view and status bar.
- Control progress, volume, speed, previous/next, play/pause, and stop.
- Use sequence, loop-all, single-repeat, or history-aware random playback.
- Restore the last track and position without autoplay.
- Switch between compact and full status bar layouts.

## Requirements

Use Windows x64. The extension includes the required `ffmpeg`, `ffplay`, `ffprobe`, and shared runtime DLLs, so no separate FFmpeg installation or `PATH` configuration is required.

Run **Music Player: Check Bundled FFmpeg Runtime** from the Command Palette if playback or metadata inspection fails. Reinstall the extension if any bundled runtime file is reported missing.

## Quick Start

1. Open the Music Player activity bar view.
2. Select a media folder with the folder button.
3. Use search and filter buttons to narrow the tree when needed.
4. Click an audio item for its detail view or double-click to play it.
5. Control playback from the detail view or status bar.

The default compact status bar shows previous, play/pause, stop, next, elapsed/total time, track, and lyric text. Set `musicPlayer.statusBarMode` to `full` for seek, volume, speed, lyric, and play-mode controls.

## Architecture

The extension is bundled from `src/extension.ts` to `out/extension.js`. `extension.ts` is the composition root and coordinates these modules:

| Module | Responsibility |
|--------|----------------|
| `player.ts` | Owns the bundled `ffplay` child process, position tracking, pause/resume, seek, volume, speed, and stop behavior. |
| `ffmpegTools.ts` | Resolves and executes the packaged Windows x64 FFmpeg tools without consulting `PATH`. |
| `playlist.ts` | Scans supported media atomically, preserves selection, and implements sequence, loop, single, and random-history navigation. |
| `mediaMetadata.ts` | Checks the bundled runtime, reads tags/duration with `ffprobe`, and caches covers extracted by `ffmpeg`. |
| `lrcParser.ts` | Parses timed lyrics, offsets, and fractional timestamps and resolves the active line. |
| `sidebarProvider.ts` | Builds the searchable/filterable media tree and marks the current audio item. |
| `detailViewProvider.ts` | Maintains one responsive Webview for cover art, controls, progress, and lyrics. |
| `statusBar.ts` | Provides compact and full editor status bar layouts. |
| `types.ts` | Defines shared media, playback, and configuration contracts. |

Runtime flow:

1. Folder scans publish a complete playlist only after the scan succeeds; cancellation leaves the previous list intact.
2. Audio metadata is enriched concurrently and merged into playlist items.
3. Selecting a song loads metadata, cover art, and lyrics before `MusicPlayer` starts `ffplay`.
4. Player events update the sidebar, detail view, status bar, lyrics, and persisted playback snapshot.
5. Natural completion asks `PlaylistManager` for the next track and reuses the open detail view.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `musicPlayer.musicFolder` | `""` | Folder scanned for supported media. |
| `musicPlayer.volume` | `50` | Playback volume from 0 to 100. |
| `musicPlayer.playMode` | `sequence` | `sequence`, `loop`, `single`, or `random`. |
| `musicPlayer.seekStep` | `10` | Forward/backward seek step in seconds. |
| `musicPlayer.fastSpeed` | `2` | Speed used by Toggle Fast Forward. |
| `musicPlayer.statusBarMode` | `compact` | `compact` or `full` status bar controls. |
| `musicPlayer.followCurrentTrack` | `true` | Reveal an open detail view when tracks change. |
| `musicPlayer.restorePlayback` | `true` | Restore the last track and position without autoplay. |

## Lyrics and Cover Art

Place an LRC file beside its audio file with the same basename:

```text
music/
  Artist - Song.mp3
  Artist - Song.lrc
```

Embedded cover art is preferred. Otherwise, the extension looks for `cover`, `folder`, or `album` JPG/PNG files in the song directory.

## Development

```powershell
npm install
npm run compile
npm run build
npm run package
```

`out/` is generated. Run `compile`, then `build`, and package only after the final build. Increment both package version fields and update the changelog before every release.

`vendor/ffmpeg/win32-x64/` contains only the Windows x64 executables, required shared DLLs, license, and build provenance. `npm run package` creates a `win32-x64` VSIX; do not replace these binaries without recording the new version and archive checksum.

## License

The extension source is MIT licensed. The bundled FFmpeg runtime is distributed under the GNU LGPL v3 or later; see [Third-Party Notices](THIRD_PARTY_NOTICES.md) and `vendor/ffmpeg/win32-x64/LICENSE.txt`.
