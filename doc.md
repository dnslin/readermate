# VS Code 小说阅读插件完整开发方案

## 一、项目概述

### 1.1 项目目标

开发一个轻量级的 VS Code 插件，通过调用 hectorqin/reader 服务端 API，实现工作时间的便捷小说阅读功能。

### 1.2 核心需求

- 显示个人书架
- 点击书籍进入阅读
- 支持快捷键翻页
- 界面简洁，不影响工作

## 二、技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────┐
│           VS Code Extension         │
├─────────────────────────────────────┤
│  Extension Host (Node.js)           │
│  ├── API Client (HTTP请求)          │
│  ├── Data Manager (数据管理)        │
│  └── Command Handler (命令处理)     │
├─────────────────────────────────────┤
│  UI Layer                          │
│  ├── TreeView (书架)               │
│  ├── Webview (阅读器)              │
│  └── Status Bar (状态栏)           │
├─────────────────────────────────────┤
│  Reader API Server                 │
│  └── HTTP: /reader3/*              │
└─────────────────────────────────────┘
```

### 2.2 技术栈

- **开发语言**: TypeScript
- **UI 框架**: VS Code Extension API
- **网络请求**: Node.js http/https
- **数据存储**: VS Code 配置 API + globalState

## 三、功能设计

### 3.1 功能模块

**书架管理模块**

- 获取书架列表
- 书籍信息展示
- 刷新书架

**阅读器模块**

- 章节列表获取
- 章节内容显示
- 翻页控制

**配置管理模块**

- 服务器地址配置
- 用户登录信息
- 阅读偏好设置

**快捷键模块**

- 翻页快捷键
- 界面切换
- 快速操作

### 3.2 API 接口设计

**基础配置**

- 服务器地址: `http://your-reader-server:8080`
- API 前缀: `/reader3/`
- 认证方式: Token

**核心 API**

```
GET  /reader3/getUserInfo           # 获取用户信息
GET  /reader3/getBookshelf         # 获取书架
GET  /reader3/getChapterList       # 获取章节列表
GET  /reader3/getBookContent       # 获取章节内容
POST /reader3/saveBookProgress     # 保存阅读进度
```

## 四、项目结构

### 4.1 目录结构

```
novel-reader-vscode/
├── package.json                 # 插件配置
├── tsconfig.json               # TypeScript配置
├── src/
│   ├── extension.ts            # 插件入口
│   ├── api/
│   │   ├── readerApi.ts        # API客户端
│   │   └── types.ts            # 类型定义
│   ├── providers/
│   │   ├── bookshelfProvider.ts # 书架数据提供者
│   │   └── readerProvider.ts   # 阅读器提供者
│   ├── views/
│   │   ├── bookshelf.ts        # 书架视图
│   │   └── reader.ts           # 阅读器视图
│   ├── commands/
│   │   └── index.ts            # 命令处理
│   └── utils/
│       ├── config.ts           # 配置管理
│       └── storage.ts          # 存储管理
├── media/
│   ├── reader.css              # 阅读器样式
│   ├── reader.js               # 阅读器脚本
│   └── icons/                  # 图标资源
└── README.md
```

### 4.2 package.json 配置

```json
{
  "name": "novel-reader",
  "displayName": "小说阅读器",
  "description": "基于阅读3服务端的VS Code小说阅读插件",
  "version": "1.0.0",
  "engines": {
    "vscode": "^1.60.0"
  },
  "categories": ["Other"],
  "activationEvents": [
    "onCommand:novelReader.openBookshelf",
    "onView:novelBookshelf"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "novelReader.openBookshelf",
        "title": "打开书架",
        "category": "小说阅读器",
        "icon": "$(library)"
      },
      {
        "command": "novelReader.openReader",
        "title": "打开阅读器"
      },
      {
        "command": "novelReader.prevChapter",
        "title": "上一章"
      },
      {
        "command": "novelReader.nextChapter",
        "title": "下一章"
      },
      {
        "command": "novelReader.refreshBookshelf",
        "title": "刷新书架",
        "icon": "$(refresh)"
      }
    ],
    "keybindings": [
      {
        "command": "novelReader.openBookshelf",
        "key": "ctrl+shift+r"
      },
      {
        "command": "novelReader.prevChapter",
        "key": "ctrl+left",
        "when": "novelReader.readerActive"
      },
      {
        "command": "novelReader.nextChapter",
        "key": "ctrl+right",
        "when": "novelReader.readerActive"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "novelReader",
          "title": "小说阅读器",
          "icon": "$(book)"
        }
      ]
    },
    "views": {
      "novelReader": [
        {
          "id": "novelBookshelf",
          "name": "我的书架",
          "when": "novelReader.enabled"
        }
      ]
    },
    "menus": {
      "view/title": [
        {
          "command": "novelReader.refreshBookshelf",
          "when": "view == novelBookshelf",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "novelReader.openReader",
          "when": "view == novelBookshelf && viewItem == book"
        }
      ]
    },
    "configuration": {
      "title": "小说阅读器",
      "properties": {
        "novelReader.serverUrl": {
          "type": "string",
          "default": "http://localhost:8080",
          "description": "阅读服务器地址"
        },
        "novelReader.username": {
          "type": "string",
          "description": "用户名"
        },
        "novelReader.pageSize": {
          "type": "number",
          "default": 20,
          "description": "每页章节数"
        }
      }
    }
  }
}
```

## 五、核心代码实现

### 5.1 API 客户端 (src/api/readerApi.ts)

```typescript
import * as https from "https";
import * as http from "http";
import { URL } from "url";

export interface Book {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  lastChapter?: string;
  readProgress?: number;
}

export interface Chapter {
  title: string;
  url: string;
  index: number;
}

export interface BookContent {
  title: string;
  content: string;
  nextUrl?: string;
  prevUrl?: string;
}

export class ReaderApiClient {
  private baseUrl: string;
  private username?: string;
  private password?: string;

  constructor(baseUrl: string, username?: string, password?: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.username = username;
    this.password = password;
  }

  private async request(path: string, options: any = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}/reader3${path}`);

    return new Promise((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        url,
        {
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "VS Code Novel Reader",
            ...options.headers,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const result = JSON.parse(data);
              if (result.isSuccess) {
                resolve(result.data);
              } else {
                reject(new Error(result.errorMsg || "请求失败"));
              }
            } catch (e) {
              reject(new Error("响应解析失败"));
            }
          });
        }
      );

      req.on("error", reject);

      if (options.data) {
        req.write(JSON.stringify(options.data));
      }

      req.end();
    });
  }

  async getUserInfo(): Promise<any> {
    return this.request("/getUserInfo");
  }

  async getBookshelf(): Promise<Book[]> {
    const result = await this.request("/getBookshelf");
    return result || [];
  }

  async getChapterList(bookUrl: string): Promise<Chapter[]> {
    const result = await this.request(
      `/getChapterList?url=${encodeURIComponent(bookUrl)}`
    );
    return result || [];
  }

  async getBookContent(chapterUrl: string): Promise<BookContent> {
    return this.request(
      `/getBookContent?url=${encodeURIComponent(chapterUrl)}`
    );
  }

  async saveProgress(
    bookUrl: string,
    chapterUrl: string,
    progress: number
  ): Promise<void> {
    return this.request("/saveBookProgress", {
      method: "POST",
      data: { bookUrl, chapterUrl, progress },
    });
  }
}
```

### 5.2 书架提供者 (src/providers/bookshelfProvider.ts)

```typescript
import * as vscode from "vscode";
import { ReaderApiClient, Book } from "../api/readerApi";

export class BookshelfProvider implements vscode.TreeDataProvider<BookItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    BookItem | undefined | null | void
  > = new vscode.EventEmitter<BookItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    BookItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private books: Book[] = [];
  private apiClient: ReaderApiClient;

  constructor(apiClient: ReaderApiClient) {
    this.apiClient = apiClient;
  }

  refresh(): void {
    this.loadBooks();
  }

  getTreeItem(element: BookItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BookItem): Thenable<BookItem[]> {
    if (!element) {
      return Promise.resolve(this.books.map((book) => new BookItem(book)));
    }
    return Promise.resolve([]);
  }

  private async loadBooks() {
    try {
      this.books = await this.apiClient.getBookshelf();
      this._onDidChangeTreeData.fire();
    } catch (error) {
      vscode.window.showErrorMessage(`加载书架失败: ${error}`);
    }
  }

  getBook(bookUrl: string): Book | undefined {
    return this.books.find((book) => book.bookUrl === bookUrl);
  }
}

class BookItem extends vscode.TreeItem {
  constructor(public readonly book: Book) {
    super(book.name, vscode.TreeItemCollapsibleState.None);

    this.label = book.name;
    this.description = book.author;
    this.tooltip = `${book.name} - ${book.author}`;
    this.contextValue = "book";

    // 设置图标
    this.iconPath = new vscode.ThemeIcon("book");

    // 设置点击命令
    this.command = {
      command: "novelReader.openReader",
      title: "阅读",
      arguments: [book],
    };
  }
}
```

### 5.3 阅读器提供者 (src/providers/readerProvider.ts)

```typescript
import * as vscode from "vscode";
import * as path from "path";
import { ReaderApiClient, Book, Chapter, BookContent } from "../api/readerApi";

export class ReaderProvider implements vscode.WebviewPanelSerializer {
  public static currentPanel: ReaderProvider | undefined;
  public static readonly viewType = "novelReader";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private currentBook?: Book;
  private chapters: Chapter[] = [];
  private currentChapterIndex = 0;
  private apiClient: ReaderApiClient;

  public static createOrShow(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    book?: Book
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReaderProvider.currentPanel) {
      ReaderProvider.currentPanel._panel.reveal(column);
      if (book) {
        ReaderProvider.currentPanel.openBook(book);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReaderProvider.viewType,
      "小说阅读器",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out"),
        ],
        retainContextWhenHidden: true,
      }
    );

    ReaderProvider.currentPanel = new ReaderProvider(
      panel,
      extensionUri,
      apiClient
    );

    if (book) {
      ReaderProvider.currentPanel.openBook(book);
    }
  }

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.apiClient = apiClient;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // 设置context
    vscode.commands.executeCommand(
      "setContext",
      "novelReader.readerActive",
      true
    );
  }

  public async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    state: any
  ): Promise<void> {
    ReaderProvider.currentPanel = new ReaderProvider(
      webviewPanel,
      this._extensionUri,
      this.apiClient
    );
  }

  public dispose() {
    ReaderProvider.currentPanel = undefined;
    vscode.commands.executeCommand(
      "setContext",
      "novelReader.readerActive",
      false
    );

    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  public async openBook(book: Book) {
    this.currentBook = book;
    this._panel.title = `阅读: ${book.name}`;

    try {
      this.chapters = await this.apiClient.getChapterList(book.bookUrl);
      this.currentChapterIndex = 0;
      await this.loadCurrentChapter();
    } catch (error) {
      vscode.window.showErrorMessage(`加载章节失败: ${error}`);
    }
  }

  public async prevChapter() {
    if (this.currentChapterIndex > 0) {
      this.currentChapterIndex--;
      await this.loadCurrentChapter();
    }
  }

  public async nextChapter() {
    if (this.currentChapterIndex < this.chapters.length - 1) {
      this.currentChapterIndex++;
      await this.loadCurrentChapter();
    }
  }

  private async loadCurrentChapter() {
    if (!this.chapters[this.currentChapterIndex]) {
      return;
    }

    try {
      const chapter = this.chapters[this.currentChapterIndex];
      const content = await this.apiClient.getBookContent(chapter.url);

      this._panel.webview.postMessage({
        command: "updateChapter",
        data: {
          title: content.title,
          content: content.content,
          chapterIndex: this.currentChapterIndex,
          totalChapters: this.chapters.length,
          hasPrev: this.currentChapterIndex > 0,
          hasNext: this.currentChapterIndex < this.chapters.length - 1,
        },
      });
    } catch (error) {
      vscode.window.showErrorMessage(`加载章节内容失败: ${error}`);
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);

    webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "prevChapter":
            this.prevChapter();
            break;
          case "nextChapter":
            this.nextChapter();
            break;
          case "ready":
            // Webview准备就绪
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.css")
    );

    return `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <title>小说阅读器</title>
      </head>
      <body>
        <div class="reader-container">
          <div class="toolbar">
            <button id="prev-btn" class="nav-btn" disabled>上一章</button>
            <span id="chapter-info">选择章节</span>
            <button id="next-btn" class="nav-btn" disabled>下一章</button>
          </div>
          <div class="content-area">
            <h1 id="chapter-title">请选择要阅读的书籍</h1>
            <div id="chapter-content" class="content"></div>
          </div>
        </div>
        <script src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
```

### 5.4 主扩展文件 (src/extension.ts)

```typescript
import * as vscode from "vscode";
import { ReaderApiClient } from "./api/readerApi";
import { BookshelfProvider } from "./providers/bookshelfProvider";
import { ReaderProvider } from "./providers/readerProvider";

let apiClient: ReaderApiClient;
let bookshelfProvider: BookshelfProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log("小说阅读器插件已激活");

  // 初始化API客户端
  const config = vscode.workspace.getConfiguration("novelReader");
  const serverUrl = config.get<string>("serverUrl", "http://localhost:8080");
  const username = config.get<string>("username");

  apiClient = new ReaderApiClient(serverUrl, username);

  // 创建书架提供者
  bookshelfProvider = new BookshelfProvider(apiClient);
  vscode.window.createTreeView("novelBookshelf", {
    treeDataProvider: bookshelfProvider,
    showCollapseAll: false,
  });

  // 注册命令
  const commands = [
    vscode.commands.registerCommand("novelReader.openBookshelf", () => {
      vscode.commands.executeCommand("novelBookshelf.focus");
    }),

    vscode.commands.registerCommand("novelReader.openReader", (book) => {
      ReaderProvider.createOrShow(context.extensionUri, apiClient, book);
    }),

    vscode.commands.registerCommand("novelReader.refreshBookshelf", () => {
      bookshelfProvider.refresh();
    }),

    vscode.commands.registerCommand("novelReader.prevChapter", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.prevChapter();
      }
    }),

    vscode.commands.registerCommand("novelReader.nextChapter", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.nextChapter();
      }
    }),

    // 注册 Webview 序列化器
    vscode.window.registerWebviewPanelSerializer(
      "novelReader",
      new ReaderProvider({} as any, context.extensionUri, apiClient)
    ),
  ];

  context.subscriptions.push(...commands);

  // 设置context
  vscode.commands.executeCommand("setContext", "novelReader.enabled", true);

  // 监听配置变化
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("novelReader.serverUrl")) {
      const newUrl = vscode.workspace
        .getConfiguration("novelReader")
        .get<string>("serverUrl", "");
      apiClient = new ReaderApiClient(newUrl, username);
      bookshelfProvider = new BookshelfProvider(apiClient);
    }
  });
}

export function deactivate() {
  if (ReaderProvider.currentPanel) {
    ReaderProvider.currentPanel.dispose();
  }
}
```

## 六、前端界面

### 6.1 样式文件 (media/reader.css)

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0;
  padding: 0;
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  line-height: 1.6;
}

.reader-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  background-color: var(--vscode-editorGroupHeader-tabsBackground);
  border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder);
}

.nav-btn {
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.nav-btn:hover:not(:disabled) {
  background-color: var(--vscode-button-hoverBackground);
}

.nav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

#chapter-info {
  font-size: 14px;
  color: var(--vscode-foreground);
}

.content-area {
  flex: 1;
  padding: 20px 40px;
  overflow-y: auto;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

#chapter-title {
  text-align: center;
  margin-bottom: 30px;
  color: var(--vscode-textPreformat-foreground);
  font-size: 24px;
  font-weight: 500;
}

.content {
  font-size: 16px;
  line-height: 2;
  text-align: justify;
}

.content p {
  margin-bottom: 16px;
  text-indent: 2em;
}

/* 滚动条美化 */
.content-area::-webkit-scrollbar {
  width: 8px;
}

