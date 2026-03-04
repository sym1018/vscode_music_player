import * as vscode from 'vscode';
import { PlayerCommand, PlayerEvent } from './types';

export class MusicPlayer implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _volume: number = 50;
  private _playing: boolean = false;
  private _disposed: boolean = false;
  private _ready: boolean = false;
  private _pendingCommands: PlayerCommand[] = [];

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
      this._panel.webview.html = this._getWebviewHtml();
      this._panel.onDidDispose(() => {
        this._panel = undefined;
        this._playing = false;
        this._ready = false;
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
        this._ready = true;
        this._onDidReady.fire();
        this._sendCommand({ command: 'setVolume', level: this._volume / 100 });
        // Flush pending commands
        for (const cmd of this._pendingCommands) {
          this._panel?.webview.postMessage(cmd);
        }
        this._pendingCommands = [];
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
    if (!this._ready && this._panel) {
      this._pendingCommands.push(cmd);
    } else {
      this._panel?.webview.postMessage(cmd);
    }
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
    if (this._ready) {
      this._sendCommand({ command: 'setVolume', level: this._volume / 100 });
    }
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
