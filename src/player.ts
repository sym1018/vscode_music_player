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
  private _restartOnResume: boolean = false;
  private _resumePosition: number = 0;

  private _onDidChangeState = new vscode.EventEmitter<'playing' | 'paused' | 'stopped'>();
  readonly onDidChangeState = this._onDidChangeState.event;

  private _onDidEnd = new vscode.EventEmitter<void>();
  readonly onDidEnd = this._onDidEnd.event;

  private _onDidPosition = new vscode.EventEmitter<number>();
  readonly onDidPosition = this._onDidPosition.event;

  get playing(): boolean { return this._playing && !this._paused; }
  get paused(): boolean { return this._paused; }
  get currentPosition(): number { return this._getCurrentPosition(); }
  get currentFilePath(): string { return this._currentFilePath; }
  get volume(): number { return this._volume; }

  async load(filePath: string, play: boolean = true, seekTo: number = 0): Promise<void> {
    this.stop();
    this._currentFilePath = filePath;
    this._resumePosition = Math.max(0, seekTo);
    this._onDidPosition.fire(this._resumePosition);
    if (play) {
      this._startProcess(filePath, this._resumePosition);
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

    const proc = spawn('ffplay', args, { stdio: ['pipe', 'ignore', 'ignore'] });
    this._proc = proc;
    this._playing = true;
    this._paused = false;
    this._startTime = Date.now() - (seekTo * 1000 / this._speed);
    this._totalPausedMs = 0;
    this._restartOnResume = false;
    this._resumePosition = seekTo;

    this._onDidChangeState.fire('playing');
    this._startPosTracking();

    let spawnFailed = false;

    proc.on('exit', () => {
      if (spawnFailed) return;
      if (gen !== this._generation) return;
      this._stopPosTracking();
      this._playing = false;
      this._paused = false;
      this._resumePosition = 0;
      if (this._proc === proc) this._proc = undefined;
      this._onDidPosition.fire(0);
      this._onDidChangeState.fire('stopped');
      this._onDidEnd.fire();
    });

    proc.on('error', (err) => {
      spawnFailed = true;
      if (gen !== this._generation) return;
      this._stopPosTracking();
      this._playing = false;
      this._paused = false;
      if (this._proc === proc) this._proc = undefined;
      this._onDidChangeState.fire('stopped');
      vscode.window.showErrorMessage(
        `Music Player: Cannot start ffplay - ${err.message}. Please install ffmpeg.`
      );
    });
  }

  toggle(): void {
    if (!this._proc && !this._paused) {
      if (this._currentFilePath) {
        this._startProcess(this._currentFilePath, this._resumePosition);
      }
      return;
    }

    if (this._paused) {
      // RESUME
      if (IS_WIN) {
        if (this._currentFilePath) {
          this._startProcess(this._currentFilePath, this._resumePosition);
        }
      } else if (this._restartOnResume) {
        const filePath = this._currentFilePath;
        const pos = this._resumePosition;
        this._stopProcess(false, false);
        if (filePath) {
          this._startProcess(filePath, pos);
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
      this._resumePosition = this._getCurrentPosition();
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
    this._stopProcess(true, true);
  }

  private _stopProcess(resetPosition: boolean, emitState: boolean): void {
    this._stopPosTracking();
    this._generation++;
    const hadProc = !!this._proc;
    const hadPosition = this._resumePosition > 0;
    if (this._proc) {
      if (this._paused && !IS_WIN) {
        try { this._proc.kill('SIGCONT'); } catch {}
      }
      this._proc.stdin?.destroy();
      try { this._proc.kill('SIGKILL'); } catch {}
      this._proc = undefined;
    }
    const wasActive = hadProc || this._paused;
    this._playing = false;
    this._paused = false;
    this._restartOnResume = false;
    if (resetPosition) {
      this._resumePosition = 0;
      this._onDidPosition.fire(0);
    }
    if (emitState && (wasActive || (resetPosition && hadPosition))) {
      this._onDidChangeState.fire('stopped');
    }
  }

  seek(seconds: number): void {
    if (!this._currentFilePath) return;
    const pos = Math.max(0, seconds);
    this._resumePosition = pos;
    this._onDidPosition.fire(pos);
    if (!this._playing && !this._paused) return;
    if (this._paused) {
      this._restartOnResume = !IS_WIN;
      return;
    }
    this._stopProcess(false, false);
    if (this._currentFilePath) {
      this._startProcess(this._currentFilePath, pos);
    }
  }

  setVolume(level: number): void {
    const volume = Math.max(0, Math.min(100, level));
    if (volume === this._volume) return;

    const pos = this._getCurrentPosition();
    this._volume = volume;
    if (this._paused) {
      this._restartOnResume = !IS_WIN;
      return;
    }
    if (this._proc && this._playing) {
      this._stopProcess(false, false);
      if (this._currentFilePath) {
        this._startProcess(this._currentFilePath, pos);
      }
    }
  }

  private _getCurrentPosition(): number {
    if (!this._playing || this._paused) return this._resumePosition;
    const now = this._paused ? this._pauseTime : Date.now();
    return Math.max(0, (now - this._startTime - this._totalPausedMs) / 1000 * this._speed);
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0 || speed === this._speed) return;
    const pos = this._getCurrentPosition();
    this._speed = speed;
    if (this._paused) {
      this._resumePosition = pos;
      this._restartOnResume = !IS_WIN;
      return;
    }
    if (this._proc && this._playing) {
      this._stopProcess(false, false);
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
        this._resumePosition = this._getCurrentPosition();
        this._onDidPosition.fire(this._resumePosition);
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
    this._stopProcess(true, false);
    this._onDidChangeState.dispose();
    this._onDidEnd.dispose();
    this._onDidPosition.dispose();
  }
}
