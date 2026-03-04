# VSCode Music Player Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VSCode extension that plays local music files (MP3/FLAC/WAV/OGG) with LRC lyrics display, status bar controls, and sidebar song list.

**Architecture:** Single-package VSCode extension using hidden Webview with HTML5 Audio for playback. Extension ↔ Webview communicate via postMessage. Six core modules: MusicPlayer (webview audio), PlaylistManager (scan/playlist/modes), LrcParser (parse .lrc), StatusBarController (buttons+lyrics), SidebarProvider (TreeView), and extension entry point.

**Tech Stack:** TypeScript, VSCode Extension API, HTML5 Audio (via hidden Webview), music-metadata (for file scanning metadata)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/extension.ts`
- Create: `.vscodeignore`
- Create: `.gitignore`

**Step 1: Initialize npm project and install dependencies**

```bash
cd /home/nvidia/codes/sym1018/vscode_music_player
npm init -y
npm install --save-dev typescript @types/vscode @types/node esbuild
npm install music-metadata
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2021"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "exclude": ["node_modules", "out"]
}
```

**Step 3: Create package.json with full extension manifest**

The `package.json` needs these sections:
- `engines.vscode`: `"^1.85.0"`
- `activationEvents`: `["onView:musicPlayer-songList"]`
- `main`: `"./out/extension.js"`
- `contributes.commands`: All 9 commands from CLAUDE.md
- `contributes.configuration`: musicPlayer.musicFolder, musicPlayer.volume, musicPlayer.playMode
- `contributes.viewsContainers.activitybar`: Music Player icon
- `contributes.views`: musicPlayer-songList TreeView
- `contributes.menus`: Context menus for TreeView items

Commands to register:
```json
[
  { "command": "musicPlayer.play", "title": "Play/Pause", "category": "Music Player" },
  { "command": "musicPlayer.next", "title": "Next Track", "category": "Music Player" },
  { "command": "musicPlayer.previous", "title": "Previous Track", "category": "Music Player" },
  { "command": "musicPlayer.volumeUp", "title": "Volume Up", "category": "Music Player" },
  { "command": "musicPlayer.volumeDown", "title": "Volume Down", "category": "Music Player" },
  { "command": "musicPlayer.toggleLyric", "title": "Toggle Lyrics", "category": "Music Player" },
  { "command": "musicPlayer.switchMode", "title": "Switch Play Mode", "category": "Music Player" },
  { "command": "musicPlayer.selectFolder", "title": "Select Music Folder", "category": "Music Player" },
  { "command": "musicPlayer.playSong", "title": "Play Song", "category": "Music Player" }
]
```

Configuration:
```json
{
  "musicPlayer.musicFolder": { "type": "string", "default": "", "description": "Path to music folder" },
  "musicPlayer.volume": { "type": "number", "default": 50, "minimum": 0, "maximum": 100, "description": "Volume (0-100)" },
  "musicPlayer.playMode": { "type": "string", "default": "sequence", "enum": ["sequence", "loop", "single", "random"], "description": "Play mode" }
}
```

**Step 4: Create minimal extension entry**

```typescript
// src/extension.ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('Music Player is now active');
}

