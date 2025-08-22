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
  const serverUrl = config.get<string>("serverUrl", "https://reader.me");
  const username = config.get<string>("username");
  const token = config.get<string>("token");
  const appendReader3Path = config.get<boolean>("appendReader3Path", true);

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

  apiClient = new ReaderApiClient(
    serverUrl,
    accessToken,
    outputChannel,
    appendReader3Path
  );

  bookshelfProvider = new BookshelfProvider(apiClient);
  vscode.window.createTreeView("readermateBookshelf", {
    treeDataProvider: bookshelfProvider,
    showCollapseAll: false,
  });

  const commands = [
    vscode.commands.registerCommand("readermate.openBookshelf", () => {
      console.log("执行打开书架命令");
      // 聚焦到 Readermate 的书架视图
      vscode.commands.executeCommand("readermateBookshelf.focus");
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

    // 显示当前生效配置
    vscode.commands.registerCommand("readermate.showConfig", () => {
      const cfg = vscode.workspace.getConfiguration("readermate");
      const serverUrl = cfg.get<string>("serverUrl", "");
      const username = cfg.get<string>("username");
      const token = cfg.get<string>("token");
      const appendReader3Path = cfg.get<boolean>("appendReader3Path", true);
      const preloadEnabled = cfg.get<boolean>("preload.enabled", true);
      const preloadChapterCount = cfg.get<number>("preload.chapterCount", 2);
      const preloadTriggerProgress = cfg.get<number>(
        "preload.triggerProgress",
        50
      );
      const preloadMaxCacheSize = cfg.get<number>("preload.maxCacheSize", 10);

      // 计算实际使用的 baseUrl（模拟 ReaderApiClient 的标准化逻辑）
      let normalizedUrl = serverUrl.endsWith("/") ? serverUrl : serverUrl + "/";
      if (appendReader3Path && !normalizedUrl.includes("/reader3/")) {
        normalizedUrl = normalizedUrl + "reader3/";
      }

      const maskedToken = token ? "***" : "(not set)";
      const accessTokenState = username && token ? "set" : "not set";

      outputChannel.appendLine("[ReaderMate] ===== Current Effective Config =====");
      outputChannel.appendLine(`serverUrl: ${serverUrl}`);
      outputChannel.appendLine(`appendReader3Path: ${appendReader3Path}`);
      outputChannel.appendLine(`computedBaseUrl: ${normalizedUrl}`);
      outputChannel.appendLine(`username: ${username ?? "(not set)"}`);
      outputChannel.appendLine(`token: ${maskedToken}`);
      outputChannel.appendLine(`accessToken(computed): ${accessTokenState}`);
      outputChannel.appendLine(
        `preload: enabled=${preloadEnabled}, chapterCount=${preloadChapterCount}, triggerProgress=${preloadTriggerProgress}, maxCacheSize=${preloadMaxCacheSize}`
      );
      outputChannel.appendLine("[ReaderMate] =====================================");
      outputChannel.show(true);

      vscode.window.showInformationMessage("ReaderMate: 配置已输出到面板");
    }),

    vscode.commands.registerCommand("readermate.refreshBookshelf", () => {
      // 刷新前读取最新配置，确保使用最新的 serverUrl/凭证
      const cfg = vscode.workspace.getConfiguration("readermate");
      const newUrl = cfg.get<string>("serverUrl", "");
      const newUsername = cfg.get<string>("username");
      const newToken = cfg.get<string>("token");
      const newAppendReader3Path = cfg.get<boolean>("appendReader3Path", true);

      const newAccessToken =
        newUsername && newToken ? `${newUsername}:${newToken}` : undefined;

      apiClient = new ReaderApiClient(
        newUrl,
        newAccessToken,
        outputChannel,
        newAppendReader3Path
      );
      bookshelfProvider.updateApiClient(apiClient);
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

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    console.log("[Extension] 配置变更事件触发");
    outputChannel.appendLine("[Extension] 配置变更事件触发");

    // 检查API相关配置变更
    const apiConfigChanged =
      e.affectsConfiguration("readermate.serverUrl") ||
      e.affectsConfiguration("readermate.username") ||
      e.affectsConfiguration("readermate.token") ||
      e.affectsConfiguration("readermate.appendReader3Path");

    if (apiConfigChanged) {
      console.log("[Extension] 检测到API相关配置变更");
      outputChannel.appendLine("[Extension] 检测到API相关配置变更");

      const config = vscode.workspace.getConfiguration("readermate");
      const newUrl = config.get<string>("serverUrl", "");
      const newUsername = config.get<string>("username");
      const newToken = config.get<string>("token");
      const newAppendReader3Path = config.get<boolean>(
        "appendReader3Path",
        true
      );

      console.log("[Extension] 新配置值:", {
        serverUrl: newUrl,
        username: newUsername,
        token: newToken ? "***已设置***" : "未设置",
        appendReader3Path: newAppendReader3Path,
      });
      outputChannel.appendLine(
        `[Extension] 新配置值: serverUrl=${newUrl}, username=${newUsername}, token=${
          newToken ? "***已设置***" : "未设置"
        }, appendReader3Path=${newAppendReader3Path}`
      );

      // 构建新的 accessToken
      const newAccessToken =
        newUsername && newToken ? `${newUsername}:${newToken}` : undefined;

      console.log("[Extension] 重新创建API客户端");
      outputChannel.appendLine("[Extension] 重新创建API客户端");

      apiClient = new ReaderApiClient(
        newUrl,
        newAccessToken,
        outputChannel,
        newAppendReader3Path
      );

      // 更新现有的书架提供者的API客户端，而不是创建新实例
      console.log("[Extension] 更新书架提供者的API客户端");
      outputChannel.appendLine("[Extension] 更新书架提供者的API客户端");
      bookshelfProvider.updateApiClient(apiClient);

      // 如果当前有活动的阅读器，也需要更新其API客户端和书架提供者
      if (ReaderProvider.currentPanel) {
        console.log("[Extension] 更新当前阅读器的API客户端");
        outputChannel.appendLine("[Extension] 更新当前阅读器的API客户端");
        ReaderProvider.currentPanel.updateApiClient(apiClient);
        ReaderProvider.currentPanel.updateBookshelfProvider(bookshelfProvider);
      }

      console.log("[Extension] API客户端和书架提供者已更新");
      outputChannel.appendLine("[Extension] API客户端和书架提供者已更新");
    }

    // 检查预加载配置变更
    const preloadConfigChanged =
      e.affectsConfiguration("readermate.preload.enabled") ||
      e.affectsConfiguration("readermate.preload.chapterCount") ||
      e.affectsConfiguration("readermate.preload.triggerProgress") ||
      e.affectsConfiguration("readermate.preload.maxCacheSize");

    if (preloadConfigChanged) {
      console.log("[Extension] 检测到预加载配置变更");
      outputChannel.appendLine("[Extension] 检测到预加载配置变更");

      const config = vscode.workspace.getConfiguration("readermate");
      const newPreloadConfig: PreloadConfig = {
        enabled: config.get<boolean>("preload.enabled", true),
        chapterCount: config.get<number>("preload.chapterCount", 2),
        triggerProgress: config.get<number>("preload.triggerProgress", 50),
        maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
      };

      console.log("[Extension] 新预加载配置:", newPreloadConfig);
      outputChannel.appendLine(
        `[Extension] 新预加载配置: ${JSON.stringify(newPreloadConfig)}`
      );

      // 通知当前活动的阅读器更新预加载配置
      if (ReaderProvider.currentPanel) {
        console.log("[Extension] 更新当前阅读器的预加载配置");
        outputChannel.appendLine("[Extension] 更新当前阅读器的预加载配置");
        ReaderProvider.currentPanel.updatePreloadConfig(newPreloadConfig);
      } else {
        console.log("[Extension] 当前没有活动的阅读器面板");
        outputChannel.appendLine("[Extension] 当前没有活动的阅读器面板");
      }
    }

    // 如果没有检测到任何相关配置变更
    if (!apiConfigChanged && !preloadConfigChanged) {
      console.log("[Extension] 配置变更不影响ReaderMate相关设置");
      outputChannel.appendLine("[Extension] 配置变更不影响ReaderMate相关设置");
    }
  });

  // 确保在扩展停用时正确清理监听器
  context.subscriptions.push(configChangeDisposable);
}

export function deactivate() {
  if (ReaderProvider.currentPanel) {
    ReaderProvider.currentPanel.dispose();
  }
}
