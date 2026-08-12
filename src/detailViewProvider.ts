import * as vscode from 'vscode';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { LrcLine } from './lrcParser';

interface PanelState {
  panel: vscode.WebviewPanel;
  filePath: string;
  duration: number;
  coverPath: string;
}

export class DetailViewProvider implements vscode.Disposable {
  private _state: PanelState | undefined;
  private _playingFilePath = '';
  private _playing = false;
  private _highlightIndex = -1;
  private _position = 0;
  private _duration = 0;
  private _volume = 50;
  private _speed = 1;

  private readonly _onDidRequestSeek = new vscode.EventEmitter<number>();
  readonly onDidRequestSeek = this._onDidRequestSeek.event;

  private readonly _onDidRequestCommand = new vscode.EventEmitter<string>();
  readonly onDidRequestCommand = this._onDidRequestCommand.event;

  private readonly _onDidRequestPlay = new vscode.EventEmitter<string>();
  readonly onDidRequestPlay = this._onDidRequestPlay.event;

  private readonly _onDidRequestVolume = new vscode.EventEmitter<number>();
  readonly onDidRequestVolume = this._onDidRequestVolume.event;

  private readonly _onDidRequestSpeed = new vscode.EventEmitter<number>();
  readonly onDidRequestSpeed = this._onDidRequestSpeed.event;

  constructor(private readonly _cacheRoot: string = '') {}

  setPlayingFile(filePath: string): void {
    this._playingFilePath = filePath;
    this._highlightIndex = -1;
    this._position = 0;
  }

  get playingFilePath(): string { return this._playingFilePath; }

  show(
    songName: string,
    artist: string,
    album: string,
    lyrics: LrcLine[],
    hasLyrics: boolean,
    filePath: string,
    coverPath: string = '',
    duration: number = 0,
  ): void {
    if (!this._state) {
      const panel = vscode.window.createWebviewPanel(
        'musicPlayer.detail',
        `Music: ${songName}`,
        { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this._state = { panel, filePath, duration, coverPath };
      panel.webview.onDidReceiveMessage(message => this._handleMessage(message));
      panel.onDidDispose(() => { this._state = undefined; });
    } else {
      this._state.filePath = filePath;
      this._state.duration = duration;
      this._state.coverPath = coverPath;
    }

    this._render(songName, artist, album, lyrics, hasLyrics);
    this._state.panel.reveal(vscode.ViewColumn.One, true);
  }

  updateIfOpen(
    songName: string,
    artist: string,
    album: string,
    lyrics: LrcLine[],
    hasLyrics: boolean,
    filePath: string,
    _oldFilePath?: string,
    coverPath: string = '',
    reveal: boolean = true,
    duration: number = 0,
  ): void {
    if (!this._state) return;
    this._state.filePath = filePath;
    this._state.duration = duration;
    this._state.coverPath = coverPath;
    this._render(songName, artist, album, lyrics, hasLyrics);
    if (reveal) this._state.panel.reveal(vscode.ViewColumn.One, true);
  }

  updateHighlight(index: number): void {
    if (this._highlightIndex === index) return;
    this._highlightIndex = index;
    if (this._state?.filePath === this._playingFilePath) {
      void this._state.panel.webview.postMessage({ type: 'highlight', index });
    }
  }

  updatePlayState(playing: boolean): void {
    this._playing = playing;
    this._postCurrentState();
  }

  updateProgress(position: number, duration?: number): void {
    this._position = Math.max(0, position);
    if (duration !== undefined) this._duration = Math.max(0, duration);
    if (this._state?.filePath === this._playingFilePath) {
      void this._state.panel.webview.postMessage({
        type: 'progress',
        position: this._position,
        duration: this._duration,
      });
    }
  }

  updateVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(100, volume));
    if (this._state) {
      void this._state.panel.webview.postMessage({ type: 'volume', value: this._volume });
    }
  }

  updateSpeed(speed: number): void {
    this._speed = speed;
    if (this._state) {
      void this._state.panel.webview.postMessage({ type: 'speed', value: speed });
    }
  }