export function deactivate() {}
```

**Step 5: Create build script and .vscodeignore**

Add to package.json scripts:
```json
{
  "compile": "tsc -p ./",
  "watch": "tsc -watch -p ./",
  "package": "npx @vscode/vsce package"
}
```

`.vscodeignore`:
```
.vscode/**
src/**
node_modules/**
tsconfig.json
```

**Step 6: Verify build**

```bash
npx tsc -p ./
```
Expected: Compiles without errors, creates `out/extension.js`.

**Step 7: Commit**

```bash
git init
git add package.json tsconfig.json src/extension.ts .vscodeignore .gitignore
git commit -m "feat: project scaffolding with extension manifest"
```

---

### Task 2: PlaylistManager - File Scanning & Playlist Logic

**Files:**
- Create: `src/playlist.ts`
- Create: `src/types.ts`

**Step 1: Define shared types**

```typescript
// src/types.ts
export interface SongItem {
  id: string;          // unique id (file path hash or path itself)
  name: string;        // display name (from metadata or filename)
  artist: string;      // artist(s)
  album: string;       // album name
  duration: number;    // duration in seconds
  filePath: string;    // absolute file path
  fileName: string;    // original filename
}

export type PlayMode = 'sequence' | 'loop' | 'single' | 'random';

// Messages from Extension to Webview
export type PlayerCommand =
  | { command: 'load'; uri: string; play: boolean }
  | { command: 'play' }
  | { command: 'pause' }
  | { command: 'stop' }
  | { command: 'setVolume'; level: number }
  | { command: 'getPosition' };

// Messages from Webview to Extension
export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'playing'; playing: boolean }
  | { type: 'ended' }
  | { type: 'position'; position: number }
  | { type: 'duration'; duration: number }
  | { type: 'error'; message: string }
  | { type: 'loadResult'; success: boolean };
```

**Step 2: Implement PlaylistManager**

```typescript
// src/playlist.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { parseFile } from 'music-metadata';
import { SongItem, PlayMode } from './types';

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg']);

export class PlaylistManager {
  private _songs: SongItem[] = [];
  private _currentIndex: number = -1;
  private _playMode: PlayMode = 'sequence';
  private _shuffledIndices: number[] = [];

  private _onDidChangePlaylist = new vscode.EventEmitter<void>();
  readonly onDidChangePlaylist = this._onDidChangePlaylist.event;

  private _onDidChangeCurrent = new vscode.EventEmitter<SongItem | undefined>();
  readonly onDidChangeCurrent = this._onDidChangeCurrent.event;

  get songs(): readonly SongItem[] { return this._songs; }
  get currentSong(): SongItem | undefined { return this._songs[this._currentIndex]; }
  get currentIndex(): number { return this._currentIndex; }
  get playMode(): PlayMode { return this._playMode; }

  setPlayMode(mode: PlayMode): void {
    this._playMode = mode;
    if (mode === 'random') this._generateShuffledIndices();
  }

  async scanFolder(folderPath: string): Promise<void> {
    this._songs = [];
    if (!folderPath) return;
    const files = await this._scanRecursive(folderPath);
    this._songs = files;
    this._currentIndex = -1;
    if (this._playMode === 'random') this._generateShuffledIndices();
    this._onDidChangePlaylist.fire();
  }

  private async _scanRecursive(dir: string): Promise<SongItem[]> {
    const results: SongItem[] = [];
    const dirs: string[] = [dir];
    while (dirs.length) {
      const current = dirs.pop()!;
      let entries;
      try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          dirs.push(fullPath);
        } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          try {
            const meta = await parseFile(fullPath, { duration: true, skipCovers: true });
            results.push({
              id: fullPath,
              name: meta.common.title || path.basename(entry.name, path.extname(entry.name)),
              artist: meta.common.artist || meta.common.artists?.join('/') || '',
              album: meta.common.album || '',
              duration: meta.format.duration || 0,
              filePath: fullPath,
              fileName: entry.name,
            });
          } catch {
            // Skip files that can't be parsed
            results.push({
              id: fullPath,
              name: path.basename(entry.name, path.extname(entry.name)),
              artist: '',
              album: '',
              duration: 0,
              filePath: fullPath,
              fileName: entry.name,
            });
          }
        }
      }
    }
    return results;
  }

  setCurrent(index: number): SongItem | undefined {
    if (index < 0 || index >= this._songs.length) return undefined;
    this._currentIndex = index;
    const song = this._songs[index];
    this._onDidChangeCurrent.fire(song);
    return song;
  }

  setCurrentByPath(filePath: string): SongItem | undefined {
    const index = this._songs.findIndex(s => s.filePath === filePath);
    if (index >= 0) return this.setCurrent(index);
    return undefined;
  }

  next(): SongItem | undefined {
    if (this._songs.length === 0) return undefined;
    switch (this._playMode) {
      case 'single':
        return this.setCurrent(this._currentIndex);
      case 'random':
        return this._nextRandom();
      case 'sequence':
        if (this._currentIndex >= this._songs.length - 1) return undefined;
        return this.setCurrent(this._currentIndex + 1);
      case 'loop':
        return this.setCurrent((this._currentIndex + 1) % this._songs.length);
    }
  }

  previous(): SongItem | undefined {
    if (this._songs.length === 0) return undefined;
    switch (this._playMode) {
      case 'single':
        return this.setCurrent(this._currentIndex);
      case 'random':
        return this._nextRandom();
      case 'sequence':
      case 'loop':
        const idx = this._currentIndex <= 0 ? this._songs.length - 1 : this._currentIndex - 1;
        return this.setCurrent(idx);
    }
  }

  private _nextRandom(): SongItem | undefined {
    if (this._songs.length <= 1) return this.setCurrent(0);
    let idx: number;
    do { idx = Math.floor(Math.random() * this._songs.length); } while (idx === this._currentIndex);
    return this.setCurrent(idx);
  }

  private _generateShuffledIndices(): void {
    this._shuffledIndices = Array.from({ length: this._songs.length }, (_, i) => i);
    for (let i = this._shuffledIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this._shuffledIndices[i], this._shuffledIndices[j]] = [this._shuffledIndices[j], this._shuffledIndices[i]];
    }
  }
}
```

**Step 3: Verify build**

```bash
npx tsc -p ./
```
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add src/types.ts src/playlist.ts
git commit -m "feat: PlaylistManager with recursive scan and play modes"
```

---

### Task 3: LrcParser - Lyrics Parsing

**Files:**
- Create: `src/lrcParser.ts`

**Step 1: Implement LrcParser**

```typescript
// src/lrcParser.ts
import * as fs from 'fs/promises';
import * as path from 'path';

export interface LrcLine {
  time: number;    // timestamp in seconds
  text: string;    // lyric text
}

export class LrcParser {
  private _lines: LrcLine[] = [];
  private _offset: number = 0;
  private _currentIndex: number = -1;

  get lines(): readonly LrcLine[] { return this._lines; }
  get currentIndex(): number { return this._currentIndex; }

  async loadForSong(songPath: string): Promise<boolean> {
    this._lines = [];
    this._currentIndex = -1;
    this._offset = 0;

    const lrcPath = songPath.replace(/\.[^.]+$/, '.lrc');
    try {
      const content = await fs.readFile(lrcPath, 'utf-8');
      this._parse(content);
      return this._lines.length > 0;
    } catch {
      return false;
    }
  }

  private _parse(content: string): void {
    const lines: LrcLine[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
    const offsetRegex = /\[offset:([+-]?\d+)\]/;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for offset tag
      const offsetMatch = trimmed.match(offsetRegex);
      if (offsetMatch) {
        this._offset = parseInt(offsetMatch[1]) / 1000;
        continue;
      }

      // Extract all timestamps from this line
      const timestamps: number[] = [];
      let match;
      while ((match = timeRegex.exec(trimmed)) !== null) {
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
        timestamps.push(min * 60 + sec + ms / 1000);
      }

      if (timestamps.length === 0) continue;

      // Extract text after all timestamps
      const text = trimmed.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
      if (!text) continue;

      for (const time of timestamps) {
        lines.push({ time, text });
      }
    }

    // Sort by time
    lines.sort((a, b) => a.time - b.time);
    this._lines = lines;
  }

  /**
   * Get current lyric line for given playback position (seconds).
   * Uses binary search like the reference cloudmusic implementation.
   * Returns the lyric text, or undefined if no lyric matches.
   */
  getLyricAt(position: number): string | undefined {
    if (this._lines.length === 0) return undefined;

    const pos = position - this._offset;
    let l = 0;
    let r = this._lines.length - 1;
    while (l <= r) {
      const mid = Math.trunc((l + r) / 2);
      if (this._lines[mid].time <= pos) l = mid + 1;
      else r = mid - 1;
    }

    const idx = Math.max(0, r);
    if (idx !== this._currentIndex) {
      this._currentIndex = idx;
    }
    return this._lines[idx]?.text;
  }

  clear(): void {
    this._lines = [];
    this._currentIndex = -1;
    this._offset = 0;
  }
}
```

**Step 2: Verify build**

```bash
npx tsc -p ./
```

**Step 3: Commit**

```bash
git add src/lrcParser.ts
git commit -m "feat: LrcParser with binary search lyric sync"
```

---

### Task 4: MusicPlayer - Hidden Webview Audio Engine

**Files:**
- Create: `src/player.ts`

**Step 1: Implement MusicPlayer**

The player creates a hidden Webview panel that contains an HTMLAudioElement. Communication is via postMessage (Extension ↔ Webview). The webview HTML is inlined as a string.

Key behaviors (reference: `provider.tsx` from cloudmusic):
- Load audio via file URI converted to webview URI
- Play/pause/stop controls
- Volume control
- Position tracking (800ms interval, like reference)
- End-of-track detection
- Report events back to extension

```typescript
// src/player.ts
import * as vscode from 'vscode';
import { PlayerCommand, PlayerEvent } from './types';

