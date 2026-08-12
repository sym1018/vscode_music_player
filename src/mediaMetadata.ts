import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import { FfmpegTool, runFfmpegTool } from './ffmpegTools';

export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  hasEmbeddedCover: boolean;
}

export interface DependencyStatus {
  ffmpeg: boolean;
  ffplay: boolean;
  ffprobe: boolean;
}

interface ProbeJson {
  format?: {
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    codec_type?: string;
    disposition?: { attached_pic?: number };
  }>;
}

async function toolAvailable(tool: FfmpegTool): Promise<boolean> {
  try {
    await runFfmpegTool(tool, ['-version'], 4000);
    return true;
  } catch {
    return false;
  }
}

function readTag(tags: Record<string, string> | undefined, name: string): string {
  if (!tags) return '';
  const entry = Object.entries(tags).find(([key]) => key.toLowerCase() === name);
  return entry?.[1]?.trim() || '';
}

export async function checkFfmpegDependencies(): Promise<DependencyStatus> {
  const [ffmpeg, ffplay, ffprobe] = await Promise.all([
    toolAvailable('ffmpeg'),
    toolAvailable('ffplay'),
    toolAvailable('ffprobe'),
  ]);
  return { ffmpeg, ffplay, ffprobe };
}

export class MediaMetadataService {
  private readonly _metadata = new Map<string, Promise<AudioMetadata>>();
  private readonly _covers = new Map<string, Promise<string>>();

  constructor(
    private readonly _cacheRoot: string,
    private readonly _log: (message: string) => void,
  ) {}

  getMetadata(filePath: string): Promise<AudioMetadata> {
    let pending = this._metadata.get(filePath);
    if (!pending) {
      pending = this._probe(filePath);
      this._metadata.set(filePath, pending);
    }
    return pending;
  }

  getCoverPath(filePath: string): Promise<string> {
    let pending = this._covers.get(filePath);
    if (!pending) {
      pending = this._resolveCover(filePath);
      this._covers.set(filePath, pending);
    }
    return pending;
  }

  clear(): void {
    this._metadata.clear();
    this._covers.clear();
  }

  private async _probe(filePath: string): Promise<AudioMetadata> {
    try {
      const stdout = await runFfmpegTool('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration:format_tags=title,artist,album:stream=codec_type:stream_disposition=attached_pic',
        '-of', 'json',
        filePath,
      ]);
      const data = JSON.parse(stdout) as ProbeJson;
      const duration = Number.parseFloat(data.format?.duration || '0');
      return {
        title: readTag(data.format?.tags, 'title'),
        artist: readTag(data.format?.tags, 'artist'),
        album: readTag(data.format?.tags, 'album'),
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        hasEmbeddedCover: !!data.streams?.some(stream =>
          stream.codec_type === 'video' && stream.disposition?.attached_pic === 1
        ),
      };
    } catch (error) {
      this._log(`Metadata unavailable for ${filePath}: ${this._errorMessage(error)}`);
      return { title: '', artist: '', album: '', duration: 0, hasEmbeddedCover: false };
    }
  }

  private async _resolveCover(filePath: string): Promise<string> {
    const metadata = await this.getMetadata(filePath);
    if (metadata.hasEmbeddedCover) {
      try {
        const stat = await fs.stat(filePath);
        const key = createHash('sha1')
          .update(`${filePath}:${stat.size}:${stat.mtimeMs}`)
          .digest('hex');
        const coverDir = path.join(this._cacheRoot, 'covers');
        const coverPath = path.join(coverDir, `${key}.png`);
        await fs.mkdir(coverDir, { recursive: true });
        try {
          await fs.access(coverPath);
          return coverPath;
        } catch {}

        await runFfmpegTool('ffmpeg', [
          '-v', 'error', '-y', '-i', filePath,
          '-map', '0:v:0', '-frames:v', '1', coverPath,
        ], 15000);
        return coverPath;
      } catch (error) {
        this._log(`Embedded cover unavailable for ${filePath}: ${this._errorMessage(error)}`);
      }
    }
    return this._findFolderCover(path.dirname(filePath));
  }

  private async _findFolderCover(directory: string): Promise<string> {
    const names = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.jpeg', 'folder.png', 'album.jpg', 'album.jpeg', 'album.png'];
    try {
      const entries = await fs.readdir(directory);
      const byLowerName = new Map(entries.map(entry => [entry.toLowerCase(), entry]));
      for (const name of names) {
        const actualName = byLowerName.get(name);
        if (actualName) return path.join(directory, actualName);
      }
    } catch {}
    return '';
  }

  private _errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
