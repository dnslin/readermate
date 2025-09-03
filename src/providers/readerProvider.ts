import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter } from "../api/types";
import { BookshelfProvider } from "./bookshelfProvider";
import { ReaderViewProvider } from "./readerViewProvider";
import { PreloadManager } from "../preload/preloadManager";
import { PreloadConfig, ReadingProgressEvent } from "../preload/types";
import { logger } from "../utils/logger";
import { showFriendlyError } from "../utils/messages";

export class ReaderProvider implements vscode.WebviewPanelSerializer {
  public static currentPanel: ReaderProvider | undefined;
  public static currentViewProvider: ReaderViewProvider | undefined;
  public static readonly viewType = "readermate";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private currentBook?: Book;
  private chapters: Chapter[] = [];
  private currentChapterIndex = 0;
  private apiClient: ReaderApiClient;
  private bookshelfProvider?: BookshelfProvider;
  private preloadManager: PreloadManager;

  public static createOrShow(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider: BookshelfProvider,
    preloadConfig: PreloadConfig,
    book?: Book
  ) {
    // Read display location config
    const cfg = vscode.workspace.getConfiguration('readermate');
    const displayLocation = cfg.get<string>('chapterDisplay.location', 'editor');
    
    if (displayLocation === 'panel') {
      // Use WebviewView in panel
      if (ReaderProvider.currentViewProvider) {
        if (book) {
          ReaderProvider.currentViewProvider.openBook(book);
        }
        // Show the panel view
        vscode.commands.executeCommand('readermateReaderPanel.focus');
        return;
      }
      
      // WebviewView will be created/managed by the view provider registration
      // Just focus the panel if it exists
      vscode.commands.executeCommand('readermateReaderPanel.focus');
      return;
    }
    
    // Use WebviewPanel in editor (existing logic)
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn || vscode.ViewColumn.One
      : vscode.ViewColumn.One;

    if (ReaderProvider.currentPanel) {
      ReaderProvider.currentPanel._panel.reveal(column);
      if (book) {
        ReaderProvider.currentPanel.openBook(book);
      }
      return;
    }

    // Read stealth config for initial title
    const stealthEnabled = cfg.get<boolean>('stealth.enabled', true);
    const disguiseTitle = cfg.get<string>('stealth.disguiseTitle', 'Output');
    const initialTitle = stealthEnabled ? (disguiseTitle || 'Output') : '小说阅读器';

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
      ReaderProvider.currentPanel.openBook(book);
    }
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

    // 初始化预加载管理器
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

  /**
   * 更新预加载配置
   */
  public updatePreloadConfig(config: PreloadConfig): void {
    this.preloadManager.updateConfig(config);
    logger.info("预加载配置已更新", "ReaderProvider");
  }

  /**
   * 更新API客户端
   */
  public updateApiClient(apiClient: ReaderApiClient): void {
    logger.info("开始更新API客户端", "ReaderProvider");
    this.apiClient = apiClient;

    // 更新预加载管理器的API客户端
    this.preloadManager.updateApiClient(apiClient);

    logger.info("API客户端已更新", "ReaderProvider");
  }

  /**
   * 更新书架提供者
   */
  public updateBookshelfProvider(bookshelfProvider: BookshelfProvider): void {
    logger.info("更新书架提供者", "ReaderProvider");
    this.bookshelfProvider = bookshelfProvider;
  }

