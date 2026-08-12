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

export interface ScanOptions {
  token?: vscode.CancellationToken;
  onProgress?: (mediaCount: number, currentDirectory: string) => void;
}

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

export class PlaylistManager implements vscode.Disposable {
  private _songs: SongItem[] = [];
  private _currentIndex: number = -1;
  private _playMode: PlayMode = 'sequence';
  private _rootFolder: string = '';
  private _scanGeneration: number = 0;
  private _scanWarnings: string[] = [];
  private _randomHistory: string[] = [];
  private _randomHistoryIndex: number = -1;

  private _onDidChangePlaylist = new vscode.EventEmitter<void>();
  readonly onDidChangePlaylist = this._onDidChangePlaylist.event;

  private _onDidChangeCurrent = new vscode.EventEmitter<SongItem | undefined>();
  readonly onDidChangeCurrent = this._onDidChangeCurrent.event;

  get songs(): readonly SongItem[] { return this._songs; }
  get currentSong(): SongItem | undefined { return this._songs[this._currentIndex]; }
  get currentIndex(): number { return this._currentIndex; }
  get playMode(): PlayMode { return this._playMode; }
  get rootFolder(): string { return this._rootFolder; }
  get scanWarnings(): readonly string[] { return this._scanWarnings; }

  firstAudio(): SongItem | undefined {
    const index = this._songs.findIndex(song => song.mediaType === 'audio');
    return index >= 0 ? this.setCurrent(index) : undefined;
  }

  setPlayMode(mode: PlayMode): void {
    this._playMode = mode;
    if (mode === 'random') {
      this._resetRandomHistory();
    }
  }

  async scanFolder(folderPath: string, options: ScanOptions = {}): Promise<boolean> {
    const generation = ++this._scanGeneration;
    const currentPath = this.currentSong?.filePath;
    const warnings: string[] = [];
    const files = folderPath ? await this._scanRecursive(folderPath, options, warnings) : [];
    if (generation !== this._scanGeneration || options.token?.isCancellationRequested) {
      return false;
    }

    files.sort((a, b) => naturalCompare(a.fileName, b.fileName));
    this._songs = files;
    this._rootFolder = folderPath;
    this._scanWarnings = warnings;
    this._currentIndex = currentPath
      ? files.findIndex(song => song.filePath === currentPath)
      : -1;
    this._reconcileRandomHistory();
    this._onDidChangePlaylist.fire();
    this._onDidChangeCurrent.fire(this.currentSong);
    return true;
  }

