import * as path from 'path';
import { execFile } from 'child_process';

export type FfmpegTool = 'ffmpeg' | 'ffplay' | 'ffprobe';

export const BUNDLED_FFMPEG_VERSION = 'n8.1.2-34-g9b6c8969e0-20260811';

export function getFfmpegRuntimeDirectory(): string {
  return path.resolve(__dirname, '..', 'vendor', 'ffmpeg', 'win32-x64', 'bin');
}

export function getFfmpegToolPath(tool: FfmpegTool): string {
  return path.join(getFfmpegRuntimeDirectory(), `${tool}.exe`);
}

export function runFfmpegTool(
  tool: FfmpegTool,
  args: readonly string[],
  timeout: number = 10000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(getFfmpegToolPath(tool), [...args], {
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}