  /**
   * 切换显示位置
   */
  public static switchDisplayLocation(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider: BookshelfProvider,
    preloadConfig: PreloadConfig
  ): void {
    // 保存当前状态
    let currentBook: Book | undefined;
    let currentChapterIndex = 0;

    // 从当前活动的提供者获取状态
    if (ReaderProvider.currentPanel) {
      currentBook = ReaderProvider.currentPanel.currentBook;
      currentChapterIndex = ReaderProvider.currentPanel.currentChapterIndex;
      ReaderProvider.currentPanel.dispose();
    } else if (ReaderProvider.currentViewProvider) {
      currentBook = ReaderProvider.currentViewProvider.currentBook;
      currentChapterIndex = ReaderProvider.currentViewProvider.currentChapterIndex;
      // ViewProvider 不需要手动dispose，因为它由VS Code管理
    }

    // 如果没有活动的阅读器，直接返回
    if (!currentBook) {
      return;
    }

    // 重新创建面板/视图
    ReaderProvider.createOrShow(
      extensionUri,
      apiClient,
      bookshelfProvider,
      preloadConfig,
      currentBook
    );

    // 恢复章节位置 - 延迟执行以确保新的提供者已完全初始化
    setTimeout(() => {
      if (ReaderProvider.currentPanel && currentBook) {
        ReaderProvider.currentPanel.currentChapterIndex = currentChapterIndex;
        ReaderProvider.currentPanel.loadCurrentChapter();
      } else if (ReaderProvider.currentViewProvider && currentBook) {
        ReaderProvider.currentViewProvider.currentChapterIndex = currentChapterIndex;
        ReaderProvider.currentViewProvider.loadCurrentChapter();
      }
    }, 100);
  }

  /**
   * 处理阅读进度更新
   */
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