  private _handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const value = message as Record<string, unknown>;
    if (value.type === 'seek' && typeof value.time === 'number' && Number.isFinite(value.time)) {
      this._onDidRequestSeek.fire(Math.max(0, value.time));
    } else if (value.type === 'play' && this._state) {
      this._onDidRequestPlay.fire(this._state.filePath);
    } else if (value.type === 'command' && typeof value.command === 'string') {
      const allowed = new Set(['previous', 'stop', 'next', 'seekBackward', 'seekForward']);
      if (allowed.has(value.command)) this._onDidRequestCommand.fire(value.command);
    } else if (value.type === 'volume' && typeof value.value === 'number' && Number.isFinite(value.value)) {
      this._onDidRequestVolume.fire(Math.max(0, Math.min(100, value.value)));
    } else if (value.type === 'speed' && typeof value.value === 'number' && Number.isFinite(value.value)) {
      this._onDidRequestSpeed.fire(Math.max(0.5, Math.min(4, value.value)));
    } else if (value.type === 'ready') {
      this._postCurrentState();
    }
  }

  private _render(songName: string, artist: string, album: string, lyrics: LrcLine[], hasLyrics: boolean): void {
    if (!this._state) return;
    const roots = [path.dirname(this._state.filePath)];
    if (this._state.coverPath) roots.push(path.dirname(this._state.coverPath));
    if (this._cacheRoot) roots.push(this._cacheRoot);
    this._state.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [...new Set(roots)].map(root => vscode.Uri.file(root)),
    };
    this._state.panel.title = `Music: ${songName}`;
    this._state.panel.webview.html = this._getHtml(
      this._state.panel,
      songName,
      artist,
      album,
      lyrics,
      hasLyrics,
      this._state.coverPath,
      this._state.duration,
    );
  }

  private _postCurrentState(): void {
    if (!this._state) return;
    const isCurrent = this._state.filePath === this._playingFilePath;
    void this._state.panel.webview.postMessage({
      type: 'sync',
      playing: this._playing && isCurrent,
      position: isCurrent ? this._position : 0,
      duration: isCurrent ? this._duration : this._state.duration,
      volume: this._volume,
      speed: this._speed,
      highlight: isCurrent ? this._highlightIndex : -1,
    });
  }

  private _getHtml(
    panel: vscode.WebviewPanel,
    songName: string,
    artist: string,
    album: string,
    lyrics: LrcLine[],
    hasLyrics: boolean,
    coverPath: string,
    duration: number,
  ): string {
    const nonce = randomBytes(16).toString('hex');
    const coverHtml = coverPath
      ? `<img src="${panel.webview.asWebviewUri(vscode.Uri.file(coverPath))}" class="cover-img" alt="Album cover" />`
      : '<div class="cover-placeholder" aria-label="No album cover">&#9835;</div>';
    const lyricsHtml = hasLyrics
      ? lyrics.map((line, index) =>
          `<button type="button" class="lyric-line" data-index="${index}" data-time="${line.time}">${this._esc(line.text)}</button>`
        ).join('\n')
      : '<div class="no-lyrics">No synchronized lyrics</div>';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  html, body { margin: 0; min-width: 0; height: 100%; }
  body {
    display: grid; grid-template-columns: minmax(280px, 38%) minmax(0, 1fr);
    background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family); overflow: hidden;
  }
  button, input, select { font: inherit; }
  .player {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-width: 0; padding: 28px 24px; background: var(--vscode-sideBar-background);
    border-right: 1px solid var(--vscode-widget-border);
  }
  .cover {
    width: min(210px, 70%); aspect-ratio: 1; overflow: hidden; border-radius: 50%;
    border: 3px solid var(--vscode-widget-border); margin-bottom: 20px;
    animation: spin 20s linear infinite; animation-play-state: paused;
  }
  .cover.playing { animation-play-state: running; }
  .cover-img, .cover-placeholder { width: 100%; height: 100%; }
  .cover-img { display: block; object-fit: cover; }
  .cover-placeholder {
    display: grid; place-items: center; font-size: 60px;
    color: var(--vscode-disabledForeground); background: var(--vscode-editorWidget-background);
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .cover { animation: none; } }
  .song-info { width: min(100%, 360px); text-align: center; margin-bottom: 18px; overflow-wrap: anywhere; }
  .song-title { font-size: 20px; font-weight: 600; line-height: 1.35; }
  .song-artist { margin-top: 6px; color: var(--vscode-descriptionForeground); }
  .song-album { margin-top: 4px; font-size: 12px; color: var(--vscode-disabledForeground); }
  .progress-wrap, .settings { width: min(100%, 420px); }
  .range { width: 100%; accent-color: var(--vscode-progressBar-background); }
  .time-row { display: flex; justify-content: space-between; margin-top: 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .controls { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 12px 0; }
  .icon-btn {
    display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0;
    border: 1px solid transparent; border-radius: 4px; background: transparent;
    color: var(--vscode-foreground); cursor: pointer; font-size: 17px;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
  .icon-btn.primary { width: 44px; height: 44px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .icon-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  :focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .settings { display: grid; grid-template-columns: auto minmax(80px, 1fr) auto auto; gap: 8px; align-items: center; }
  .settings label { color: var(--vscode-descriptionForeground); }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); padding: 3px 5px; }
  .lyrics { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 24px 32px; }
  .lyrics-header { padding-bottom: 10px; border-bottom: 1px solid var(--vscode-widget-border); color: var(--vscode-descriptionForeground); }
  .lyrics-scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 12px 6px 40vh 0; scroll-behavior: smooth; }
  .lyric-line {
    display: block; width: 100%; padding: 9px 12px; border: 0; border-radius: 4px;
    background: transparent; color: var(--vscode-disabledForeground); text-align: left;
    line-height: 1.65; cursor: pointer;
  }
  .lyric-line:hover { color: var(--vscode-editor-foreground); background: var(--vscode-list-hoverBackground); }
  .lyric-line.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); font-weight: 600; }
  .no-lyrics { display: grid; place-items: center; min-height: 180px; color: var(--vscode-disabledForeground); }
  @media (max-width: 680px) {
    body { display: block; height: auto; min-height: 100%; overflow-y: auto; }
    .player { min-height: 50vh; padding: 20px 16px; border-right: 0; border-bottom: 1px solid var(--vscode-widget-border); }
    .cover { width: 140px; margin-bottom: 14px; }
    .lyrics { height: 50vh; min-height: 300px; padding: 18px 16px; }
    .settings { grid-template-columns: auto minmax(70px, 1fr) auto auto; }
  }
  @media (max-width: 360px) {
    .player { padding: 16px 8px; }
    .cover { width: 120px; }
    .controls { gap: 2px; }
    .icon-btn { width: 30px; height: 34px; font-size: 15px; }
    .icon-btn.primary { width: 40px; height: 40px; }
    .settings { grid-template-columns: auto minmax(54px, 1fr) auto; }
    .settings select { grid-column: 1 / -1; width: 100%; }
    .lyrics { padding: 14px 8px; }
  }
