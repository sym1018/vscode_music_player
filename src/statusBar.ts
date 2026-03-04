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
    const p = -100;
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
