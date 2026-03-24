import * as vscode from 'vscode';
import * as path from 'path';
import { SongItem } from './types';

type TreeNode = FolderTreeItem | MediaTreeItem;

export class FolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string,
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.tooltip = folderPath;
    this.contextValue = 'folderItem';
  }
}

export class MediaTreeItem extends vscode.TreeItem {
  constructor(
    public readonly song: SongItem,
    public readonly index: number,
    public isCurrent: boolean,
  ) {
    super(song.name, vscode.TreeItemCollapsibleState.None);
    this.description = song.artist || '';
    this.tooltip = `${song.name}${song.artist ? ' - ' + song.artist : ''}${song.album ? ' [' + song.album + ']' : ''}`;

    if (song.mediaType === 'audio') {
      this.iconPath = isCurrent
        ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('file-media');
    } else if (song.mediaType === 'image') {
      this.iconPath = new vscode.ThemeIcon('file-media');
    } else {
      this.iconPath = new vscode.ThemeIcon('device-camera-video');
    }

    this.contextValue = song.mediaType === 'audio' ? 'songItem' : 'mediaItem';

    // Fire command on every click (unlike onDidChangeSelection which skips re-selection)
    this.command = {
      command: 'musicPlayer._itemClick',
      title: 'Click',
      arguments: [song.filePath, song.mediaType],
    };
  }
}

interface FolderNode {
  songs: { song: SongItem; index: number }[];
  subfolders: Map<string, FolderNode>;
}

export class SidebarProvider implements vscode.TreeDataProvider<TreeNode> {
  private _songs: SongItem[] = [];
  private _currentIndex: number = -1;
  private _rootFolder: string = '';
  private _tree: FolderNode = { songs: [], subfolders: new Map() };

  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  setSongs(songs: readonly SongItem[], rootFolder?: string): void {
    this._songs = [...songs];
    this._rootFolder = rootFolder || '';
    this._buildTree();
    this._onDidChangeTreeData.fire();
  }

  setCurrentIndex(index: number): void {
    this._currentIndex = index;
    this._onDidChangeTreeData.fire();
  }

  private _buildTree(): void {
    this._tree = { songs: [], subfolders: new Map() };
    for (let i = 0; i < this._songs.length; i++) {
      const song = this._songs[i];
      const dir = path.dirname(song.filePath);
      const rel = this._rootFolder ? path.relative(this._rootFolder, dir) : '';
      const parts = rel ? rel.split(path.sep) : [];

      let node = this._tree;
      for (const part of parts) {
        if (!node.subfolders.has(part)) {
          node.subfolders.set(part, { songs: [], subfolders: new Map() });
        }
        node = node.subfolders.get(part)!;
      }
      node.songs.push({ song, index: i });
    }
  }

  getTreeItem(element: TreeNode): TreeNode {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // Show music folder name as root if it has subfolders or content
      if (this._rootFolder && (this._tree.subfolders.size > 0 || this._tree.songs.length > 0)) {
        const rootName = path.basename(this._rootFolder);
        const rootItem = new FolderTreeItem(rootName, this._rootFolder);
        return [rootItem];
      }
      return [];
    }
    if (element instanceof FolderTreeItem) {
      const node = this._findNode(element.folderPath);
      if (node) return this._getNodeChildren(node, element.folderPath);
    }
    return [];
  }

  private _getNodeChildren(node: FolderNode, parentPath: string): TreeNode[] {
    const items: TreeNode[] = [];

    // Subfolders first
    for (const [name, _subNode] of node.subfolders) {
      const folderPath = path.join(parentPath, name);
      items.push(new FolderTreeItem(name, folderPath));
    }

    // Then media items
    for (const { song, index } of node.songs) {
      items.push(new MediaTreeItem(song, index, index === this._currentIndex));
    }

    return items;
  }

  private _findNode(folderPath: string): FolderNode | undefined {
    const rel = this._rootFolder ? path.relative(this._rootFolder, folderPath) : folderPath;
    if (rel === '' || rel === '.') return this._tree;
    const parts = rel.split(path.sep);
    let node = this._tree;
    for (const part of parts) {
      const sub = node.subfolders.get(part);
      if (!sub) return undefined;
      node = sub;
    }
    return node;
  }
}
