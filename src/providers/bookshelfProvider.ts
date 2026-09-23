import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter } from "../api/types";
import { logger } from "../utils/logger";
import { showFriendlyError } from "../utils/messages";

export class BookshelfProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private books: Book[] = [];
  private apiClient: ReaderApiClient;
  private chapterCache: Map<string, Chapter[]> = new Map();

  constructor(apiClient: ReaderApiClient) {
    this.apiClient = apiClient;
    this.loadBooks(); // 初始化时自动加载书籍
  }

  refresh(): void {
    this.chapterCache.clear();
    this.loadBooks();
  }

  /**
   * 更新API客户端
   */
  updateApiClient(apiClient: ReaderApiClient): void {
    logger.info("开始更新API客户端", "BookshelfProvider");
    this.apiClient = apiClient;
    this.chapterCache.clear();
    this.loadBooks();
    logger.info("API客户端已更新，重新加载书籍列表", "BookshelfProvider");
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      if (this.books.length === 0) {
        return [];
      }
      return this.books.map((book) => new BookItem(book));
    }

    if (element instanceof BookItem) {
      try {
        const chapters = await this.getChapterList(element.book.bookUrl);
        return chapters.map(
          (chapter) =>
            new ChapterItem(
              element.book,
              chapter,
              chapter.index === element.book.durChapterIndex
            )
        );
      } catch (error) {
        logger.error(error, "获取章节列表失败", "BookshelfProvider");
        return [new vscode.TreeItem("加载章节列表失败，点击重试")];
      }
    }

    return [];
  }

  async getChapterList(bookUrl: string): Promise<Chapter[]> {
    if (this.chapterCache.has(bookUrl)) {
      return this.chapterCache.get(bookUrl)!;
    }
    const chapters = await this.apiClient.getChapterList(bookUrl);
    this.chapterCache.set(bookUrl, chapters);
    return chapters;
  }

  private async loadBooks() {
    try {
      logger.info("开始加载书架", "BookshelfProvider");
      this.books = await this.apiClient.getBookshelf();
      this._onDidChangeTreeData.fire();
      logger.info(
        `书架加载成功，共 ${this.books.length} 本书`,
        "BookshelfProvider"
      );
    } catch (error) {
      logger.error(error, "加载书架失败", "BookshelfProvider");
      showFriendlyError("bookshelf", error, "BookshelfProvider");
    }
  }

  getBook(bookUrl: string): Book | undefined {
    return this.books.find((book) => book.bookUrl === bookUrl);
  }

  getBooks(): Book[] {
    return this.books;
  }
}

export class BookItem extends vscode.TreeItem {
  constructor(public readonly book: Book) {
    super(book.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.label = book.name;
    const progressText =
      book.durChapterIndex !== undefined && book.totalChapterNum
        ? `${book.durChapterIndex + 1}/${book.totalChapterNum}`
        : book.lastChapter || "";
    this.description = progressText
      ? `${book.author} · ${progressText}`
      : book.author;
    this.tooltip = `${book.name} - ${book.author}\n当前进度: ${progressText || "未开始"}`;
    this.contextValue = "book";

    this.iconPath = new vscode.ThemeIcon("book");

    // 点击书名默认继续阅读当前章节
    this.command = {
      command: "readermate.openReader",
      title: "阅读",
      arguments: [book],
    };
  }
}

export class ChapterItem extends vscode.TreeItem {
  constructor(
    public readonly book: Book,
    public readonly chapter: Chapter,
    public readonly isCurrent: boolean
  ) {
    super(chapter.title, vscode.TreeItemCollapsibleState.None);

    this.label = chapter.title;
    this.description = isCurrent ? "当前阅读" : undefined;
    this.tooltip = `${book.name} - ${chapter.title}`;
    this.contextValue = "chapter";

    this.iconPath = isCurrent
      ? new vscode.ThemeIcon("bookmark", new vscode.ThemeColor("charts.yellow"))
      : new vscode.ThemeIcon("file-text");

    this.command = {
      command: "readermate.openReader",
      title: "阅读本章",
      arguments: [book, chapter.index],
    };
  }
}
