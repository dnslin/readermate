import * as vscode from "vscode";
import { ReaderApiClient } from "./api/readerApi";
import { Book, ReaderBackendConfig } from "./api/types";
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

function extractBookAndChapter(target?: unknown): {
  book?: Book;
  chapterIndex?: number;
} {
  if (!target || typeof target !== "object") {
    return {};
  }

  if ("book" in target) {
    const candidateBook = (target as Record<string, unknown>).book;
    if (
      candidateBook &&
      typeof candidateBook === "object" &&
      "bookUrl" in candidateBook &&
      typeof (candidateBook as Record<string, unknown>).bookUrl === "string"
    ) {
      const book = candidateBook as Book;
      let chapterIndex = book.durChapterIndex || 0;
      if ("chapter" in target) {
        const candidateChapter = (target as Record<string, unknown>).chapter;
        if (
          candidateChapter &&
          typeof candidateChapter === "object" &&
          "index" in candidateChapter &&
          typeof (candidateChapter as Record<string, unknown>).index === "number"
        ) {
          chapterIndex = (candidateChapter as { index: number }).index;
        }
      }
      return { book, chapterIndex };
    }
  }

  if (
    "bookUrl" in target &&
    typeof (target as Record<string, unknown>).bookUrl === "string"
  ) {
    const book = target as Book;
    return {
      book,
      chapterIndex: book.durChapterIndex || 0,
    };
  }

  return {};
}

function getPreloadConfig(): PreloadConfig {
  const config = vscode.workspace.getConfiguration("readermate");
  return {
    enabled: config.get<boolean>("preload.enabled", true),
    chapterCount: config.get<number>("preload.chapterCount", 2),
    triggerProgress: config.get<number>("preload.triggerProgress", 50),
    maxCacheSize: config.get<number>("preload.maxCacheSize", 10),
  };
}

function getBackendConfig(): ReaderBackendConfig {
  const config = vscode.workspace.getConfiguration("readermate");
  if (config.get<string>("backend", "reader3") === "legado") {
    return {
      backend: "legado",
      serverUrl: config.get<string>("legado.serverUrl", "https://legado.kuku.me"),
      apiKey: config.get<string>("legado.apiKey", ""),
    };
  }
  const username = config.get<string>("username", "");
  const token = config.get<string>("token", "");
  return {
    backend: "reader3",
    serverUrl: config.get<string>("serverUrl", "https://reader.me"),
    accessToken: username && token ? `${username}:${token}` : undefined,
    appendReader3Path: config.get<boolean>("appendReader3Path", true),
  };
}

