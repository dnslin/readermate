import * as vscode from "vscode";
import { ReaderApiClient } from "./api/readerApi";
import { BookshelfProvider } from "./providers/bookshelfProvider";
import { ReaderProvider } from "./providers/readerProvider";
import { ReaderViewProvider } from "./providers/readerViewProvider";
import { PreloadConfig } from "./preload/types";
import { logger } from "./utils/logger";
import { showInfo } from "./utils/messages";

let apiClient: ReaderApiClient;
let bookshelfProvider: BookshelfProvider;
let readerViewProvider: ReaderViewProvider;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  // 创建输出通道
  outputChannel = vscode.window.createOutputChannel("ReaderMate");
  context.subscriptions.push(outputChannel);
  // 初始化统一日志
  logger.init(outputChannel, "info");
  logger.info("插件已激活", "Extension");

  // 显示激活消息
  showInfo("ReaderMate 插件已激活！");

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

  logger.info(`服务器地址: ${serverUrl}`, "Extension");
  logger.info(`用户名: ${username}`, "Extension");
  logger.info(`访问令牌: ${accessToken ? "已配置" : "未配置"}`, "Extension");

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

  // Create and register ReaderViewProvider for panel display
  readerViewProvider = new ReaderViewProvider(
    context.extensionUri,
    apiClient,
    bookshelfProvider,
    preloadConfig
  );
  
  // Register the webview view provider
  const readerViewDisposable = vscode.window.registerWebviewViewProvider(
    ReaderViewProvider.viewType,
    readerViewProvider
  );
  context.subscriptions.push(readerViewDisposable);
  
  // Set the static reference for access from other parts
  ReaderProvider.currentViewProvider = readerViewProvider;

  const commands = [
    vscode.commands.registerCommand("readermate.openBookshelf", () => {
      logger.info("执行打开书架命令", "Extension");
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

      logger.info("===== Current Effective Config =====", "Extension");
      logger.info(`serverUrl: ${serverUrl}`, "Extension");
      logger.info(`appendReader3Path: ${appendReader3Path}`, "Extension");
      logger.info(`computedBaseUrl: ${normalizedUrl}`, "Extension");
      logger.info(`username: ${username ?? "(not set)"}`, "Extension");
      logger.info(`token: ${maskedToken}`, "Extension");
      logger.info(`accessToken(computed): ${accessTokenState}`, "Extension");
      logger.info(
        `preload: enabled=${preloadEnabled}, chapterCount=${preloadChapterCount}, triggerProgress=${preloadTriggerProgress}, maxCacheSize=${preloadMaxCacheSize}`,
        "Extension"
      );
      logger.info("=====================================", "Extension");
      outputChannel.show(true);
      showInfo("ReaderMate：配置已输出到输出面板");
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

      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.updateApiClient(apiClient);
        ReaderProvider.currentPanel.updateBookshelfProvider(bookshelfProvider);
      }

      if (readerViewProvider) {
        readerViewProvider.updateApiClient(apiClient);
        readerViewProvider.updateBookshelfProvider(bookshelfProvider);
      }
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
    logger.info("配置变更事件触发", "Extension");

    // 检查API相关配置变更
    const apiConfigChanged =
      e.affectsConfiguration("readermate.serverUrl") ||
      e.affectsConfiguration("readermate.username") ||
      e.affectsConfiguration("readermate.token") ||
      e.affectsConfiguration("readermate.appendReader3Path");

    if (apiConfigChanged) {
      logger.info("检测到API相关配置变更", "Extension");

      const config = vscode.workspace.getConfiguration("readermate");
      const newUrl = config.get<string>("serverUrl", "");
      const newUsername = config.get<string>("username");
      const newToken = config.get<string>("token");
      const newAppendReader3Path = config.get<boolean>(
        "appendReader3Path",
        true
      );

      logger.info(
        `新配置值: serverUrl=${newUrl}, username=${newUsername}, token=${
          newToken ? "***已设置***" : "未设置"
        }, appendReader3Path=${newAppendReader3Path}`,
        "Extension"
      );

      // 构建新的 accessToken
      const newAccessToken =
        newUsername && newToken ? `${newUsername}:${newToken}` : undefined;

      logger.info("重新创建API客户端", "Extension");

      apiClient = new ReaderApiClient(
        newUrl,
        newAccessToken,
        outputChannel,
        newAppendReader3Path
      );

      // 更新现有的书架提供者的API客户端，而不是创建新实例
      logger.info("更新书架提供者的API客户端", "Extension");
      bookshelfProvider.updateApiClient(apiClient);

      // 如果当前有活动的阅读器，也需要更新其API客户端和书架提供者
      if (ReaderProvider.currentPanel) {
        logger.info("更新当前阅读器的API客户端", "Extension");
        ReaderProvider.currentPanel.updateApiClient(apiClient);
        ReaderProvider.currentPanel.updateBookshelfProvider(bookshelfProvider);
      }

      // 也要更新 ReaderViewProvider
      if (readerViewProvider) {
        logger.info("更新ReaderViewProvider的API客户端", "Extension");
        readerViewProvider.updateApiClient(apiClient);
        readerViewProvider.updateBookshelfProvider(bookshelfProvider);
      }

      logger.info("API客户端和书架提供者已更新", "Extension");
    }

    // 检查预加载配置变更
    const preloadConfigChanged =
      e.affectsConfiguration("readermate.preload.enabled") ||
      e.affectsConfiguration("readermate.preload.chapterCount") ||
      e.affectsConfiguration("readermate.preload.triggerProgress") ||
      e.affectsConfiguration("readermate.preload.maxCacheSize");

    if (preloadConfigChanged) {
      logger.info("检测到预加载配置变更", "Extension");

      const config = vscode.workspace.getConfiguration("readermate");
      const newPreloadConfig: PreloadConfig = {
        enabled: config.get<boolean>("preload.enabled", true),
        chapterCount: config.get<number>("preload.chapterCount", 2),
        triggerProgress: config.get<number>("preload.triggerProgress", 50),
        maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
      };

      logger.info(`新预加载配置: ${JSON.stringify(newPreloadConfig)}`, "Extension");

      // 通知当前活动的阅读器更新预加载配置
      if (ReaderProvider.currentPanel) {
        logger.info("更新当前阅读器的预加载配置", "Extension");
        ReaderProvider.currentPanel.updatePreloadConfig(newPreloadConfig);
      } else {
        logger.info("当前没有活动的阅读器面板", "Extension");
      }

      // 也要更新 ReaderViewProvider
      if (readerViewProvider) {
        logger.info("更新ReaderViewProvider的预加载配置", "Extension");
        readerViewProvider.updatePreloadConfig(newPreloadConfig);
      }
    }

    // 检查章节页显示位置配置变更
    const displayLocationChanged = e.affectsConfiguration("readermate.chapterDisplay.location");

    if (displayLocationChanged) {
      logger.info("检测到章节页显示位置配置变更", "Extension");

      const config = vscode.workspace.getConfiguration("readermate");
      const newPreloadConfig: PreloadConfig = {
        enabled: config.get<boolean>("preload.enabled", true),
        chapterCount: config.get<number>("preload.chapterCount", 2),
        triggerProgress: config.get<number>("preload.triggerProgress", 50),
        maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
      };

      // 如果有活动的阅读器，切换显示位置
      if (ReaderProvider.currentPanel || ReaderProvider.currentViewProvider) {
        logger.info("切换阅读器显示位置", "Extension");
        ReaderProvider.switchDisplayLocation(
          context.extensionUri,
          apiClient,
          bookshelfProvider,
          newPreloadConfig
        );
      } else {
        logger.info("当前没有活动的阅读器面板", "Extension");
      }
    }

    // 如果没有检测到任何相关配置变更
    if (!apiConfigChanged && !preloadConfigChanged && !displayLocationChanged) {
      logger.info("配置变更不影响ReaderMate相关设置", "Extension");
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
