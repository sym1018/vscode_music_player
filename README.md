# Sym Music Player

A lightweight local music player for Visual Studio Code with synchronized LRC lyrics display and full status bar controls.

## Features

- **Local Music Playback** — Play MP3, FLAC, WAV, OGG files directly in VSCode
- **LRC Lyrics Sync** — Auto-load `.lrc` files with real-time synced lyrics in status bar and detail view
- **Detail View** — Dedicated tab with album cover, song info, and scrollable lyrics
- **Status Bar Controls** — Previous, Play/Pause, Next, Volume, Lyrics toggle, Play mode, Progress bar
- **Sidebar Playlist** — TreeView with folder hierarchy, double-click to open song detail
- **Play Modes** — Sequence, Loop All, Single Loop, Random
- **Cross-Platform** — Works on Linux, macOS, and Windows

## Requirements

- **ffmpeg** (includes `ffplay` and `ffprobe`) must be installed and available in PATH
  - Linux: `sudo apt install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH

## Quick Start

1. Click the music note icon in the Activity Bar to open the Song List
2. Click the folder icon to select your music folder
3. Double-click a song to open the detail view
4. Use the status bar controls or detail view buttons to control playback

### Status Bar Layout

```
[< Prev] [> Play] [> Next] [- Vol] [+ Vol] [Lyric] [Mode] | 01:23 ━━━━━━──── 03:45 | ♪ Song Name | Lyrics...
```

### Play Modes

| Mode | Description |
|------|-------------|
| Sequence | Play songs in order, stop at the end |
| Loop All | Loop the entire playlist |
| Single Loop | Repeat the current song |
| Random | Shuffle playback |

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `musicPlayer.musicFolder` | `""` | Path to your music folder |
| `musicPlayer.volume` | `50` | Default volume (0-100) |
| `musicPlayer.playMode` | `sequence` | Play mode: `sequence`, `loop`, `single`, `random` |

## Commands

All commands are available via `Ctrl+Shift+P` with the "Music Player:" prefix:

| Command | Description |
|---------|-------------|
| Play/Pause | Toggle playback |
| Next Track | Play next song |
| Previous Track | Play previous song |
| Volume Up / Down | Adjust volume (+-10) |
| Toggle Lyrics | Show/hide lyrics in status bar |
| Switch Play Mode | Cycle through play modes |
| Select Music Folder | Choose music directory |
| Seek | Jump to a position (mm:ss) |

## LRC Lyrics

Place `.lrc` files alongside your music files with the same base name:

```
music/
├── Artist - Song.mp3
├── Artist - Song.lrc
```

The extension will automatically detect and display synced lyrics.

## License

MIT
