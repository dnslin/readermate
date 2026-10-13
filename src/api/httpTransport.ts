import * as http from "node:http";
import * as https from "node:https";
import { logger } from "../utils/logger";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  data?: unknown;
}

export class HttpTransport {
  private active = true;
  private readonly pending = new Map<http.ClientRequest, () => void>();

  get isActive(): boolean {
    return this.active;
  }

  assertActive(): void {
    if (!this.active) throw new Error("API client disposed，连接已停用");
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    for (const cancel of this.pending.values()) cancel();
  }

  async request<T>(url: URL, options: RequestOptions = {}): Promise<T> {
    this.assertActive();
    // Never log query parameters, credentials, request headers or response bodies.
    logger.debug(`${options.method || "GET"} ${url.origin}${url.pathname}`, "ReaderApiClient");
    return new Promise<T>((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      let settled = false;
      const finish = (error?: Error, value?: T): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(req);
        if (!this.active) reject(new Error("API client disposed，连接已停用"));
        else if (error) reject(error);
        else resolve(value as T);
      };
      const networkFailure = (cause: Error): void => {
        finish(Object.assign(new Error(`无法连接服务器或请求失败: ${cause.message}`), { cause }));
      };
      const req = client.request(url, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          ...options.headers,
        },
      }, (res) => {
        res.setEncoding("utf8");
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("error", networkFailure);
        res.on("end", () => {
          if (settled) return;
          if (!this.active) {
            finish(new Error("API client disposed，连接已停用"));
            return;
          }
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            finish(new Error(`API请求失败 (HTTP ${status}): ${data || res.statusMessage || "空响应"}`));
            return;
          }
          try {
            finish(undefined, JSON.parse(data) as T);
          } catch (cause) {
            finish(Object.assign(new Error(`响应数据解析失败 (HTTP ${status}): ${data}`), { cause }));
          }
        });
      });
      this.pending.set(req, () => {
        const error = new Error("API client disposed，连接已停用");
        finish(error);
        // destroy() aborts both requests awaiting headers and streaming responses.
        // https://nodejs.org/docs/latest-v20.x/api/http.html#requestdestroyerror
        req.destroy(error);
      });
      req.on("error", networkFailure);
      if (options.data !== undefined) req.write(JSON.stringify(options.data));
      req.end();
    });
  }
}
