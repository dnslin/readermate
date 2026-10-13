import { HttpTransport } from "./httpTransport";
import { Book, BookContent, Chapter } from "./types";

interface LegadoBook {
  id: number;
  name: string;
  author: string;
  coverUrl?: string | null;
  latestChapterTitle?: string | null;
  durChapterIndex?: number;
  totalChapterNum?: number;
}

interface LegadoChapter {
  index: number;
  title: string;
  isVolume?: boolean;
}

/** Protocol source: https://legado.kuku.me/openapi/openapi.yaml */
export class LegadoBackend {
  constructor(
    private readonly transport: HttpTransport,
    private readonly baseUrl: URL,
    private readonly apiKey: string
  ) {}

  private async request<T>(path: string, data?: unknown): Promise<T> {
    const result = await this.transport.request<T>(new URL(path, this.baseUrl), {
      method: data === undefined ? "GET" : "PUT",
      headers: { "X-API-Key": this.apiKey },
      data,
    });
    this.transport.assertActive();
    return result;
  }

  async getBookshelf(): Promise<Omit<Book, "sourceKey">[]> {
    const result = await this.request<LegadoBook[]>("shelf");
    if (!Array.isArray(result)) throw new Error("Legado书架响应不是数组");
    return result.map((book) => {
      if (!book || typeof book.id !== "number" || typeof book.name !== "string" || typeof book.author !== "string") {
        throw new Error("Legado书架响应缺少书籍 id、name 或 author");
      }
      return {
        bookUrl: String(book.id),
        name: book.name,
        author: book.author,
        coverUrl: book.coverUrl ?? undefined,
        latestChapterTitle: book.latestChapterTitle ?? undefined,
        lastChapter: book.latestChapterTitle ?? undefined,
        durChapterIndex: book.durChapterIndex,
        totalChapterNum: book.totalChapterNum,
      };
    });
  }

  async getChapterList(bookUrl: string): Promise<Chapter[]> {
    const result = await this.request<{ chapters: LegadoChapter[] }>(`books/${encodeURIComponent(bookUrl)}`);
    if (!result || !Array.isArray(result.chapters)) throw new Error("Legado目录响应缺少 chapters 数组");
    return result.chapters.map((chapter) => {
      if (!chapter || !Number.isInteger(chapter.index) || typeof chapter.title !== "string") {
        throw new Error("Legado目录响应缺少原始章节 index 或 title");
      }
      return { title: chapter.title, index: chapter.index, isVolume: chapter.isVolume, url: "" };
    });
  }

  async getBookContent(bookUrl: string, index: number): Promise<BookContent> {
    // OpenAPI defaults saveProgress to true; every fetch, including preload, must opt out.
    const result = await this.request<BookContent>(`books/${encodeURIComponent(bookUrl)}/content?index=${index}&saveProgress=false`);
    if (!result || typeof result.title !== "string" || typeof result.content !== "string") {
      throw new Error("Legado正文响应缺少 title 或 content");
    }
    return { title: result.title, content: result.content };
  }

  async saveBookProgress(bookUrl: string, index: number): Promise<void> {
    const result = await this.request<{ ok: boolean }>(`books/${encodeURIComponent(bookUrl)}/progress`, { index });
    if (!result || result.ok !== true) throw new Error("Legado阅读进度保存失败");
  }
}
