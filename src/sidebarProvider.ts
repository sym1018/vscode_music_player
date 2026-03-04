import * as vscode from 'vscode';
import { SongItem } from './types';

export class SongTreeItem extends vscode.TreeItem {
  constructor(
    public readonly song: SongItem,
    public readonly index: number,
    public isCurrent: boolean,
  ) {
    super(song.name, vscode.TreeItemCollapsibleState.None);
    this.description = song.artist || '';
    this.tooltip = `${song.name}${song.artist ? ' - ' + song.artist : ''}${song.album ? ' [' + song.album + ']' : ''}`;
    this.iconPath = isCurrent
      ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('file-media');
    this.command = {
      command: 'musicPlayer.playSong',
      title: 'Play',
      arguments: [index],
    };
    this.contextValue = 'songItem';
  }
}

export class SidebarProvider implements vscode.TreeDataProvider<SongTreeItem> {
  private _songs: SongItem[] = [];
  private _currentIndex: number = -1;

  private _onDidChangeTreeData = new vscode.EventEmitter<SongTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  setSongs(songs: readonly SongItem[]): void {
    this._songs = [...songs];
    this._onDidChangeTreeData.fire();
  }

  setCurrentIndex(index: number): void {
    this._currentIndex = index;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SongTreeItem): SongTreeItem {
    return element;
  }

  getChildren(): SongTreeItem[] {
    return this._songs.map((song, index) =>
      new SongTreeItem(song, index, index === this._currentIndex)
    );
  }
}
