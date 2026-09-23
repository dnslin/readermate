import * as vscode from "vscode";
import { ReaderApiClient } from "./api/readerApi";
import { Book } from "./api/types";
import { BookshelfProvider } from "./providers/bookshelfProvider";
import {
  ReaderProvider,
  ReaderPanelSerializer,
} from "./providers/readerProvider";
import { ReaderViewProvider } from "./providers/readerViewProvider";
import { BaseReaderController } from "./providers/baseReaderController";
import { CommentReaderController } from "./stealth/commentReaderController";
import { PreloadManager } from "./preload/preloadManager";
import { PreloadConfig } from "./preload/types";
import { logger } from "./utils/logger";
import { showInfo } from "./utils/messages";

let apiClient: ReaderApiClient;
let bookshelfProvider: BookshelfProvider;
let readerViewProvider: ReaderViewProvider;
let commentReaderController: CommentReaderController;
let preloadManager: PreloadManager;
let outputChannel: vscode.OutputChannel;

function getPreloadConfig(): PreloadConfig {
  const config = vscode.workspace.getConfiguration("readermate");
  return {
    enabled: config.get<boolean>("preload.enabled", true),
    chapterCount: config.get<number>("preload.chapterCount", 2),
    triggerProgress: config.get<number>("preload.triggerProgress", 50),
    maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
  };
}

