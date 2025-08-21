(function () {
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

    switch (message.command) {
      case "updateChapter":
        updateChapter(message.data);
        break;
    }
  });

  function updateChapter(data) {
    chapterTitle.textContent = data.title;
    chapterContent.innerHTML = formatContent(data.content);
    chapterInfo.textContent = `${data.chapterIndex + 1} / ${
      data.totalChapters
    }`;

    prevBtn.disabled = !data.hasPrev;
    nextBtn.disabled = !data.hasNext;

    document.querySelector(".content-area").scrollTop = 0;
  }

  function formatContent(content) {
    if (!content) return "";

    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<p>${line.trim()}</p>`)
      .join("");
  }

  vscode.postMessage({ command: "ready" });
})();