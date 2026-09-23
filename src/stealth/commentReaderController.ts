import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, BookContent, Chapter } from "../api/types";
import { BookshelfProvider } from "../providers/bookshelfProvider";
import { PreloadManager } from "../preload/preloadManager";
import { PreloadConfig } from "../preload/types";
import { formatComment } from "./commentAdapter";
import { logger } from "../utils/logger";

/**
 * 将小说长段落切分为适合代码注释单行展示的短句/切片
 * @param content 章节原始内容
 * @param maxLen 单行推荐最大字符数（默认 45 字）
 */
export function splitIntoSentences(content: string, maxLen = 45): string[] {
  if (!content) {
    return [];
  }

  // 统一换行符并过滤常见无意义广告或空行
  const normalized = content.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split("\n");
  const sentences: string[] = [];

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) {
      continue;
    }

    // 按句号、问号、感叹号、省略号分句（保留标点与后引号）
    const rawTokens = trimmedPara.split(/([。！？!?]+["”]?|……)/);
    let currentBuffer = "";

    for (const token of rawTokens) {
      if (!token) {
        continue;
      }
      currentBuffer += token;

      if (/[。！？!?]["”]?$/.test(token) || token === "……" || currentBuffer.length >= maxLen) {
        if (currentBuffer.length > maxLen * 1.5) {
          // 单句过长，尝试按逗号、分号细分
          const commaTokens = currentBuffer.split(/([，,；;]+["”]?)/);
          let subBuffer = "";
          for (const sub of commaTokens) {
            subBuffer += sub;
            if (subBuffer.length >= maxLen || /[，,；;]["”]?$/.test(sub)) {
              if (subBuffer.trim()) {
                sentences.push(subBuffer.trim());
              }
              subBuffer = "";
            }
          }
          if (subBuffer.trim()) {
            sentences.push(subBuffer.trim());
          }
        } else {
          if (currentBuffer.trim()) {
            sentences.push(currentBuffer.trim());
          }
        }
        currentBuffer = "";
      }
    }

    if (currentBuffer.trim()) {
      sentences.push(currentBuffer.trim());
    }
  }

  return sentences.filter((s) => s.length > 0);
}

/**
 * 注释伪装阅读控制器
 * 通过虚拟文本装饰器在当前活动代码编辑器中显示小说，零污染代码文件，支持长按心跳与滚轮翻页
 */
export class CommentReaderController implements vscode.Disposable {
  private static instance: CommentReaderController | null = null;

  private readonly context: vscode.ExtensionContext;
  private apiClient: ReaderApiClient;
  private readonly bookshelfProvider: BookshelfProvider;
  private readonly preloadManager: PreloadManager;

  private currentBook: Book | null = null;
  private chapters: Chapter[] = [];
  private currentChapterIndex = 0;
  private chapterContent: BookContent | null = null;
  private sentences: string[] = [];
  private sentenceIndex = 0;

  private isVisible = false;
  private hideTimer: NodeJS.Timeout | null = null;
  private lastVisibleTopLine: number | null = null;
  private isChangingChapter = false;

  private decorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(
    context: vscode.ExtensionContext,
    apiClient: ReaderApiClient,
    bookshelfProvider: BookshelfProvider,
    preloadManager: PreloadManager
  ) {
    this.context = context;
    this.apiClient = apiClient;
    this.bookshelfProvider = bookshelfProvider;
    this.preloadManager = preloadManager;

    this.decorationType = this.createDecorationType();

    // 注册全局逃生门监听器（输入代码、切出窗口、切换文件时瞬间恢复）
    this.registerEscapeListeners();

    // 恢复历史书籍阅读状态
    this.restoreState();

    CommentReaderController.instance = this;
  }

  public static getInstance(): CommentReaderController | null {
    return CommentReaderController.instance;
  }
  public updateApiClient(apiClient: ReaderApiClient): void {
    this.apiClient = apiClient;
    this.preloadManager.updateApiClient(apiClient);
  }

  public updatePreloadConfig(config: PreloadConfig): void {
    this.preloadManager.updateConfig(config);
  }


  /**
   * 创建虚拟注释装饰类型
   */
  private getDecorationColor(): string | vscode.ThemeColor {
    const config = vscode.workspace.getConfiguration("readermate");
    const colorStyle = config.get<string>("commentReader.color", "comment");

    if (colorStyle === "green") {
      return "#6A9955";
    }
    if (colorStyle === "dim") {
      return new vscode.ThemeColor("editorCodeLens.foreground");
    }
    if (colorStyle === "ghost") {
      return new vscode.ThemeColor("editorGhostText.foreground");
    }
    // "comment" 模式使用 descriptionForeground（VS Code 官方标准次级/注释文字色，在任意深浅主题中均正常显示）
    return new vscode.ThemeColor("descriptionForeground");
  }

  /**
   * 创建虚拟注释装饰类型
   */
  private createDecorationType(): vscode.TextEditorDecorationType {
    const color = this.getDecorationColor();
    return vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      after: {
        color,
        fontStyle: "italic",
        margin: "0 0 0 2em",
      },
    });
  }

  /**
   * 注册安全逃生门事件监听器
   */
  private registerEscapeListeners(): void {
    // 1. 用户敲键盘编辑代码时：立即无感隐藏，绝不干扰正常编写
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => {
        if (this.isVisible) {
          this.hide();
        }
      })
    );

    // 2. 编辑器切换时：若处于阅读态且有新编辑器，无缝在新编辑器中重新渲染；无编辑器才隐藏
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.isVisible) {
          if (editor) {
            this.render();
          } else {
            this.hide();
          }
        }
      })
    );

    // 2.1 光标位置改变时：将注释平滑跟随到新行
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (this.isVisible && e.textEditor === vscode.window.activeTextEditor) {
          this.render();
        }
      })
    );
    // 3. 窗口失焦时（如切到浏览器或切屏）：立即隐藏
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused && this.isVisible) {
          this.hide();
        }
      })
    );

    // 4. 滚轮滚动事件（监听视口变化）：当且仅当处于阅读态时响应翻页
    this.disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        this.handleVisibleRangesChange(event);
      })
    );

    // 5. 配置变动时重新构建装饰器样式
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("readermate.commentReader")) {
          this.decorationType.dispose();
          this.decorationType = this.createDecorationType();
          if (this.isVisible) {
            this.render();
          }
        }
      })
    );
  }

  /**
   * 处理编辑器滚轮滚动
   */
  private handleVisibleRangesChange(
    event: vscode.TextEditorVisibleRangesChangeEvent
  ): void {
    if (!this.isVisible || event.textEditor !== vscode.window.activeTextEditor) {
      return;
    }

    if (event.visibleRanges.length === 0) {
      return;
    }

    const currentTopLine = event.visibleRanges[0].start.line;
    if (this.lastVisibleTopLine === null) {
      this.lastVisibleTopLine = currentTopLine;
      return;
    }

    const delta = currentTopLine - this.lastVisibleTopLine;
    this.lastVisibleTopLine = currentTopLine;

    if (delta > 0) {
      // 向下滚动 -> 读下一句/下一段
      this.next();
    } else if (delta < 0) {
      // 向上滚动 -> 读上一句/上一段
      this.prev();
    }
  }

  /**
   * 长按按键触发（心跳模式）：按住时通过连击持续续期，松手后 400ms 自动还原
   */
  public handleHoldTrigger(): void {
    if (!this.isVisible) {
      this.show().then(() => {
        this.resetHoldTimer();
      });
    } else {
      this.resetHoldTimer();
    }
  }

  private resetHoldTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    this.hideTimer = setTimeout(() => {
      this.hide();
      this.hideTimer = null;
    }, 400);
  }
  /**
   * 切换触发（开关模式）：按一次打开，再按一次关闭
   */
  public toggle(): void {
    logger.info(
      `toggle() 调用, 当前 isVisible=${this.isVisible}`,
      "CommentReader"
    );
    if (this.isVisible) {
      this.hide();
      vscode.window.setStatusBarMessage("ReaderMate: 代码注释阅读已关闭", 3000);
    } else {
      this.show().then(() => {
        vscode.window.setStatusBarMessage(
          "ReaderMate: 代码注释阅读已开启 (滚轮翻页，Alt+R 切换，Esc 退出)",
          4000
        );
      });
    }
  }

  /**
   * 激活显示注释
   */
  public async show(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage(
        "ReaderMate: 请先在编辑器中打开一个代码文件以开始注释阅读"
      );
      return;
    }

    this.isVisible = true;
    vscode.commands.executeCommand(
      "setContext",
      "readermate.commentReading",
      true
    );

    // 记录初始视口行
    if (editor.visibleRanges.length > 0) {
      this.lastVisibleTopLine = editor.visibleRanges[0].start.line;
    }

    logger.info(
      `show() 开始执行: file=${editor.document.fileName}, sentences=${this.sentences.length}, currentBook=${this.currentBook?.name}`,
      "CommentReader"
    );

    // 如果还没有加载内容，先显示即时加载反馈，再异步拉取
    if (this.sentences.length === 0) {
      const line = editor.selection.active.line;
      const lineObj = editor.document.lineAt(line);
      const loadingComment = formatComment(
        editor.document.languageId,
        "正在加载章节内容..."
      );
      editor.setDecorations(this.decorationType, [
        {
          range: new vscode.Range(
            line,
            lineObj.text.length,
            line,
            lineObj.text.length
          ),
          renderOptions: {
            after: {
              contentText: loadingComment,
              color: this.getDecorationColor(),
              fontStyle: "italic",
              margin: "0 0 0 2em",
            },
          },
        },
      ]);
      await this.ensureContentLoaded();
    }

    if (this.isVisible) {
      this.render();
    }
  }

  /**
   * 立即隐藏并清空装饰器
   */
  public hide(): void {
    logger.info("hide() 隐藏并清理注释", "CommentReader");
    this.isVisible = false;
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    vscode.commands.executeCommand(
      "setContext",
      "readermate.commentReading",
      false
    );

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  /**
   * 渲染虚拟文本到编辑器
   */
  private render(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isVisible) {
      return;
    }

    let targetEditorLine = editor.selection.active.line;

    // 如果当前有可见视口，且光标不在可见视口内（例如用户用鼠标滚轮滚动离开了光标位置）
    if (editor.visibleRanges.length > 0) {
      const visibleRange = editor.visibleRanges[0];
      const isCursorVisible =
        targetEditorLine >= visibleRange.start.line &&
        targetEditorLine <= visibleRange.end.line;

      if (!isCursorVisible) {
        // 动态锚定到当前视口内第 3 行，确保读者在滚轮滚动时始终能在屏幕上看到注释
        targetEditorLine = Math.min(
          visibleRange.start.line + 2,
          Math.max(0, editor.document.lineCount - 1)
        );
      }
    }

    if (this.sentences.length === 0) {
      // 提示尚未选择书籍
      const lineObj = editor.document.lineAt(targetEditorLine);
      const comment = formatComment(
        editor.document.languageId,
        "未选择图书，请在侧边栏右键书籍选择“在代码注释中阅读本书”"
      );
      editor.setDecorations(this.decorationType, [
        {
          range: new vscode.Range(
            targetEditorLine,
            lineObj.text.length,
            targetEditorLine,
            lineObj.text.length
          ),
          renderOptions: {
            after: {
              contentText: comment,
              color: this.getDecorationColor(),
              fontStyle: "italic",
              margin: "0 0 0 2em",
            },
          },
        },
      ]);
      return;
    }

    const config = vscode.workspace.getConfiguration("readermate");
    const lineCount = Math.max(
      1,
      config.get<number>("commentReader.lines", 1)
    );
    const showProgress = config.get<boolean>(
      "commentReader.showProgress",
      true
    );

    const decorations: vscode.DecorationOptions[] = [];

    for (let i = 0; i < lineCount; i++) {
      const targetSentenceIdx = this.sentenceIndex + i;
      if (targetSentenceIdx >= this.sentences.length) {
        break;
      }

      const lineIndex = targetEditorLine + i;
      if (lineIndex >= editor.document.lineCount) {
        break;
      }

      const textLine = editor.document.lineAt(lineIndex);
      const sentence = this.sentences[targetSentenceIdx];

      // 前置标签：只在第一行显示当前章节与阅读百分比
      let tag: string | undefined = undefined;
      if (i === 0 && showProgress) {
        const chapterTitle =
          this.chapterContent?.title ||
          this.chapters[this.currentChapterIndex]?.title ||
          `第${this.currentChapterIndex + 1}章`;
        const percent = Math.floor(
          ((this.sentenceIndex + 1) / Math.max(1, this.sentences.length)) * 100
        );
        tag = `${chapterTitle} ${percent}%`;
      }

      const formatted = formatComment(
        editor.document.languageId,
        sentence,
        tag
      );

      decorations.push({
        range: new vscode.Range(
          lineIndex,
          textLine.text.length,
          lineIndex,
          textLine.text.length
        ),
        renderOptions: {
          after: {
            contentText: formatted,
            color: this.getDecorationColor(),
            fontStyle: "italic",
            margin: "0 0 0 2em",
          },
        },
      });
    }

    logger.info(
      `render() 绘制完成: targetLine=${targetEditorLine}, 句子=${this.sentenceIndex + 1}/${this.sentences.length}, 装饰行数=${decorations.length}`,
      "CommentReader"
    );

    editor.setDecorations(this.decorationType, decorations);
  }

  /**
   * 翻下一句/下一段
   */
  public async next(): Promise<void> {
    if (!this.isVisible || this.sentences.length === 0 || this.isChangingChapter) {
      return;
    }

    const config = vscode.workspace.getConfiguration("readermate");
    const step = config.get<number>("commentReader.lines", 1);

    if (this.sentenceIndex + step < this.sentences.length) {
      this.sentenceIndex += step;
      this.render();
      this.checkPreload();
      this.saveState();
    } else {
      // 读到当前章末尾，自动无缝跨入下一章
      await this.nextChapter();
    }
  }

  /**
   * 翻上一句/上一段
   */
  public async prev(): Promise<void> {
    if (!this.isVisible || this.sentences.length === 0 || this.isChangingChapter) {
      return;
    }

    const config = vscode.workspace.getConfiguration("readermate");
    const step = config.get<number>("commentReader.lines", 1);

    if (this.sentenceIndex - step >= 0) {
      this.sentenceIndex -= step;
      this.render();
      this.saveState();
    } else {
      // 读到章首，自动返回上一章末尾
      await this.prevChapter();
    }
  }

  /**
   * 跨入下一章
   */
  public async nextChapter(): Promise<void> {
    if (this.isChangingChapter || !this.currentBook) {
      return;
    }

    if (this.currentChapterIndex + 1 < this.chapters.length) {
      logger.info(
        `注释阅读自动切入下一章: 第${this.currentChapterIndex + 2}章`,
        "CommentReader"
      );
      await this.loadChapter(this.currentChapterIndex + 1, 0);
    }
  }

  /**
   * 返回上一章
   */
  public async prevChapter(): Promise<void> {
    if (this.isChangingChapter || !this.currentBook) {
      return;
    }

    if (this.currentChapterIndex > 0) {
      logger.info(
        `注释阅读切入上一章: 第${this.currentChapterIndex}章`,
        "CommentReader"
      );
      await this.loadChapter(this.currentChapterIndex - 1, -1);
    }
  }

  /**
   * 设定当前正在阅读的图书和章节
   */
  public async setBook(bookInput: unknown, chapterIndex = 0): Promise<void> {
    if (!bookInput || typeof bookInput !== "object") {
      return;
    }

    let book: Book | null = null;
    if ("book" in bookInput) {
      const candidate = (bookInput as Record<string, unknown>).book;
      if (candidate && typeof candidate === "object" && "bookUrl" in candidate) {
        const candidateUrl = (candidate as Record<string, unknown>).bookUrl;
        if (typeof candidateUrl === "string") {
          book = candidate as Book;
        }
      }
    } else if ("bookUrl" in bookInput) {
      const candidateUrl = (bookInput as Record<string, unknown>).bookUrl;
      if (typeof candidateUrl === "string") {
        book = bookInput as Book;
      }
    }

    if (!book) {
      logger.error(
        new Error("无效的书籍对象，缺少合法 book 结构"),
        "CommentReader:setBook"
      );
      return;
    }

    this.currentBook = book;
    this.currentChapterIndex = chapterIndex ?? book.durChapterIndex ?? 0;
    this.sentenceIndex = 0;

    try {
      this.chapters = await this.apiClient.getChapterList(book.bookUrl);
      await this.loadChapter(this.currentChapterIndex, 0);
    } catch (err) {
      logger.error(err as Error, "CommentReader:setBook");
    }
  }

  /**
   * 加载指定章节内容
   * @param chapterIndex 章节索引
   * @param targetSentenceIndex 目标定位句（0为章首，-1为跳到章尾）
   */
  public async loadChapter(
    chapterIndex: number,
    targetSentenceIndex = 0
  ): Promise<void> {
    if (!this.currentBook) {
      return;
    }

    this.isChangingChapter = true;
    this.currentChapterIndex = chapterIndex;

    try {
      const bookUrl = this.currentBook.bookUrl;
      this.preloadManager.setCurrentBook(bookUrl, this.chapters.length);

      // 从 PreloadManager 获取（优先从缓存命中，未命中自动请求 API 并缓存）
      const contentObj = await this.preloadManager.getChapterContent(
        bookUrl,
        chapterIndex
      );

      this.chapterContent = contentObj;

      // 切分成句
      this.sentences = splitIntoSentences(contentObj.content);

      if (targetSentenceIndex === -1) {
        this.sentenceIndex = Math.max(0, this.sentences.length - 1);
      } else {
        this.sentenceIndex = Math.min(
          targetSentenceIndex,
          Math.max(0, this.sentences.length - 1)
        );
      }

      // 保存进度
      this.saveState();

      // 重新渲染
      if (this.isVisible) {
        this.render();
      }

      // 静默通知预加载管理器触发后续章节预加载
      this.preloadManager.onReadingProgress({
        chapterIndex,
        progress: Math.floor(
          (this.sentenceIndex / Math.max(1, this.sentences.length)) * 100
        ),
        totalChapters: this.chapters.length,
      });
    } catch (err) {
      logger.error(err as Error, "CommentReader:loadChapter");
    } finally {
      this.isChangingChapter = false;
    }
  }

  /**
   * 检查阅读进度并触发预加载
   */
  private checkPreload(): void {
    if (!this.currentBook || this.sentences.length === 0) {
      return;
    }

    const progress = Math.floor(
      (this.sentenceIndex / Math.max(1, this.sentences.length)) * 100
    );

    this.preloadManager.onReadingProgress({
      chapterIndex: this.currentChapterIndex,
      progress,
      totalChapters: this.chapters.length,
    });
  }
  /**
   * 保存阅读进度
   */
  private saveState(): void {
    if (!this.currentBook) {
      return;
    }

    this.context.globalState.update("readermate.commentReader.state", {
      book: this.currentBook,
      chapterIndex: this.currentChapterIndex,
      sentenceIndex: this.sentenceIndex,
    });

    // 同时向后端同步保存阅读进度
    this.apiClient
      .saveBookProgress(this.currentBook.bookUrl, this.currentChapterIndex)
      .catch((err) => {
        logger.warn(`保存阅读进度失败: ${err}`, "CommentReader:saveState");
      });
  }
  /**
   * 恢复历史进度
   */
  private async restoreState(): Promise<void> {
    const saved = this.context.globalState.get<{
      book: Book;
      chapterIndex: number;
      sentenceIndex: number;
    }>("readermate.commentReader.state");

    if (saved && saved.book) {
      this.currentBook = saved.book;
      this.currentChapterIndex = saved.chapterIndex || 0;
      this.sentenceIndex = saved.sentenceIndex || 0;
    }
  }

  /**
   * 确保内容已加载
   */
  private async ensureContentLoaded(): Promise<void> {
    if (!this.currentBook) {
      let books = this.bookshelfProvider.getBooks();
      if (books.length === 0) {
        try {
          books = await this.apiClient.getBookshelf();
        } catch (e) {
          logger.warn(
            `异步获取书架失败: ${e}`,
            "CommentReader:ensureContentLoaded"
          );
        }
      }
      if (books.length > 0) {
        this.currentBook = books[0];
        this.currentChapterIndex = books[0].durChapterIndex || 0;
      }
    }

    if (this.currentBook && this.sentences.length === 0) {
      try {
        if (this.chapters.length === 0) {
          this.chapters = await this.apiClient.getChapterList(
            this.currentBook.bookUrl
          );
        }
        await this.loadChapter(this.currentChapterIndex, this.sentenceIndex);
      } catch (err) {
        logger.error(err as Error, "CommentReader:ensureContentLoaded");
      }
    }
  }

  /**
   * 伪装快速选章对话框（QuickPick）
   */
  public async selectChapterQuickPick(): Promise<void> {
    if (!this.currentBook) {
      vscode.window.showInformationMessage(
        "ReaderMate：请先在书架中选择一本书籍"
      );
      return;
    }

    if (this.chapters.length === 0) {
      this.chapters = await this.apiClient.getChapterList(
        this.currentBook.bookUrl
      );
    }

    // 伪装标题为代码符号跳转，避免同事注视
    const items = this.chapters.map((ch, index) => ({
      label: `$(symbol-class) ${ch.title}`,
      description: index === this.currentChapterIndex ? "当前章节" : undefined,
      chapterIndex: index,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Go to Symbol / Chapter",
      matchOnDescription: true,
    });

    if (selected) {
      await this.loadChapter(selected.chapterIndex, 0);
    }
  }

  public dispose(): void {
    this.hide();
    this.decorationType.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    CommentReaderController.instance = null;
  }
}
