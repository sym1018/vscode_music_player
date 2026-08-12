import * as vscode from 'vscode';
import * as path from 'path';
import { MediaType, SongItem } from './types';

type TreeNode = FolderTreeItem | MediaTreeItem;

export class FolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string,
    description?: string,
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Expanded);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.tooltip = folderPath;
    this.contextValue = 'folderItem';
    this.accessibilityInformation = {
      label: `${folderName} folder${description ? `, ${description}` : ''}`,
      role: 'treeitem',
    };
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
        : new vscode.ThemeIcon('music');
    } else if (song.mediaType === 'image') {
      this.iconPath = new vscode.ThemeIcon('file-media');
    } else {
      this.iconPath = new vscode.ThemeIcon('device-camera-video');
    }

    this.contextValue = song.mediaType === 'audio' ? 'songItem' : 'mediaItem';
    this.accessibilityInformation = {
      label: `${isCurrent ? 'Current, ' : ''}${song.name}${song.artist ? ` by ${song.artist}` : ''}, ${song.mediaType}`,
      role: 'treeitem',
    };

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

export class SidebarProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private _songs: SongItem[] = [];
  private _currentIndex: number = -1;
  private _rootFolder: string = '';
  private _tree: FolderNode = { songs: [], subfolders: new Map() };
  private _searchQuery: string = '';
  private _mediaFilter: MediaType | 'all' = 'all';
  private _filteredCount: number = 0;

  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  setSongs(songs: readonly SongItem[], rootFolder?: string, currentIndex: number = -1): void {
    this._songs = [...songs];
    this._rootFolder = rootFolder || '';
    this._currentIndex = currentIndex;
    this._buildTree();
    this._onDidChangeTreeData.fire();
  }

  setCurrentIndex(index: number): void {
    this._currentIndex = index;
    this._onDidChangeTreeData.fire();
  }

  get searchQuery(): string { return this._searchQuery; }
  get mediaFilter(): MediaType | 'all' { return this._mediaFilter; }

  setSearchQuery(query: string): void {
    this._searchQuery = query.trim();
    this._buildTree();
    this._onDidChangeTreeData.fire();
  }

  setMediaFilter(filter: MediaType | 'all'): void {
    this._mediaFilter = filter;
    this._buildTree();
    this._onDidChangeTreeData.fire();
  }

  private _buildTree(): void {
    this._tree = { songs: [], subfolders: new Map() };
    this._filteredCount = 0;
    const query = this._searchQuery.toLocaleLowerCase();
    for (let i = 0; i < this._songs.length; i++) {
      const song = this._songs[i];
      if (this._mediaFilter !== 'all' && song.mediaType !== this._mediaFilter) continue;
      if (query) {
        const searchable = [song.name, song.artist, song.album, song.fileName]
          .join('\n')
          .toLocaleLowerCase();
        if (!searchable.includes(query)) continue;
      }
      const dir = path.dirname(song.filePath);
      const rel = this._rootFolder ? path.relative(this._rootFolder, dir) : '';

      // Skip files outside the selected root folder.
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;

      const parts = (rel && rel !== '.') ? rel.split(path.sep) : [];

      let node = this._tree;
      for (const part of parts) {
        if (!node.subfolders.has(part)) {
          node.subfolders.set(part, { songs: [], subfolders: new Map() });
        }
        node = node.subfolders.get(part)!;
      }
      node.songs.push({ song, index: i });
      this._filteredCount++;
    }
  }

  getTreeItem(element: TreeNode): TreeNode {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // Show selected folder as root node
      if (this._rootFolder) {
        const rootName = path.basename(this._rootFolder);
        const suffix = this._filteredCount === this._songs.length
          ? `${this._songs.length} items`
          : `${this._filteredCount} of ${this._songs.length}`;
        return [new FolderTreeItem(rootName, this._rootFolder, suffix)];
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

    // Subfolders first — collapse single-child intermediate folders (compact folders)
    const subfolders = [...node.subfolders.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    for (const [name, subNode] of subfolders) {
      let displayName = name;
      let currentNode = subNode;
      let currentPath = path.join(parentPath, name);

      // Collapse chain of single-subfolder-only nodes
      while (currentNode.songs.length === 0 && currentNode.subfolders.size === 1) {
        const [childName, childNode] = currentNode.subfolders.entries().next().value!;
        displayName += '/' + childName;
        currentPath = path.join(currentPath, childName);
        currentNode = childNode;
      }

      const folderItem = new FolderTreeItem(displayName, currentPath);
      items.push(folderItem);
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

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
