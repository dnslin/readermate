# ReaderMate 双后端实施计划

## 目标与边界
支持 Reader3 与 Legado 阅读 Web OpenAPI，统一在现有 VS Code 插件设置页选择，不保留独立配置向导。只运行当前选择的后端，不自动探测或失败回退。保留已发布 Reader3 设置键与默认行为；没有外部 API 消费者或生产数据迁移要求。

接口依据：https://legado.kuku.me/openapi/docs 与 https://legado.kuku.me/openapi/openapi.yaml（2026-10-13 读取）。

## 设计
- `readermate.backend`: `reader3`（默认）或 `legado`。
- Reader3 继续使用 `serverUrl`、`username`、`token`、`appendReader3Path`。
- Legado 使用 `legado.serverUrl`（默认 https://legado.kuku.me）、`legado.apiKey`；地址支持站点根路径和完整 `/openapi/v1` 基础路径。
- ReaderApiClient 作为当前会话唯一入口，内部只构建所选后端。两套协议分开实现，不自动回退。
- 保留统一 Book/Chapter/BookContent 数据；Legado 书籍数字 ID 映射到内部 bookUrl 字符串。章节保留服务端 index 与 isVolume，所有读取路径跳过卷名。
- 正文读取不隐式保存进度；实际阅读成功后显式调用保存进度。预加载永远不推进进度。
- 客户端暴露 dispose/isActive/stateKey/ownsBook。切换先 dispose 旧请求，再替换所有消费者。旧响应不得写入新书架、正文、缓存或阅读历史。
- Book.sourceKey 标记所属连接；本地历史按 stateKey 隔离，避免不同后端或账号串书。旧无来源历史不自动转移。
- `readermate.configure` 仅打开 `@ext:readermate-dnslin.readermate` 原生插件设置页。后端下拉框排在最上方，修改立即生效；不再弹出独立向导或另写一份配置。

## 执行顺序及验收
1. API 与类型：实现两种后端的书架、目录、正文、进度；取消请求；错误上下文。验收：本地 HTTP 集成测试覆盖两协议、鉴权、Legado saveProgress=false、非 2xx、切换取消。
2. 阅读生命周期：书架、卡片、标签页、注释阅读与预加载统一处理切换及卷名。验收：延迟旧响应不能污染新状态；跨卷翻页/预加载请求正确 index；历史来源不匹配不恢复。
3. 设置集成：统一原生设置入口、生效配置输出、仅激活相关配置触发重建。验收：默认 Reader3；两者配置互不覆盖；切换只调用所选后端；打开设置不覆盖凭据或重建连接。
4. 验证：运行相关测试、TypeScript 编译、现有 lint 与 VSIX 打包；启动扩展宿主或可用的最接近实际运行路径。无用户 API Key 时不声称完成线上认证联调。

任务状态记录在会话任务列表中。

## 风险
- Legado 卷名没有正文：保留原始 index，前后章、选章、初始位置与预加载都过滤卷名。
- 切换过程中仍有请求：旧客户端主动取消；消费者在 await 后检查客户端和操作身份。
- 已打开的选择框/恢复面板携带旧书籍：来源标记不匹配则拒绝打开。
- 当前仓库测试脚本指向不存在的测试入口且没有 ESLint 配置：建立可运行的 Node 内置测试入口，不弱化现有断言。

## 完成记录
- [x] 两套协议分离实现，统一 API 会话入口与取消请求。
- [x] 原生设置统一入口、生效配置输出与互斥切换；删除独立向导和相应批量保存状态。
- [x] 所有阅读路径、选章、目录及预加载支持卷名；旧响应与历史按来源隔离。
- [x] 修复缺失的测试入口及 ESLint 配置，保留完整静态检查门禁。
- [x] `pnpm test`：TypeScript、ESLint 及 46 项测试通过。
- [x] `node tests/run-extension-smoke.cjs --visual`：真实 VS Code 扩展宿主通过，Reader3 → Legado、跨卷阅读及 PUT 保存进度，18 次本地 HTTP 请求；退出码 0。
- [x] 通过 `readermate.configure` 打开现有插件设置页，Backend 位于最上方，页面包含 22 项设置；直接从 Legado 切回 Reader3 后，新书架显示且旧正文清空。截图位于 `artifacts/native-settings-legado.png` 与 `artifacts/native-settings-reader3.png`。
- [x] 故意将预加载请求变为 `saveProgress=true` 时，回归测试因进度从 3 误变为 9 而失败；移除临时变异脚本后全套通过。
- [x] `pnpm run package`：生成统一设置入口版本 `readermate-1.2.14.vsix`。

验证使用本地协议服务器，未使用真实 API Key，未声称线上账号认证联调通过。真实宿主首次启动遇到 Windows 保留端口 9435–9534，验证端口调整为 19471/19472 后通过。
