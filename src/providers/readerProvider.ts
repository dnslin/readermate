import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book } from "../api/types";
import { BookshelfProvider } from "./bookshelfProvider";
import { ReaderViewProvider } from "./readerViewProvider";
import { BaseReaderController } from "./baseReaderController";
import { PreloadConfig } from "../preload/types";
import { logger } from "../utils/logger";

export class ReaderProvider extends BaseReaderController {
  public static currentPanel: ReaderProvider | undefined;
  public static currentViewProvider: ReaderViewProvider | undefined;
  public static readonly viewType = "readermate";

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider: BookshelfProvider,
    preloadConfig: PreloadConfig,
    book?: Book,
    chapterIndex?: number
  ) {
    const cfg = vscode.workspace.getConfiguration("readermate");
    const displayLocation = cfg.get<string>(
      "chapterDisplay.location",
      "sidebar"
    );

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
    super(extensionUri, apiClient, bookshelfProvider, preloadConfig);
    this._panel = panel;
    this._initPanel();
  }

  public getWebview(): vscode.Webview {
    return this._panel.webview;
  }

  public updateTitle(stealthTitle?: string): void {
    this._panel.title =
      stealthTitle ||
      (this.currentBook ? `阅读: ${this.currentBook.name}` : "小说阅读器");
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

  private _initPanel() {
    const webview = this._panel.webview;
    webview.html = this.getHtmlForWebview(webview);

    webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.onDidChangeViewState(
      (e) => {
        vscode.commands.executeCommand(
          "setContext",
          "readermate.readerFocused",
          e.webviewPanel.active
        );
      },
      null,
      this._disposables
    );

    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerActive",
      true
    );
    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerFocused",
      true
    );
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
    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerFocused",
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
    state: any
  ) {
    logger.info("正在恢复阅读器面板", "ReaderPanelSerializer");
    ReaderProvider.revive(
      webviewPanel,
      this.extensionUri,
      this.getApiClient(),
      this.getBookshelfProvider(),
      this.getPreloadConfig()
    );

    if (state && state.book) {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.openBook(state.book, state.chapterIndex);
      }
    }
  }
}
