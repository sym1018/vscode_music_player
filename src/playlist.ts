import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SongItem, PlayMode, MediaType } from './types';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm']);
const MEDIA_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

function getMediaType(ext: string): MediaType {
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'video';
}
const SKIP_DIRS = new Set(['.git', '.venv', '.env', 'node_modules', '__pycache__', '.cache', '.npm', '.yarn', 'dist', 'build', '.tox', '.mypy_cache', '.pytest_cache', 'site-packages']);

function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const aParts = a.match(re) || [];
  const bParts = b.match(re) || [];
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const aIsNum = /^\d+$/.test(aParts[i]);
    const bIsNum = /^\d+$/.test(bParts[i]);
    if (aIsNum && bIsNum) {
      const diff = parseInt(aParts[i]) - parseInt(bParts[i]);
      if (diff !== 0) return diff;
    } else {
      const cmp = aParts[i].localeCompare(bParts[i]);
      if (cmp !== 0) return cmp;
    }
  }
  return aParts.length - bParts.length;
}

export class PlaylistManager {
  private _songs: SongItem[] = [];
  private _currentIndex: number = -1;
  private _playMode: PlayMode = 'sequence';

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
  }

  async scanFolder(folderPath: string): Promise<void> {
    this._songs = [];
    if (!folderPath) return;
    const files = await this._scanRecursive(folderPath);
    files.sort((a, b) => naturalCompare(a.fileName, b.fileName));
    this._songs = files;
    this._currentIndex = -1;
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
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
          dirs.push(fullPath);
        } else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const baseName = path.basename(entry.name, path.extname(entry.name));
          // Try to extract "artist - title" from filename
          const dashIndex = baseName.indexOf(' - ');
          let name: string;
          let artist: string;
          if (dashIndex > 0) {
            artist = baseName.substring(0, dashIndex).trim();
            name = baseName.substring(dashIndex + 3).trim();
          } else {
            name = baseName;
            artist = '';
          }
          results.push({
            id: fullPath,
            name,
            artist,
            album: '',
            duration: 0,
            filePath: fullPath,
            fileName: entry.name,
            mediaType: getMediaType(path.extname(entry.name).toLowerCase()),
          });
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
        if (this._currentIndex <= 0) return undefined;
        return this.setCurrent(this._currentIndex - 1);
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
}