export class MusicPlayer implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _volume: number = 50;
  private _playing: boolean = false;
  private _disposed: boolean = false;

  private _onDidChangeState = new vscode.EventEmitter<'playing' | 'paused' | 'stopped'>();
  readonly onDidChangeState = this._onDidChangeState.event;

  private _onDidEnd = new vscode.EventEmitter<void>();
  readonly onDidEnd = this._onDidEnd.event;

  private _onDidPosition = new vscode.EventEmitter<number>();
  readonly onDidPosition = this._onDidPosition.event;

  private _onDidReady = new vscode.EventEmitter<void>();
  readonly onDidReady = this._onDidReady.event;

  get playing(): boolean { return this._playing; }

  constructor(private readonly _extensionUri: vscode.Uri) {}

  private _ensurePanel(): vscode.WebviewPanel {
    if (!this._panel) {
      this._panel = vscode.window.createWebviewPanel(
        'musicPlayerAudio',
        'Music Player',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.file('/')],
          retainContextWhenHidden: true,
        }
      );
      // Hide the panel - we only need the webview for audio
      this._panel.webview.html = this._getWebviewHtml();
      this._panel.onDidDispose(() => {
        this._panel = undefined;
        this._playing = false;
      });
      this._panel.webview.onDidReceiveMessage((msg: PlayerEvent) => {
        this._handleMessage(msg);
      });
    }
    return this._panel;
  }

  private _handleMessage(msg: PlayerEvent): void {
    switch (msg.type) {
      case 'ready':
        this._onDidReady.fire();
        // Set initial volume
        this._sendCommand({ command: 'setVolume', level: this._volume / 100 });
        break;
      case 'playing':
        this._playing = msg.playing;
        this._onDidChangeState.fire(msg.playing ? 'playing' : 'paused');
        break;
      case 'ended':
        this._playing = false;
        this._onDidEnd.fire();
        break;
      case 'position':
        this._onDidPosition.fire(msg.position);
        break;
      case 'error':
        console.error('Audio error:', msg.message);
        break;
    }
  }

  private _sendCommand(cmd: PlayerCommand): void {
    this._panel?.webview.postMessage(cmd);
  }

  async load(filePath: string, play: boolean = true): Promise<void> {
    const panel = this._ensurePanel();
    const fileUri = vscode.Uri.file(filePath);
    const webviewUri = panel.webview.asWebviewUri(fileUri).toString();
    this._sendCommand({ command: 'load', uri: webviewUri, play });
  }

  play(): void {
    this._sendCommand({ command: 'play' });
  }

  pause(): void {
    this._sendCommand({ command: 'pause' });
  }

  toggle(): void {
    if (this._playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  stop(): void {
    this._sendCommand({ command: 'stop' });
    this._playing = false;
  }

  setVolume(level: number): void {
    this._volume = Math.max(0, Math.min(100, level));
    this._sendCommand({ command: 'setVolume', level: this._volume / 100 });
  }

  getVolume(): number {
    return this._volume;
  }

  dispose(): void {
    this._disposed = true;
    this._panel?.dispose();
    this._onDidChangeState.dispose();
    this._onDidEnd.dispose();
    this._onDidPosition.dispose();
    this._onDidReady.dispose();
  }

  private _getWebviewHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Music Player Audio</title></head>
<body>
<audio id="audio" preload="auto"></audio>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const audio = document.getElementById('audio');
  let posTimer = null;

  function startPosTracking() {
    stopPosTracking();
    posTimer = setInterval(() => {
      if (!audio.paused && !audio.ended) {
        vscode.postMessage({ type: 'position', position: audio.currentTime });
      }
    }, 800);
  }

  function stopPosTracking() {
    if (posTimer) { clearInterval(posTimer); posTimer = null; }
  }

  audio.addEventListener('play', () => {
    vscode.postMessage({ type: 'playing', playing: true });
    startPosTracking();
  });

  audio.addEventListener('pause', () => {
    vscode.postMessage({ type: 'playing', playing: false });
    stopPosTracking();
  });

  audio.addEventListener('ended', () => {
    vscode.postMessage({ type: 'ended' });
    stopPosTracking();
  });

  audio.addEventListener('durationchange', () => {
    if (audio.duration && isFinite(audio.duration)) {
      vscode.postMessage({ type: 'duration', duration: audio.duration });
    }
  });

  audio.addEventListener('error', (e) => {
    vscode.postMessage({ type: 'error', message: audio.error?.message || 'Unknown audio error' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.command) {
      case 'load':
        audio.src = msg.uri;
        if (msg.play) {
          audio.play().then(() => {
            vscode.postMessage({ type: 'loadResult', success: true });
          }).catch((err) => {
            vscode.postMessage({ type: 'loadResult', success: false });
            vscode.postMessage({ type: 'error', message: err.message });
          });
        }
        break;
      case 'play':
        audio.play().catch((err) => {
          vscode.postMessage({ type: 'error', message: err.message });
        });
        break;
      case 'pause':
        audio.pause();
        break;
      case 'stop':
        audio.pause();
        audio.src = '';
        stopPosTracking();
        break;
      case 'setVolume':
        audio.volume = msg.level;
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}
```

**Step 2: Verify build**

```bash
npx tsc -p ./
```

**Step 3: Commit**

```bash
git add src/player.ts
git commit -m "feat: MusicPlayer with hidden Webview audio engine"
```

---

### Task 5: StatusBarController - Buttons & Lyrics Display

**Files:**
- Create: `src/statusBar.ts`

**Step 1: Implement StatusBarController**

Reference: `button.ts` from cloudmusic. We create StatusBarItems aligned left with descending priority to maintain order.

Layout: `[⏮] [⏯] [⏭] [🔉] [🔊] [词] | ♪ songName | lyricText`

```typescript
// src/statusBar.ts
import * as vscode from 'vscode';

export class StatusBarController implements vscode.Disposable {
  private _btnPrev: vscode.StatusBarItem;
  private _btnPlay: vscode.StatusBarItem;
  private _btnNext: vscode.StatusBarItem;
  private _btnVolDown: vscode.StatusBarItem;
  private _btnVolUp: vscode.StatusBarItem;
  private _btnLyric: vscode.StatusBarItem;
  private _btnSong: vscode.StatusBarItem;
  private _btnLyricText: vscode.StatusBarItem;
  private _btnMode: vscode.StatusBarItem;

  private _showLyric: boolean = true;

  constructor() {
    // Higher priority = further left. Use negative numbers with Left alignment.
    const p = -100; // base priority
    this._btnPrev     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p);
    this._btnPlay     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 1);
    this._btnNext     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 2);
    this._btnVolDown  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 3);
    this._btnVolUp    = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 4);
    this._btnLyric    = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 5);
    this._btnMode     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 6);
    this._btnSong     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 7);
    this._btnLyricText = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 8);

    this._btnPrev.text = '$(chevron-left)';
    this._btnPrev.tooltip = 'Previous Track';
    this._btnPrev.command = 'musicPlayer.previous';

    this._btnPlay.text = '$(play)';
    this._btnPlay.tooltip = 'Play';
    this._btnPlay.command = 'musicPlayer.play';

    this._btnNext.text = '$(chevron-right)';
    this._btnNext.tooltip = 'Next Track';
    this._btnNext.command = 'musicPlayer.next';

    this._btnVolDown.text = '$(remove)';
    this._btnVolDown.tooltip = 'Volume Down';
    this._btnVolDown.command = 'musicPlayer.volumeDown';

    this._btnVolUp.text = '$(add)';
    this._btnVolUp.tooltip = 'Volume Up';
    this._btnVolUp.command = 'musicPlayer.volumeUp';

    this._btnLyric.text = '词';
    this._btnLyric.tooltip = 'Toggle Lyrics';
    this._btnLyric.command = 'musicPlayer.toggleLyric';

    this._btnMode.text = '$(list-ordered)';
    this._btnMode.tooltip = 'Play Mode: Sequence';
    this._btnMode.command = 'musicPlayer.switchMode';

    this._btnSong.text = '$(music) No song';
    this._btnSong.tooltip = 'Current song';

    this._btnLyricText.text = '';
    this._btnLyricText.tooltip = 'Lyrics';
  }

  showAll(): void {
    this._btnPrev.show();
    this._btnPlay.show();
    this._btnNext.show();
    this._btnVolDown.show();
    this._btnVolUp.show();
    this._btnLyric.show();
    this._btnMode.show();
    this._btnSong.show();
    this._btnLyricText.show();
  }

  updatePlaying(playing: boolean): void {
    this._btnPlay.text = playing ? '$(debug-pause)' : '$(play)';
    this._btnPlay.tooltip = playing ? 'Pause' : 'Play';
  }

  updateSong(name: string, artist?: string): void {
    const display = artist ? `$(music) ${name} - ${artist}` : `$(music) ${name}`;
    this._btnSong.text = display;
    this._btnSong.tooltip = display;
  }

  updateLyric(text: string): void {
    if (this._showLyric && text) {
      this._btnLyricText.text = text;
    } else {
      this._btnLyricText.text = '';
    }
  }

  toggleLyric(): boolean {
    this._showLyric = !this._showLyric;
    if (!this._showLyric) {
      this._btnLyricText.text = '';
    }
    this._btnLyric.text = this._showLyric ? '词' : '$(eye-closed)';
    return this._showLyric;
  }

  updateMode(mode: string): void {
    const icons: Record<string, string> = {
      'sequence': '$(list-ordered)',
      'loop': '$(sync)',
      'single': '$(debug-restart)',
      'random': '$(symbol-number)',
    };
    const labels: Record<string, string> = {
      'sequence': 'Sequence',
      'loop': 'Loop All',
      'single': 'Single Loop',
      'random': 'Random',
    };
    this._btnMode.text = icons[mode] || '$(list-ordered)';
    this._btnMode.tooltip = `Play Mode: ${labels[mode] || mode}`;
  }

  updateVolume(level: number): void {
    this._btnVolDown.tooltip = `Volume Down (${level})`;
    this._btnVolUp.tooltip = `Volume Up (${level})`;
  }

  clearSong(): void {
    this._btnSong.text = '$(music) No song';
    this._btnLyricText.text = '';
    this.updatePlaying(false);
  }

  dispose(): void {
    this._btnPrev.dispose();
    this._btnPlay.dispose();
    this._btnNext.dispose();
    this._btnVolDown.dispose();
    this._btnVolUp.dispose();
    this._btnLyric.dispose();
    this._btnMode.dispose();
    this._btnSong.dispose();
    this._btnLyricText.dispose();
  }
}
```

**Step 2: Verify build**

```bash
npx tsc -p ./
```

**Step 3: Commit**

```bash
git add src/statusBar.ts
git commit -m "feat: StatusBarController with playback buttons and lyrics"
```

---

### Task 6: SidebarProvider - TreeView Song List

**Files:**
- Create: `src/sidebarProvider.ts`

**Step 1: Implement SidebarProvider**

Reference: `local.ts` TreeView from cloudmusic. We implement a flat song list that highlights the currently playing song.

```typescript
// src/sidebarProvider.ts
import * as vscode from 'vscode';
import { SongItem } from './types';