function replaceApiClient(): void {
  apiClient.dispose();
  apiClient = new ReaderApiClient(getBackendConfig());
  ReaderProvider.currentPanel?.updateApiClient(apiClient);
  readerViewProvider.updateApiClient(apiClient);
  commentReaderController.updateApiClient(apiClient);
  bookshelfProvider.updateApiClient(apiClient);
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("ReaderMate");
  context.subscriptions.push(outputChannel);

  logger.init(outputChannel, "info");
  logger.info("ReaderMate 插件已激活", "Extension");

  const backendConfig = getBackendConfig();
  const missingConfig = !backendConfig.serverUrl ||
    (backendConfig.backend === "legado" ? !backendConfig.apiKey : !backendConfig.accessToken);

  if (missingConfig) {
    vscode.window
      .showWarningMessage(
        backendConfig.backend === "legado"
          ? "ReaderMate：请配置 Legado 服务器地址和 API Key。"
          : "ReaderMate：请配置 Reader3 服务器地址、用户名和 Token。",
        "立即配置"
      )
      .then((selection) => {
        if (selection === "立即配置") {
          vscode.commands.executeCommand("readermate.configure");
        }
      });
  }

  apiClient = new ReaderApiClient(backendConfig);
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
      async (bookOrItem?: unknown, chapterIndex?: number) => {
        const extracted = extractBookAndChapter(bookOrItem);
        const book = extracted.book;
        const index = chapterIndex ?? extracted.chapterIndex ?? 0;

        if (book) {
          if (!apiClient.ownsBook(book)) return;
          commentReaderController.setBook(book, index);
          ReaderProvider.createOrShow(
            context.extensionUri,
            apiClient,
            bookshelfProvider,
            getPreloadConfig(),
            book,
            index
          );
          return;
        }
        const books = bookshelfProvider.getBooks();
        if (books.length === 0) {
          vscode.window.showInformationMessage("书架中暂无书籍，请先在当前后端添加书籍或刷新书架");
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

        if (picked && apiClient.ownsBook(picked.book)) {
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

      if (!pickedBook || !apiClient.ownsBook(pickedBook.book)) return;

      try {
        const client = apiClient;
        const chapters = await bookshelfProvider.getChapterList(
          pickedBook.book.bookUrl
        );
        if (client !== apiClient || !client.isActive) return;
        const pickedChapter = await vscode.window.showQuickPick(
          chapters.filter((ch) => !ch.isVolume).map((ch) => ({
            label: ch.title,
            description:
              ch.index === pickedBook.book.durChapterIndex
                ? "上次阅读位置"
                : undefined,
            index: ch.index,
          })),
          { placeHolder: `《${pickedBook.book.name}》目录（共 ${chapters.length} 章）` }
        );

        if (pickedChapter && client === apiClient && client.isActive) {
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
        if (!apiClient.ownsBook(pickedBook.book)) return;
        vscode.window.showErrorMessage("获取目录失败，请检查网络");
      }
    }),

    vscode.commands.registerCommand("readermate.prevChapter", () => {
      if (ReaderProvider.currentPanel) {
        return ReaderProvider.currentPanel.prevChapter();
      } else if (readerViewProvider) {
        return readerViewProvider.prevChapter();
      }
    }),

    vscode.commands.registerCommand("readermate.nextChapter", () => {
      if (ReaderProvider.currentPanel) {
        return ReaderProvider.currentPanel.nextChapter();
      } else if (readerViewProvider) {
        return readerViewProvider.nextChapter();
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
      async (bookOrItem?: unknown, chapterIndex?: number) => {
        logger.info("在代码注释中打开书籍", "Extension");
        const extracted = extractBookAndChapter(bookOrItem);
        let book = extracted.book;
        let index = chapterIndex ?? extracted.chapterIndex ?? 0;

        if (!book) {
          const books = bookshelfProvider.getBooks();
          if (books.length === 0) {
            vscode.window.showInformationMessage(
              "书架中暂无书籍，请先在当前后端添加书籍或刷新书架"
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

          if (!picked) {
            return;
          }
          book = picked.book;
          index = book.durChapterIndex || 0;
        }

        if (!apiClient.ownsBook(book)) return;
        const client = apiClient;
        // 设定书籍并预取首章
        await commentReaderController.setBook(book, index);
        if (client !== apiClient || !client.isActive) return;

        // 如果光标在侧边栏，将焦点自动切回主代码编辑区
        await vscode.commands.executeCommand(
          "workbench.action.focusActiveEditorGroup"
        );

        // 尝试显示
        await commentReaderController.show();
        vscode.window.setStatusBarMessage(
          `ReaderMate: 《${book.name}》已就绪 (Alt+R 切换，滚轮翻页，Esc 退出)`,
          5000
        );
      }
    ),
    vscode.commands.registerCommand("readermate.closePanelIfOpen", () => {
      if (ReaderProvider.currentPanel) {
        ReaderProvider.currentPanel.dispose();
      }
    }),

    vscode.commands.registerCommand("readermate.refreshBookshelf", () => {
      replaceApiClient();
      showInfo("ReaderMate 书架与配置已刷新");
    }),

    vscode.commands.registerCommand("readermate.configure", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:readermate-dnslin.readermate")
    ),

    vscode.commands.registerCommand("readermate.showConfig", () => {
      const active = getBackendConfig();
      const preloadCfg = getPreloadConfig();

      logger.info("===== 当前 ReaderMate 生效配置 =====", "Extension");
      logger.info(`当前后端: ${active.backend === "legado" ? "Legado 阅读 Web" : "Reader3"}（另一套后端未启用）`, "Extension");
      logger.info(`服务器地址: ${active.serverUrl}`, "Extension");
      if (active.backend === "reader3") {
        const cfg = vscode.workspace.getConfiguration("readermate");
        logger.info(`自动追加 /reader3: ${active.appendReader3Path}`, "Extension");
        logger.info(`用户名: ${cfg.get<string>("username", "") || "(未配置)"}`, "Extension");
        logger.info(`访问令牌: ${active.accessToken ? "***已配置***" : "(未配置)"}`, "Extension");
      } else {
        logger.info(`API Key: ${active.apiKey ? "***已配置***" : "(未配置)"}`, "Extension");
      }
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
      const activeBackend = getBackendConfig().backend;
      const apiConfigChanged = e.affectsConfiguration("readermate.backend") ||
        (activeBackend === "legado"
          ? e.affectsConfiguration("readermate.legado.serverUrl") || e.affectsConfiguration("readermate.legado.apiKey")
          : e.affectsConfiguration("readermate.serverUrl") || e.affectsConfiguration("readermate.username") ||
            e.affectsConfiguration("readermate.token") || e.affectsConfiguration("readermate.appendReader3Path"));

      if (apiConfigChanged) {
        logger.info("检测到当前后端配置变更，停止旧会话并切换客户端", "Extension");
        replaceApiClient();
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
  apiClient?.dispose();
  preloadManager?.dispose();
  readerViewProvider?.dispose();
  if (ReaderProvider.currentPanel) {
    ReaderProvider.currentPanel.dispose();
  }
}
