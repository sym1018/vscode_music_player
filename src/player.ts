import * as vscode from 'vscode';
import { ChildProcess, spawn, execFile } from 'child_process';

const IS_WIN = process.platform === 'win32';

export async function getDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
    ], { timeout: 5000 }, (err, stdout) => {
      if (err) { resolve(0); return; }
      const seconds = parseFloat(stdout.trim());
      resolve(isFinite(seconds) && seconds > 0 ? seconds : 0);
    });
  });
}

export class MusicPlayer implements vscode.Disposable {
  private _proc: ChildProcess | undefined;
  private _volume: number = 50;
  private _playing: boolean = false;
  private _paused: boolean = false;
  private _startTime: number = 0;
  private _pauseTime: number = 0;
  private _totalPausedMs: number = 0;
  private _posTimer: ReturnType<typeof setInterval> | undefined;
  private _currentFilePath: string = '';
  private _generation: number = 0;
  private _speed: number = 1;

  private _onDidChangeState = new vscode.EventEmitter<'playing' | 'paused' | 'stopped'>();
  readonly onDidChangeState = this._onDidChangeState.event;

  private _onDidEnd = new vscode.EventEmitter<void>();
  readonly onDidEnd = this._onDidEnd.event;

  private _onDidPosition = new vscode.EventEmitter<number>();
  readonly onDidPosition = this._onDidPosition.event;

  get playing(): boolean { return this._playing && !this._paused; }
  get currentPosition(): number { return this._getCurrentPosition(); }

  async load(filePath: string, play: boolean = true): Promise<void> {
    this.stop();
    this._currentFilePath = filePath;
    if (play) {
      this._startProcess(filePath);
    }
  }

  private _startProcess(filePath: string, seekTo: number = 0): void {
    const gen = ++this._generation;
    const args = ['-nodisp', '-autoexit', '-loglevel', 'quiet',
                  '-volume', String(this._volume)];
    if (seekTo > 0) {
      args.push('-ss', String(seekTo));
    }
    if (this._speed !== 1) {
      args.push('-af', `atempo=${this._speed}`);
    }
    args.push('-i', filePath);

    this._proc = spawn('ffplay', args, { stdio: ['pipe', 'ignore', 'ignore'] });
    this._playing = true;
    this._paused = false;
    this._startTime = Date.now() - (seekTo * 1000 / this._speed);
    this._totalPausedMs = 0;

    this._onDidChangeState.fire('playing');
    this._startPosTracking();

    this._proc.on('exit', () => {
      if (gen !== this._generation) return;
      this._stopPosTracking();
      this._playing = false;
      this._paused = false;
      this._proc = undefined;
      this._onDidEnd.fire();
    });

    this._proc.on('error', (err) => {
      vscode.window.showErrorMessage(
        `Music Player: Cannot start ffplay - ${err.message}. Please install ffmpeg.`
      );
    });
  }

  toggle(): void {
    if (!this._proc && !this._paused) {
      // No process and not in Windows-paused state: start fresh
      if (this._currentFilePath) {
        this._startProcess(this._currentFilePath);
      }
      return;
    }

    if (this._paused) {
      // RESUME
      if (IS_WIN) {
        const pos = this._getCurrentPosition();
        if (this._currentFilePath) {
          this._startProcess(this._currentFilePath, pos);
        }
      } else {
        this._proc!.kill('SIGCONT');
        this._totalPausedMs += Date.now() - this._pauseTime;
        this._paused = false;
        this._onDidChangeState.fire('playing');
        this._startPosTracking();
      }
    } else {
      // PAUSE
      if (IS_WIN) {
        this._pauseTime = Date.now();
        this._paused = true;
        this._stopPosTracking();
        this._generation++;
        if (this._proc) {
          this._proc.stdin?.destroy();
          try { this._proc.kill(); } catch {}
          this._proc = undefined;
        }
        this._onDidChangeState.fire('paused');
      } else {
        this._proc!.kill('SIGSTOP');
        this._pauseTime = Date.now();
        this._paused = true;
        this._onDidChangeState.fire('paused');
        this._stopPosTracking();
      }
    }
  }

  stop(): void {
    this._stopPosTracking();
    this._generation++;
    const hadProc = !!this._proc;
    if (this._proc) {
      const pid = this._proc.pid;
      if (this._paused && !IS_WIN) {
        this._proc.kill('SIGCONT');
      }
      this._proc.stdin?.destroy();
      this._proc.kill('SIGKILL');
      this._proc = undefined;
      if (pid) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
    const wasActive = hadProc || this._paused;
    this._playing = false;
    this._paused = false;
    if (wasActive) {
      this._onDidChangeState.fire('stopped');
    }
  }

  seek(seconds: number): void {
    if (!this._playing && !this._paused) return;
    const pos = Math.max(0, seconds);
    if (IS_WIN && this._paused) {
      // Adjust saved position for next resume
      this._startTime = this._pauseTime - this._totalPausedMs - (pos * 1000);
      return;
    }
    this.stop();
    if (this._currentFilePath) {
      this._startProcess(this._currentFilePath, pos);
    }
  }

  setVolume(level: number): void {
    this._volume = Math.max(0, Math.min(100, level));
  }

  private _getCurrentPosition(): number {
    if (!this._playing && !this._paused) return 0;
    const now = this._paused ? this._pauseTime : Date.now();
    return (now - this._startTime - this._totalPausedMs) / 1000 * this._speed;
  }

  setSpeed(speed: number): void {
    if (speed === this._speed) return;
    const pos = this._getCurrentPosition();
    this._speed = speed;
    if (this._proc && this._playing) {
      this.stop();
      if (this._currentFilePath) {
        this._startProcess(this._currentFilePath, pos);
      }
    }
  }

  get speed(): number { return this._speed; }

  private _startPosTracking(): void {
    this._stopPosTracking();
    this._posTimer = setInterval(() => {
      if (this._playing && !this._paused) {
        this._onDidPosition.fire(this._getCurrentPosition());
      }
    }, 800);
  }

  private _stopPosTracking(): void {
    if (this._posTimer) {
      clearInterval(this._posTimer);
      this._posTimer = undefined;
    }
  }

  dispose(): void {
    this.stop();
    this._onDidChangeState.dispose();
    this._onDidEnd.dispose();
    this._onDidPosition.dispose();
  }
}
