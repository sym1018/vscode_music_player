import * as vscode from 'vscode';
import { StatusBarMode } from './types';

export class StatusBarController implements vscode.Disposable {
  private readonly _btnSeekBack: vscode.StatusBarItem;
  private readonly _btnPrev: vscode.StatusBarItem;
  private readonly _btnPlay: vscode.StatusBarItem;
  private readonly _btnStop: vscode.StatusBarItem;
  private readonly _btnNext: vscode.StatusBarItem;
  private readonly _btnSeekFwd: vscode.StatusBarItem;
  private readonly _btnSpeed: vscode.StatusBarItem;
  private readonly _btnVolDown: vscode.StatusBarItem;
  private readonly _btnVolUp: vscode.StatusBarItem;
  private readonly _btnLyric: vscode.StatusBarItem;
  private readonly _btnSong: vscode.StatusBarItem;
  private readonly _btnLyricText: vscode.StatusBarItem;
  private readonly _btnMode: vscode.StatusBarItem;
  private readonly _btnElapsed: vscode.StatusBarItem;
  private readonly _btnBar: vscode.StatusBarItem;
  private readonly _items: vscode.StatusBarItem[];

  private _showLyric = true;
  private _totalDuration = 0;
  private _position = 0;
  private _layout: StatusBarMode;
  private _visible = false;

  constructor(layout: StatusBarMode = 'compact') {
    this._layout = layout;
    const create = (priority: number) =>
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
    const p = -100;
    this._btnSeekBack = create(p);
    this._btnPrev = create(p - 1);
    this._btnPlay = create(p - 2);
    this._btnStop = create(p - 3);
    this._btnNext = create(p - 4);
    this._btnSeekFwd = create(p - 5);
    this._btnSpeed = create(p - 6);
    this._btnVolDown = create(p - 7);
    this._btnVolUp = create(p - 8);
    this._btnLyric = create(p - 9);
    this._btnMode = create(p - 10);
    this._btnElapsed = create(p - 11);
    this._btnBar = create(p - 12);
    this._btnSong = create(p - 13);
    this._btnLyricText = create(p - 14);
    this._items = [
      this._btnSeekBack, this._btnPrev, this._btnPlay, this._btnStop,
      this._btnNext, this._btnSeekFwd, this._btnSpeed, this._btnVolDown,
      this._btnVolUp, this._btnLyric, this._btnMode, this._btnElapsed,
      this._btnBar, this._btnSong, this._btnLyricText,
    ];

    this._configure(this._btnSeekBack, '$(triangle-left)', 'Seek Backward', 'musicPlayer.seekBackward');
    this._configure(this._btnPrev, '$(chevron-left)', 'Previous Track', 'musicPlayer.previous');
    this._configure(this._btnPlay, '$(play)', 'Play', 'musicPlayer.play');
    this._configure(this._btnStop, '$(debug-stop)', 'Stop', 'musicPlayer.stop');
    this._configure(this._btnNext, '$(chevron-right)', 'Next Track', 'musicPlayer.next');
    this._configure(this._btnSeekFwd, '$(triangle-right)', 'Seek Forward', 'musicPlayer.seekForward');
    this._configure(this._btnSpeed, '1x', 'Toggle Fast Forward', 'musicPlayer.toggleFastForward');
    this._configure(this._btnVolDown, '$(remove)', 'Volume Down', 'musicPlayer.volumeDown');
    this._configure(this._btnVolUp, '$(add)', 'Volume Up', 'musicPlayer.volumeUp');
    this._configure(this._btnLyric, '$(quote)', 'Toggle Lyrics', 'musicPlayer.toggleLyric');
    this._configure(this._btnMode, '$(list-ordered)', 'Play Mode: Sequence', 'musicPlayer.switchMode');
    this._configure(this._btnElapsed, '', 'Seek to Time', 'musicPlayer.seek');
    this._btnBar.text = '';
    this._btnSong.text = '$(music) No song';
    this._btnSong.tooltip = 'Current song';
    this._btnLyricText.text = '';
    this._btnLyricText.tooltip = 'Lyrics';
  }

