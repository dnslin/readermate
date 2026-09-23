# ReaderMate 📚

> 专为开发者打造的 VS Code 极致沉浸式小说阅读与摸鱼扩展，无缝集成 Reader3 开源阅读服务器。
> 零运行时外部依赖，轻量安全，支持**代码注释伪装阅读**、**侧边栏小卡片**与**主编辑区沉浸标签页**。

---

## ✨ 核心特性

### 1. 🥷 代码注释伪装阅读（Ghost Comment Reader）—— 摸鱼天花板
- **纯视觉虚拟图层**：采用 VS Code 原生 `TextEditorDecorationType`，**绝不修改真实代码文件**！文件始终保持干净的未修改状态（无脏文件圆点），不产生 Git 变动，不触发任何 Linter 报错。
- **智能语言语法伪装**：自动识别当前正在编辑的文件类型（TypeScript、Python、Java、Go、Rust、HTML、SQL 等），智能适配对应的注释格式（如 `//`、`#`、`<!-- -->`、`--`）。
- **智能块注释融入**：如果在已有的 `/**` 或 `*` 等 JSDoc/块注释行阅读，自动去除重复的 `//` 前缀，真假难辨。
- **与当前主题 100% 同色**：默认预设经典紫灰注释色（`#6272a4`，完美契合 Dracula、Tokyo Night 等主流暗色主题），同时支持经典注释绿、暗木灰、淡幽灵色或**直接自定义 Hex 颜色值**，与周围真实代码注释完全一致。
- **平稳的原地静止阅读（Static Mode）**：滚轮向下滚动即可无感更替下一句，**代码行绝对不跳动、不闪烁、光标不乱窜**，眼睛停留在舒适的单一行位，即使只有 10 行的短代码文件也能无限畅读！
- **极速伪装跳转（QuickPick）**：按下 `Alt+Shift+C` 弹出伪装成代码符号搜索（`Go to Symbol`）的目录框，打字秒搜章节直达。
- **多重安全瞬隐逃生门**：
  - **敲键盘打字即隐**：只要手指一碰到键盘开始写代码，小说瞬间消失，绝不干扰工作；
  - **切屏失焦即隐**：切换到浏览器或离开 VS Code 瞬间清空；
  - **老板键即隐**：按 `Esc` 键瞬间清除所有注释。

### 2. 📖 多形态阅读器
- **侧边栏小卡片（Sidebar）**：直接嵌入资源管理器侧边栏底部，边看边写，低调小巧。
- **主编辑区独立标签页（Editor）**：支持自适应正文字号与舒适行高倍数。
- **底部面板（Panel）**：与终端、输出并列显示。
- **一键极速伪装**：标签页标题可一键伪装为“输出”、“终端”或自定义标题，隐藏工具栏。

### 3. ⚡ 静默后台预加载（Preload）
- 根据阅读进度（如读到 50%），后台自动通过 Reader3 API 预取后续 1~5 章内容到内存高速缓存，翻页秒开无白屏。

### 4. 🚨 终极一键老板键（Boss Key）
- 无论你处于代码注释模式、侧边栏模式还是标签页模式，按下 **`Escape`** 瞬间关闭阅读界面/清除注释，并将焦点秒速拉回当前代码编辑区。

---

## ⌨️ 快捷键总览

| 功能 | 默认快捷键 | 生效条件 | 描述 |
| :--- | :--- | :--- | :--- |
| **切换注释伪装阅读** | `Alt + R` | 代码编辑区 | **开启/关闭代码注释阅读**，开启后滚轮直接翻句 |
| **长按透视阅读** | `Alt + Shift + R` | 代码编辑区 | 按住显示，松开按键自动隐藏恢复 |
| **注释阅读下一句** | `Alt + Down` / 鼠标滚轮下滚 | 注释阅读中 | 步进到下一句，读完当前章自动无缝切入下一章 |
| **注释阅读上一句** | `Alt + Up` / 鼠标滚轮上滚 | 注释阅读中 | 回退到上一句 |
| **伪装快速跳转章节** | `Alt + Shift + C` | 代码编辑区 | 伪装成代码符号搜索框（QuickPick），回车直达 |
| **终极老板键** | `Escape` | 阅读激活时 | **瞬间隐藏/关闭所有阅读界面，光标切回写代码** |
| **打开书架** | `Ctrl + Shift + L` | 全局 | 展开左侧 ReaderMate 图书目录树 |
| **上一章 / 下一章** | `Ctrl + Left` / `Ctrl + Right` | 阅读面板中 | 常规标签页/侧边栏阅读模式下切章 |

