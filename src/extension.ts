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
  outputChannel = vscode.window.createOutputChannel("小说阅读器");
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine("小说阅读器插件已激活");
  console.log("小说阅读器插件已激活");

  // 显示激活消息
  vscode.window.showInformationMessage("小说阅读器插件已激活！");

  const config = vscode.workspace.getConfiguration("novelReader");
  const serverUrl = config.get<string>("serverUrl", "https://reader.kuku.me");
  const username = config.get<string>("username");
  const token = config.get<string>("token");

  // 读取预加载配置
  const preloadConfig: PreloadConfig = {
    enabled: config.get<boolean>("preload.enabled", true),
    chapterCount: config.get<number>("preload.chapterCount", 2),
    triggerProgress: config.get<number>("preload.triggerProgress", 80),
    wifiOnly: config.get<boolean>("preload.wifiOnly", false),
    maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
  };

  // 构建 accessToken，格式为 username:token
  const accessToken = username && token ? `${username}:${token}` : undefined;

  // 验证配置
  if (!serverUrl) {
    vscode.window.showWarningMessage("请先配置小说阅读器的服务器地址");
  }

  if (!accessToken) {
    vscode.window.showWarningMessage("请先配置小说阅读器的用户名和访问令牌");
  }

  outputChannel.appendLine(`服务器地址: ${serverUrl}`);
  outputChannel.appendLine(`用户名: ${username}`);
  outputChannel.appendLine(`访问令牌: ${accessToken ? "已配置" : "未配置"}`);

  apiClient = new ReaderApiClient(serverUrl, accessToken, outputChannel);

  bookshelfProvider = new BookshelfProvider(apiClient);
  vscode.window.createTreeView("novelBookshelf", {
    treeDataProvider: bookshelfProvider,
    showCollapseAll: false,
  });

  const commands = [
    vscode.commands.registerCommand("novelReader.openBookshelf", () => {
      console.log("执行打开书架命令");
      vscode.commands.executeCommand("novelBookshelf.focus");
    }),

    vscode.commands.registerCommand("novelReader.openReader", (book) => {
      ReaderProvider.createOrShow(
        context.extensionUri,
        apiClient,
        bookshelfProvider,
        preloadConfig,
        book
      );
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

      apiClient = new ReaderApiClient(newUrl, newAccessToken, outputChannel);
      bookshelfProvider = new BookshelfProvider(apiClient);
    }

    // 处理预加载配置变更
    if (
      e.affectsConfiguration("novelReader.preload.enabled") ||
      e.affectsConfiguration("novelReader.preload.chapterCount") ||
      e.affectsConfiguration("novelReader.preload.triggerProgress") ||
      e.affectsConfiguration("novelReader.preload.wifiOnly") ||
      e.affectsConfiguration("novelReader.preload.maxCacheSize")
    ) {
      const config = vscode.workspace.getConfiguration("novelReader");
      const newPreloadConfig: PreloadConfig = {
        enabled: config.get<boolean>("preload.enabled", true),
        chapterCount: config.get<number>("preload.chapterCount", 2),
        triggerProgress: config.get<number>("preload.triggerProgress", 80),
        wifiOnly: config.get<boolean>("preload.wifiOnly", false),
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
