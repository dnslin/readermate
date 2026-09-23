(function () {
  const vscode = acquireVsCodeApi();

  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const catalogBtn = document.getElementById("catalog-btn");
  const chapterInfo = document.getElementById("chapter-info");
  const chapterTitle = document.getElementById("chapter-title");
  const chapterContent = document.getElementById("chapter-content");
  const loadingBox = document.getElementById("loading-box");
  const loadingText = document.getElementById("loading-text");
  const errorBox = document.getElementById("error-box");
  const errorText = document.getElementById("error-text");
  const retryBtn = document.getElementById("retry-btn");
  const chapterBody = document.getElementById("chapter-body");
  const contentArea = document.querySelector(".content-area");

  let lastReportedProgress = 0;
  const PROGRESS_REPORT_THRESHOLD = 5;
  let lastNavTime = 0;
  function triggerPrev() {
    const now = Date.now();
    if (now - lastNavTime < 300) return;
    lastNavTime = now;
    if (prevBtn && !prevBtn.disabled) {
      vscode.postMessage({ command: "prevChapter" });
    }
  }

  function triggerNext() {
    const now = Date.now();
    if (now - lastNavTime < 300) return;
    lastNavTime = now;
    if (nextBtn && !nextBtn.disabled) {
      vscode.postMessage({ command: "nextChapter" });
    }
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", triggerPrev);
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", triggerNext);
  }

  if (catalogBtn) {
    catalogBtn.addEventListener("click", () => {
      vscode.postMessage({ command: "selectChapter" });
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      vscode.postMessage({ command: "retry" });
    });
  }

  document.addEventListener("keydown", (e) => {
    // 老板键：Esc 或 Ctrl+W
    if (e.key === "Escape" || (e.ctrlKey && (e.key === "w" || e.key === "W"))) {
      e.preventDefault();
      vscode.postMessage({ command: "panic" });
      return;
    }

    // 目录快捷键：Alt+C 或 Ctrl+Shift+C
    if (
      (e.altKey && (e.key === "c" || e.key === "C")) ||
      (e.ctrlKey && e.shiftKey && (e.key === "c" || e.key === "C"))
    ) {
      e.preventDefault();
      vscode.postMessage({ command: "selectChapter" });
      return;
    }

    // 注意：Ctrl+Left / Ctrl+Right 已在 VS Code package.json 注册为全局快捷键，
    // 此处切勿重复发送 postMessage，否则会导致单次按键跳两章（如48跳50）
      // 单键翻页快捷键：[ 或 ]
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
      if (tag !== "input" && tag !== "textarea") {
        if (e.key === "[") {
          e.preventDefault();
          triggerPrev();
        } else if (e.key === "]") {
          e.preventDefault();
          triggerNext();
        }
      }
  });
  window.addEventListener("focus", () => {
    vscode.postMessage({ command: "focus" });
  });

  window.addEventListener("blur", () => {
    vscode.postMessage({ command: "blur" });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !message.command) return;

    switch (message.command) {
      case "loading":
        showLoading(message.data?.title);
        break;
      case "error":
        showError(message.data?.message);
        break;
      case "updateChapter":
        updateChapter(message.data);
        break;
      case "applyStealth":
        applyStealth(message.data);
        break;
    }
  });

  function showLoading(title) {
    if (loadingBox) {
      loadingBox.style.display = "flex";
      if (loadingText) {
        loadingText.textContent = title ? `正在加载《${title}》...` : "正在加载章节内容...";
      }
    }
    if (errorBox) {
      errorBox.style.display = "none";
    }
  }

  function showError(msg) {
    if (loadingBox) {
      loadingBox.style.display = "none";
    }
    if (errorBox) {
      errorBox.style.display = "flex";
      if (errorText) {
        errorText.textContent = msg || "加载失败，请重试";
      }
    }
  }

  function updateChapter(data) {
    if (!data) return;

    if (loadingBox) loadingBox.style.display = "none";
    if (errorBox) errorBox.style.display = "none";
    if (chapterBody) chapterBody.style.display = "block";

    if (chapterTitle) {
      chapterTitle.textContent = data.title || "无标题";
    }

    if (chapterContent) {
      chapterContent.innerHTML = formatContent(data.content);
    }

    if (chapterInfo) {
      chapterInfo.textContent = `${data.chapterIndex + 1} / ${data.totalChapters}`;
    }

    if (prevBtn) prevBtn.disabled = !data.hasPrev;
    if (nextBtn) nextBtn.disabled = !data.hasNext;

    if (contentArea) {
      contentArea.scrollTop = 0;
    }
    window.scrollTo(0, 0);

    lastReportedProgress = 0;

    if (contentArea && !contentArea.hasAttribute("data-scroll-listener")) {
      contentArea.addEventListener("scroll", throttle(trackReadingProgress, 400));
      contentArea.setAttribute("data-scroll-listener", "true");
    }
  }

  function applyStealth(config) {
    try {
      const { stealthEnabled, hideToolbar, fontSize, lineHeight } = config || {};
      if (typeof fontSize === "number") {
        document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
      }
      if (typeof lineHeight === "number") {
        document.documentElement.style.setProperty("--reader-line-height", String(lineHeight));
      }

      if (stealthEnabled) {
        document.body.classList.add("stealth");
        const tb = document.querySelector(".toolbar");
        if (tb) {
          tb.style.display = hideToolbar ? "none" : "";
        }
      } else {
        document.body.classList.remove("stealth");
        const tb = document.querySelector(".toolbar");
        if (tb) {
          tb.style.display = "";
        }
      }
    } catch (e) {
      console.error("[ReaderMate] applyStealth failed:", e);
    }
  }

  function trackReadingProgress() {
    if (!contentArea) return;

    const scrollTop = contentArea.scrollTop;
    const scrollHeight = contentArea.scrollHeight;
    const clientHeight = contentArea.clientHeight;
    const maxScrollTop = scrollHeight - clientHeight;

    if (maxScrollTop <= 0) return;
    const progress = Math.min(Math.round((scrollTop / maxScrollTop) * 100), 100);
    if (Math.abs(progress - lastReportedProgress) >= PROGRESS_REPORT_THRESHOLD) {
      lastReportedProgress = progress;
      vscode.postMessage({
        command: "readingProgress",
        progress: progress,
      });
    }
  }

  function throttle(func, delay) {
    let lastCall = 0;
    let timeoutId = null;

    return function (...args) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        func.apply(this, args);
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          lastCall = Date.now();
          func.apply(this, args);
          timeoutId = null;
        }, delay - (now - lastCall));
      }
    };
  }

  function formatContent(content) {
    if (!content) return "<p>本章内容为空</p>";

    const lines = content.split("\n");
    const filteredLines = lines.filter((line) => line.trim());
    if (filteredLines.length === 0) return "<p>本章内容为空</p>";

    return filteredLines
      .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
      .join("");
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 通知插件 WebView 准备就绪
  vscode.postMessage({ command: "ready" });
})();
