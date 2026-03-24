import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LrcLine } from './lrcParser';

interface SongPanel {
  panel: vscode.WebviewPanel;
  filePath: string;
}

export class DetailViewProvider implements vscode.Disposable {
  private _panels: Map<string, SongPanel> = new Map();
  private _playingFilePath: string = '';

  private _onDidRequestSeek = new vscode.EventEmitter<number>();
  readonly onDidRequestSeek = this._onDidRequestSeek.event;

  private _onDidRequestCommand = new vscode.EventEmitter<string>();
  readonly onDidRequestCommand = this._onDidRequestCommand.event;

  private _onDidRequestPlay = new vscode.EventEmitter<string>();
  readonly onDidRequestPlay = this._onDidRequestPlay.event;

  setPlayingFile(filePath: string): void {
    this._playingFilePath = filePath;
  }

  show(songName: string, artist: string, album: string, lyrics: LrcLine[], hasLyrics: boolean, filePath: string): void {
    let data = this._panels.get(filePath);

    if (data) {
      data.panel.reveal(vscode.ViewColumn.One, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'musicPlayer.detail',
      `♪ ${songName}`,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );

    data = { panel, filePath };
    this._panels.set(filePath, data);

    const coverUri = this._findCover(filePath);
    panel.webview.html = this._getHtml(panel, songName, artist, album, lyrics, hasLyrics, coverUri);
    panel.title = `♪ ${songName}`;

    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'seek' && typeof msg.time === 'number') {
        this._onDidRequestSeek.fire(msg.time);
      } else if (msg.type === 'play') {
        this._onDidRequestPlay.fire(data!.filePath);
      } else if (msg.type === 'command' && typeof msg.command === 'string') {
        this._onDidRequestCommand.fire(msg.command);
      }
    });

    panel.onDidDispose(() => {
      this._panels.delete(data!.filePath);
    });
  }

  /** Update the panel that was showing the previous playing song, reuse it for the new song */
  updateIfOpen(songName: string, artist: string, album: string, lyrics: LrcLine[], hasLyrics: boolean, filePath: string, oldFilePath?: string): void {
    // Try to find panel for the new file first
    let data = this._panels.get(filePath);

    // If not found, reuse the panel from the previous playing song
    if (!data && oldFilePath) {
      data = this._panels.get(oldFilePath);
      if (data) {
        this._panels.delete(oldFilePath);
        data.filePath = filePath;
        this._panels.set(filePath, data);
      }
    }

    if (!data) return;
    const coverUri = this._findCover(filePath);
    data.panel.webview.html = this._getHtml(data.panel, songName, artist, album, lyrics, hasLyrics, coverUri);
    data.panel.title = `♪ ${songName}`;
  }

  updateHighlight(index: number): void {
    const data = this._panels.get(this._playingFilePath);
    if (data) {
      data.panel.webview.postMessage({ type: 'highlight', index });
    }
  }

  updatePlayState(playing: boolean): void {
    for (const [fp, data] of this._panels) {
      data.panel.webview.postMessage({
        type: 'playState',
        playing: playing && fp === this._playingFilePath,
      });
    }
  }

  private _findCover(filePath: string): string {
    const dir = path.dirname(filePath);
    const coverNames = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'album.jpg', 'album.png'];
    for (const name of coverNames) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    return '';
  }

  private _getHtml(panel: vscode.WebviewPanel, songName: string, artist: string, album: string, lyrics: LrcLine[], hasLyrics: boolean, coverPath: string): string {
    let coverHtml: string;
    if (coverPath) {
      const webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(coverPath));
      coverHtml = `<img src="${webviewUri}" class="cover-img" alt="Cover" />`;
    } else {
      coverHtml = `<div class="cover-placeholder">&#9835;</div>`;
    }

    const lyricsHtml = hasLyrics
      ? lyrics.map((l, i) =>
          `<div class="lyric-line" data-index="${i}" data-time="${l.time}">${this._esc(l.text)}</div>`
        ).join('\n')
      : `<div class="no-lyrics">未匹配歌词</div>`;

    return /*html*/`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    height: 100vh;
    overflow: hidden;
    display: flex;
  }
  .left-panel {
    width: 40%; min-width: 260px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 40px 30px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  .cover-container {
    width: 220px; height: 220px; border-radius: 50%; overflow: hidden;
    border: 4px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    margin-bottom: 24px;
    animation: spin 20s linear infinite;
    animation-play-state: paused;
  }
  .cover-container.playing { animation-play-state: running; }
  .cover-img { width: 100%; height: 100%; object-fit: cover; }
  .cover-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-size: 64px;
    background: var(--vscode-badge-background, #333);
    color: var(--vscode-disabledForeground, rgba(128,128,128,0.4));
  }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .song-info { text-align: center; max-width: 280px; margin-bottom: 24px; }
  .song-title { font-size: 20px; font-weight: 600; color: var(--vscode-editor-foreground); margin-bottom: 8px; line-height: 1.3; }
  .song-artist { font-size: 14px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .song-album { font-size: 12px; color: var(--vscode-disabledForeground); }
  .controls { display: flex; align-items: center; gap: 16px; }
  .ctrl-btn {
    background: none; border: none; color: var(--vscode-descriptionForeground); font-size: 20px;
    cursor: pointer; width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; transition: all 0.2s;
  }
  .ctrl-btn:hover { color: var(--vscode-editor-foreground); background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
  .ctrl-btn.play-btn {
    width: 50px; height: 50px; font-size: 24px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .ctrl-btn.play-btn:hover { background: var(--vscode-button-hoverBackground); }
  .right-panel { flex: 1; display: flex; flex-direction: column; padding: 30px 40px; overflow: hidden; }
  .lyrics-header {
    font-size: 13px; color: var(--vscode-disabledForeground); margin-bottom: 16px;
    padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
  }
  .lyrics-scroll { flex: 1; overflow-y: auto; padding-right: 10px; scroll-behavior: smooth; }
  .lyrics-scroll::-webkit-scrollbar { width: 6px; }
  .lyrics-scroll::-webkit-scrollbar-track { background: transparent; }
  .lyrics-scroll::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
  .lyrics-scroll::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
  .lyric-line {
    padding: 10px 14px; font-size: 15px; line-height: 1.8;
    color: var(--vscode-disabledForeground); cursor: pointer; border-radius: 6px; transition: all 0.3s ease;
  }
  .lyric-line:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-editor-foreground); }
  .lyric-line.active {
    color: var(--vscode-editor-foreground); font-size: 17px; font-weight: 500;
    background: var(--vscode-list-activeSelectionBackground);
  }
  .no-lyrics { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 16px; color: var(--vscode-disabledForeground); }
  .lyrics-spacer { height: 40vh; }
</style>
</head>
<body>
  <div class="left-panel">
    <div class="cover-container" id="cover">${coverHtml}</div>
    <div class="song-info">
      <div class="song-title">${this._esc(songName)}</div>
      <div class="song-artist">${this._esc(artist || '未知艺术家')}</div>
      ${album ? `<div class="song-album">专辑: ${this._esc(album)}</div>` : ''}
    </div>
    <div class="controls">
      <button class="ctrl-btn" id="btnSeekBack" title="快退">&#9194;</button>
      <button class="ctrl-btn" id="btnPrev" title="上一首">&#9198;</button>
      <button class="ctrl-btn play-btn" id="btnPlay" title="播放">&#9654;</button>
      <button class="ctrl-btn" id="btnNext" title="下一首">&#9197;</button>
      <button class="ctrl-btn" id="btnSeekFwd" title="快进">&#9193;</button>
      <button class="ctrl-btn" id="btnVolDown" title="音量-">&#128265;</button>
      <button class="ctrl-btn" id="btnVolUp" title="音量+">&#128266;</button>
    </div>
  </div>
  <div class="right-panel">
    <div class="lyrics-header">歌词</div>
    <div class="lyrics-scroll" id="lyricsScroll">
      ${lyricsHtml}
      <div class="lyrics-spacer"></div>
    </div>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  const scroll = document.getElementById('lyricsScroll');
  const lines = document.querySelectorAll('.lyric-line');
  const btnPlay = document.getElementById('btnPlay');
  const cover = document.getElementById('cover');
  let currentActive = -1;
  let userScrolling = false;
  let scrollTimer = null;

  btnPlay.addEventListener('click', () => { vscode.postMessage({ type: 'play' }); });
  document.getElementById('btnPrev').addEventListener('click', () => { vscode.postMessage({ type: 'command', command: 'previous' }); });
  document.getElementById('btnNext').addEventListener('click', () => { vscode.postMessage({ type: 'command', command: 'next' }); });
  document.getElementById('btnVolDown').addEventListener('click', () => { vscode.postMessage({ type: 'command', command: 'volumeDown' }); });
  document.getElementById('btnVolUp').addEventListener('click', () => { vscode.postMessage({ type: 'command', command: 'volumeUp' }); });

  // Long-press forward: 2x speed playback
  (function() {
    const btn = document.getElementById('btnSeekFwd');
    let holdTimer = null;
    let isLongPress = false;
    btn.addEventListener('mousedown', () => {
      isLongPress = false;
      holdTimer = setTimeout(() => {
        isLongPress = true;
        vscode.postMessage({ type: 'command', command: 'speedUp' });
      }, 500);
    });
    function release() {
      clearTimeout(holdTimer);
      if (isLongPress) {
        vscode.postMessage({ type: 'command', command: 'speedNormal' });
        isLongPress = false;
      }
    }
    btn.addEventListener('mouseup', () => {
      if (!isLongPress) vscode.postMessage({ type: 'command', command: 'seekForward' });
      release();
    });
    btn.addEventListener('mouseleave', release);
  })();

  // Long-press backward: repeated rewind (simulated 2x reverse)
  (function() {
    const btn = document.getElementById('btnSeekBack');
    let holdTimer = null;
    let rewindInterval = null;
    let isLongPress = false;
    btn.addEventListener('mousedown', () => {
      isLongPress = false;
      holdTimer = setTimeout(() => {
        isLongPress = true;
        vscode.postMessage({ type: 'command', command: 'rewindStep' });
        rewindInterval = setInterval(() => {
          vscode.postMessage({ type: 'command', command: 'rewindStep' });
        }, 500);
      }, 500);
    });
    function release() {
      clearTimeout(holdTimer);
      if (rewindInterval) { clearInterval(rewindInterval); rewindInterval = null; }
      isLongPress = false;
    }
    btn.addEventListener('mouseup', () => {
      if (!isLongPress) vscode.postMessage({ type: 'command', command: 'seekBackward' });
      release();
    });
    btn.addEventListener('mouseleave', release);
  })();

  lines.forEach((line, idx) => {
    line.addEventListener('dblclick', () => {
      const time = parseFloat(line.getAttribute('data-time'));
      if (isNaN(time)) return;
      if (currentActive >= 0 && currentActive < lines.length) lines[currentActive].classList.remove('active');
      currentActive = idx;
      line.classList.add('active');
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
      vscode.postMessage({ type: 'seek', time });
    });
  });

  scroll.addEventListener('wheel', () => {
    userScrolling = true; clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { userScrolling = false; }, 4000);
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'highlight' && typeof msg.index === 'number') {
      if (currentActive >= 0 && currentActive < lines.length) lines[currentActive].classList.remove('active');
      currentActive = msg.index;
      if (currentActive >= 0 && currentActive < lines.length) {
        lines[currentActive].classList.add('active');
        if (!userScrolling) lines[currentActive].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (msg.type === 'playState') {
      btnPlay.textContent = msg.playing ? '\\u23F8' : '\\u25B6';
      btnPlay.title = msg.playing ? '暂停' : '播放';
      if (msg.playing) cover.classList.add('playing');
      else cover.classList.remove('playing');
    }
  });
</script>
</body>
</html>`;
  }

  private _esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  dispose(): void {
    for (const [, data] of this._panels) data.panel.dispose();
    this._panels.clear();
    this._onDidRequestSeek.dispose();
    this._onDidRequestCommand.dispose();
    this._onDidRequestPlay.dispose();
  }
}
