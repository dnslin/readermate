import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book } from "../api/types";

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
  }

  refresh(): void {
    this.loadBooks();
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
      this.books = await this.apiClient.getBookshelf();
      this._onDidChangeTreeData.fire();
    } catch (error) {
      vscode.window.showErrorMessage(`加载书架失败: ${error}`);
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
      command: "novelReader.openReader",
      title: "阅读",
      arguments: [book],
    };
  }
}