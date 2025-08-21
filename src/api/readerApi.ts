import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import * as vscode from "vscode";
import { Book, Chapter, BookContent } from "./types";

export class ReaderApiClient {
  private baseUrl: string;
  private accessToken?: string;
  private outputChannel?: vscode.OutputChannel;

  constructor(
    baseUrl: string,
    accessToken?: string,
    outputChannel?: vscode.OutputChannel
  ) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.accessToken = accessToken;
    this.outputChannel = outputChannel;
  }

  private async request(path: string, options: any = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);

    // 添加 accessToken 参数
    if (this.accessToken) {
      url.searchParams.set("accessToken", this.accessToken);
      url.searchParams.set("v", Date.now().toString());
    }

    const logMessage = `发起API请求: ${url.toString()}`;
    console.log(logMessage);
    if (this.outputChannel) {
      this.outputChannel.appendLine(logMessage);
    }

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
            const statusMessage = `API响应状态码: ${res.statusCode}`;
            const contentMessage = `API响应内容: ${data}`;

            console.log(statusMessage);
            console.log(contentMessage);

            if (this.outputChannel) {
              this.outputChannel.appendLine(statusMessage);
              this.outputChannel.appendLine(contentMessage);
            }

            try {
              const result = JSON.parse(data);
              // 检查是否是包装格式的响应
              if (result.hasOwnProperty("isSuccess")) {
                if (result.isSuccess) {
                  resolve(result.data);
                } else {
                  reject(new Error(result.errorMsg || "请求失败"));
                }
              } else {
                // 直接返回解析后的数据
                resolve(result);
              }
            } catch (e) {
              const errorMessage = `JSON解析失败，原始响应: ${data}`;
              console.error(errorMessage);
              if (this.outputChannel) {
                this.outputChannel.appendLine(errorMessage);
              }
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

  async getBookContent(
    bookUrl: string,
    chapterIndex: number
  ): Promise<BookContent> {
    return this.request(
      `/getBookContent?url=${encodeURIComponent(bookUrl)}&index=${chapterIndex}`
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

