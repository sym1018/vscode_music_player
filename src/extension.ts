import * as vscode from 'vscode';
import { MusicPlayer, getDuration } from './player';
import { PlaylistManager } from './playlist';
import { LrcParser } from './lrcParser';
import { StatusBarController } from './statusBar';
import { SidebarProvider, MediaTreeItem } from './sidebarProvider';
import { DetailViewProvider } from './detailViewProvider';
import { PlayMode } from './types';

let player: MusicPlayer;
let playlist: PlaylistManager;
let lrcParser: LrcParser;
let statusBar: StatusBarController;
let sidebarProvider: SidebarProvider;
let detailView: DetailViewProvider;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('musicPlayer');

  // Initialize modules
  player = new MusicPlayer();
  playlist = new PlaylistManager();
  lrcParser = new LrcParser();
  statusBar = new StatusBarController();
  sidebarProvider = new SidebarProvider();
  detailView = new DetailViewProvider();

  // Register TreeView
  const treeView = vscode.window.createTreeView('musicPlayer-songList', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: false,
  });

  // Double-click detection via TreeItem.command (fires on every click, even re-selection)
  let lastClickedPath = '';
  let lastClickTime = 0;
  context.subscriptions.push(
    vscode.commands.registerCommand('musicPlayer._itemClick', (filePath: string, mediaType: string) => {
      const now = Date.now();
      const isDoubleClick = filePath === lastClickedPath && (now - lastClickTime) < 400;
      lastClickedPath = filePath;
      lastClickTime = now;
      if (!isDoubleClick) return;

      if (mediaType === 'audio') {
        showSongDetail(filePath);
      } else {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
      }
    }),
  );

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
    detailView.updatePlayState(state === 'playing');
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

  // Event: player position - update progress and lyrics
  player.onDidPosition((position) => {
    statusBar.updateProgress(position);
    const lyric = lrcParser.getLyricAt(position);
    if (lyric !== undefined) {
      statusBar.updateLyric(lyric);
    }
    detailView.updateHighlight(lrcParser.currentIndex);
  });

  // Event: detail view seek request
  detailView.onDidRequestSeek((time) => {
    player.seek(time);
  });

  // Event: detail view play button - play displayed song or toggle
  detailView.onDidRequestPlay((filePath) => {
    const currentSong = playlist.currentSong;
    if (currentSong && currentSong.filePath === filePath && (player.playing || player.currentPosition > 0)) {
      player.toggle();
    } else {
      playSong(filePath, true);
    }
  });

  // Event: detail view control buttons
  detailView.onDidRequestCommand((cmd) => {
    vscode.commands.executeCommand(`musicPlayer.${cmd}`);
  });

  // Event: playlist changed - update sidebar
  playlist.onDidChangePlaylist(() => {
    const folder = vscode.workspace.getConfiguration('musicPlayer').get<string>('musicFolder', '');
    sidebarProvider.setSongs(playlist.songs, folder);
  });

  // Guard: cancel stale playSong calls on rapid clicks
  let loadToken = 0;

  // Helper: show detail tab only (no playback change)
  async function showSongDetail(filePath: string) {
    const song = playlist.songs.find(s => s.filePath === filePath);
    if (!song) return;
    const tempParser = new LrcParser();
    const hasLyric = await tempParser.loadForSong(song.filePath);
    detailView.show(song.name, song.artist, song.album, [...tempParser.lines], hasLyric, song.filePath);
  }

  // Helper: load a song (autoPlay=false: load only, autoPlay=true: load and play)
  async function playSong(filePath: string, autoPlay: boolean = true) {
    const token = ++loadToken;

    // Stop current playback IMMEDIATELY (before any async work)
    player.stop();
    statusBar.clearProgress();

    const song = playlist.setCurrentByPath(filePath) || playlist.songs.find(s => s.filePath === filePath);
    if (!song) return;

    statusBar.updateSong(song.name, song.artist);
    sidebarProvider.setCurrentIndex(playlist.currentIndex);

    // Load lyrics and duration in parallel
    const [hasLyric, duration] = await Promise.all([
      lrcParser.loadForSong(song.filePath),
      getDuration(song.filePath),
    ]);

    // If another playSong was called while loading, abort this one
    if (token !== loadToken) return;

    if (!hasLyric) {
      statusBar.updateLyric('');
    }

    statusBar.setDuration(duration);

    // Show detail tab for the new song (create or switch)
    detailView.setPlayingFile(song.filePath);
    detailView.show(
      song.name, song.artist, song.album,
      [...lrcParser.lines], hasLyric, song.filePath,
    );

    // Load audio
    await player.load(song.filePath, autoPlay);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('musicPlayer.play', () => {
      if (!playlist.currentSong && playlist.songs.length > 0) {
        const song = playlist.setCurrent(0);
        if (song) playSong(song.filePath, true);
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
        await playlist.scanFolder(folderPath);
        scanFromSelectFolder = true;
        await config.update('musicFolder', folderPath, vscode.ConfigurationTarget.Global);
        scanFromSelectFolder = false;
        if (playlist.songs.length > 0) {
          vscode.window.showInformationMessage(`Found ${playlist.songs.length} media files`);
        } else {
          vscode.window.showWarningMessage('No supported media files found');
        }
      }
    }),

    vscode.commands.registerCommand('musicPlayer.seek', async () => {
      if (!player.playing && player.currentPosition <= 0) return;
      const pos = player.currentPosition;
      const mm = Math.floor(pos / 60).toString().padStart(2, '0');
      const ss = Math.floor(pos % 60).toString().padStart(2, '0');
      const input = await vscode.window.showInputBox({
        prompt: 'Seek to (mm:ss)',
        value: `${mm}:${ss}`,
        validateInput: (val) => /^\d{1,2}:\d{2}$/.test(val) ? null : 'Format: mm:ss',
      });
      if (!input) return;
      const [m, s] = input.split(':').map(Number);
      player.seek(m * 60 + s);
    }),

    vscode.commands.registerCommand('musicPlayer.playSong', (index: number) => {
      const song = playlist.songs[index];
      if (song) showSongDetail(song.filePath);
    }),

    vscode.commands.registerCommand('musicPlayer.openMedia', (filePath: string) => {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    }),
  );

  let scanFromSelectFolder = false;

  // Show status bar
  statusBar.showAll();

  // Auto-scan configured folder
  const musicFolder = config.get<string>('musicFolder', '');
  if (musicFolder) {
    await playlist.scanFolder(musicFolder);
  }

  // Listen for config changes (skip if selectFolder already handled the scan)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('musicPlayer.musicFolder') && !scanFromSelectFolder) {
        const folder = vscode.workspace.getConfiguration('musicPlayer').get<string>('musicFolder', '');
        if (folder) void playlist.scanFolder(folder);
      }
    }),
  );

  // Disposables
  context.subscriptions.push(player, statusBar, detailView, treeView);
}

export function deactivate() {}
