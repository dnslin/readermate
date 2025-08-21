import * as vscode from "vscode";
import { ReaderApiClient } from "./api/readerApi";
import { BookshelfProvider } from "./providers/bookshelfProvider";
import { ReaderProvider } from "./providers/readerProvider";
import { PreloadConfig } from "./preload/types";

let apiClient: ReaderApiClient;
let bookshelfProvider: BookshelfProvider;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  // 创建输出通道
  outputChannel = vscode.window.createOutputChannel("ReaderMate");
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine("ReaderMate插件已激活");
  console.log("ReaderMate插件已激活");

  // 显示激活消息
  vscode.window.showInformationMessage("ReaderMate插件已激活！");

  const config = vscode.workspace.getConfiguration("readermate");
  const serverUrl = config.get<string>("serverUrl", "https://reader.kuku.me");
  const username = config.get<string>("username");
  const token = config.get<string>("token");

  // 读取预加载配置
  const preloadConfig: PreloadConfig = {
    enabled: config.get<boolean>("preload.enabled", true),
    chapterCount: config.get<number>("preload.chapterCount", 2),
    triggerProgress: config.get<number>("preload.triggerProgress", 50),
    maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
  };

  // 构建 accessToken，格式为 username:token
  const accessToken = username && token ? `${username}:${token}` : undefined;

  // 验证配置
  if (!serverUrl) {
    vscode.window.showWarningMessage("请先配置ReaderMate的服务器地址");
  }

  if (!accessToken) {
    vscode.window.showWarningMessage("请先配置ReaderMate的用户名和访问令牌");
  }

  outputChannel.appendLine(`服务器地址: ${serverUrl}`);
  outputChannel.appendLine(`用户名: ${username}`);
  outputChannel.appendLine(`访问令牌: ${accessToken ? "已配置" : "未配置"}`);

  apiClient = new ReaderApiClient(serverUrl, accessToken, outputChannel);

  bookshelfProvider = new BookshelfProvider(apiClient);
  vscode.window.createTreeView("readermateBookshelf", {
    treeDataProvider: bookshelfProvider,
    showCollapseAll: false,
  });

  const commands = [
    vscode.commands.registerCommand("readermate.openBookshelf", () => {
      console.log("执行打开书架命令");
      vscode.commands.executeCommand("novelBookshelf.focus");
    }),

    vscode.commands.registerCommand("readermate.openReader", (book) => {
      ReaderProvider.createOrShow(
        context.extensionUri,
        apiClient,
        bookshelfProvider,
        preloadConfig,
        book
      );
    }),

    vscode.commands.registerCommand("readermate.refreshBookshelf", () => {
      bookshelfProvider.refresh();
    }),

    vscode.commands.registerCommand("readermate.prevChapter", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.prevChapter();
      }
    }),

    vscode.commands.registerCommand("readermate.nextChapter", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.nextChapter();
      }
    }),

    vscode.window.registerWebviewPanelSerializer(
      "readermate",
      new ReaderProvider(
        {} as any,
        context.extensionUri,
        apiClient,
        undefined,
        preloadConfig
      )
    ),
  ];

  context.subscriptions.push(...commands);

  vscode.commands.executeCommand("setContext", "readermate.enabled", true);

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration("readermate.serverUrl") ||
      e.affectsConfiguration("readermate.username") ||
      e.affectsConfiguration("readermate.token")
    ) {
      const config = vscode.workspace.getConfiguration("readermate");
      const newUrl = config.get<string>("serverUrl", "");
      const newUsername = config.get<string>("username");
      const newToken = config.get<string>("token");

      // 构建新的 accessToken
      const newAccessToken =
        newUsername && newToken ? `${newUsername}:${newToken}` : undefined;

      apiClient = new ReaderApiClient(newUrl, newAccessToken, outputChannel);
      bookshelfProvider = new BookshelfProvider(apiClient);
    }

    // 处理预加载配置变更
    if (
      e.affectsConfiguration("readermate.preload.enabled") ||
      e.affectsConfiguration("readermate.preload.chapterCount") ||
      e.affectsConfiguration("readermate.preload.triggerProgress") ||
      e.affectsConfiguration("readermate.preload.maxCacheSize")
    ) {
      const config = vscode.workspace.getConfiguration("readermate");
      const newPreloadConfig: PreloadConfig = {
        enabled: config.get<boolean>("preload.enabled", true),
        chapterCount: config.get<number>("preload.chapterCount", 2),
        triggerProgress: config.get<number>("preload.triggerProgress", 50),
        maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
      };

      // 通知当前活动的阅读器更新预加载配置
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.updatePreloadConfig(newPreloadConfig);
      }

      console.log("[Extension] 预加载配置已更新:", newPreloadConfig);
    }
  });
}

export function deactivate() {
  if (ReaderProvider.currentPanel) {
    ReaderProvider.currentPanel.dispose();
  }
}