  private _configure(item: vscode.StatusBarItem, text: string, tooltip: string, command: string): void {
    item.text = text;
    item.tooltip = tooltip;
    item.command = command;
    item.accessibilityInformation = { label: tooltip, role: 'button' };
  }

  showAll(): void {
    this._visible = true;
    this._applyVisibility();
  }

  setLayout(layout: StatusBarMode): void {
    this._layout = layout;
    this.updateProgress(this._position);
    if (this._visible) this._applyVisibility();
  }

  private _applyVisibility(): void {
    for (const item of this._items) item.hide();
    const compact = [
      this._btnPrev, this._btnPlay, this._btnStop, this._btnNext,
      this._btnElapsed, this._btnSong, this._btnLyricText,
    ];
    const visible = this._layout === 'compact' ? compact : this._items;
    for (const item of visible) item.show();
  }

  updatePlaying(playing: boolean): void {
    this._btnPlay.text = playing ? '$(debug-pause)' : '$(play)';
    this._btnPlay.tooltip = playing ? 'Pause' : 'Play';
    this._btnPlay.accessibilityInformation = { label: playing ? 'Pause' : 'Play', role: 'button' };
  }

  updateSong(name: string, artist?: string): void {
    const label = artist ? `${name} - ${artist}` : name;
    this._btnSong.text = `$(music) ${label}`;
    this._btnSong.tooltip = label;
  }

  updateLyric(text: string): void {
    this._btnLyricText.text = this._showLyric && text ? text : '';
  }

  toggleLyric(): boolean {
    this._showLyric = !this._showLyric;
    if (!this._showLyric) this._btnLyricText.text = '';
    this._btnLyric.text = this._showLyric ? '$(quote)' : '$(eye-closed)';
    return this._showLyric;
  }

  updateMode(mode: string): void {
    const icons: Record<string, string> = {
      sequence: '$(list-ordered)',
      loop: '$(sync)',
      single: '$(debug-restart)',
      random: '$(symbol-number)',
    };
    const labels: Record<string, string> = {
      sequence: 'Sequence',
      loop: 'Loop All',
      single: 'Single Loop',
      random: 'Random',
    };
    this._btnMode.text = icons[mode] || '$(list-ordered)';
    this._btnMode.tooltip = `Play Mode: ${labels[mode] || mode}`;
  }

  updateSpeed(speed: number): void {
    this._btnSpeed.text = `${speed}x`;
    this._btnSpeed.tooltip = speed === 1 ? 'Toggle Fast Forward' : `Playing at ${speed}x; click to restore`;
  }

  updateVolume(level: number): void {
    this._btnVolDown.tooltip = `Volume Down (${level})`;
    this._btnVolUp.tooltip = `Volume Up (${level})`;
  }

  setDuration(seconds: number): void {
    this._totalDuration = Math.max(0, seconds);
    this.updateProgress(this._position);
  }

  getDuration(): number { return this._totalDuration; }

  updateProgress(positionSeconds: number): void {
    this._position = Math.max(0, positionSeconds);
    const current = this._formatTime(this._position);
    const total = this._totalDuration > 0 ? this._formatTime(this._totalDuration) : '--:--';
    this._btnElapsed.text = this._layout === 'compact' ? `${current} / ${total}` : current;
    if (this._totalDuration <= 0) {
      this._btnBar.text = '';
      return;
    }
    const fraction = Math.min(this._position / this._totalDuration, 1);
    const filled = Math.round(fraction * 10);
    this._btnBar.text = `${'\u2501'.repeat(filled)}${'\u2500'.repeat(10 - filled)} ${total}`;
  }

  clearProgress(): void {
    this._position = 0;
    this._totalDuration = 0;
    this._btnElapsed.text = '';
    this._btnBar.text = '';
  }

  clearSong(): void {
    this._btnSong.text = '$(music) No song';
    this._btnLyricText.text = '';
    this.clearProgress();
    this.updatePlaying(false);
  }

  private _formatTime(seconds: number): string {
    const value = Math.floor(Math.max(0, seconds));
    const mm = Math.floor(value / 60).toString().padStart(2, '0');
    const ss = (value % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  dispose(): void {
    for (const item of this._items) item.dispose();
  }
}
