import * as vscode from 'vscode';
import { MusicPlayer, getDuration } from './player';
import { PlaylistManager } from './playlist';
import { LrcParser } from './lrcParser';
import { StatusBarController } from './statusBar';
import { SidebarProvider } from './sidebarProvider';
import { DetailViewProvider } from './detailViewProvider';
import { checkFfmpegDependencies, DependencyStatus, MediaMetadataService } from './mediaMetadata';
import { BUNDLED_FFMPEG_VERSION, getFfmpegRuntimeDirectory } from './ffmpegTools';
import { MediaType, PlaybackSnapshot, PlayMode, StatusBarMode } from './types';

const PLAYBACK_STATE_KEY = 'musicPlayer.playbackState';
const ONBOARDING_KEY = 'musicPlayer.onboardingShown';

let savePlaybackState: (() => Thenable<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Music Player');
  const initialConfig = vscode.workspace.getConfiguration('musicPlayer');
  const player = new MusicPlayer();
  const playlist = new PlaylistManager();
  let lrcParser = new LrcParser();
  const statusBar = new StatusBarController(initialConfig.get<StatusBarMode>('statusBarMode', 'compact'));
  const sidebarProvider = new SidebarProvider();
  const detailView = new DetailViewProvider(context.globalStorageUri.fsPath);
  const metadataService = new MediaMetadataService(
    context.globalStorageUri.fsPath,
    message => output.appendLine(`[metadata] ${message}`),
  );
  let dependencyStatus: DependencyStatus = { ffmpeg: false, ffplay: false, ffprobe: false };
  let loadToken = 0;
  let detailToken = 0;
  let scanFromSelectFolder = false;
  let volumePersistTimer: ReturnType<typeof setTimeout> | undefined;

  const treeView = vscode.window.createTreeView('musicPlayer-songList', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: false,
  });

  let volume = initialConfig.get<number>('volume', 50);
  let playMode = initialConfig.get<PlayMode>('playMode', 'sequence');
  playlist.setPlayMode(playMode);
  statusBar.updateMode(playMode);
  statusBar.updateVolume(volume);
  player.setVolume(volume);
  detailView.updateVolume(volume);

  const updateTreeDescription = (): void => {
    const parts: string[] = [];
    if (sidebarProvider.mediaFilter !== 'all') parts.push(sidebarProvider.mediaFilter);
    if (sidebarProvider.searchQuery) parts.push(`"${sidebarProvider.searchQuery}"`);
    treeView.description = parts.join(' / ');
  };

  const openSetup = async (): Promise<void> => {
    const readme = vscode.Uri.joinPath(context.extensionUri, 'README.md');
    await vscode.commands.executeCommand('markdown.showPreview', readme);
  };

  const showMissingDependencyMessage = async (): Promise<void> => {
    const missing = Object.entries(dependencyStatus)
      .filter(([, available]) => !available)
      .map(([name]) => name)
      .join(', ');
    const action = await vscode.window.showWarningMessage(
      `Music Player's bundled FFmpeg runtime is incomplete. Missing: ${missing}.`,
      'Open Setup',
      'Check Again',
    );
    if (action === 'Open Setup') await openSetup();
    if (action === 'Check Again') await verifyDependencies(true);
  };

  const verifyDependencies = async (showResult: boolean): Promise<DependencyStatus> => {
    dependencyStatus = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Music Player: checking FFmpeg tools',
    }, () => checkFfmpegDependencies());
    const missing = Object.entries(dependencyStatus)
      .filter(([, available]) => !available)
      .map(([name]) => name);
    await vscode.commands.executeCommand('setContext', 'musicPlayer.dependenciesReady', missing.length === 0);
    output.appendLine(
      `[dependencies] bundled=${BUNDLED_FFMPEG_VERSION} path=${getFfmpegRuntimeDirectory()} status=${JSON.stringify(dependencyStatus)}`,
    );
    if (showResult) {
      if (missing.length === 0) {
        void vscode.window.showInformationMessage(
          `Music Player: bundled FFmpeg runtime ${BUNDLED_FFMPEG_VERSION} is available.`,
        );
      } else {
        await showMissingDependencyMessage();
      }
    }
    return dependencyStatus;
  };

  const enrichMetadata = async (
    token: vscode.CancellationToken,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> => {
    if (!dependencyStatus.ffprobe) return;
    const songs = playlist.songs.filter(song => song.mediaType === 'audio');
    if (songs.length === 0) return;
    const updates = new Map<string, { name?: string; artist?: string; album?: string; duration?: number }>();
    let cursor = 0;
    let completed = 0;
    const worker = async (): Promise<void> => {
      while (!token.isCancellationRequested) {
        const index = cursor++;
        if (index >= songs.length) return;
        const song = songs[index];
        const metadata = await metadataService.getMetadata(song.filePath);
        updates.set(song.filePath, {
          name: metadata.title || song.name,
          artist: metadata.artist || song.artist,
          album: metadata.album || song.album,
          duration: metadata.duration || song.duration,
        });
        completed++;
        progress.report({ message: `Reading media tags ${completed}/${songs.length}` });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, songs.length) }, () => worker()));
    playlist.applyMetadata(updates);
  };

  const scanMusicFolder = async (folderPath: string, notify: boolean): Promise<boolean> => {
    metadataService.clear();
    const completed = await vscode.window.withProgress({
      location: notify ? vscode.ProgressLocation.Notification : vscode.ProgressLocation.Window,
      title: 'Music Player: scanning media',
      cancellable: true,
    }, async (progress, token) => {
      const scanned = await playlist.scanFolder(folderPath, {
        token,
        onProgress: (count, directory) => {
          progress.report({ message: `${count} files - ${directory}` });
        },
      });
      if (!scanned) return false;
      await enrichMetadata(token, progress);
      return true;
    });
    if (!completed) {
      output.appendLine(`[scan] Cancelled: ${folderPath}`);
      return false;
    }
    output.appendLine(`[scan] ${playlist.songs.length} media files in ${folderPath}`);
    for (const warning of playlist.scanWarnings) output.appendLine(`[scan warning] ${warning}`);
    if (playlist.scanWarnings.length > 0) {
      output.show(true);
      void vscode.window.showWarningMessage(
        `Music Player skipped ${playlist.scanWarnings.length} unreadable folder(s). See the output channel for details.`,
      );
    }
    return true;
  };

  const applyVolume = (value: number, persist: boolean): void => {
    volume = Math.round(Math.max(0, Math.min(100, value)));
    player.setVolume(volume);
    statusBar.updateVolume(volume);
    detailView.updateVolume(volume);
    if (persist) {
      if (volumePersistTimer) clearTimeout(volumePersistTimer);
      volumePersistTimer = setTimeout(() => {
        void vscode.workspace.getConfiguration('musicPlayer')
          .update('volume', volume, vscode.ConfigurationTarget.Global);
      }, 250);
    }
  };

  savePlaybackState = (): Thenable<void> => {
    const song = playlist.currentSong;
    if (!song || song.mediaType !== 'audio') {
      return context.globalState.update(PLAYBACK_STATE_KEY, undefined);
    }
    const snapshot: PlaybackSnapshot = {
      filePath: song.filePath,
      position: player.currentPosition,
      updatedAt: Date.now(),
    };
    return context.globalState.update(PLAYBACK_STATE_KEY, snapshot);
  };

  const loadSongData = async (filePath: string): Promise<{
    hasLyrics: boolean;
    parser: LrcParser;
    coverPath: string;
    duration: number;
  }> => {
    const parser = new LrcParser();
    const [hasLyrics, metadata, coverPath] = await Promise.all([
      parser.loadForSong(filePath),
      metadataService.getMetadata(filePath),
      metadataService.getCoverPath(filePath),
    ]);
    const duration = metadata.duration || await getDuration(filePath);
    return { hasLyrics, parser, coverPath, duration };
  };

  const showSongDetail = async (filePath: string): Promise<void> => {
    const requested = playlist.songs.find(song => song.filePath === filePath);
    if (!requested || requested.mediaType !== 'audio') return;
    const token = ++detailToken;
    const data = await loadSongData(filePath);
    if (token !== detailToken || !playlist.songs.some(song => song.filePath === filePath)) return;
    const metadata = await metadataService.getMetadata(filePath);
    playlist.applyMetadata(new Map([[filePath, {
      name: metadata.title || requested.name,
      artist: metadata.artist || requested.artist,
      album: metadata.album || requested.album,
      duration: data.duration,
    }]]));
    const song = playlist.songs.find(item => item.filePath === filePath) || requested;
    detailView.show(
      song.name, song.artist, song.album, [...data.parser.lines], data.hasLyrics,
      song.filePath, data.coverPath, data.duration,
    );
  };

  const playSong = async (
    filePath: string,
    autoPlay: boolean = true,
    startPosition: number = 0,
    showDetail: boolean = false,
  ): Promise<void> => {
    const requested = playlist.songs.find(song => song.filePath === filePath);
    if (!requested || requested.mediaType !== 'audio') return;
    const token = ++loadToken;
    const viewToken = ++detailToken;
    const oldFilePath = detailView.playingFilePath || playlist.currentSong?.filePath;

    player.stop();
    statusBar.clearProgress();
    const selected = playlist.setCurrentByPath(filePath);
    if (!selected) return;
    statusBar.updateSong(selected.name, selected.artist);
    statusBar.updateLyric('');

    const data = await loadSongData(filePath);
    if (token !== loadToken || playlist.currentSong?.filePath !== filePath) return;
    const metadata = await metadataService.getMetadata(filePath);
    playlist.applyMetadata(new Map([[filePath, {
      name: metadata.title || selected.name,
      artist: metadata.artist || selected.artist,
      album: metadata.album || selected.album,
      duration: data.duration,
    }]]));
    const song = playlist.currentSong || selected;
    const position = data.duration > 0
      ? Math.min(Math.max(0, startPosition), Math.max(0, data.duration - 1))
      : Math.max(0, startPosition);

    lrcParser = data.parser;
    statusBar.updateSong(song.name, song.artist);
    statusBar.setDuration(data.duration);
    statusBar.updateProgress(position);
    detailView.setPlayingFile(song.filePath);
    detailView.updateProgress(position, data.duration);
    const followCurrentTrack = vscode.workspace.getConfiguration('musicPlayer')
      .get<boolean>('followCurrentTrack', true);
    if (viewToken === detailToken) {
      if (showDetail) {
        detailView.show(
          song.name, song.artist, song.album, [...data.parser.lines], data.hasLyrics,
          song.filePath, data.coverPath, data.duration,
        );
      } else {
        detailView.updateIfOpen(
          song.name, song.artist, song.album, [...data.parser.lines], data.hasLyrics,
          song.filePath, oldFilePath, data.coverPath, followCurrentTrack, data.duration,
        );
      }
    }

    const canPlay = autoPlay && dependencyStatus.ffplay;
    await player.load(song.filePath, canPlay, position);
    if (autoPlay && !dependencyStatus.ffplay) await showMissingDependencyMessage();
    await savePlaybackState?.();
  };

  player.onDidChangeState(state => {
    statusBar.updatePlaying(state === 'playing');
    detailView.updatePlayState(state === 'playing');
  });

  player.onDidEnd(() => {
    const nextSong = playlist.next();
    if (nextSong) {
      void playSong(nextSong.filePath);
    } else {
      statusBar.updateProgress(0);
      statusBar.updateLyric('');
      detailView.updateProgress(0);
      detailView.updateHighlight(-1);
      void savePlaybackState?.();
    }
  });

  player.onDidPosition(position => {
    statusBar.updateProgress(position);
    detailView.updateProgress(position, statusBar.getDuration());
    const lyric = lrcParser.getLyricAt(position);
    statusBar.updateLyric(lyric ?? '');
    detailView.updateHighlight(lrcParser.currentIndex);
  });

  detailView.onDidRequestSeek(time => {
    const duration = statusBar.getDuration();
    player.seek(duration > 0 ? Math.min(time, duration) : time);
  });
  detailView.onDidRequestPlay(filePath => {
    if (playlist.currentSong?.filePath === filePath && player.currentFilePath === filePath) {
      player.toggle();
    } else {
      void playSong(filePath, true, 0, true);
    }
  });
  detailView.onDidRequestCommand(command => {
    void vscode.commands.executeCommand(`musicPlayer.${command}`);
  });
  detailView.onDidRequestVolume(value => applyVolume(value, true));
  detailView.onDidRequestSpeed(value => {
    player.setSpeed(value);
    statusBar.updateSpeed(value);
    detailView.updateSpeed(value);
  });

  playlist.onDidChangePlaylist(() => {
    sidebarProvider.setSongs(playlist.songs, playlist.rootFolder, playlist.currentIndex);
    void vscode.commands.executeCommand('setContext', 'musicPlayer.hasMedia', playlist.songs.length > 0);
    if (!playlist.currentSong) {
      loadToken++;
      player.stop();
      lrcParser.clear();
      statusBar.clearSong();
      detailView.updateHighlight(-1);
      detailView.setPlayingFile('');
    }
  });
  playlist.onDidChangeCurrent(() => sidebarProvider.setCurrentIndex(playlist.currentIndex));

  let pendingClick: { filePath: string; mediaType: string; time: number; timer: ReturnType<typeof setTimeout> } | undefined;
  const performSingleClick = (filePath: string, mediaType: string): void => {
    if (mediaType === 'audio') void showSongDetail(filePath);
    else void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('musicPlayer._itemClick', (filePath: string, mediaType: string) => {
      const now = Date.now();
      if (pendingClick && pendingClick.filePath === filePath && now - pendingClick.time < 350) {
        clearTimeout(pendingClick.timer);
        pendingClick = undefined;
        if (mediaType === 'audio') void playSong(filePath, true, 0, true);
        else void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        return;
      }
      if (pendingClick) {
        clearTimeout(pendingClick.timer);
        performSingleClick(pendingClick.filePath, pendingClick.mediaType);
      }
      const timer = setTimeout(() => {
        performSingleClick(filePath, mediaType);
        pendingClick = undefined;
      }, 300);
      pendingClick = { filePath, mediaType, time: now, timer };
    }),

    vscode.commands.registerCommand('musicPlayer.play', () => {
      if (!playlist.currentSong || playlist.currentSong.mediaType !== 'audio') {
        const song = playlist.firstAudio();
        if (song) void playSong(song.filePath, true);
      } else if (player.currentFilePath === playlist.currentSong.filePath) {
        if (!dependencyStatus.ffplay) void showMissingDependencyMessage();
        else player.toggle();
      } else {
        void playSong(playlist.currentSong.filePath, true);
      }
    }),

    vscode.commands.registerCommand('musicPlayer.stop', () => {
      player.stop();
      statusBar.updateProgress(0);
      statusBar.updateLyric('');
      detailView.updateProgress(0, statusBar.getDuration());
      detailView.updateHighlight(-1);
      void savePlaybackState?.();
    }),

    vscode.commands.registerCommand('musicPlayer.next', () => {
      const song = playlist.next();
      if (song) void playSong(song.filePath);
    }),

    vscode.commands.registerCommand('musicPlayer.previous', () => {
      const song = playlist.previous();
      if (song) void playSong(song.filePath);
    }),

    vscode.commands.registerCommand('musicPlayer.volumeUp', () => applyVolume(volume + 10, true)),
    vscode.commands.registerCommand('musicPlayer.volumeDown', () => applyVolume(volume - 10, true)),
    vscode.commands.registerCommand('musicPlayer.toggleLyric', () => statusBar.toggleLyric()),

    vscode.commands.registerCommand('musicPlayer.switchMode', () => {
      const modes: PlayMode[] = ['sequence', 'loop', 'single', 'random'];
      playMode = modes[(modes.indexOf(playMode) + 1) % modes.length];
      playlist.setPlayMode(playMode);
      statusBar.updateMode(playMode);
      void vscode.workspace.getConfiguration('musicPlayer')
        .update('playMode', playMode, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('musicPlayer.selectFolder', async () => {
      const config = vscode.workspace.getConfiguration('musicPlayer');
      const lastFolder = config.get<string>('musicFolder', '');
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Music Folder',
        defaultUri: lastFolder ? vscode.Uri.file(lastFolder) : undefined,
      });
      if (!uris?.[0]) return;
      const folderPath = uris[0].fsPath;
      const completed = await scanMusicFolder(folderPath, true);
      if (!completed) return;
      scanFromSelectFolder = true;
      try {
        await config.update('musicFolder', folderPath, vscode.ConfigurationTarget.Global);
      } finally {
        scanFromSelectFolder = false;
      }
      const message = playlist.songs.length > 0
        ? `Found ${playlist.songs.length} media files.`
        : 'No supported media files found.';
      if (playlist.songs.length > 0) void vscode.window.showInformationMessage(message);
      else void vscode.window.showWarningMessage(message);
    }),

    vscode.commands.registerCommand('musicPlayer.refresh', async () => {
      if (playlist.rootFolder) await scanMusicFolder(playlist.rootFolder, true);
      else await vscode.commands.executeCommand('musicPlayer.selectFolder');
    }),

    vscode.commands.registerCommand('musicPlayer.search', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Search Media',
        prompt: 'Match title, artist, album, or file name. Leave empty to clear.',
        value: sidebarProvider.searchQuery,
      });
      if (query === undefined) return;
      sidebarProvider.setSearchQuery(query);
      updateTreeDescription();
    }),

    vscode.commands.registerCommand('musicPlayer.filter', async () => {
      const choices: Array<vscode.QuickPickItem & { value: MediaType | 'all' }> = [
        { label: 'All media', description: 'Audio, images, and video', value: 'all' },
        { label: 'Audio', description: 'Playable music files', value: 'audio' },
        { label: 'Images', description: 'Image files', value: 'image' },
        { label: 'Videos', description: 'Video files', value: 'video' },
      ];
      const selected = await vscode.window.showQuickPick(choices, {
        title: 'Filter Media',
        placeHolder: `Current: ${sidebarProvider.mediaFilter}`,
      });
      if (!selected) return;
      sidebarProvider.setMediaFilter(selected.value);
      updateTreeDescription();
    }),

    vscode.commands.registerCommand('musicPlayer.checkDependencies', () => verifyDependencies(true)),
    vscode.commands.registerCommand('musicPlayer.openSetup', openSetup),

    vscode.commands.registerCommand('musicPlayer.seek', async () => {
      if (!player.currentFilePath) return;
      const position = player.currentPosition;
      const input = await vscode.window.showInputBox({
        prompt: 'Seek to (mm:ss)',
        value: `${Math.floor(position / 60).toString().padStart(2, '0')}:${Math.floor(position % 60).toString().padStart(2, '0')}`,
        validateInput: value => /^\d{1,3}:[0-5]\d$/.test(value) ? null : 'Format: mm:ss (seconds 00-59)',
      });
      if (!input) return;
      const [minutes, seconds] = input.split(':').map(Number);
      const duration = statusBar.getDuration();
      player.seek(duration > 0 ? Math.min(minutes * 60 + seconds, duration) : minutes * 60 + seconds);
    }),

    vscode.commands.registerCommand('musicPlayer.playSong', (value: number | string) => {
      const song = typeof value === 'number'
        ? playlist.songs[value]
        : playlist.songs.find(item => item.filePath === value);
      if (song?.mediaType === 'audio') void playSong(song.filePath, true, 0, true);
    }),

    vscode.commands.registerCommand('musicPlayer.openMedia', (filePath: string) => {
      void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    }),

    vscode.commands.registerCommand('musicPlayer.seekForward', () => {
      if (!player.currentFilePath) return;
      const step = vscode.workspace.getConfiguration('musicPlayer').get<number>('seekStep', 10);
      const duration = statusBar.getDuration();
      const target = player.currentPosition + step;
      player.seek(duration > 0 ? Math.min(target, duration) : target);
    }),

    vscode.commands.registerCommand('musicPlayer.seekBackward', () => {
      if (!player.currentFilePath) return;
      const step = vscode.workspace.getConfiguration('musicPlayer').get<number>('seekStep', 10);
      player.seek(Math.max(0, player.currentPosition - step));
    }),

    vscode.commands.registerCommand('musicPlayer.toggleFastForward', () => {
      if (!player.currentFilePath) return;
      const speed = player.speed > 1
        ? 1
        : vscode.workspace.getConfiguration('musicPlayer').get<number>('fastSpeed', 2);
      player.setSpeed(speed);
      statusBar.updateSpeed(speed);
      detailView.updateSpeed(speed);
    }),

    vscode.commands.registerCommand('musicPlayer.rewindStep', () => {
      if (player.currentFilePath) player.seek(Math.max(0, player.currentPosition - 1));
    }),

    vscode.commands.registerCommand('musicPlayer.speedUp', () => {
      if (!player.currentFilePath) return;
      const speed = vscode.workspace.getConfiguration('musicPlayer').get<number>('fastSpeed', 2);
      player.setSpeed(speed);
      statusBar.updateSpeed(speed);
      detailView.updateSpeed(speed);
    }),

    vscode.commands.registerCommand('musicPlayer.speedNormal', () => {
      player.setSpeed(1);
      statusBar.updateSpeed(1);
      detailView.updateSpeed(1);
    }),
  );

  statusBar.showAll();
  await vscode.commands.executeCommand('setContext', 'musicPlayer.hasMedia', false);
  await verifyDependencies(false);

  const musicFolder = initialConfig.get<string>('musicFolder', '');
  if (musicFolder) await scanMusicFolder(musicFolder, false);

  if (initialConfig.get<boolean>('restorePlayback', true) && playlist.songs.length > 0) {
    const snapshot = context.globalState.get<PlaybackSnapshot>(PLAYBACK_STATE_KEY);
    if (snapshot && playlist.songs.some(song => song.filePath === snapshot.filePath && song.mediaType === 'audio')) {
      await playSong(snapshot.filePath, false, snapshot.position);
    }
  }

  if (!context.globalState.get<boolean>(ONBOARDING_KEY)) {
    await context.globalState.update(ONBOARDING_KEY, true);
    if (!dependencyStatus.ffplay || !dependencyStatus.ffprobe) {
      void showMissingDependencyMessage();
    } else if (!musicFolder) {
      void vscode.window.showInformationMessage(
        'Music Player is ready. Select a media folder to begin.',
        'Select Folder',
        'Open Setup',
      ).then(async action => {
        if (action === 'Select Folder') await vscode.commands.executeCommand('musicPlayer.selectFolder');
        if (action === 'Open Setup') await openSetup();
      });
    }
  }

  const persistenceTimer = setInterval(() => { void savePlaybackState?.(); }, 5000);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      const config = vscode.workspace.getConfiguration('musicPlayer');
      if (event.affectsConfiguration('musicPlayer.musicFolder') && !scanFromSelectFolder) {
        void scanMusicFolder(config.get<string>('musicFolder', ''), false);
      }
      if (event.affectsConfiguration('musicPlayer.volume')) {
        applyVolume(config.get<number>('volume', 50), false);
      }
      if (event.affectsConfiguration('musicPlayer.playMode')) {
        playMode = config.get<PlayMode>('playMode', 'sequence');
        playlist.setPlayMode(playMode);
        statusBar.updateMode(playMode);
      }
      if (event.affectsConfiguration('musicPlayer.statusBarMode')) {
        statusBar.setLayout(config.get<StatusBarMode>('statusBarMode', 'compact'));
      }
    }),
    { dispose: () => clearInterval(persistenceTimer) },
    { dispose: () => { if (volumePersistTimer) clearTimeout(volumePersistTimer); } },
    { dispose: () => { if (pendingClick) clearTimeout(pendingClick.timer); } },
    player,
    playlist,
    statusBar,
    sidebarProvider,
    detailView,
    treeView,
    output,
  );
}

export function deactivate(): Thenable<void> | undefined {
  return savePlaybackState?.();
}
