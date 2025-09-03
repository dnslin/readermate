import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter } from "../api/types";
import { BookshelfProvider } from "./bookshelfProvider";
import { PreloadManager } from "../preload/preloadManager";
import { PreloadConfig, ReadingProgressEvent } from "../preload/types";
import { logger } from "../utils/logger";
import { showFriendlyError } from "../utils/messages";

export class ReaderViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "readermateReaderPanel";

  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;

  public currentBook?: Book;
  public chapters: Chapter[] = [];
  public currentChapterIndex = 0;
  private apiClient: ReaderApiClient;
  private bookshelfProvider?: BookshelfProvider;
  private preloadManager: PreloadManager;

  constructor(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider?: BookshelfProvider,
    preloadConfig?: PreloadConfig
  ) {
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
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "media"),
        vscode.Uri.joinPath(this._extensionUri, "out"),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
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
          logger.debug("WebView已准备就绪", "ReaderViewProvider");
          // Apply stealth on ready
          try {
            const cfg = vscode.workspace.getConfiguration('readermate');
            const stealthEnabled = cfg.get<boolean>('stealth.enabled', true);
            const hideToolbar = cfg.get<boolean>('stealth.hideToolbar', true);
            const fontSize = cfg.get<number>('reader.fontSize', 16);
            webviewView.webview.postMessage({
              command: 'applyStealth',
              data: { stealthEnabled, hideToolbar, fontSize },
            });
          } catch {}
          break;
        case "panic":
          // Quick-close/boss key
          try {
            vscode.commands.executeCommand("workbench.action.closePanel");
          } catch {}
          break;
      }
    });

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
    logger.info("预加载配置已更新", "ReaderViewProvider");
  }

  /**
   * 更新API客户端
   */
  public updateApiClient(apiClient: ReaderApiClient): void {
    logger.info("开始更新API客户端", "ReaderViewProvider");
    this.apiClient = apiClient;

    // 更新预加载管理器的API客户端
    this.preloadManager.updateApiClient(apiClient);

    logger.info("API客户端已更新", "ReaderViewProvider");
  }

  /**
   * 更新书架提供者
   */
  public updateBookshelfProvider(bookshelfProvider: BookshelfProvider): void {
    logger.info("更新书架提供者", "ReaderViewProvider");
    this.bookshelfProvider = bookshelfProvider;
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
      "ReaderViewProvider"
    );
  }

  public async openBook(book: Book) {
    if (!this._view) {
      return;
    }

    this.currentBook = book;

    try {
      logger.info(`开始获取章节列表: ${book.name}, bookUrl: ${book.bookUrl}`,
        "ReaderViewProvider");
      this.chapters = await this.apiClient.getChapterList(book.bookUrl);
      logger.info(`章节列表获取成功，共 ${this.chapters.length} 章`, "ReaderViewProvider");

      // 使用书籍的阅读进度作为起始章节，如果没有则从第0章开始
      this.currentChapterIndex = book.durChapterIndex || 0;
      logger.info(
        `设置起始章节索引: ${this.currentChapterIndex} (来自书籍进度: ${book.durChapterIndex})`,
        "ReaderViewProvider"
      );

      // 确保章节索引不超出范围
      if (this.currentChapterIndex >= this.chapters.length) {
        logger.warn("章节索引超出范围，重置为0", "ReaderViewProvider");
        this.currentChapterIndex = 0;
      }

      await this.loadCurrentChapter();

      // 设置预加载管理器的当前书籍信息
      this.preloadManager.setCurrentBook(book.bookUrl, this.chapters.length);
    } catch (error) {
      logger.error(error, "加载章节失败", "ReaderViewProvider");
      showFriendlyError("chapterList", error, "ReaderViewProvider");
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
        "ReaderViewProvider"
      );

      // 保存进度成功后刷新书架，以更新书籍的阅读进度
      if (this.bookshelfProvider) {
        logger.info("刷新书架以更新阅读进度", "ReaderViewProvider");
        this.bookshelfProvider.refresh();
      }
    } catch (error) {
      logger.warn(`保存阅读进度失败: ${String(error)}`, "ReaderViewProvider");
      // 不显示错误消息给用户，避免打断阅读体验
    }
  }

  public async loadCurrentChapter() {
    if (!this.chapters[this.currentChapterIndex] || !this.currentBook || !this._view) {
      logger.warn(
        `无法加载章节: chapters.length=${this.chapters?.length}, currentChapterIndex=${this.currentChapterIndex}, currentBook=${!!this.currentBook}, view=${!!this._view}`,
        "ReaderViewProvider"
      );
      return;
    }

    try {
      const chapter = this.chapters[this.currentChapterIndex];
      logger.info(
        `准备加载章节: ${chapter.title}, 索引: ${this.currentChapterIndex}`,
        "ReaderViewProvider"
      );

      // 优先从预加载缓存获取章节内容
      const content = await this.preloadManager.getChapterContent(
        this.currentBook.bookUrl,
        this.currentChapterIndex
      );

      logger.debug(`getBookContent返回的数据类型: ${typeof content}`, "ReaderViewProvider");
      logger.debug(
        `getBookContent返回的数据: ${JSON.stringify(content, null, 2)}`,
        "ReaderViewProvider"
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
        logger.debug(`正在设置章节标题: ${chapter.title}`, "ReaderViewProvider");
        content.title = chapter.title;
      } else {
        logger.debug(
          `无法设置章节标题，content类型: ${typeof content}, chapter.title: ${chapter.title}`,
          "ReaderViewProvider"
        );
      }

      logger.info(`章节内容加载成功: ${content.title}`, "ReaderViewProvider");
      logger.debug(`章节内容长度: ${content.content?.length || 0} 字符`, "ReaderViewProvider");

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
        "ReaderViewProvider"
      );
      this._view.webview.postMessage(messageData);
    } catch (error) {
      logger.error(error, "加载章节内容失败", "ReaderViewProvider");
      showFriendlyError("content", error, "ReaderViewProvider");
    }
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
        <style> 
          :root { --reader-font-size: ${fontSize}px; } 
          /* Panel view specific styles */
          .reader-container { height: 100%; }
          .content-area { max-width: none; padding: 16px; }
        </style>
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
    // 清理预加载管理器资源
    this.preloadManager.dispose();

    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerActive",
      false
    );
  }
}