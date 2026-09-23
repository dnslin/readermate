# ReaderMate

基于 Reader3 服务器的 VS Code 小说阅读插件。支持代码行间伪装阅读（虚拟注释图层）、侧边栏卡片及主编辑区独立标签页。

插件无第三方运行时 npm 依赖，仅依赖 Node.js 内置模块与 VS Code Extension API。

## 特性

- **代码注释伪装**：通过虚拟文本装饰层在当前代码行末展示小说内容，不修改文件内容，无 git diff，不触发 linter。
- **语言语法适配**：自动根据当前文件语言（TS、JS、Python、Go、Rust、HTML、SQL 等）匹配单行或块注释语法。若当前行已有 `/**` 或 `*` 注释符号，自动省略重复前缀。
- **原地静止与滚轮翻页**：默认原地静止模式（`static`），滚轮滑动仅更新当前行的文本切片，代码视图与光标保持不动；支持章节末尾自动切入下一章。
- **安全瞬隐机制**：敲键盘写代码、编辑器失焦切屏或按 `Escape` 键立即清空虚拟文本。
- **多端视图**：支持侧边栏视图卡片、主编辑区标签页和底部面板三种展示形态。
- **静默预加载**：根据当前章节阅读进度，后台自动缓存后续章节至内存。
- **快捷选章**：支持通过伪装搜索框（QuickPick）按章节名快速跳转，无需展开侧边栏目录。

## 快捷键

| 命令 | 快捷键 | 上下文 | 说明 |
| --- | --- | --- | --- |
| 切换注释阅读 | `Alt + R` | 代码编辑区 | 开启/关闭代码注释伪装模式 |
| 长按透视阅读 | `Alt + Shift + R` | 代码编辑区 | 按住显示，松开按键自动隐藏 |
| 注释阅读下一句 | `Alt + Down` 或 鼠标滚轮向下 | 注释阅读激活时 | 步进到下一句，章末自动切章 |
| 注释阅读上一句 | `Alt + Up` 或 鼠标滚轮向上 | 注释阅读激活时 | 回退到上一句 |
| 快速选章 | `Alt + Shift + C` | 代码编辑区 | 弹出伪装搜索框（QuickPick）搜索章节 |
| 老板键 / 退出阅读 | `Escape` | 阅读激活时 | 隐藏注释层、关闭阅读面板并将焦点切回编辑区 |
| 打开书架 | `Ctrl + Shift + L` | 全局 | 聚焦左侧 ReaderMate 书架树 |
| 上一章 / 下一章 | `Ctrl + Left` / `Ctrl + Right` | 阅读器面板激活时 | 切换章节 |

## 配置项

在 VS Code 设置中搜索 `readermate` 可进行调整，主要配置项如下：

### 服务器与账号
- `readermate.serverUrl`: Reader3 服务器地址（默认 `https://reader.me`）
- `readermate.username`: 账户用户名
- `readermate.token`: 访问令牌（Access Token）
- `readermate.appendReader3Path`: 是否在地址末尾自动补全 `/reader3` 路径（默认 `true`）

### 阅读与界面
- `readermate.chapterDisplay.location`: 阅读器位置，可选 `sidebar`（侧边栏）、`editor`（编辑器标签页）、`panel`（底部面板）
- `readermate.reader.fontSize`: 标签页正文字号（默认 `16`）
- `readermate.reader.lineHeight`: 标签页行高倍数（默认 `1.7`）

### 摸鱼与隐身
- `readermate.commentReader.mode`: 运动模式，可选 `static`（原地静止，默认）或 `walk`（光标逐行漫游）
- `readermate.commentReader.color`: 预设字体颜色，可选 `slate`（紫灰 `#6272a4`，默认）、`green`（经典绿 `#6a9955`）、`muted`（暗灰 `#5c6370`）、`dim`（低对比 `#4b5263`）、`ghost`（半透明）
- `readermate.commentReader.customColor`: 自定义十六进制颜色代码（如 `#6272a4`，填写后覆盖预设颜色）
- `readermate.commentReader.lines`: 同时展示的行数（默认 `1`）
- `readermate.commentReader.showProgress`: 是否在行首标注章节进度（默认 `true`）
- `readermate.stealth.enabled`: 标签页是否启用标题伪装（默认 `true`）
- `readermate.stealth.disguiseTitle`: 伪装标签标题（默认 `输出`）
- `readermate.stealth.hideToolbar`: 标签页是否隐藏翻页工具栏（默认 `true`）

### 预加载与缓存
- `readermate.preload.enabled`: 是否启用后续章节预加载（默认 `true`）
- `readermate.preload.chapterCount`: 预加载章节数（1-5，默认 `2`）
- `readermate.preload.triggerProgress`: 触发预加载的阅读进度阈值（30-95，默认 `50`）
- `readermate.preload.maxCacheSize`: 内存缓存保留章节上限（5-20，默认 `10`）

## 使用方法

1. 配置 Reader3 服务器地址、用户名及 Token。
2. 按 `Ctrl+Shift+L` 展开书架，在书籍项右键选择“在代码注释中阅读本书”。
3. 在任意打开的代码文件中按 `Alt+R` 开启注释阅读，使用鼠标滚轮翻句。
4. 敲击任意代码键打字或按 `Escape` 键即可退出。

## 开发与构建

环境要求：Node.js >= 20，pnpm >= 8。

```bash
# 安装依赖
pnpm install

# 编译 TypeScript
pnpm run compile

# 打包 VSIX 安装包
pnpm run package

# 一键编译并打包
pnpm run build
```

## 许可证

MIT License
