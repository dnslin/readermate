(function () {
  console.log("reader.js开始执行");
  const vscode = acquireVsCodeApi();

  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const chapterInfo = document.getElementById("chapter-info");
  const chapterTitle = document.getElementById("chapter-title");
  const chapterContent = document.getElementById("chapter-content");

  // 阅读进度跟踪变量
  let lastReportedProgress = 0;
  const PROGRESS_REPORT_THRESHOLD = 5; // 每5%报告一次

  prevBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "prevChapter" });
  });

  nextBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "nextChapter" });
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey) {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (!prevBtn.disabled) {
            vscode.postMessage({ command: "prevChapter" });
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (!nextBtn.disabled) {
            vscode.postMessage({ command: "nextChapter" });
          }
          break;
      }
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    console.log("WebView收到消息:", message);

    switch (message.command) {
      case "updateChapter":
        console.log("开始更新章节:", message.data);
        updateChapter(message.data);
        break;
    }
  });

  function updateChapter(data) {
    console.log("updateChapter被调用，数据:", data);
    console.log("章节标题:", data.title);
    console.log("章节内容长度:", data.content?.length || 0);

    chapterTitle.textContent = data.title || "无标题";
    const formattedContent = formatContent(data.content);
    console.log("格式化后的内容长度:", formattedContent.length);

    chapterContent.innerHTML = formattedContent;
    chapterInfo.textContent = `${data.chapterIndex + 1} / ${data.totalChapters
      }`;

    prevBtn.disabled = !data.hasPrev;
    nextBtn.disabled = !data.hasNext;

    const contentArea = document.querySelector(".content-area");
    contentArea.scrollTop = 0;

    // 重置阅读进度跟踪
    lastReportedProgress = 0;

    // 添加滚动监听器（如果还没有添加）
    if (!contentArea.hasAttribute('data-scroll-listener')) {
      contentArea.addEventListener('scroll', throttle(trackReadingProgress, 500));
      contentArea.setAttribute('data-scroll-listener', 'true');
      console.log('[滚动调试] 已添加滚动监听器');
    }

    console.log("章节更新完成");
  }

  /**
   * 跟踪阅读进度
   */
  function trackReadingProgress() {
    const contentArea = document.querySelector('.content-area');
    const content = document.getElementById('chapter-content');

    if (!contentArea || !content) {
      console.log('[滚动调试] 未找到内容区域或章节内容元素');
      return;
    }

    const scrollTop = contentArea.scrollTop;
    const scrollHeight = contentArea.scrollHeight;
    const clientHeight = contentArea.clientHeight;
    const maxScrollTop = scrollHeight - clientHeight;

    console.log(`[滚动调试] scrollTop: ${scrollTop}, scrollHeight: ${scrollHeight}, clientHeight: ${clientHeight}, maxScrollTop: ${maxScrollTop}`);

    // 避免除零错误
    if (maxScrollTop <= 0) {
      console.log('[滚动调试] maxScrollTop <= 0，无法计算进度');
      return;
    }

    const progress = Math.min(Math.round((scrollTop / maxScrollTop) * 100), 100);

    console.log(`[滚动调试] 计算进度: ${scrollTop} / ${maxScrollTop} * 100 = ${progress}%`);

    // 只有当进度变化超过阈值时才报告
    if (Math.abs(progress - lastReportedProgress) >= PROGRESS_REPORT_THRESHOLD) {
      lastReportedProgress = progress;
      console.log(`[滚动调试] 阅读进度更新: ${progress}% (上次报告: ${lastReportedProgress - (progress - lastReportedProgress)}%)`);

      vscode.postMessage({
        command: 'readingProgress',
        progress: progress
      });
    } else {
      console.log(`[滚动调试] 进度变化不足阈值: ${Math.abs(progress - lastReportedProgress)}% < ${PROGRESS_REPORT_THRESHOLD}%`);
    }
  }

  /**
   * 节流函数
   * @param {Function} func 要节流的函数
   * @param {number} delay 延迟时间（毫秒）
   * @returns {Function} 节流后的函数
   */
  function throttle(func, delay) {
    let lastCall = 0;
    let timeoutId = null;

    return function (...args) {
      const now = Date.now();

      if (now - lastCall >= delay) {
        // 立即执行
        lastCall = now;
        func.apply(this, args);
      } else {
        // 延迟执行
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
          lastCall = Date.now();
          func.apply(this, args);
          timeoutId = null;
        }, delay - (now - lastCall));
      }
    };
  }

  function formatContent(content) {
    console.log("formatContent被调用，原始内容:", content);
    if (!content) {
      console.log("内容为空，返回空字符串");
      return "";
    }

    const lines = content.split("\n");
    console.log("分割后的行数:", lines.length);

    const filteredLines = lines.filter((line) => line.trim());
    console.log("过滤后的行数:", filteredLines.length);

    const formattedLines = filteredLines.map((line) => `<p>${line.trim()}</p>`);
    const result = formattedLines.join("");

    console.log("格式化完成，最终HTML长度:", result.length);
    return result;
  }

  console.log("准备发送ready消息");
  vscode.postMessage({ command: "ready" });
  console.log("ready消息已发送");
})();