import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book } from "../api/types";
import { BookshelfProvider } from "./bookshelfProvider";
import { BaseReaderController } from "./baseReaderController";
import { PreloadConfig } from "../preload/types";

export class ReaderViewProvider
  extends BaseReaderController
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "readermateReaderPanel";

  private _view?: vscode.WebviewView;
  private _pendingBook?: { book: Book; chapterIndex?: number };

  constructor(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider?: BookshelfProvider,
    preloadConfig?: PreloadConfig
  ) {
    super(extensionUri, apiClient, bookshelfProvider, preloadConfig);
  }

  public getWebview(): vscode.Webview | undefined {
    return this._view?.webview;
  }

  public updateTitle(stealthTitle?: string): void {
    if (this._view) {
      this._view.description =
        stealthTitle ||
        (this.currentBook ? this.currentBook.name : undefined);
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    this._isWebviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "media"),
        vscode.Uri.joinPath(this._extensionUri, "out"),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleWebviewMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      vscode.commands.executeCommand(
        "setContext",
        "readermate.readerFocused",
        webviewView.visible
      );
    });

    webviewView.onDidDispose(() => {
      this.dispose();
    });

    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerActive",
      true
    );
    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerFocused",
      webviewView.visible
    );

    if (this._pendingBook) {
      const { book, chapterIndex } = this._pendingBook;
      this._pendingBook = undefined;
      this.openBook(book, chapterIndex);
    }
  }

  public override async openBook(book: Book, chapterIndex?: number): Promise<void> {
    if (!this._view) {
      this._pendingBook = { book, chapterIndex };
      vscode.commands.executeCommand("readermateReaderPanel.focus");
      return;
    }
    return super.openBook(book, chapterIndex);
  }

  public dispose() {
    this.preloadManager.dispose();
    this._view = undefined;
    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerFocused",
      false
    );
  }
}