---

## ⚙️ 设置配置指南

打开 VS Code 设置（`Ctrl + ,`），搜索 `readermate`，所有选项按逻辑分为清晰的 4 大类别：

### 1. ReaderMate - 服务器与账号
- `readermate.serverUrl`: Reader3 服务器地址（例如 `https://reader.me` 或自建服务）
- `readermate.username`: Reader3 账户用户名
- `readermate.token`: Reader3 访问令牌（Access Token）
- `readermate.appendReader3Path`: 是否自动在地址后追加 `/reader3` 路径（默认开启）

### 2. ReaderMate - 阅读与界面
- `readermate.chapterDisplay.location`: 阅读器位置（`sidebar` 侧边栏卡片 / `editor` 编辑器标签页 / `panel` 底部面板）
- `readermate.reader.fontSize`: 正文字体大小（单位 px，默认 16）
- `readermate.reader.lineHeight`: 正文行高倍数（默认 1.7 倍）

### 3. ReaderMate - 摸鱼与隐身
- `readermate.commentReader.mode`: 注释阅读模式：
  - `static`: **原地静止阅读（推荐）**，代码完全不跳动，最省眼力、最不易被发觉
  - `walk`: 光标逐行漫游下移
- `readermate.commentReader.color`: 注释预设颜色（`slate` 紫灰 / `green` 经典绿 / `muted` 暗木灰 / `dim` 极暗灰 / `ghost` 幽灵灰）
- `readermate.commentReader.customColor`: **自定义十六进制颜色**（如填入 `#6272a4`，完全匹配你的主题注释色）
- `readermate.commentReader.lines`: 同时显示的注释行数（默认 1 行）
- `readermate.commentReader.showProgress`: 是否在首行标注当前章节与百分比（如 `[第1章 10%]`）
- `readermate.stealth.enabled`: 启用标签页摸鱼隐身伪装（默认开启）
- `readermate.stealth.disguiseTitle`: 隐身模式下的伪装标题（默认为 `输出`）
- `readermate.stealth.hideToolbar`: 隐藏顶部翻页工具栏（默认开启）

### 4. ReaderMate - 预加载与缓存
- `readermate.preload.enabled`: 开启后台静默预加载（默认开启）
- `readermate.preload.chapterCount`: 预加载后续章节数（1~5 章，默认 2）
- `readermate.preload.triggerProgress`: 触发预加载的阅读进度阈值（默认 50%）
- `readermate.preload.maxCacheSize`: 内存缓存最多保留章节数（默认 10 章）

---

## 🚀 快速上手

1. 在 VS Code 安装 **ReaderMate** 扩展；
2. 配置好你的 Reader3 服务器信息（地址、账号与 Token）；
3. 按 `Ctrl+Shift+L` 打开左侧书架，右键你想阅读的小说选择 **“在代码注释中阅读本书”**；
4. 回到代码编辑区，按 **`Alt + R`**，滑动鼠标滚轮，即可在代码行间开始摸鱼阅读！

---

## 🛠️ 本地开发与构建

本项目遵循严格的轻量化工程标准，**零第三方运行时 NPM 依赖**（仅依赖 Node.js 内置模块与 VS Code 原生 API）：

```bash
# 安装开发构建依赖
pnpm install

# 编译 TypeScript
pnpm run compile

# 打包 VSIX 离线安装包
pnpm run package

# 一键编译并打包
pnpm run build
```

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE.md) 开源。
