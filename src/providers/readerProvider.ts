import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter, BookContent } from "../api/types";
import { BookshelfProvider } from "./bookshelfProvider";
import { ReaderViewProvider } from "./readerViewProvider";
import { PreloadManager } from "../preload/preloadManager";
import { PreloadConfig, ReadingProgressEvent } from "../preload/types";
import { logger } from "../utils/logger";
import { showFriendlyError } from "../utils/messages";

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class ReaderProvider {
  public static currentPanel: ReaderProvider | undefined;
  public static currentViewProvider: ReaderViewProvider | undefined;
  public static readonly viewType = "readermate";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public currentBook?: Book;
  public chapters: Chapter[] = [];
  public currentChapterIndex = 0;
  private apiClient: ReaderApiClient;
  private bookshelfProvider?: BookshelfProvider;
  private preloadManager: PreloadManager;
  private _isWebviewReady = false;
  private _isNavigating = false;
  private _lastNavTime = 0;
  private _pendingChapterContent?: {
    title: string;
    content: string;
    chapterIndex: number;
    totalChapters: number;
    hasPrev: boolean;
    hasNext: boolean;
  };

  public static createOrShow(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider: BookshelfProvider,
    preloadConfig: PreloadConfig,
    book?: Book,
    chapterIndex?: number
  ) {
    const cfg = vscode.workspace.getConfiguration("readermate");
    const displayLocation = cfg.get<string>("chapterDisplay.location", "sidebar");

    if (displayLocation === "sidebar" || displayLocation === "panel") {
      if (ReaderProvider.currentViewProvider) {
        if (book) {
          ReaderProvider.currentViewProvider.openBook(book, chapterIndex);
        }
        vscode.commands.executeCommand("readermateReaderPanel.focus");
        return;
      }
      vscode.commands.executeCommand("readermateReaderPanel.focus");
      return;
    }

    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn || vscode.ViewColumn.One
      : vscode.ViewColumn.One;

    if (ReaderProvider.currentPanel) {
      ReaderProvider.currentPanel._panel.reveal(column);
      if (book) {
        ReaderProvider.currentPanel.openBook(book, chapterIndex);
      }
      return;
    }

    const stealthEnabled = cfg.get<boolean>("stealth.enabled", true);
    const disguiseTitle = cfg.get<string>("stealth.disguiseTitle", "输出");
    const initialTitle = stealthEnabled
      ? disguiseTitle || "输出"
      : book
      ? `阅读: ${book.name}`
      : "小说阅读器";

    const panel = vscode.window.createWebviewPanel(
      ReaderProvider.viewType,
      initialTitle,
      column,
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
      apiClient,
      bookshelfProvider,
      preloadConfig
    );

    if (book) {
      ReaderProvider.currentPanel.openBook(book, chapterIndex);
    }
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider?: BookshelfProvider,
    preloadConfig?: PreloadConfig
  ) {
    ReaderProvider.currentPanel = new ReaderProvider(
      panel,
      extensionUri,
      apiClient,
      bookshelfProvider,
      preloadConfig
    );
  }

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider?: BookshelfProvider,
    preloadConfig?: PreloadConfig
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.apiClient = apiClient;
    this.bookshelfProvider = bookshelfProvider;

    const defaultConfig: PreloadConfig = {
      enabled: true,
      chapterCount: 2,
      triggerProgress: 50,
      maxCacheSize: 10,
    };
    this.preloadManager = new PreloadManager(
      apiClient,
      preloadConfig || defaultConfig
    );

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerActive",
      true
    );
  }

  public updatePreloadConfig(config: PreloadConfig): void {
    this.preloadManager.updateConfig(config);
    logger.info("预加载配置已更新", "ReaderProvider");
  }

  public updateApiClient(apiClient: ReaderApiClient): void {
    logger.info("开始更新API客户端", "ReaderProvider");
    this.apiClient = apiClient;
    this.preloadManager.updateApiClient(apiClient);
    logger.info("API客户端已更新", "ReaderProvider");
  }

  public updateBookshelfProvider(bookshelfProvider: BookshelfProvider): void {
    logger.info("更新书架提供者", "ReaderProvider");
    this.bookshelfProvider = bookshelfProvider;
  }

  public applySettings(): void {
    try {
      const cfg = vscode.workspace.getConfiguration("readermate");
      const stealthEnabled = cfg.get<boolean>("stealth.enabled", true);
      const hideToolbar = cfg.get<boolean>("stealth.hideToolbar", true);
      const fontSize = cfg.get<number>("reader.fontSize", 16);
      const lineHeight = cfg.get<number>("reader.lineHeight", 1.7);
      const disguiseTitle = cfg.get<string>("stealth.disguiseTitle", "输出");

      if (this.currentBook) {
        this._panel.title = stealthEnabled
          ? disguiseTitle || "输出"
          : `阅读: ${this.currentBook.name}`;
      }

      this._panel.webview.postMessage({
        command: "applyStealth",
        data: { stealthEnabled, hideToolbar, fontSize, lineHeight },
      });
      logger.debug("已应用最新阅读与隐身设置", "ReaderProvider");
    } catch (e) {
      logger.error(e, "应用设置失败", "ReaderProvider");
    }
  }

  public static switchDisplayLocation(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider: BookshelfProvider,
    preloadConfig: PreloadConfig
  ): void {
    let currentBook: Book | undefined;
    let currentChapterIndex = 0;

    if (ReaderProvider.currentPanel) {
      currentBook = ReaderProvider.currentPanel.currentBook;
      currentChapterIndex = ReaderProvider.currentPanel.currentChapterIndex;
      ReaderProvider.currentPanel.dispose();
    } else if (ReaderProvider.currentViewProvider) {
      currentBook = ReaderProvider.currentViewProvider.currentBook;
      currentChapterIndex =
        ReaderProvider.currentViewProvider.currentChapterIndex;
    }

    if (!currentBook) {
      return;
    }

    ReaderProvider.createOrShow(
      extensionUri,
      apiClient,
      bookshelfProvider,
      preloadConfig,
      currentBook,
      currentChapterIndex
    );
  }

  private handleReadingProgress(progress: number): void {
    if (!this.currentBook || this.chapters.length === 0) {
      return;
    }

    const event: ReadingProgressEvent = {
      chapterIndex: this.currentChapterIndex,
      progress: progress,
      totalChapters: this.chapters.length,
    };

    this.preloadManager.onReadingProgress(event);
    logger.debug(
      `阅读进度更新: 第${this.currentChapterIndex + 1}章 ${progress}%`,
      "ReaderProvider"
    );
  }

  public async openBook(book: Book, chapterIndex?: number) {
    this.currentBook = book;
    const cfg = vscode.workspace.getConfiguration("readermate");
    const stealthEnabled = cfg.get<boolean>("stealth.enabled", true);
    const disguiseTitle = cfg.get<string>("stealth.disguiseTitle", "输出");
    this._panel.title = stealthEnabled
      ? disguiseTitle || "输出"
      : `阅读: ${book.name}`;

    try {
      this._panel.webview.postMessage({
        command: "loading",
        data: { title: book.name },
      });

      logger.info(
        `开始获取章节列表: ${book.name}, bookUrl: ${book.bookUrl}`,
        "ReaderProvider"
      );
      this.chapters = await this.apiClient.getChapterList(book.bookUrl);
      logger.info(
        `章节列表获取成功，共 ${this.chapters.length} 章`,
        "ReaderProvider"
      );

      if (
        chapterIndex !== undefined &&
        chapterIndex >= 0 &&
        chapterIndex < this.chapters.length
      ) {
        this.currentChapterIndex = chapterIndex;
      } else {
        this.currentChapterIndex = book.durChapterIndex || 0;
      }

      if (this.currentChapterIndex >= this.chapters.length) {
        this.currentChapterIndex = 0;
      }

      await this.loadCurrentChapter();
      this.preloadManager.setCurrentBook(book.bookUrl, this.chapters.length);
    } catch (error) {
      logger.error(error, "加载章节失败", "ReaderProvider");
      showFriendlyError("chapterList", error, "ReaderProvider");
      this._panel.webview.postMessage({
        command: "error",
        data: { message: "加载章节列表失败，请检查网络或服务配置" },
      });
    }
  }

  public async prevChapter() {
    const now = Date.now();
    if (this._isNavigating || now - this._lastNavTime < 300) {
      return;
    }
    if (this.currentChapterIndex > 0) {
      this._isNavigating = true;
      this._lastNavTime = now;
      try {
        this.currentChapterIndex--;
        await this.loadCurrentChapter();
        await this.saveCurrentProgress();
      } finally {
        this._isNavigating = false;
      }
    }
  }

  public async nextChapter() {
    const now = Date.now();
    if (this._isNavigating || now - this._lastNavTime < 300) {
      return;
    }
    if (this.currentChapterIndex < this.chapters.length - 1) {
      this._isNavigating = true;
      this._lastNavTime = now;
      try {
        this.currentChapterIndex++;
        await this.loadCurrentChapter();
        await this.saveCurrentProgress();
      } finally {
        this._isNavigating = false;
      }
    }
  }

  public async selectChapter() {
    if (!this.currentBook || this.chapters.length === 0) {
      vscode.window.showInformationMessage("请先打开一本书籍");
      return;
    }

    const items = this.chapters.map((ch) => ({
      label: ch.title,
      description:
        ch.index === this.currentChapterIndex ? "当前章节" : undefined,
      index: ch.index,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `选择《${this.currentBook.name}》的章节（共 ${this.chapters.length} 章）`,
      matchOnDescription: true,
    });

    if (picked) {
      this.currentChapterIndex = picked.index;
      await this.loadCurrentChapter();
      await this.saveCurrentProgress();
    }
  }

  private async saveCurrentProgress() {
    if (!this.currentBook || !this.chapters[this.currentChapterIndex]) {
      return;
    }

    try {
      await this.apiClient.saveBookProgress(
        this.currentBook.bookUrl,
        this.currentChapterIndex
      );
      if (this.bookshelfProvider) {
        this.bookshelfProvider.refresh();
      }
    } catch (error) {
      logger.warn(`保存阅读进度失败: ${String(error)}`, "ReaderProvider");
    }
  }

  public async loadCurrentChapter() {
    if (!this.chapters[this.currentChapterIndex] || !this.currentBook) {
      return;
    }

    const chapter = this.chapters[this.currentChapterIndex];
    this._panel.webview.postMessage({
      command: "loading",
      data: { title: chapter.title },
    });

    try {
      const content = await this.preloadManager.getChapterContent(
        this.currentBook.bookUrl,
        this.currentChapterIndex
      );

      if (
        chapter.title &&
        content &&
        typeof content === "object" &&
        !Array.isArray(content)
      ) {
        content.title = chapter.title;
      }

      const messagePayload = {
        title: content.title,
        content: content.content,
        chapterIndex: this.currentChapterIndex,
        totalChapters: this.chapters.length,
        hasPrev: this.currentChapterIndex > 0,
        hasNext: this.currentChapterIndex < this.chapters.length - 1,
      };

      this._pendingChapterContent = messagePayload;

      if (this._isWebviewReady) {
        this._panel.webview.postMessage({
          command: "updateChapter",
          data: messagePayload,
        });
      }
    } catch (error) {
      logger.error(error, "加载章节内容失败", "ReaderProvider");
      showFriendlyError("content", error, "ReaderProvider");
      this._panel.webview.postMessage({
        command: "error",
        data: { message: "章节内容加载失败，请点击重试" },
      });
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
          case "selectChapter":
            this.selectChapter();
            break;
          case "retry":
            this.loadCurrentChapter();
            break;
          case "readingProgress":
            this.handleReadingProgress(message.progress);
            break;
          case "ready":
            this._isWebviewReady = true;
            this.applySettings();
            if (this._pendingChapterContent) {
              this._panel.webview.postMessage({
                command: "updateChapter",
                data: this._pendingChapterContent,
              });
            } else if (this.currentBook && this.chapters.length > 0) {
              this.loadCurrentChapter();
            }
            break;
          case "panic":
            try {
              this._panel.dispose();
            } catch {}
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.css")
    );
    const cfg = vscode.workspace.getConfiguration("readermate");
    const fontSize = cfg.get<number>("reader.fontSize", 16);
    const lineHeight = cfg.get<number>("reader.lineHeight", 1.7);
    const nonce = getNonce();
    return `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <style>
          :root {
            --reader-font-size: ${fontSize}px;
            --reader-line-height: ${lineHeight};
          }
        </style>
        <title>ReaderMate</title>
      </head>
      <body>
        <div class="reader-container">
          <div class="toolbar">
            <button id="prev-btn" class="nav-btn" disabled>上一章</button>
            <button id="catalog-btn" class="nav-btn catalog-btn" title="查看目录 (Ctrl+Shift+C)">目录</button>
            <span id="chapter-info">未加载</span>
            <button id="next-btn" class="nav-btn" disabled>下一章</button>
          </div>
          <div class="content-area">
            <div id="loading-box" class="loading-state" style="display: none;">
              <div class="spinner"></div>
              <p id="loading-text">正在加载章节内容...</p>
            </div>
            <div id="error-box" class="error-state" style="display: none;">
              <p id="error-text">加载失败</p>
              <button id="retry-btn" class="nav-btn">重试</button>
            </div>
            <div id="chapter-body">
              <div id="chapter-title"></div>
              <div id="chapter-content" class="content"></div>
            </div>
          </div>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  public dispose() {
    ReaderProvider.currentPanel = undefined;
    this.preloadManager.dispose();
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }

    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerActive",
      false
    );
  }
}

export class ReaderPanelSerializer implements vscode.WebviewPanelSerializer {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getApiClient: () => ReaderApiClient,
    private readonly getBookshelfProvider: () => BookshelfProvider,
    private readonly getPreloadConfig: () => PreloadConfig
  ) {}

  async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    _state: unknown
  ): Promise<void> {
    ReaderProvider.revive(
      webviewPanel,
      this.extensionUri,
      this.getApiClient(),
      this.getBookshelfProvider(),
      this.getPreloadConfig()
    );
  }
}
