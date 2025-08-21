import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import { Book, Chapter, BookContent } from "./types";

export class ReaderApiClient {
  private baseUrl: string;
  private accessToken?: string;

  constructor(baseUrl: string, accessToken?: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.accessToken = accessToken;
  }

  private async request(path: string, options: any = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}/reader3${path}`);

    // 添加 accessToken 参数
    if (this.accessToken) {
      url.searchParams.set("accessToken", this.accessToken);
      url.searchParams.set("v", Date.now().toString());
    }

    console.log(`发起API请求: ${url.toString()}`);

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
            console.log(`API响应状态码: ${res.statusCode}`);
            console.log(`API响应内容: ${data}`);

            try {
              const result = JSON.parse(data);
              if (result.isSuccess) {
                resolve(result.data);
              } else {
                reject(new Error(result.errorMsg || "请求失败"));
              }
            } catch (e) {
              console.error(`JSON解析失败，原始响应: ${data}`);
              reject(new Error(`响应解析失败: ${data.substring(0, 200)}...`));
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

