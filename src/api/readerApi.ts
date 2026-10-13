import { createHash } from "node:crypto";
import { HttpTransport } from "./httpTransport";
import { LegadoBackend } from "./legadoBackend";
import { Reader3Backend } from "./reader3Backend";
import { Book, Chapter, BookContent, ReaderBackendConfig } from "./types";
import { logger } from "../utils/logger";

/** One connection/account session. Construct only the explicitly selected protocol. */
export class ReaderApiClient {
  readonly stateKey: string;
  private readonly transport = new HttpTransport();
  private readonly backend: Reader3Backend | LegadoBackend | Error;

  constructor(config: ReaderBackendConfig) {
    let baseIdentity = config.serverUrl;
    try {
      const baseUrl = new URL(config.serverUrl);
      if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
        throw new Error("服务器地址必须使用 HTTP 或 HTTPS");
      }
      baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") + "/";
      if (config.backend === "reader3") {
        if (config.appendReader3Path && !baseUrl.pathname.includes("/reader3/")) {
          baseUrl.pathname += "reader3/";
        }
        this.backend = new Reader3Backend(this.transport, baseUrl, config.accessToken);
      } else {
        if (!baseUrl.pathname.endsWith("/openapi/v1/")) baseUrl.pathname += "openapi/v1/";
        this.backend = new LegadoBackend(this.transport, baseUrl, config.apiKey);
      }
      baseIdentity = baseUrl.href;
    } catch (cause) {
      // A malformed setting must not prevent activation/configuration or revive the old session.
      this.backend = Object.assign(new Error("服务器地址无效，请配置有效的 HTTP 或 HTTPS 地址"), { cause });
    }
    const credential = config.backend === "reader3" ? config.accessToken || "" : config.apiKey;
    this.stateKey = `${config.backend}:${createHash("sha256")
      .update(JSON.stringify([config.backend, baseIdentity, credential]))
      .digest("hex")}`;
    logger.info(`创建 ${config.backend} API客户端`, "ReaderApiClient");
  }

  get isActive(): boolean {
    return this.transport.isActive;
  }

  dispose(): void {
    this.transport.dispose();
  }

  ownsBook(book: Book): boolean {
    return book.sourceKey === this.stateKey;
  }

  private getBackend(): Reader3Backend | LegadoBackend {
    this.transport.assertActive();
    if (this.backend instanceof Error) throw this.backend;
    return this.backend;
  }

  async getBookshelf(): Promise<Book[]> {
    const books = await this.getBackend().getBookshelf();
    this.transport.assertActive();
    return books.map((book) => ({ ...book, sourceKey: this.stateKey }));
  }

  async getChapterList(bookUrl: string): Promise<Chapter[]> {
    const chapters = await this.getBackend().getChapterList(bookUrl);
    this.transport.assertActive();
    return chapters;
  }

  async getBookContent(bookUrl: string, index: number): Promise<BookContent> {
    const content = await this.getBackend().getBookContent(bookUrl, index);
    this.transport.assertActive();
    return content;
  }

  async saveBookProgress(bookUrl: string, index: number): Promise<void> {
    await this.getBackend().saveBookProgress(bookUrl, index);
    this.transport.assertActive();
  }
}
