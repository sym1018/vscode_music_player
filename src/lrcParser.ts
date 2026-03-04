import * as fs from 'fs/promises';

export interface LrcLine {
  time: number;
  text: string;
}

export class LrcParser {
  private _lines: LrcLine[] = [];
  private _offset: number = 0;
  private _currentIndex: number = -1;

  get lines(): readonly LrcLine[] { return this._lines; }
  get currentIndex(): number { return this._currentIndex; }

  async loadForSong(songPath: string): Promise<boolean> {
    this._lines = [];
    this._currentIndex = -1;
    this._offset = 0;

    const lrcPath = songPath.replace(/\.[^.]+$/, '.lrc');
    try {
      const content = await fs.readFile(lrcPath, 'utf-8');
      this._parse(content);
      return this._lines.length > 0;
    } catch {
      return false;
    }
  }

  private _parse(content: string): void {
    const lines: LrcLine[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
    const offsetRegex = /\[offset:([+-]?\d+)\]/;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const offsetMatch = trimmed.match(offsetRegex);
      if (offsetMatch) {
        this._offset = parseInt(offsetMatch[1]) / 1000;
        continue;
      }

      timeRegex.lastIndex = 0;
      const timestamps: number[] = [];
      let match;
      while ((match = timeRegex.exec(trimmed)) !== null) {
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
        timestamps.push(min * 60 + sec + ms / 1000);
      }

      if (timestamps.length === 0) continue;

      const text = trimmed.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
      if (!text) continue;

      for (const time of timestamps) {
        lines.push({ time, text });
      }
    }

    lines.sort((a, b) => a.time - b.time);
    this._lines = lines;
  }

  getLyricAt(position: number): string | undefined {
    if (this._lines.length === 0) return undefined;

    const pos = position - this._offset;
    let l = 0;
    let r = this._lines.length - 1;
    while (l <= r) {
      const mid = Math.trunc((l + r) / 2);
      if (this._lines[mid].time <= pos) l = mid + 1;
      else r = mid - 1;
    }

    const idx = Math.max(0, r);
    if (idx !== this._currentIndex) {
      this._currentIndex = idx;
    }
    return this._lines[idx]?.text;
  }

  clear(): void {
    this._lines = [];
    this._currentIndex = -1;
    this._offset = 0;
  }
}