  private async _scanRecursive(
    dir: string,
    options: ScanOptions,
    warnings: string[],
  ): Promise<SongItem[]> {
    const results: SongItem[] = [];
    const dirs: string[] = [dir];
    while (dirs.length) {
      if (options.token?.isCancellationRequested) break;
      const current = dirs.pop()!;
      options.onProgress?.(results.length, current);
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${current}: ${message}`);
        continue;
      }
      for (const entry of entries) {
        if (options.token?.isCancellationRequested) break;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name.toLowerCase())) {
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
          if (results.length % 25 === 0) {
            options.onProgress?.(results.length, current);
          }
        }
      }
    }
    return results;
  }

  applyMetadata(
    updates: ReadonlyMap<string, Partial<Pick<SongItem, 'name' | 'artist' | 'album' | 'duration'>>>,
  ): void {
    let changed = false;
    this._songs = this._songs.map(song => {
      const update = updates.get(song.filePath);
      if (!update) return song;
      changed = true;
      return { ...song, ...update };
    });
    if (!changed) return;
    this._onDidChangePlaylist.fire();
    this._onDidChangeCurrent.fire(this.currentSong);
  }

  setCurrent(index: number, recordHistory: boolean = true): SongItem | undefined {
    if (index < 0 || index >= this._songs.length) return undefined;
    this._currentIndex = index;
    const song = this._songs[index];
    if (recordHistory && this._playMode === 'random' && song.mediaType === 'audio') {
      this._recordRandomSelection(song.filePath);
    }
    this._onDidChangeCurrent.fire(song);
    return song;
  }

  setCurrentByPath(filePath: string, recordHistory: boolean = true): SongItem | undefined {
    const index = this._songs.findIndex(s => s.filePath === filePath);
    if (index >= 0) return this.setCurrent(index, recordHistory);
    return undefined;
  }

  next(): SongItem | undefined {
    const audioIndices = this._audioIndices();
    if (audioIndices.length === 0) return undefined;
    const position = audioIndices.indexOf(this._currentIndex);

    switch (this._playMode) {
      case 'single':
        return this.setCurrent(position >= 0 ? this._currentIndex : audioIndices[0]);
      case 'random':
        return this._nextRandom(audioIndices);
      case 'sequence':
        if (position >= audioIndices.length - 1) return undefined;
        return this.setCurrent(audioIndices[position + 1]);
      case 'loop':
        return this.setCurrent(audioIndices[(position + 1) % audioIndices.length]);
    }
  }

  previous(): SongItem | undefined {
    const audioIndices = this._audioIndices();
    if (audioIndices.length === 0) return undefined;
    const position = audioIndices.indexOf(this._currentIndex);

    switch (this._playMode) {
      case 'single':
        return this.setCurrent(position >= 0 ? this._currentIndex : audioIndices[0]);
      case 'random':
        return this._previousRandom();
      case 'sequence':
        if (position <= 0) return undefined;
        return this.setCurrent(audioIndices[position - 1]);
      case 'loop':
        return this.setCurrent(audioIndices[position <= 0 ? audioIndices.length - 1 : position - 1]);
    }
  }

  private _audioIndices(): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this._songs.length; i++) {
      if (this._songs[i].mediaType === 'audio') indices.push(i);
    }
    return indices;
  }

  private _nextRandom(audioIndices: number[]): SongItem | undefined {
    if (this._randomHistoryIndex < this._randomHistory.length - 1) {
      this._randomHistoryIndex++;
      return this.setCurrentByPath(this._randomHistory[this._randomHistoryIndex], false);
    }
    if (audioIndices.length === 1) {
      const song = this.setCurrent(audioIndices[0], false);
      if (song) this._recordRandomSelection(song.filePath);
      return song;
    }
    let index: number;
    do {
      index = audioIndices[Math.floor(Math.random() * audioIndices.length)];
    } while (index === this._currentIndex);
    const song = this.setCurrent(index, false);
    if (song) this._recordRandomSelection(song.filePath);
    return song;
  }

  private _previousRandom(): SongItem | undefined {
    if (this._randomHistoryIndex <= 0) return undefined;
    this._randomHistoryIndex--;
    return this.setCurrentByPath(this._randomHistory[this._randomHistoryIndex], false);
  }

  private _recordRandomSelection(filePath: string): void {
    if (this._randomHistory[this._randomHistoryIndex] === filePath) return;
    this._randomHistory = this._randomHistory.slice(0, this._randomHistoryIndex + 1);
    this._randomHistory.push(filePath);
    if (this._randomHistory.length > 100) {
      this._randomHistory.shift();
    }
    this._randomHistoryIndex = this._randomHistory.length - 1;
  }

  private _resetRandomHistory(): void {
    const current = this.currentSong;
    this._randomHistory = current?.mediaType === 'audio' ? [current.filePath] : [];
    this._randomHistoryIndex = this._randomHistory.length - 1;
  }

  private _reconcileRandomHistory(): void {
    const activePath = this._randomHistory[this._randomHistoryIndex];
    const audioPaths = new Set(
      this._songs.filter(song => song.mediaType === 'audio').map(song => song.filePath),
    );
    this._randomHistory = this._randomHistory.filter(filePath => audioPaths.has(filePath));
    this._randomHistoryIndex = activePath ? this._randomHistory.indexOf(activePath) : -1;
    if (this._randomHistoryIndex < 0) {
      this._resetRandomHistory();
    }
  }

  dispose(): void {
    this._scanGeneration++;
    this._onDidChangePlaylist.dispose();
    this._onDidChangeCurrent.dispose();
  }
}
