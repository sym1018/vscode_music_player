import * as vscode from 'vscode';
import { MusicPlayer } from './player';
import { PlaylistManager } from './playlist';
import { LrcParser } from './lrcParser';
import { StatusBarController } from './statusBar';
import { SidebarProvider } from './sidebarProvider';
import { PlayMode } from './types';

let player: MusicPlayer;
let playlist: PlaylistManager;
let lrcParser: LrcParser;
let statusBar: StatusBarController;
let sidebarProvider: SidebarProvider;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('musicPlayer');

  // Initialize modules
  player = new MusicPlayer(context.extensionUri);
  playlist = new PlaylistManager();
  lrcParser = new LrcParser();
  statusBar = new StatusBarController();
  sidebarProvider = new SidebarProvider();

  // Register TreeView
  const treeView = vscode.window.createTreeView('musicPlayer-songList', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: false,
  });

  // Load config
  let volume = config.get<number>('volume', 50);
  let playMode = config.get<PlayMode>('playMode', 'sequence');
  playlist.setPlayMode(playMode);
  statusBar.updateMode(playMode);
  statusBar.updateVolume(volume);
  player.setVolume(volume);

  // Event: player state changed
  player.onDidChangeState((state) => {
    statusBar.updatePlaying(state === 'playing');
  });

  // Event: track ended - play next
  player.onDidEnd(() => {
    const nextSong = playlist.next();
    if (nextSong) {
      playSong(nextSong.filePath);
    } else {
      statusBar.clearSong();
    }
  });

  // Event: player position - update lyrics
  player.onDidPosition((position) => {
    const lyric = lrcParser.getLyricAt(position);
    if (lyric !== undefined) {
      statusBar.updateLyric(lyric);
    }
  });

  // Event: playlist changed - update sidebar
  playlist.onDidChangePlaylist(() => {
    sidebarProvider.setSongs(playlist.songs);
  });

  // Helper: play a song by path
  async function playSong(filePath: string) {
    const song = playlist.setCurrentByPath(filePath) || playlist.songs.find(s => s.filePath === filePath);
    if (!song) return;

    statusBar.updateSong(song.name, song.artist);
    sidebarProvider.setCurrentIndex(playlist.currentIndex);

    // Load lyrics
    const hasLyric = await lrcParser.loadForSong(song.filePath);
    if (!hasLyric) {
      statusBar.updateLyric('');
    }

    // Load and play audio
    await player.load(song.filePath, true);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('musicPlayer.play', () => {
      if (!playlist.currentSong && playlist.songs.length > 0) {
        const song = playlist.setCurrent(0);
        if (song) playSong(song.filePath);
      } else {
        player.toggle();
      }
    }),

    vscode.commands.registerCommand('musicPlayer.next', () => {
      const song = playlist.next();
      if (song) playSong(song.filePath);
    }),

    vscode.commands.registerCommand('musicPlayer.previous', () => {
      const song = playlist.previous();
      if (song) playSong(song.filePath);
    }),

    vscode.commands.registerCommand('musicPlayer.volumeUp', () => {
      volume = Math.min(100, volume + 10);
      player.setVolume(volume);
      statusBar.updateVolume(volume);
      void config.update('volume', volume, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('musicPlayer.volumeDown', () => {
      volume = Math.max(0, volume - 10);
      player.setVolume(volume);
      statusBar.updateVolume(volume);
      void config.update('volume', volume, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('musicPlayer.toggleLyric', () => {
      statusBar.toggleLyric();
    }),

    vscode.commands.registerCommand('musicPlayer.switchMode', () => {
      const modes: PlayMode[] = ['sequence', 'loop', 'single', 'random'];
      const currentIdx = modes.indexOf(playMode);
      playMode = modes[(currentIdx + 1) % modes.length];
      playlist.setPlayMode(playMode);
      statusBar.updateMode(playMode);
      void config.update('playMode', playMode, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('musicPlayer.selectFolder', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Music Folder',
      });
      if (uris && uris[0]) {
        const folderPath = uris[0].fsPath;
        await config.update('musicFolder', folderPath, vscode.ConfigurationTarget.Global);
        await playlist.scanFolder(folderPath);
        if (playlist.songs.length > 0) {
          vscode.window.showInformationMessage(`Found ${playlist.songs.length} songs`);
        } else {
          vscode.window.showWarningMessage('No supported audio files found');
        }
      }
    }),

    vscode.commands.registerCommand('musicPlayer.playSong', (index: number) => {
      const song = playlist.setCurrent(index);
      if (song) playSong(song.filePath);
    }),
  );

  // Show status bar
  statusBar.showAll();

  // Auto-scan configured folder
  const musicFolder = config.get<string>('musicFolder', '');
  if (musicFolder) {
    await playlist.scanFolder(musicFolder);
  }

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('musicPlayer.musicFolder')) {
        const folder = vscode.workspace.getConfiguration('musicPlayer').get<string>('musicFolder', '');
        if (folder) void playlist.scanFolder(folder);
      }
    }),
  );

  // Disposables
  context.subscriptions.push(player, statusBar, treeView);
}

export function deactivate() {}