export class SongTreeItem extends vscode.TreeItem {
  constructor(
    public readonly song: SongItem,
    public readonly index: number,
    public isCurrent: boolean,
  ) {
    super(song.name, vscode.TreeItemCollapsibleState.None);
    this.description = song.artist || '';
    this.tooltip = `${song.name}${song.artist ? ' - ' + song.artist : ''}${song.album ? ' [' + song.album + ']' : ''}`;
    this.iconPath = isCurrent
      ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('file-media');
    this.command = {
      command: 'musicPlayer.playSong',
      title: 'Play',
      arguments: [index],
    };
    this.contextValue = 'songItem';
  }
}

export class SidebarProvider implements vscode.TreeDataProvider<SongTreeItem> {
  private _songs: SongItem[] = [];
  private _currentIndex: number = -1;

  private _onDidChangeTreeData = new vscode.EventEmitter<SongTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  setSongs(songs: readonly SongItem[]): void {
    this._songs = [...songs];
    this._onDidChangeTreeData.fire();
  }

  setCurrentIndex(index: number): void {
    this._currentIndex = index;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SongTreeItem): SongTreeItem {
    return element;
  }

  getChildren(): SongTreeItem[] {
    return this._songs.map((song, index) =>
      new SongTreeItem(song, index, index === this._currentIndex)
    );
  }
}
```

**Step 2: Verify build**

```bash
npx tsc -p ./
```

**Step 3: Commit**

```bash
git add src/sidebarProvider.ts
git commit -m "feat: SidebarProvider TreeView with song list"
```

---

### Task 7: Extension Entry Point - Wire Everything Together

**Files:**
- Modify: `src/extension.ts`

**Step 1: Implement full extension entry**

This is the orchestration layer. It initializes all modules, registers all commands, and connects them together.

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { MusicPlayer } from './player';
import { PlaylistManager } from './playlist';
import { LrcParser } from './lrcParser';
import { StatusBarController } from './statusBar';
import { SidebarProvider } from './sidebarProvider';
import { PlayMode } from './types';

let player: MusicPlayer;
let playlist: PlaylistManager;
let lrcParser: LrcParser;
let statusBar: StatusBarController;
let sidebarProvider: SidebarProvider;
let lyricTimer: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('musicPlayer');

  // Initialize modules
  player = new MusicPlayer(context.extensionUri);
  playlist = new PlaylistManager();
  lrcParser = new LrcParser();
  statusBar = new StatusBarController();
  sidebarProvider = new SidebarProvider();

  // Register TreeView
  const treeView = vscode.window.createTreeView('musicPlayer-songList', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: false,
  });

  // Load config
  let volume = config.get<number>('volume', 50);
  let playMode = config.get<PlayMode>('playMode', 'sequence');
  playlist.setPlayMode(playMode);
  statusBar.updateMode(playMode);
  statusBar.updateVolume(volume);

  // Event: player state changed
  player.onDidChangeState((state) => {
    statusBar.updatePlaying(state === 'playing');
  });

  // Event: track ended - play next
  player.onDidEnd(() => {
    const nextSong = playlist.next();
    if (nextSong) {
      playSong(nextSong.filePath);
    } else {
      statusBar.clearSong();
    }
  });

  // Event: player position - update lyrics
  player.onDidPosition((position) => {
    const lyric = lrcParser.getLyricAt(position);
    if (lyric !== undefined) {
      statusBar.updateLyric(lyric);
    }
  });

  // Event: playlist changed - update sidebar
  playlist.onDidChangePlaylist(() => {
    sidebarProvider.setSongs(playlist.songs);
  });

  // Helper: play a song by path
  async function playSong(filePath: string) {
    const song = playlist.setCurrentByPath(filePath) || playlist.songs.find(s => s.filePath === filePath);
    if (!song) return;

    statusBar.updateSong(song.name, song.artist);
    sidebarProvider.setCurrentIndex(playlist.currentIndex);

    // Load lyrics
    const hasLyric = await lrcParser.loadForSong(song.filePath);
    if (!hasLyric) {
      statusBar.updateLyric('');
    }

    // Load and play audio
    await player.load(song.filePath, true);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('musicPlayer.play', () => {
      if (!playlist.currentSong && playlist.songs.length > 0) {
        const song = playlist.setCurrent(0);
        if (song) playSong(song.filePath);
      } else {
        player.toggle();
      }
    }),

    vscode.commands.registerCommand('musicPlayer.next', () => {
      const song = playlist.next();
      if (song) playSong(song.filePath);
    }),

    vscode.commands.registerCommand('musicPlayer.previous', () => {
      const song = playlist.previous();
      if (song) playSong(song.filePath);
    }),

    vscode.commands.registerCommand('musicPlayer.volumeUp', () => {
      volume = Math.min(100, volume + 10);
      player.setVolume(volume);
      statusBar.updateVolume(volume);
      void config.update('volume', volume, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('musicPlayer.volumeDown', () => {
      volume = Math.max(0, volume - 10);
      player.setVolume(volume);
      statusBar.updateVolume(volume);
      void config.update('volume', volume, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('musicPlayer.toggleLyric', () => {
      statusBar.toggleLyric();
    }),

    vscode.commands.registerCommand('musicPlayer.switchMode', () => {
      const modes: PlayMode[] = ['sequence', 'loop', 'single', 'random'];
      const currentIdx = modes.indexOf(playMode);
      playMode = modes[(currentIdx + 1) % modes.length];
      playlist.setPlayMode(playMode);
      statusBar.updateMode(playMode);
      void config.update('playMode', playMode, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('musicPlayer.selectFolder', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Music Folder',
      });
      if (uris && uris[0]) {
        const folderPath = uris[0].fsPath;
        await config.update('musicFolder', folderPath, vscode.ConfigurationTarget.Global);
        await playlist.scanFolder(folderPath);
        if (playlist.songs.length > 0) {
          vscode.window.showInformationMessage(`Found ${playlist.songs.length} songs`);
        } else {
          vscode.window.showWarningMessage('No supported audio files found');
        }
      }
    }),

    vscode.commands.registerCommand('musicPlayer.playSong', (index: number) => {
      const song = playlist.setCurrent(index);
      if (song) playSong(song.filePath);
    }),
  );

  // Show status bar
  statusBar.showAll();

  // Auto-scan configured folder
  const musicFolder = config.get<string>('musicFolder', '');
  if (musicFolder) {
    await playlist.scanFolder(musicFolder);
  }

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('musicPlayer.musicFolder')) {
        const folder = vscode.workspace.getConfiguration('musicPlayer').get<string>('musicFolder', '');
        if (folder) void playlist.scanFolder(folder);
      }
    }),
  );

  // Disposables
  context.subscriptions.push(player, statusBar, treeView);
}

export function deactivate() {
  if (lyricTimer) clearInterval(lyricTimer);
}
```

**Step 2: Verify build**

```bash
npx tsc -p ./
```

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: extension entry wiring all modules together"
```

---

### Task 8: Build, Test & Polish

**Step 1: Create esbuild config for bundling**

Create `esbuild.js`:
```javascript
const esbuild = require('esbuild');
esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
}).catch(() => process.exit(1));
```

Update package.json scripts:
```json
{
  "compile": "node esbuild.js",
  "watch": "tsc -watch -p ./"
}
```

**Step 2: Full build and verify**

```bash
node esbuild.js
```
Expected: Creates `out/extension.js` bundle.

**Step 3: Test in VSCode**

Press F5 in VSCode to launch Extension Development Host. Verify:
- [ ] Status bar buttons appear on the left
- [ ] "Select Music Folder" command works
- [ ] Songs appear in sidebar TreeView
- [ ] Click song → plays audio
- [ ] Play/pause button toggles
- [ ] Next/previous navigate songs
- [ ] Volume up/down work
- [ ] LRC lyrics display in status bar (if .lrc file exists)
- [ ] Play mode switching works
- [ ] Song auto-advances on track end

**Step 4: Fix any issues found during testing**

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete VSCode Music Player extension"
```
