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
  const token = config.get<string>("token");

  // 构建 accessToken，格式为 username:token
  const accessToken = username && token ? `${username}:${token}` : undefined;

  apiClient = new ReaderApiClient(serverUrl, accessToken);

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
    if (
      e.affectsConfiguration("novelReader.serverUrl") ||
      e.affectsConfiguration("novelReader.username") ||
      e.affectsConfiguration("novelReader.token")
    ) {
      const config = vscode.workspace.getConfiguration("novelReader");
      const newUrl = config.get<string>("serverUrl", "");
      const newUsername = config.get<string>("username");
      const newToken = config.get<string>("token");

      // 构建新的 accessToken
      const newAccessToken =
        newUsername && newToken ? `${newUsername}:${newToken}` : undefined;

      apiClient = new ReaderApiClient(newUrl, newAccessToken);
      bookshelfProvider = new BookshelfProvider(apiClient);
    }
  });
}

export function deactivate() {
  if (ReaderProvider.currentPanel) {
    ReaderProvider.currentPanel.dispose();
  }
}

