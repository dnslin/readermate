(function () {
  console.log("reader.js开始执行");
  const vscode = acquireVsCodeApi();

  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const chapterInfo = document.getElementById("chapter-info");
  const chapterTitle = document.getElementById("chapter-title");
  const chapterContent = document.getElementById("chapter-content");

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

    document.querySelector(".content-area").scrollTop = 0;
    console.log("章节更新完成");
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