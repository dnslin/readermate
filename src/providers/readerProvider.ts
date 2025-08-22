import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter, BookContent } from "../api/types";
import { BookshelfProvider } from "./bookshelfProvider";
import { PreloadManager } from "../preload/preloadManager";
import { PreloadConfig, ReadingProgressEvent } from "../preload/types";

export class ReaderProvider implements vscode.WebviewPanelSerializer {
  public static currentPanel: ReaderProvider | undefined;
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
    console.log("[ReaderProvider] 预加载配置已更新");
  }

  /**
   * 更新API客户端
   */
  public updateApiClient(apiClient: ReaderApiClient): void {
    console.log("[ReaderProvider] 开始更新API客户端");
    this.apiClient = apiClient;

    // 更新预加载管理器的API客户端
    this.preloadManager.updateApiClient(apiClient);

    console.log("[ReaderProvider] API客户端已更新");
  }

  /**
   * 更新书架提供者
   */
  public updateBookshelfProvider(bookshelfProvider: BookshelfProvider): void {
    console.log("[ReaderProvider] 更新书架提供者");
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
    console.log(
      `[ReaderProvider] 阅读进度更新: 第${
        this.currentChapterIndex + 1
      }章 ${progress}%`
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
    this._panel.title = `阅读: ${book.name}`;

    try {
      console.log(`开始获取章节列表: ${book.name}, bookUrl: ${book.bookUrl}`);
      this.chapters = await this.apiClient.getChapterList(book.bookUrl);
      console.log(`章节列表获取成功，共 ${this.chapters.length} 章`);

      // 使用书籍的阅读进度作为起始章节，如果没有则从第0章开始
      this.currentChapterIndex = book.durChapterIndex || 0;
      console.log(
        `设置起始章节索引: ${this.currentChapterIndex} (来自书籍进度: ${book.durChapterIndex})`
      );

      // 确保章节索引不超出范围
      if (this.currentChapterIndex >= this.chapters.length) {
        console.log(`章节索引超出范围，重置为0`);
        this.currentChapterIndex = 0;
      }

      await this.loadCurrentChapter();

      // 设置预加载管理器的当前书籍信息
      this.preloadManager.setCurrentBook(book.bookUrl, this.chapters.length);
    } catch (error) {
      console.error(`加载章节失败:`, error);
      vscode.window.showErrorMessage(`加载章节失败: ${error}`);
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
      console.log(
        `已保存阅读进度: 第${this.currentChapterIndex + 1}章 ${
          this.chapters[this.currentChapterIndex]?.title || "未知章节"
        }`
      );

      // 保存进度成功后刷新书架，以更新书籍的阅读进度
      if (this.bookshelfProvider) {
        console.log("刷新书架以更新阅读进度");
        this.bookshelfProvider.refresh();
      }
    } catch (error) {
      console.error(`保存阅读进度失败:`, error);
      // 不显示错误消息给用户，避免打断阅读体验
    }
  }

  private async loadCurrentChapter() {
    if (!this.chapters[this.currentChapterIndex] || !this.currentBook) {
      console.log(
        `无法加载章节: chapters.length=${
          this.chapters?.length
        }, currentChapterIndex=${this.currentChapterIndex}, currentBook=${!!this
          .currentBook}`
      );
      return;
    }

    try {
      const chapter = this.chapters[this.currentChapterIndex];
      console.log(
        `准备加载章节: ${chapter.title}, 索引: ${this.currentChapterIndex}`
      );

      // 优先从预加载缓存获取章节内容
      const content = await this.preloadManager.getChapterContent(
        this.currentBook.bookUrl,
        this.currentChapterIndex
      );

      console.log(`getBookContent返回的数据类型: ${typeof content}`);
      console.log(
        `getBookContent返回的数据: ${JSON.stringify(content, null, 2)}`
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
        console.log(`正在设置章节标题: ${chapter.title}`);
        content.title = chapter.title;
      } else {
        console.log(
          `无法设置章节标题，content类型: ${typeof content}, chapter.title: ${
            chapter.title
          }`
        );
      }

      console.log(`章节内容加载成功: ${content.title}`);
      console.log(`章节内容长度: ${content.content?.length || 0} 字符`);

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

      console.log(`准备发送WebView消息:`, JSON.stringify(messageData, null, 2));
      this._panel.webview.postMessage(messageData);
    } catch (error) {
      console.error(`加载章节内容失败:`, error);
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
          case "readingProgress":
            this.handleReadingProgress(message.progress);
            break;
          case "ready":
            console.log("WebView已准备就绪");
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
        <title>ReaderMate</title>
      </head>
      <body>
        <div class="reader-container">
          <div class="toolbar">
            <button id="prev-btn" class="nav-btn" disabled>上一章</button>
            <button id="next-btn" class="nav-btn" disabled>下一章</button>
          </div>
          <div class="content-area">
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
