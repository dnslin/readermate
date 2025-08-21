import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter, BookContent } from "../api/types";

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