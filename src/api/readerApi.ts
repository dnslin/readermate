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
    outputChannel?: vscode.OutputChannel,
    appendReader3Path: boolean = true
  ) {
    // 确保baseUrl以斜杠结尾
    let normalizedUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    // 根据配置决定是否添加reader3路径
    if (appendReader3Path && !normalizedUrl.includes("/reader3/")) {
      normalizedUrl = normalizedUrl + "reader3/";
    }
    this.baseUrl = normalizedUrl;
    this.accessToken = accessToken;
    this.outputChannel = outputChannel;

    console.log(`[ReaderApiClient] 创建API客户端，baseUrl: ${this.baseUrl}`);
    if (this.outputChannel) {
      this.outputChannel.appendLine(
        `[ReaderApiClient] 创建API客户端，baseUrl: ${this.baseUrl}`
      );
    }
  }

  private async request(path: string, options: any = {}): Promise<any> {
    // 使用URL构造函数正确拼接路径，path应该以斜杠开头
    const apiPath = path.startsWith("/") ? path.substring(1) : path;
    const url = new URL(apiPath, this.baseUrl);

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

    // 添加POST数据调试信息
    if (options.method === "POST" && options.data) {
      const postDataMessage = `POST数据: ${JSON.stringify(
        options.data,
        null,
        2
      )}`;
      console.log(postDataMessage);
      if (this.outputChannel) {
        this.outputChannel.appendLine(postDataMessage);
      }
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
          // 设置响应编码为UTF-8以正确处理中文字符
          res.setEncoding("utf8");
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
    const result = await this.request(
      `/getBookContent?url=${encodeURIComponent(bookUrl)}&index=${chapterIndex}`
    );

    const logMessage = `getBookContent API原始响应: ${JSON.stringify(
      result,
      null,
      2
    )}`;
    console.log(logMessage);
    if (this.outputChannel) {
      this.outputChannel.appendLine(logMessage);
    }

    // API返回的可能是字符串内容或对象，需要转换为BookContent格式
    let contentText = "";
    if (typeof result === "string") {
      contentText = result;
    } else if (result && typeof result === "object") {
      contentText = result.content || result.text || "";
    }

    const bookContent: BookContent = {
      title: `第${chapterIndex + 1}章`, // 使用章节索引生成标题
      content: contentText,
      nextUrl: undefined,
      prevUrl: undefined,
    };

    console.log(
      `转换后的BookContent: title="${bookContent.title}", content长度=${bookContent.content.length}`
    );

    return bookContent;
  }

  async saveBookProgress(
    bookUrl: string,
    durChapterIndex: number
  ): Promise<void> {
    const progressData = {
      url: bookUrl,
      index: durChapterIndex,
    };

    console.log(`保存阅读进度: ${JSON.stringify(progressData, null, 2)}`);
    if (this.outputChannel) {
      this.outputChannel.appendLine(
        `保存阅读进度: ${JSON.stringify(progressData, null, 2)}`
      );
    }

    return this.request("/saveBookProgress", {
      method: "POST",
      data: progressData,
    });
  }
}
