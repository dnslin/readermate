import * as vscode from "vscode";

export type LogLevel = "debug" | "info" | "warn" | "error";

class LoggerImpl {
  private channel?: vscode.OutputChannel;
  private level: LogLevel = "info";
  private name = "ReaderMate";

  init(channel: vscode.OutputChannel, level: LogLevel = "info") {
    this.channel = channel;
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const order: Record<LogLevel, number> = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
    };
    return order[level] >= order[this.level];
  }

  private ts(): string {
    return new Date().toISOString();
  }

  private fmt(level: LogLevel, component: string | undefined, message: string) {
    const comp = component ? ` [${component}]` : "";
    return `${this.ts()} ${level.toUpperCase()}${comp} ${message}`;
  }

  debug(message: string, component?: string) {
    if (!this.shouldLog("debug")) return;
    const line = this.fmt("debug", component, message);
    console.debug(line);
    this.channel?.appendLine(line);
  }

  info(message: string, component?: string) {
    if (!this.shouldLog("info")) return;
    const line = this.fmt("info", component, message);
    console.log(line);
    this.channel?.appendLine(line);
  }

  warn(message: string, component?: string) {
    if (!this.shouldLog("warn")) return;
    const line = this.fmt("warn", component, message);
    console.warn(line);
    this.channel?.appendLine(line);
  }

  error(err: unknown, message?: string, component?: string) {
    const errObj = normalizeError(err);
    const prefix = message ? `${message} - ` : "";
    const line = this.fmt(
      "error",
      component,
      `${prefix}${errObj.message}${errObj.stack ? `\n${errObj.stack}` : ""}`
    );
    console.error(line);
    this.channel?.appendLine(line);
  }
}

export const logger = new LoggerImpl();

export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