.content-area::-webkit-scrollbar-track {
  background: var(--vscode-scrollbarSlider-background);
}

.content-area::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-activeBackground);
  border-radius: 4px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .content-area {
    padding: 15px 20px;
  }

  .toolbar {
    padding: 8px 15px;
  }

  .nav-btn {
    padding: 6px 12px;
    font-size: 12px;
  }
}
```

### 6.2 脚本文件 (media/reader.js)

```javascript
(function () {
  const vscode = acquireVsCodeApi();

  // DOM元素
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const chapterInfo = document.getElementById("chapter-info");
  const chapterTitle = document.getElementById("chapter-title");
  const chapterContent = document.getElementById("chapter-content");

  // 事件监听
  prevBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "prevChapter" });
  });

  nextBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "nextChapter" });
  });

  // 键盘事件
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey) {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (!prevBtn.disabled) {
            vscode.postMessage({ command: "prevChapter" });
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (!nextBtn.disabled) {
            vscode.postMessage({ command: "nextChapter" });
          }
          break;
      }
    }
  });

  // 监听来自扩展的消息
  window.addEventListener("message", (event) => {
    const message = event.data;

    switch (message.command) {
      case "updateChapter":
        updateChapter(message.data);
        break;
    }
  });

  function updateChapter(data) {
    chapterTitle.textContent = data.title;
    chapterContent.innerHTML = formatContent(data.content);
    chapterInfo.textContent = `${data.chapterIndex + 1} / ${
      data.totalChapters
    }`;

    prevBtn.disabled = !data.hasPrev;
    nextBtn.disabled = !data.hasNext;

    // 滚动到顶部
    document.querySelector(".content-area").scrollTop = 0;
  }

  function formatContent(content) {
    if (!content) return "";

    // 简单的内容格式化
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<p>${line.trim()}</p>`)
      .join("");
  }

  // 通知扩展webview已准备就绪
  vscode.postMessage({ command: "ready" });
})();
```

## 七、开发流程

### 7.1 环境搭建

```bash
# 1. 安装开发工具
npm install -g yo generator-code

# 2. 创建项目
yo code
# 选择 "New Extension (TypeScript)"

# 3. 安装依赖
cd novel-reader-vscode
npm install

# 4. 配置开发环境
code .
```

### 7.2 开发步骤

**阶段一：基础框架**

1. 搭建项目结构
2. 配置 package.json
3. 实现基础的 API 客户端
4. 创建书架 TreeView

**阶段二：核心功能**

1. 实现书架数据加载
2. 创建阅读器 Webview
3. 实现章节加载和显示
4. 添加翻页功能

**阶段三：交互优化**

1. 添加快捷键支持
2. 优化用户界面
3. 添加错误处理
4. 实现配置管理

**阶段四：完善功能**

1. 添加阅读进度保存
2. 实现书签功能
3. 优化性能
4. 编写文档

### 7.3 调试测试

```bash
# 编译
npm run compile

# 运行调试
F5 (在VS Code中)

# 打包发布
npm install -g vsce
vsce package
```

## 八、配置说明

### 8.1 插件配置

在 VS Code 设置中添加：

```json
{
  "novelReader.serverUrl": "http://your-server:8080",
  "novelReader.username": "your-username",
  "novelReader.pageSize": 20
}
```

### 8.2 快捷键说明

- `Ctrl+Shift+R`: 打开书架
- `Ctrl+←`: 上一章 (阅读模式下)
- `Ctrl+→`: 下一章 (阅读模式下)
- `Esc`: 关闭阅读器

## 九、部署发布

### 9.1 打包发布

```bash
# 安装发布工具
npm install -g vsce

# 打包插件
vsce package

# 发布到市场 (可选)
vsce publish
```

### 9.2 安装使用

```bash
# 安装vsix文件
code --install-extension novel-reader-1.0.0.vsix
```

## 十、维护升级

### 10.1 版本规划

- v1.0: 基础阅读功能
- v1.1: 书签和历史记录
- v1.2: 主题和字体设置
- v1.3: 离线缓存功能

### 10.2 后续优化

- 性能优化
- 界面美化
- 功能扩展
- 错误修复

