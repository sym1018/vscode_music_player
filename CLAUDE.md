# VSCode Music Player - 开发计划

## 项目概述

VSCode 扩展插件，实现本地音乐播放器功能，支持歌词显示和状态栏控制。

## 功能需求

### 1. 本地音乐播放
- 支持格式：MP3、FLAC、WAV、OGG
- 可自定义音乐文件夹（配置项）
- 递归扫描子目录
- 播放模式：顺序播放、列表循环、单曲循环、随机播放

### 2. LRC 歌词显示
- 自动查找与歌曲同目录、同名的 .lrc 文件
- 按时间戳同步显示歌词
- 歌词内容显示在状态栏

### 3. 状态栏控件（左侧）
```
[⏮上一首] [⏯播放/暂停] [⏭下一首] [🔉音量-] [🔊音量+] [词 歌词开关] | ♪ 歌曲名 | 歌词内容...
```

### 4. 侧边栏视图
- TreeView 展示歌曲列表
- 支持点击切换歌曲
- 显示当前播放状态

## 技术架构

### 技术栈
- 语言：TypeScript
- 框架：VSCode Extension API
- 音频引擎：ffplay（ffmpeg 子进程），通过 `child_process.spawn` 控制
- UI：StatusBar Items + TreeView
- 打包：esbuild (CJS, vscode external) + @vscode/vsce

### 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| MusicPlayer | `src/player.ts` | 通过 ffplay 子进程播放音频，SIGSTOP/SIGCONT 暂停恢复 |
| PlaylistManager | `src/playlist.ts` | 扫描文件夹、构建播放列表、管理播放模式和顺序 |
| LrcParser | `src/lrcParser.ts` | 解析 .lrc 文件，提供按时间戳查询歌词的接口 |
| StatusBarController | `src/statusBar.ts` | 创建和管理状态栏按钮、歌词显示、状态更新 |
| SidebarProvider | `src/sidebarProvider.ts` | TreeDataProvider 实现，提供歌曲列表视图 |
| Extension Entry | `src/extension.ts` | 扩展入口，注册命令、初始化各模块 |

### 数据流
```
用户操作(状态栏/侧边栏/命令)
    ↓
Extension Commands
    ↓
MusicPlayer ←→ ffplay (child_process)
    ↓
PlaylistManager (管理列表和顺序)
    ↓
LrcParser (同步歌词)
    ↓
StatusBarController (更新显示)
SidebarProvider (更新列表状态)
```

### VSCode 配置项
```json
{
  "musicPlayer.musicFolder": "",       // 音乐文件夹路径
  "musicPlayer.volume": 50,            // 默认音量 (0-100)
  "musicPlayer.playMode": "sequence"   // 播放模式: sequence | loop | single | random
}
```

### 注册命令
- `musicPlayer.play` - 播放/暂停
- `musicPlayer.next` - 下一首
- `musicPlayer.previous` - 上一首
- `musicPlayer.volumeUp` - 音量增加
- `musicPlayer.volumeDown` - 音量减少
- `musicPlayer.toggleLyric` - 歌词开关
- `musicPlayer.switchMode` - 切换播放模式
- `musicPlayer.selectFolder` - 选择音乐文件夹
- `musicPlayer.playSong` - 播放指定歌曲（侧边栏点击）

## 实施步骤

### Step 1: 项目初始化
- 使用 `yo code` 生成 VSCode 扩展脚手架
- 配置 TypeScript、ESLint
- 配置 package.json（commands、配置项、viewsContainers）

### Step 2: PlaylistManager 播放列表管理
- 实现文件夹递归扫描（过滤 mp3/flac/wav/ogg）
- 构建歌曲数据结构（路径、文件名、时长等）
- 实现播放模式逻辑（顺序/循环/单曲/随机）

### Step 3: MusicPlayer 播放引擎
- 创建隐藏 Webview Panel
- 实现 Extension ↔ Webview 消息通信
- Webview 中使用 HTML5 Audio API 播放音频
- 实现播放、暂停、上一首、下一首、音量调节
- 实现播放进度回报

### Step 4: LrcParser 歌词解析
- 实现 LRC 格式解析（时间标签 + 歌词文本）
- 支持多时间标签、偏移标签
- 根据播放时间返回当前歌词行

### Step 5: StatusBarController 状态栏
- 创建状态栏按钮：⏮ ⏯ ⏭ 🔉 🔊 词
- 绑定按钮点击命令
- 实现歌词滚动显示
- 实现歌曲名显示

### Step 6: SidebarProvider 侧边栏
- 实现 TreeDataProvider
- 显示歌曲列表（按文件夹分组）
- 高亮当前播放歌曲
- 支持点击播放

### Step 7: 整合与测试
- 整合所有模块
- 端到端测试
- 处理边界情况（无歌曲、无歌词、格式错误等）

## 编码规范
- 使用 TypeScript strict 模式
- 模块间通过事件/回调解耦
- 所有用户可见文本支持中英文
- 错误处理：静默降级，不中断播放体验

## 开发部署流程

**重要：每次修改代码后必须执行完整流程，否则扩展运行的仍是旧代码：**
```bash
npm run build && npx @vscode/vsce package && code --install-extension vscode-music-player-0.1.0.vsix
```
然后在 VSCode 中 `Ctrl+Shift+P` → `Developer: Reload Window`。

仅 `npm run build` 只更新项目本地 `out/` 目录，已安装的扩展读取的是 `~/.vscode/extensions/` 中的副本，不会自动更新。

## 已解决的问题与关键决策

### 音频引擎选型（Webview → ffplay）
- **HTML5 Audio**：Chromium autoplay policy 阻止 `audio.play()`，需用户手势
- **Web Audio API (AudioContext)**：`audioCtx.resume()` 同样被 autoplay policy 阻止
- **WebviewPanel + 点击启用**：可行但用户必须手动点击 "Enable Audio" 按钮，且会显示一个标签页
- **WebviewViewProvider（侧边栏）**：仍需点击启用
- **最终方案：ffplay 子进程** — 完全绕过 Webview 和 autoplay 限制，无需用户手势

### 进程管理（多音频同时播放问题）
**问题**：切换歌曲时旧 ffplay 进程未被杀死，导致多首歌曲同时播放、无法暂停

**根因与修复**：
1. **SIGTERM 无法可靠杀死 ffplay** → 改用 SIGKILL + stdin.destroy() + process.kill(pid) 三重保障
2. **旧进程 exit handler 异步触发 onDidEnd 导致级联播放** → 引入 generation counter，stale exit handler 直接忽略
3. **playSong 异步间隙旧音频继续播放** → playSong 开头立即调用 player.stop()，并用 loadToken 取消过期调用
4. **stop() 未触发状态变更事件** → stop() 增加 `onDidChangeState('stopped')` 通知状态栏更新按钮

### 文件夹扫描性能
- 扫描大型目录（如 `.venv/site-packages`）耗时过长 → 添加 SKIP_DIRS 过滤（.git, .venv, node_modules 等），11255 目录降至 160，1231ms 降至 16ms
- selectFolder 与 onDidChangeConfiguration 监听器的竞态条件 → 先扫描再更新配置 + scanFromSelectFolder 守卫标志

### music-metadata ESM 兼容性
- music-metadata v11 是纯 ESM 模块，与 esbuild CJS 打包不兼容 → 移除依赖，改用文件名提取元数据（"Artist - Title" 格式）

### VSIX 打包警告
- 缺少 repository 字段 → package.json 添加 repository 和 license 字段
- 缺少 LICENSE 文件 → 创建 MIT LICENSE 文件
