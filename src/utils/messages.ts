import * as vscode from "vscode";
import { logger, normalizeError } from "./logger";

export type ErrorContext =
  | "bookshelf"
  | "chapterList"
  | "content"
  | "saveProgress"
  | "network"
  | "config"
  | "unknown";

/**
 * 生成友好的中文错误提示
 */
export function friendlyErrorMessage(context: ErrorContext, err?: unknown): string {
  const e = err ? normalizeError(err) : undefined;
  const reason = e?.message ? limit(e.message, 140) : undefined;
  const suffix = reason ? `（原因：${reason}）` : "";

  switch (context) {
    case "bookshelf":
      return `加载书架失败，请检查服务器地址与网络连接，或确认用户名与令牌已配置。${suffix}`;
    case "chapterList":
      return `加载章节列表失败，请稍后重试或检查网络连接。${suffix}`;
    case "content":
      return `加载章节内容失败，请稍后重试。${suffix}`;
    case "saveProgress":
      return `保存阅读进度失败，不影响继续阅读，可稍后重试。${suffix}`;
    case "network":
      return `无法连接服务器，请检查网络或设置中的服务器地址与访问令牌。${suffix}`;
    case "config":
      return `配置无效或缺失，请在设置中完成 ReaderMate 配置。${suffix}`;
    default:
      return `发生未知错误，请稍后重试。${suffix}`;
  }
}

/** 限制字符串长度 */
function limit(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

/**
 * 显示友好的错误，并将详细错误写入日志
 */
export function showFriendlyError(context: ErrorContext, err?: unknown, source?: string) {
  logger.error(err ?? new Error("Unknown error"), "操作失败", source);
  vscode.window.showErrorMessage(friendlyErrorMessage(context, err));
}

export function showInfo(message: string) {
  vscode.window.showInformationMessage(message);
}

export function showWarn(message: string) {
  vscode.window.showWarningMessage(message);
}

