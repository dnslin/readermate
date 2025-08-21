import * as vscode from "vscode";
import { ReaderApiClient } from "./api/readerApi";
import { BookshelfProvider } from "./providers/bookshelfProvider";
import { ReaderProvider } from "./providers/readerProvider";

let apiClient: ReaderApiClient;
let bookshelfProvider: BookshelfProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log("小说阅读器插件已激活");

  const config = vscode.workspace.getConfiguration("novelReader");
  const serverUrl = config.get<string>("serverUrl", "http://localhost:8080");
  const username = config.get<string>("username");

  apiClient = new ReaderApiClient(serverUrl, username);

  bookshelfProvider = new BookshelfProvider(apiClient);
  vscode.window.createTreeView("novelBookshelf", {
    treeDataProvider: bookshelfProvider,
    showCollapseAll: false,
  });

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

    vscode.window.registerWebviewPanelSerializer(
      "novelReader",
      new ReaderProvider({} as any, context.extensionUri, apiClient)
    ),
  ];

  context.subscriptions.push(...commands);

  vscode.commands.executeCommand("setContext", "novelReader.enabled", true);

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