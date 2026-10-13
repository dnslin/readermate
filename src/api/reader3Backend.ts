import { HttpTransport } from "./httpTransport";
import { Book, BookContent, Chapter } from "./types";

interface Reader3Envelope<T> {
  isSuccess: boolean;
  data: T;
  errorMsg?: string;
}

export class Reader3Backend {
  constructor(
    private readonly transport: HttpTransport,
    private readonly baseUrl: URL,
    private readonly accessToken?: string
  ) {}

  private async request<T>(path: string, data?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (this.accessToken) {
      url.searchParams.set("accessToken", this.accessToken);
      url.searchParams.set("v", Date.now().toString());
    }
    const result = await this.transport.request<T | Reader3Envelope<T>>(url, {
      method: data === undefined ? "GET" : "POST",
      data,
    });
    this.transport.assertActive();
    if (result && typeof result === "object" && "isSuccess" in result) {
      const envelope = result as Reader3Envelope<T>;
      if (!envelope.isSuccess) throw new Error(envelope.errorMsg || "请求失败");
      return envelope.data;
    }
    return result as T;
  }

  async getBookshelf(): Promise<Book[]> {
    return (await this.request<Book[]>("getBookshelf")) || [];
  }

  async getChapterList(bookUrl: string): Promise<Chapter[]> {
    return (await this.request<Chapter[]>(`getChapterList?url=${encodeURIComponent(bookUrl)}`)) || [];
  }

  async getBookContent(bookUrl: string, index: number): Promise<BookContent> {
    const result = await this.request<unknown>(`getBookContent?url=${encodeURIComponent(bookUrl)}&index=${index}`);
    let content = "";
    if (typeof result === "string") content = result;
    else if (result && typeof result === "object") {
      const body = result as Record<string, unknown>;
      if (typeof body.content === "string") content = body.content;
      else if (typeof body.text === "string") content = body.text;
    }
    return { title: `第${index + 1}章`, content, nextUrl: undefined, prevUrl: undefined };
  }

  async saveBookProgress(bookUrl: string, index: number): Promise<void> {
    await this.request("saveBookProgress", { url: bookUrl, index });
  }
}