  public async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    _state: any
  ): Promise<void> {
    ReaderProvider.currentPanel = new ReaderProvider(
      webviewPanel,
      this._extensionUri,
      this.apiClient
    );
  }

  public async openBook(book: Book) {
    this.currentBook = book;
    const cfg = vscode.workspace.getConfiguration('readermate');
    const stealthEnabled = cfg.get<boolean>('stealth.enabled', true);
    const disguiseTitle = cfg.get<string>('stealth.disguiseTitle', 'Output');
    this._panel.title = stealthEnabled ? (disguiseTitle || 'Output') : `阅读: ${book.name}`;

    try {
      logger.info(`开始获取章节列表: ${book.name}, bookUrl: ${book.bookUrl}`,
        "ReaderProvider");
      this.chapters = await this.apiClient.getChapterList(book.bookUrl);
      logger.info(`章节列表获取成功，共 ${this.chapters.length} 章`, "ReaderProvider");

      // 使用书籍的阅读进度作为起始章节，如果没有则从第0章开始
      this.currentChapterIndex = book.durChapterIndex || 0;
      logger.info(
        `设置起始章节索引: ${this.currentChapterIndex} (来自书籍进度: ${book.durChapterIndex})`,
        "ReaderProvider"
      );

      // 确保章节索引不超出范围
      if (this.currentChapterIndex >= this.chapters.length) {
        logger.warn("章节索引超出范围，重置为0", "ReaderProvider");
        this.currentChapterIndex = 0;
      }

      await this.loadCurrentChapter();

      // 设置预加载管理器的当前书籍信息
      this.preloadManager.setCurrentBook(book.bookUrl, this.chapters.length);
    } catch (error) {
      logger.error(error, "加载章节失败", "ReaderProvider");
      showFriendlyError("chapterList", error, "ReaderProvider");
    }
  }

  public async prevChapter() {
    if (this.currentChapterIndex > 0) {
      this.currentChapterIndex--;
      await this.loadCurrentChapter();
      await this.saveCurrentProgress();
    }
  }

  public async nextChapter() {
    if (this.currentChapterIndex < this.chapters.length - 1) {
      this.currentChapterIndex++;
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
      logger.debug(
        `已保存阅读进度: 第${this.currentChapterIndex + 1}章 ${
          this.chapters[this.currentChapterIndex]?.title || "未知章节"
        }`,
        "ReaderProvider"
      );

      // 保存进度成功后刷新书架，以更新书籍的阅读进度
      if (this.bookshelfProvider) {
        logger.info("刷新书架以更新阅读进度", "ReaderProvider");
        this.bookshelfProvider.refresh();
      }
    } catch (error) {
      logger.warn(`保存阅读进度失败: ${String(error)}`, "ReaderProvider");
      // 不显示错误消息给用户，避免打断阅读体验
    }
  }

  public async loadCurrentChapter() {
    if (!this.chapters[this.currentChapterIndex] || !this.currentBook) {
      logger.warn(
        `无法加载章节: chapters.length=${this.chapters?.length}, currentChapterIndex=${this.currentChapterIndex}, currentBook=${!!this.currentBook}`,
        "ReaderProvider"
      );
      return;
    }

    try {
      const chapter = this.chapters[this.currentChapterIndex];
      logger.info(
        `准备加载章节: ${chapter.title}, 索引: ${this.currentChapterIndex}`,
        "ReaderProvider"
      );

      // 优先从预加载缓存获取章节内容
      const content = await this.preloadManager.getChapterContent(
        this.currentBook.bookUrl,
        this.currentChapterIndex
      );

      logger.debug(`getBookContent返回的数据类型: ${typeof content}`, "ReaderProvider");
      logger.debug(
        `getBookContent返回的数据: ${JSON.stringify(content, null, 2)}`,
        "ReaderProvider"
      );

      // 使用章节列表中的标题覆盖API返回的标题
      // 确保content是对象且不是字符串，并且具有title属性
      if (
        chapter.title &&
        content &&
        typeof content === "object" &&
        !Array.isArray(content) &&
        typeof content !== "string"
      ) {
        logger.debug(`正在设置章节标题: ${chapter.title}`, "ReaderProvider");
        content.title = chapter.title;
      } else {
        logger.debug(
          `无法设置章节标题，content类型: ${typeof content}, chapter.title: ${chapter.title}`,
          "ReaderProvider"
        );
      }

      logger.info(`章节内容加载成功: ${content.title}`, "ReaderProvider");
      logger.debug(`章节内容长度: ${content.content?.length || 0} 字符`, "ReaderProvider");

      const messageData = {
        command: "updateChapter",
        data: {
          title: content.title,
          content: content.content,
          chapterIndex: this.currentChapterIndex,
          totalChapters: this.chapters.length,
          hasPrev: this.currentChapterIndex > 0,
          hasNext: this.currentChapterIndex < this.chapters.length - 1,
        },
      };

      logger.debug(
        `准备发送WebView消息: ${JSON.stringify(messageData, null, 2)}`,
        "ReaderProvider"
      );
      this._panel.webview.postMessage(messageData);
    } catch (error) {
      logger.error(error, "加载章节内容失败", "ReaderProvider");
      showFriendlyError("content", error, "ReaderProvider");
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
          case "readingProgress":
            this.handleReadingProgress(message.progress);
            break;
          case "ready":
            logger.debug("WebView已准备就绪", "ReaderProvider");
            // Apply stealth on ready
            try {
              const cfg = vscode.workspace.getConfiguration('readermate');
              const stealthEnabled = cfg.get<boolean>('stealth.enabled', true);
              const hideToolbar = cfg.get<boolean>('stealth.hideToolbar', true);
              const fontSize = cfg.get<number>('reader.fontSize', 16);
              this._panel.webview.postMessage({
                command: 'applyStealth',
                data: { stealthEnabled, hideToolbar, fontSize },
              });
            } catch {}
            break;
          case "panic":
            // Quick-close/boss key
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

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.css")
    );
    // Read font size for initial CSS var in case script is delayed
    const cfg = vscode.workspace.getConfiguration('readermate');
    const fontSize = cfg.get<number>('reader.fontSize', 16);

    return `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <style> :root { --reader-font-size: ${fontSize}px; } </style>
        <title>ReaderMate</title>
      </head>
      <body>
        <div class="reader-container">
          <div class="toolbar">
            <button id="prev-btn" class="nav-btn" disabled>上一章</button>
            <span id="chapter-info"></span>
            <button id="next-btn" class="nav-btn" disabled>下一章</button>
          </div>
          <div class="content-area">
            <div id="chapter-title"></div>
            <div id="chapter-content" class="content"></div>
          </div>
        </div>
        <script src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  public dispose() {
    ReaderProvider.currentPanel = undefined;

    // 清理预加载管理器资源
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
