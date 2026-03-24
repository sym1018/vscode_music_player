import * as vscode from 'vscode';

export class StatusBarController implements vscode.Disposable {
  private _btnSeekBack: vscode.StatusBarItem;
  private _btnPrev: vscode.StatusBarItem;
  private _btnPlay: vscode.StatusBarItem;
  private _btnNext: vscode.StatusBarItem;
  private _btnSeekFwd: vscode.StatusBarItem;
  private _btnSpeed: vscode.StatusBarItem;
  private _btnVolDown: vscode.StatusBarItem;
  private _btnVolUp: vscode.StatusBarItem;
  private _btnLyric: vscode.StatusBarItem;
  private _btnSong: vscode.StatusBarItem;
  private _btnLyricText: vscode.StatusBarItem;
  private _btnMode: vscode.StatusBarItem;
  private _btnElapsed: vscode.StatusBarItem;
  private _btnBar: vscode.StatusBarItem;

  private _showLyric: boolean = true;
  private _totalDuration: number = 0;

  constructor() {
    const p = -100;
    this._btnSeekBack  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p);
    this._btnPrev      = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 1);
    this._btnPlay      = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 2);
    this._btnNext      = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 3);
    this._btnSeekFwd   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 4);
    this._btnSpeed     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 5);
    this._btnVolDown   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 6);
    this._btnVolUp     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 7);
    this._btnLyric     = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 8);
    this._btnMode      = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 9);
    this._btnElapsed   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 10);
    this._btnBar       = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 11);
    this._btnSong      = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 12);
    this._btnLyricText = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, p - 13);

    this._btnSeekBack.text = '$(triangle-left)';
    this._btnSeekBack.tooltip = 'Seek Backward';
    this._btnSeekBack.command = 'musicPlayer.seekBackward';

    this._btnPrev.text = '$(chevron-left)';
    this._btnPrev.tooltip = 'Previous Track';
    this._btnPrev.command = 'musicPlayer.previous';

    this._btnPlay.text = '$(play)';
    this._btnPlay.tooltip = 'Play';
    this._btnPlay.command = 'musicPlayer.play';

    this._btnNext.text = '$(chevron-right)';
    this._btnNext.tooltip = 'Next Track';
    this._btnNext.command = 'musicPlayer.next';

    this._btnSeekFwd.text = '$(triangle-right)';
    this._btnSeekFwd.tooltip = 'Seek Forward';
    this._btnSeekFwd.command = 'musicPlayer.seekForward';

    this._btnSpeed.text = '1x';
    this._btnSpeed.tooltip = 'Toggle Fast Forward';
    this._btnSpeed.command = 'musicPlayer.toggleFastForward';

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

    this._btnElapsed.text = '';
    this._btnElapsed.tooltip = 'Click to seek to time';
    this._btnElapsed.command = 'musicPlayer.seek';

    this._btnBar.text = '';

    this._btnSong.text = '$(music) No song';
    this._btnSong.tooltip = 'Current song';

    this._btnLyricText.text = '';
    this._btnLyricText.tooltip = 'Lyrics';
  }

  showAll(): void {
    this._btnSeekBack.show();
    this._btnPrev.show();
    this._btnPlay.show();
    this._btnNext.show();
    this._btnSeekFwd.show();
    this._btnSpeed.show();
    this._btnVolDown.show();
    this._btnVolUp.show();
    this._btnLyric.show();
    this._btnMode.show();
    this._btnElapsed.show();
    this._btnBar.show();
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

  updateSpeed(speed: number): void {
    this._btnSpeed.text = speed === 1 ? '1x' : `${speed}x`;
    this._btnSpeed.tooltip = speed === 1 ? 'Toggle Fast Forward' : `Playing at ${speed}x — click to restore`;
  }

  updateVolume(level: number): void {
    this._btnVolDown.tooltip = `Volume Down (${level})`;
    this._btnVolUp.tooltip = `Volume Up (${level})`;
  }

  setDuration(seconds: number): void {
    this._totalDuration = seconds;
  }

  getDuration(): number {
    return this._totalDuration;
  }

  updateProgress(positionSeconds: number): void {
    this._btnElapsed.text = this._formatTime(positionSeconds);
    if (this._totalDuration <= 0) {
      this._btnBar.text = '';
      return;
    }
    const total = this._formatTime(this._totalDuration);
    const barLength = 10;
    const fraction = Math.min(positionSeconds / this._totalDuration, 1);
    const filled = Math.round(fraction * barLength);
    const bar = '\u2501'.repeat(filled) + '\u2500'.repeat(barLength - filled);
    this._btnBar.text = `${bar} ${total}`;
  }

  clearProgress(): void {
    this._btnElapsed.text = '';
    this._btnBar.text = '';
    this._totalDuration = 0;
  }

  clearSong(): void {
    this._btnSong.text = '$(music) No song';
    this._btnLyricText.text = '';
    this.clearProgress();
    this.updatePlaying(false);
  }

  private _formatTime(seconds: number): string {
    const s = Math.floor(Math.max(0, seconds));
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  dispose(): void {
    this._btnSeekBack.dispose();
    this._btnPrev.dispose();
    this._btnPlay.dispose();
    this._btnNext.dispose();
    this._btnSeekFwd.dispose();
    this._btnSpeed.dispose();
    this._btnVolDown.dispose();
    this._btnVolUp.dispose();
    this._btnLyric.dispose();
    this._btnMode.dispose();
    this._btnElapsed.dispose();
    this._btnBar.dispose();
    this._btnSong.dispose();
    this._btnLyricText.dispose();
  }
}
