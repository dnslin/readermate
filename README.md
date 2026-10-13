# ReaderMate

支持 Reader3 和 Legado 阅读 Web OpenAPI 的 VS Code 小说阅读插件。两套后端可在设置中切换，同一时刻只启用一套。支持代码行间伪装阅读（虚拟注释图层）、侧边栏卡片及主编辑区独立标签页。

插件无第三方运行时 npm 依赖，仅依赖 Node.js 内置模块与 VS Code Extension API。

## 特性

- **双后端切换**：Reader3 使用用户名与 Token，Legado 使用 API Key；两套配置分别保留，未启用的后端不发起请求。
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

在 VS Code 扩展列表中点击 ReaderMate 的齿轮 →「扩展设置」，或运行命令「ReaderMate: 打开插件设置」。这两个入口打开同一个原生设置页，不再使用独立配置向导。

### 服务器与账号
- `readermate.backend`: 当前后端，可选 `reader3`（默认）或 `legado`。
- `readermate.serverUrl`: Reader3 服务器地址（默认 `https://reader.me`）
- `readermate.username`: Reader3 账户用户名
- `readermate.token`: Reader3 访问令牌（Access Token）
- `readermate.appendReader3Path`: Reader3 地址末尾是否自动补全 `/reader3`（默认 `true`）
- `readermate.legado.serverUrl`: Legado 站点地址（默认 `https://legado.kuku.me`），也可填写完整的 `/openapi/v1` 基础地址。
- `readermate.legado.apiKey`: 在 Legado 网页「我的 → API Key」中生成的密钥。通过 `X-API-Key` 请求头发送，不放进 URL 或日志；不要提交到工作区版本控制中。

设置页最上方的 `Readermate: Backend` 下拉框用于切换后端，选择后立即生效，无需另外点击保存。VS Code 原生设置页会同时列出两套配置，但只有所选后端的设置生效。修改未启用后端的地址或凭据，不会重连当前后端。切换后端或修改当前连接配置时，会取消旧请求，清空当前书籍、正文和预加载缓存，然后加载新书架；不会失败后自动回退到另一套后端。

注释阅读历史按后端、服务器地址和凭据分别保存。切回原连接后，开启注释阅读可恢复该连接的历史。旧版本未标明连接来源的本地历史不会自动套用到新连接；仍可通过后端书架的章节进度继续阅读。

Legado 的卷名只作为目录标题显示，不可点击阅读。翻页、选章和预加载都会跳过卷名，仍使用服务端原始章节序号。预加载明确设置 `saveProgress=false`，实际读到章节后再保存进度。

接口依据：[Legado 开放接口文档](https://legado.kuku.me/openapi/docs) · [OpenAPI 定义](https://legado.kuku.me/openapi/openapi.yaml)。

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

1. 打开 ReaderMate「扩展设置」，在最上方 `Readermate: Backend` 选择后端，再填写对应配置。Reader3 使用原来的 Server Url、Username、Token；Legado 使用下方的 Legado Server Url、Legado API Key。也可在设置中搜索 `readermate.backend` 直接定位切换项。
2. 按 `Ctrl+Shift+L` 展开书架，在书籍项右键选择“在代码注释中阅读本书”。
3. 在任意打开的代码文件中按 `Alt+R` 开启注释阅读，使用鼠标滚轮翻句。
4. 敲击任意代码键打字或按 `Escape` 键即可退出。

安装新版 VSIX 后，执行「Developer: Reload Window / 开发人员: 重新加载窗口」。1.2.14 版统一了设置入口；如果仍只看到旧的 19 项设置且没有 Backend 下拉框，请先确认正在运行的插件版本并重载窗口。

## 开发与构建

环境要求：Node.js >= 20，pnpm >= 8。

```bash
# 安装依赖
pnpm install

# 编译 TypeScript
pnpm run compile

# 编译、ESLint 检查及回归测试
pnpm test

# 在真实 VS Code 扩展宿主运行本地 HTTP 切换验证
pnpm run test:smoke

# 打包 VSIX 安装包
pnpm run package

# 一键编译并打包
pnpm run build
```

`test:smoke` 在独立测试配置目录中验证 Reader3 → Legado 切换、正文加载、跳过卷名及进度保存，不使用真实账号。Windows 默认使用本机 `code` 对应的 VS Code；可用环境变量 `VSCODE_EXECUTABLE_PATH` 指定可执行文件，其他平台未指定时由 `@vscode/test-electron` 下载测试宿主。

## 后端维护边界

- `src/api/reader3Backend.ts`：Reader3 请求路径、鉴权和响应格式。
- `src/api/legadoBackend.ts`：Legado OpenAPI 请求与数据转换。
- `src/api/readerApi.ts`：仅创建所选后端，标记书籍所属连接并管理会话关闭。
- `src/api/httpTransport.ts`：共享 HTTP 请求、错误上下文及请求取消。
- 阅读器、书架与预加载只使用统一数据类型；更换连接后丢弃旧异步结果，避免串书或混用缓存。

## 1.2.14 更新

- 新增 Legado 阅读 Web OpenAPI 后端，保留 Reader3 配置，支持在插件设置中互斥切换。
- 删除重复配置向导，命令「打开插件设置」直接进入现有设置页。
- 修复切换后旧请求、正文与缓存残留；阅读历史按连接隔离。
- 目录、翻页和预加载跳过卷名；预加载不再推进 Legado 阅读进度。

## 许可证

MIT License
