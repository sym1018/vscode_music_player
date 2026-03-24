export type MediaType = 'audio' | 'image' | 'video';

export interface SongItem {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  filePath: string;
  fileName: string;
  mediaType: MediaType;
}

export type PlayMode = 'sequence' | 'loop' | 'single' | 'random';

export type PlayerCommand =
  | { command: 'load'; uri: string; play: boolean }
  | { command: 'play' }
  | { command: 'pause' }
  | { command: 'stop' }
  | { command: 'setVolume'; level: number };

export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'playing'; playing: boolean }
  | { type: 'ended' }
  | { type: 'position'; position: number }
  | { type: 'duration'; duration: number }
  | { type: 'error'; message: string }
  | { type: 'loadResult'; success: boolean };