function createApiClient(channel: vscode.OutputChannel): ReaderApiClient {
  const config = vscode.workspace.getConfiguration("readermate");
  const serverUrl = config.get<string>("serverUrl", "https://reader.me");
  const username = config.get<string>("username");
  const token = config.get<string>("token");
  const appendReader3Path = config.get<boolean>("appendReader3Path", true);

  const accessToken = username && token ? `${username}:${token}` : undefined;
  return new ReaderApiClient(
    serverUrl,
    accessToken,
    channel,
    appendReader3Path
  );
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("ReaderMate");
  context.subscriptions.push(outputChannel);

  logger.init(outputChannel, "info");
  logger.info("ReaderMate 插件已激活", "Extension");

  const config = vscode.workspace.getConfiguration("readermate");
  const serverUrl = config.get<string>("serverUrl", "");
  const username = config.get<string>("username");
  const token = config.get<string>("token");

  if (!serverUrl || !username || !token) {
    vscode.window
      .showWarningMessage(
        "ReaderMate：尚未配置完整的 Reader3 服务器信息（地址、用户名或 Token）。",
        "立即配置"
      )
      .then((selection) => {
        if (selection === "立即配置") {
          vscode.commands.executeCommand("readermate.configure");
        }
      });
  }

  apiClient = createApiClient(outputChannel);
  bookshelfProvider = new BookshelfProvider(apiClient);

  vscode.window.createTreeView("readermateBookshelf", {
    treeDataProvider: bookshelfProvider,
    showCollapseAll: false,
  });

  readerViewProvider = new ReaderViewProvider(
    context.extensionUri,
    apiClient,
    bookshelfProvider,
    getPreloadConfig()
  );

  const readerViewDisposable = vscode.window.registerWebviewViewProvider(
    ReaderViewProvider.viewType,
    readerViewProvider
  );
  context.subscriptions.push(readerViewDisposable);

  ReaderProvider.currentViewProvider = readerViewProvider;

  const serializer = new ReaderPanelSerializer(
    context.extensionUri,
    () => apiClient,
    () => bookshelfProvider,
    () => getPreloadConfig()
  );
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      ReaderProvider.viewType,
      serializer
    )
  );

  preloadManager = new PreloadManager(apiClient, getPreloadConfig());
  commentReaderController = new CommentReaderController(
    context,
    apiClient,
    bookshelfProvider,
    preloadManager
  );
  context.subscriptions.push(commentReaderController);
  const commands = [
    vscode.commands.registerCommand("readermate.openBookshelf", () => {
      logger.info("执行打开书架命令", "Extension");
      vscode.commands.executeCommand("readermateBookshelf.focus");
    }),

    vscode.commands.registerCommand(
      "readermate.openReader",
      async (book?: Book, chapterIndex?: number) => {
        if (book) {
          commentReaderController.setBook(book, chapterIndex || 0);
          ReaderProvider.createOrShow(
            context.extensionUri,
            apiClient,
            bookshelfProvider,
            getPreloadConfig(),
            book,
            chapterIndex
          );
          return;
        }

        const books = bookshelfProvider.getBooks();
        if (books.length === 0) {
          vscode.window.showInformationMessage("书架中暂无书籍，请先在 Reader3 添加书籍或刷新书架");
          return;
        }

        const picked = await vscode.window.showQuickPick(
          books.map((b) => ({
            label: b.name,
            description: `${b.author} · ${b.lastChapter || ""}`,
            book: b,
          })),
          { placeHolder: "选择要阅读的书籍" }
        );

        if (picked) {
          commentReaderController.setBook(picked.book);
          ReaderProvider.createOrShow(
            context.extensionUri,
            apiClient,
            bookshelfProvider,
            getPreloadConfig(),
            picked.book
          );
        }
      }
    ),

    vscode.commands.registerCommand("readermate.selectChapter", async () => {
      if (ReaderProvider.currentPanel) {
        await ReaderProvider.currentPanel.selectChapter();
        return;
      }
      if (
        readerViewProvider &&
        readerViewProvider.currentBook &&
        readerViewProvider.chapters.length > 0
      ) {
        await readerViewProvider.selectChapter();
        return;
      }

      const books = bookshelfProvider.getBooks();
      if (books.length === 0) {
        vscode.window.showInformationMessage("书架为空或尚未加载完成");
        return;
      }

      const pickedBook = await vscode.window.showQuickPick(
        books.map((b) => ({
          label: b.name,
          description: b.author,
          book: b,
        })),
        { placeHolder: "选择查看目录的书籍" }
      );

      if (!pickedBook) return;

      try {
        const chapters = await bookshelfProvider.getChapterList(
          pickedBook.book.bookUrl
        );
        const pickedChapter = await vscode.window.showQuickPick(
          chapters.map((ch) => ({
            label: ch.title,
            description:
              ch.index === pickedBook.book.durChapterIndex
                ? "上次阅读位置"
                : undefined,
            index: ch.index,
          })),
          { placeHolder: `《${pickedBook.book.name}》目录（共 ${chapters.length} 章）` }
        );

        if (pickedChapter) {
          ReaderProvider.createOrShow(
            context.extensionUri,
            apiClient,
            bookshelfProvider,
            getPreloadConfig(),
            pickedBook.book,
            pickedChapter.index
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage("获取目录失败，请检查网络");
      }
    }),

    vscode.commands.registerCommand("readermate.prevChapter", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.prevChapter();
      } else if (readerViewProvider) {
        readerViewProvider.prevChapter();
      }
    }),

    vscode.commands.registerCommand("readermate.nextChapter", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.nextChapter();
      } else if (readerViewProvider) {
        readerViewProvider.nextChapter();
      }
    }),

    vscode.commands.registerCommand("readermate.bossKey", () => {
      logger.info("执行老板键命令", "Extension");
      if (commentReaderController) {
        commentReaderController.hide();
      }
      BaseReaderController.handleBossKey();
    }),

    vscode.commands.registerCommand("readermate.commentReader.toggle", () => {
      logger.info("执行切换注释伪装阅读命令", "Extension");
      commentReaderController.toggle();
    }),

    vscode.commands.registerCommand(
      "readermate.commentReader.holdTrigger",
      () => {
        commentReaderController.handleHoldTrigger();
      }
    ),

    vscode.commands.registerCommand("readermate.commentReader.next", () => {
      commentReaderController.next();
    }),

    vscode.commands.registerCommand("readermate.commentReader.prev", () => {
      commentReaderController.prev();
    }),

    vscode.commands.registerCommand(
      "readermate.commentReader.selectChapter",
      () => {
        logger.info("执行注释阅读快速选章命令", "Extension");
        commentReaderController.selectChapterQuickPick();
      }
    ),

    vscode.commands.registerCommand("readermate.commentReader.hide", () => {
      commentReaderController.hide();
    }),

    vscode.commands.registerCommand(
      "readermate.commentReader.openBook",
      async (book?: Book, chapterIndex?: number) => {
        if (book) {
          await commentReaderController.setBook(book, chapterIndex || 0);
          await commentReaderController.show();
          return;
        }

        const books = bookshelfProvider.getBooks();
        if (books.length === 0) {
          vscode.window.showInformationMessage(
            "书架中暂无书籍，请先在 Reader3 添加书籍或刷新书架"
          );
          return;
        }

        const picked = await vscode.window.showQuickPick(
          books.map((b) => ({
            label: b.name,
            description: `${b.author} · ${b.lastChapter || ""}`,
            book: b,
          })),
          { placeHolder: "选择要在代码注释中阅读的书籍" }
        );

        if (picked) {
          await commentReaderController.setBook(picked.book);
          await commentReaderController.show();
        }
      }
    ),
    vscode.commands.registerCommand("readermate.closePanelIfOpen", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.dispose();
      }
    }),

    vscode.commands.registerCommand("readermate.refreshBookshelf", () => {
      apiClient = createApiClient(outputChannel);
      bookshelfProvider.updateApiClient(apiClient);

      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.updateApiClient(apiClient);
        ReaderProvider.currentPanel.updateBookshelfProvider(bookshelfProvider);
      }

      if (readerViewProvider) {
        readerViewProvider.updateApiClient(apiClient);
        readerViewProvider.updateBookshelfProvider(bookshelfProvider);
      }
      showInfo("ReaderMate 书架与配置已刷新");
    }),

    vscode.commands.registerCommand("readermate.configure", async () => {
      const cfg = vscode.workspace.getConfiguration("readermate");
      const currentUrl = cfg.get<string>("serverUrl", "https://reader.me");
      const currentUsername = cfg.get<string>("username", "");
      const currentToken = cfg.get<string>("token", "");

      const serverUrl = await vscode.window.showInputBox({
        title: "ReaderMate 配置向导 (1/3)",
        prompt: "请输入 Reader3 服务器地址",
        value: currentUrl,
        ignoreFocusOut: true,
      });
      if (serverUrl === undefined) return;

      const username = await vscode.window.showInputBox({
        title: "ReaderMate 配置向导 (2/3)",
        prompt: "请输入 Reader3 账户用户名",
        value: currentUsername,
        ignoreFocusOut: true,
      });
      if (username === undefined) return;

      const token = await vscode.window.showInputBox({
        title: "ReaderMate 配置向导 (3/3)",
        prompt: "请输入 Reader3 访问令牌 (Token)",
        value: currentToken,
        password: true,
        ignoreFocusOut: true,
      });
      if (token === undefined) return;

      await cfg.update(
        "serverUrl",
        serverUrl.trim(),
        vscode.ConfigurationTarget.Global
      );
      await cfg.update(
        "username",
        username.trim(),
        vscode.ConfigurationTarget.Global
      );
      await cfg.update(
        "token",
        token.trim(),
        vscode.ConfigurationTarget.Global
      );

      vscode.commands.executeCommand("readermate.refreshBookshelf");
      vscode.window.showInformationMessage(
        "ReaderMate 配置已保存，正在重新加载书架..."
      );
    }),

    vscode.commands.registerCommand("readermate.showConfig", () => {
      const cfg = vscode.workspace.getConfiguration("readermate");
      const currentUrl = cfg.get<string>("serverUrl", "");
      const currentUsername = cfg.get<string>("username", "");
      const token = cfg.get<string>("token", "");
      const appendReader3Path = cfg.get<boolean>("appendReader3Path", true);
      const preloadCfg = getPreloadConfig();

      logger.info("===== 当前 ReaderMate 生效配置 =====", "Extension");
      logger.info(`服务器地址: ${currentUrl}`, "Extension");
      logger.info(`自动追加 /reader3: ${appendReader3Path}`, "Extension");
      logger.info(`用户名: ${currentUsername || "(未配置)"}`, "Extension");
      logger.info(`访问令牌: ${token ? "***已配置***" : "(未配置)"}`, "Extension");
      logger.info(
        `预加载: 启用=${preloadCfg.enabled}, 章节数=${preloadCfg.chapterCount}, 触发进度=${preloadCfg.triggerProgress}%, 最大缓存=${preloadCfg.maxCacheSize}`,
        "Extension"
      );
      logger.info("====================================", "Extension");
      outputChannel.show(true);
      showInfo("ReaderMate 配置已输出到控制台面板");
    }),
  ];

  context.subscriptions.push(...commands);
  vscode.commands.executeCommand("setContext", "readermate.enabled", true);

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
    (e) => {
      const apiConfigChanged =
        e.affectsConfiguration("readermate.serverUrl") ||
        e.affectsConfiguration("readermate.username") ||
        e.affectsConfiguration("readermate.token") ||
        e.affectsConfiguration("readermate.appendReader3Path");

      if (apiConfigChanged) {
        logger.info("检测到 API 相关配置变更，重建客户端", "Extension");
        apiClient = createApiClient(outputChannel);
        bookshelfProvider.updateApiClient(apiClient);

        if (ReaderProvider.currentPanel) {
          ReaderProvider.currentPanel.updateApiClient(apiClient);
          ReaderProvider.currentPanel.updateBookshelfProvider(bookshelfProvider);
        }

        if (readerViewProvider) {
          readerViewProvider.updateApiClient(apiClient);
          readerViewProvider.updateBookshelfProvider(bookshelfProvider);
        }

        if (commentReaderController) {
          commentReaderController.updateApiClient(apiClient);
        }
      }

      const preloadConfigChanged =
        e.affectsConfiguration("readermate.preload.enabled") ||
        e.affectsConfiguration("readermate.preload.chapterCount") ||
        e.affectsConfiguration("readermate.preload.triggerProgress") ||
        e.affectsConfiguration("readermate.preload.maxCacheSize");

      if (preloadConfigChanged) {
        const newPreload = getPreloadConfig();
        if (ReaderProvider.currentPanel) {
          ReaderProvider.currentPanel.updatePreloadConfig(newPreload);
        }
        if (readerViewProvider) {
          readerViewProvider.updatePreloadConfig(newPreload);
        }
        if (commentReaderController) {
          commentReaderController.updatePreloadConfig(newPreload);
        }
      }

      const styleConfigChanged =
        e.affectsConfiguration("readermate.reader.fontSize") ||
        e.affectsConfiguration("readermate.reader.lineHeight") ||
        e.affectsConfiguration("readermate.stealth.enabled") ||
        e.affectsConfiguration("readermate.stealth.hideToolbar") ||
        e.affectsConfiguration("readermate.stealth.disguiseTitle");

      if (styleConfigChanged) {
        logger.info("检测到外观或隐身配置变更，热更新视图", "Extension");
        if (ReaderProvider.currentPanel) {
          ReaderProvider.currentPanel.applySettings();
        }
        if (readerViewProvider) {
          readerViewProvider.applySettings();
        }
      }

      const displayLocationChanged = e.affectsConfiguration(
        "readermate.chapterDisplay.location"
      );

      if (displayLocationChanged) {
        logger.info("检测到章节显示位置变更", "Extension");
        if (ReaderProvider.currentPanel || ReaderProvider.currentViewProvider) {
          ReaderProvider.switchDisplayLocation(
            context.extensionUri,
            apiClient,
            bookshelfProvider,
            getPreloadConfig()
          );
        }
      }
    }
  );

  context.subscriptions.push(configChangeDisposable);
}

export function deactivate() {
  if (ReaderProvider.currentPanel) {
    ReaderProvider.currentPanel.dispose();
  }
}
