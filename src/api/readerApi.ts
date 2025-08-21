import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import { Book, Chapter, BookContent } from "./types";

export class ReaderApiClient {
  private baseUrl: string;
  private username?: string;
  private password?: string;

  constructor(baseUrl: string, username?: string, password?: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.username = username;
    this.password = password;
  }

  private async request(path: string, options: any = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}/reader3${path}`);

    return new Promise((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        url,
        {
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "VS Code Novel Reader",
            ...options.headers,
          },
        },
        (res: http.IncomingMessage) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            try {
              const result = JSON.parse(data);
              if (result.isSuccess) {
                resolve(result.data);
              } else {
                reject(new Error(result.errorMsg || "请求失败"));
              }
            } catch (e) {
              reject(new Error("响应解析失败"));
            }
          });
        }
      );

      req.on("error", reject);

      if (options.data) {
        req.write(JSON.stringify(options.data));
      }

      req.end();
    });
  }

  async getUserInfo(): Promise<any> {
    return this.request("/getUserInfo");
  }

  async getBookshelf(): Promise<Book[]> {
    const result = await this.request("/getBookshelf");
    return result || [];
  }

  async getChapterList(bookUrl: string): Promise<Chapter[]> {
    const result = await this.request(
      `/getChapterList?url=${encodeURIComponent(bookUrl)}`
    );
    return result || [];
  }

  async getBookContent(chapterUrl: string): Promise<BookContent> {
    return this.request(
      `/getBookContent?url=${encodeURIComponent(chapterUrl)}`
    );
  }

  async saveProgress(
    bookUrl: string,
    chapterUrl: string,
    progress: number
  ): Promise<void> {
    return this.request("/saveBookProgress", {
      method: "POST",
      data: { bookUrl, chapterUrl, progress },
    });
  }
}