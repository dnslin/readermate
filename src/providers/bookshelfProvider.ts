import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book } from "../api/types";
import { logger } from "../utils/logger";
import { showFriendlyError } from "../utils/messages";

export class BookshelfProvider implements vscode.TreeDataProvider<BookItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    BookItem | undefined | null | void
  > = new vscode.EventEmitter<BookItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    BookItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private books: Book[] = [];
  private apiClient: ReaderApiClient;

  constructor(apiClient: ReaderApiClient) {
    this.apiClient = apiClient;
    this.loadBooks(); // 初始化时自动加载书籍
  }

  refresh(): void {
    this.loadBooks();
  }

  /**
   * 更新API客户端
   */
  updateApiClient(apiClient: ReaderApiClient): void {
    logger.info("开始更新API客户端", "BookshelfProvider");
    this.apiClient = apiClient;
    // 更新API客户端后重新加载书籍列表
    this.loadBooks();
    logger.info("API客户端已更新，重新加载书籍列表", "BookshelfProvider");
  }

  getTreeItem(element: BookItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BookItem): Thenable<BookItem[]> {
    if (!element) {
      return Promise.resolve(this.books.map((book) => new BookItem(book)));
    }
    return Promise.resolve([]);
  }

  private async loadBooks() {
    try {
      logger.info("开始加载书架", "BookshelfProvider");
      this.books = await this.apiClient.getBookshelf();
      this._onDidChangeTreeData.fire();
      logger.info(`书架加载成功，共 ${this.books.length} 本书`, "BookshelfProvider");
    } catch (error) {
      logger.error(error, "加载书架失败", "BookshelfProvider");
      showFriendlyError("bookshelf", error, "BookshelfProvider");
    }
  }

  getBook(bookUrl: string): Book | undefined {
    return this.books.find((book) => book.bookUrl === bookUrl);
  }
}

class BookItem extends vscode.TreeItem {
  constructor(public readonly book: Book) {
    super(book.name, vscode.TreeItemCollapsibleState.None);

    this.label = book.name;
    this.description = book.author;
    this.tooltip = `${book.name} - ${book.author}`;
    this.contextValue = "book";

    this.iconPath = new vscode.ThemeIcon("book");

    this.command = {
      command: "readermate.openReader",
      title: "阅读",
      arguments: [book],
    };
  }
}
