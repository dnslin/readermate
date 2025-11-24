import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import * as vscode from "vscode";
import { Book, Chapter, BookContent } from "./types";
import { logger } from "../utils/logger";

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

    logger.info(`创建API客户端，baseUrl: ${this.baseUrl}`, "ReaderApiClient");
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
    logger.info(logMessage, "ReaderApiClient");

    // 添加POST数据调试信息
    if (options.method === "POST" && options.data) {
      const postDataMessage = `POST数据: ${JSON.stringify(
        options.data,
        null,
        2
      )}`;
      logger.debug(postDataMessage, "ReaderApiClient");
    }

    return new Promise((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const requestOptions = {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          ...options.headers,
        },
      };
      logger.info(
        `请求头: ${JSON.stringify(requestOptions.headers, null, 2)}`,
        "ReaderApiClient"
      );
      const req = client.request(
        url,
        requestOptions,
        (res: http.IncomingMessage) => {
          // 设置响应编码为UTF-8以正确处理中文字符
          res.setEncoding("utf8");
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            const statusMessage = `API响应状态码: ${res.statusCode}`;
            const contentMessage = `API响应内容: ${data}`;
            logger.debug(statusMessage, "ReaderApiClient");
            logger.debug(contentMessage, "ReaderApiClient");

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
              logger.error(
                new Error(errorMessage),
                undefined,
                "ReaderApiClient"
              );
              reject(new Error(`响应解析失败: ${data.substring(0, 200)}...`));
            }
          });
        }
      );

      req.on("error", (err) => {
        logger.error(err, "网络请求失败", "ReaderApiClient");
        // 返回更友好的错误信息
        reject(new Error("无法连接服务器或请求失败，请检查网络或服务器地址"));
      });

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
    logger.debug(logMessage, "ReaderApiClient");

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

    logger.debug(
      `转换后的BookContent: title="${bookContent.title}", content长度=${bookContent.content.length}`,
      "ReaderApiClient"
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

    logger.debug(
      `保存阅读进度: ${JSON.stringify(progressData, null, 2)}`,
      "ReaderApiClient"
    );

    return this.request("/saveBookProgress", {
      method: "POST",
      data: progressData,
    });
  }
}