</style>
</head>
<body>
  <main class="player">
    <div class="cover" id="cover">${coverHtml}</div>
    <div class="song-info">
      <div class="song-title">${this._esc(songName)}</div>
      <div class="song-artist">${this._esc(artist || 'Unknown artist')}</div>
      ${album ? `<div class="song-album">${this._esc(album)}</div>` : ''}
    </div>
    <div class="progress-wrap">
      <input class="range" id="progress" type="range" min="0" max="${Math.max(0, duration)}" value="0" step="0.1" aria-label="Playback position" />
      <div class="time-row"><span id="elapsed">00:00</span><span id="duration">${this._formatTime(duration)}</span></div>
    </div>
    <div class="controls" role="toolbar" aria-label="Playback controls">
      <button type="button" class="icon-btn" data-command="seekBackward" title="Seek backward" aria-label="Seek backward">&#x25C1;</button>
      <button type="button" class="icon-btn" data-command="previous" title="Previous track" aria-label="Previous track">&#x23EE;&#xFE0E;</button>
      <button type="button" class="icon-btn primary" id="btnPlay" title="Play" aria-label="Play">&#x25B6;&#xFE0E;</button>
      <button type="button" class="icon-btn" data-command="stop" title="Stop" aria-label="Stop">&#x25A0;&#xFE0E;</button>
      <button type="button" class="icon-btn" data-command="next" title="Next track" aria-label="Next track">&#x23ED;&#xFE0E;</button>
      <button type="button" class="icon-btn" data-command="seekForward" title="Seek forward" aria-label="Seek forward">&#x25B7;</button>
    </div>
    <div class="settings">
      <label for="volume">Volume</label>
      <input class="range" id="volume" type="range" min="0" max="100" value="${this._volume}" aria-label="Volume" />
      <span id="volumeValue">${Math.round(this._volume)}%</span>
      <select id="speed" aria-label="Playback speed">
        ${[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => `<option value="${value}"${value === this._speed ? ' selected' : ''}>${value}x</option>`).join('')}
      </select>
    </div>
  </main>
  <section class="lyrics" aria-label="Lyrics">
    <div class="lyrics-header">Lyrics</div>
    <div class="lyrics-scroll" id="lyricsScroll">${lyricsHtml}</div>
  </section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = id => document.getElementById(id);
  const progress = byId('progress');
  const elapsed = byId('elapsed');
  const durationLabel = byId('duration');
  const volume = byId('volume');
  const volumeValue = byId('volumeValue');
  const speed = byId('speed');
  const btnPlay = byId('btnPlay');
  const cover = byId('cover');
  const scroll = byId('lyricsScroll');
  const lines = [...document.querySelectorAll('.lyric-line')];
  let active = -1;
  let seeking = false;
  let userScrolling = false;
  let scrollTimer;

  const formatTime = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  };
  const setPlaying = playing => {
    btnPlay.textContent = playing ? '\u23F8\uFE0E' : '\u25B6\uFE0E';
    btnPlay.title = playing ? 'Pause' : 'Play';
    btnPlay.setAttribute('aria-label', btnPlay.title);
    cover.classList.toggle('playing', playing);
  };
  const setHighlight = index => {
    if (active >= 0 && active < lines.length) lines[active].classList.remove('active');
    active = index;
    if (active >= 0 && active < lines.length) {
      lines[active].classList.add('active');
      if (!userScrolling) lines[active].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  btnPlay.addEventListener('click', () => vscode.postMessage({ type: 'play' }));
  document.querySelectorAll('[data-command]').forEach(button => {
    button.addEventListener('click', () => vscode.postMessage({ type: 'command', command: button.dataset.command }));
  });
  progress.addEventListener('pointerdown', () => { seeking = true; });
  progress.addEventListener('input', () => { elapsed.textContent = formatTime(progress.value); });
  progress.addEventListener('change', () => {
    seeking = false;
    vscode.postMessage({ type: 'seek', time: Number(progress.value) });
  });
  volume.addEventListener('input', () => {
    volumeValue.textContent = Math.round(Number(volume.value)) + '%';
  });
  volume.addEventListener('change', () => {
    vscode.postMessage({ type: 'volume', value: Number(volume.value) });
  });
  speed.addEventListener('change', () => vscode.postMessage({ type: 'speed', value: Number(speed.value) }));
  lines.forEach((line, index) => line.addEventListener('click', () => {
    const time = Number(line.dataset.time);
    if (!Number.isFinite(time)) return;
    setHighlight(index);
    vscode.postMessage({ type: 'seek', time });
  }));
  scroll.addEventListener('wheel', () => {
    userScrolling = true;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { userScrolling = false; }, 4000);
  });
  const setSpeed = value => {
    const optionValue = String(value);
    if (![...speed.options].some(option => option.value === optionValue)) {
      speed.add(new Option(optionValue + 'x', optionValue));
    }
    speed.value = optionValue;
  };
  progress.addEventListener('pointercancel', () => { seeking = false; });
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'sync') {
      setPlaying(message.playing);
      setHighlight(message.highlight);
      progress.max = Math.max(0, message.duration || 0);
      progress.value = Math.min(message.position || 0, Number(progress.max));
      elapsed.textContent = formatTime(message.position);
      durationLabel.textContent = formatTime(message.duration);
      volume.value = message.volume;
      volumeValue.textContent = Math.round(message.volume) + '%';
      setSpeed(message.speed);
    } else if (message.type === 'playState') {
      setPlaying(message.playing);
    } else if (message.type === 'highlight') {
      setHighlight(message.index);
    } else if (message.type === 'progress' && !seeking) {
      progress.max = Math.max(0, message.duration || 0);
      progress.value = Math.min(message.position || 0, Number(progress.max));
      elapsed.textContent = formatTime(message.position);
      durationLabel.textContent = formatTime(message.duration);
    } else if (message.type === 'volume') {
      volume.value = message.value;
      volumeValue.textContent = Math.round(message.value) + '%';
    } else if (message.type === 'speed') {
      setSpeed(message.value);
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }

  private _formatTime(seconds: number): string {
    const value = Math.floor(Math.max(0, seconds));
    return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
  }

  private _esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  dispose(): void {
    this._state?.panel.dispose();
    this._state = undefined;
    this._onDidRequestSeek.dispose();
    this._onDidRequestCommand.dispose();
    this._onDidRequestPlay.dispose();
    this._onDidRequestVolume.dispose();
    this._onDidRequestSpeed.dispose();
  }
}
