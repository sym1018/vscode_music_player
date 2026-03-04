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
      case 'loop': {
        const idx = this._currentIndex <= 0 ? this._songs.length - 1 : this._currentIndex - 1;
        return this.setCurrent(idx);
      }
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
