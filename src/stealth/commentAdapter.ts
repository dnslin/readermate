/**
 * 语言注释适配器
 * 根据当前激活代码编辑器的语言类型，将小说文本适配为该语言标准的注释形式
 */

export interface CommentStyle {
  prefix: string;
  suffix: string;
}

/**
 * 获取指定编程语言的单行注释样式
 * @param languageId VS Code 语言标识符（如 typescript, python, html 等）
 */
export function getCommentStyle(languageId: string): CommentStyle {
  switch (languageId.toLowerCase()) {
    case "python":
    case "ruby":
    case "perl":
    case "perl6":
    case "shellscript":
    case "bash":
    case "zsh":
    case "powershell":
    case "yaml":
    case "dockerfile":
    case "r":
    case "makefile":
    case "cmake":
    case "graphql":
      return { prefix: "# ", suffix: "" };

    case "html":
    case "xml":
    case "markdown":
    case "svg":
    case "vue":
      return { prefix: "<!-- ", suffix: " -->" };

    case "css":
    case "less":
    case "scss":
      return { prefix: "/* ", suffix: " */" };

    case "sql":
    case "lua":
    case "haskell":
    case "ada":
      return { prefix: "-- ", suffix: "" };

    case "ini":
    case "clojure":
    case "lisp":
    case "scheme":
      return { prefix: "; ", suffix: "" };

    case "bat":
      return { prefix: "REM ", suffix: "" };

    default:
      // 默认为 C 风格单行注释（TS/JS/Java/C/C++/Go/Rust/Swift/Kotlin/PHP/Dart）
      return { prefix: "// ", suffix: "" };
  }
}

/**
 * 将文本格式化为伪装的注释字符串
 * @param languageId 当前语言标识符
 * @param text 正文切片文本
 * @param prefixText 可选的前置标签（如进度或章节名）
 * @param lineText 当前行的实际已有代码文本（用于智能避免重复注释前缀）
 * @param includeCommentMarker 是否包含语言注释标记（默认 true）
 */
export function formatComment(
  languageId: string,
  text: string,
  prefixText?: string,
  lineText?: string,
  includeCommentMarker = true
): string {
  let style = getCommentStyle(languageId);

  if (!includeCommentMarker) {
    style = { prefix: "", suffix: "" };
  } else if (lineText) {
    const trimmed = lineText.trim();
    // 如果当前行已经处于注释块中（如 /** 或 * 或已带 //、# 等），智能省略重复的前缀标记
    if (
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("--") ||
      trimmed.startsWith("<!--")
    ) {
      style = { prefix: "", suffix: "" };
    }
  }

  const tag = prefixText ? `[${prefixText}] ` : "";
  return `${style.prefix}${tag}${text}${style.suffix}`;
}
