# ChatGPT 与 Codex 统一归档工作站项目计划书

日期：2026-06-11

## 1. 项目背景

在使用 ChatGPT 和 Codex 进行长上下文对话、资料分析、软件开发时，用户会遇到两个核心问题：

1. 对话变长后，模型可能遗忘上文，用户自己也难以回忆哪些关键信息被遗漏。
2. 聊天记录、上传文件、AI 生成文档、代码修改、测试结果分散在不同地方，缺少统一归档与版本化记录。

现有工具已经可以部分导出 ChatGPT 对话文本，例如浏览器扩展或官方数据导出；但对“指定聊天/项目的一键增量归档”“AI 生成文件下载”“Codex 开发过程实时日志”“跨工具统一知识库”等需求覆盖不足。

因此，本项目计划拆成两个互补产品：

1. **ChatGPT Archive Extension**：面向 ChatGPT 网页端，支持指定聊天或指定项目的一键增量归档。
2. **Codex Project Journal**：面向本地软件开发项目，支持 Codex 开发过程的实时归档、diff 记录、产物登记和阶段摘要。

两个产品最终汇入同一个本地归档目录，形成统一的“AI 工作站记忆库”。

## 2. 项目目标

### 2.1 总体目标

构建一个本地优先、用户可控、可增量更新的 AI 对话与开发过程归档系统，支持：

- 将指定 ChatGPT 聊天导出为 Markdown、JSON 和附件目录。
- 将指定 ChatGPT Project 中的多条聊天进行一键增量同步。
- 尽可能保存 AI 生成的文档、图片、代码文件、下载产物。
- 记录 Codex 在软件项目中的每轮开发任务、文件变更、git diff、运行命令、测试结果和输出文件。
- 生成适合再次交给大模型总结的结构化上下文包。

### 2.2 非目标

第一阶段不做以下事情：

- 不破解 ChatGPT Windows 桌面端或网页端内部加密数据。
- 不做全账号后台无感爬取。
- 不绕过用户权限下载不可访问文件。
- 不保证可以下载所有历史上传文件。
- 不替代 git，而是补充 git 无法表达的“开发意图、AI 对话和验证过程”。

## 3. 合规与权限边界

项目应坚持以下原则：

1. **用户主动触发**：由用户打开指定聊天、项目或本地仓库后点击同步。
2. **只归档用户自己的数据**：不抓取他人内容，不绕过访问权限。
3. **本地优先**：默认保存到用户本地目录，不上传到第三方服务。
4. **不依赖逆向破解**：优先使用页面可见内容、官方导出包、本地文件系统、git diff 和用户授权路径。
5. **可审计**：每个归档文件记录来源、时间、URL、hash、同步方式和失败原因。

## 4. 产品一：ChatGPT Archive Extension

### 4.1 产品定位

ChatGPT Archive Extension 是一个浏览器扩展，用于在 ChatGPT 网页端对指定聊天或指定 Project 进行一键增量归档。

它的目标不是做全自动爬虫，而是做一个“用户明确选择范围后的一键备份器”。

### 4.2 核心功能

- 当前聊天一键归档。
- 当前聊天增量更新。
- 当前 Project 聊天列表识别。
- 指定 Project 批量同步。
- 用户消息、AI 回复、代码块、表格、链接提取。
- AI 生成文件、图片、下载链接的检测与保存。
- 生成 Markdown、JSON、manifest。
- 失败项记录，例如文件链接过期、无下载权限、页面未加载完整。

### 4.3 目录结构

```text
archive/
  chatgpt/
    projects/
      project-slug-or-id/
        project.json
        chats/
          chat-id/
            conversation.md
            conversation.json
            manifest.json
            assets/
              generated/
              images/
              downloads/
              unresolved/
    standalone-chats/
      chat-id/
        conversation.md
        conversation.json
        manifest.json
        assets/
```

### 4.4 数据模型

每条消息至少包含：

```json
{
  "id": "message-id-or-generated-hash",
  "conversation_id": "chat-id",
  "source": "chatgpt-web",
  "role": "user | assistant | tool | system",
  "created_at": "ISO-8601",
  "content_markdown": "...",
  "content_blocks": [],
  "attachments": [],
  "generated_files": [],
  "links": [],
  "hash": "sha256"
}
```

每个文件至少包含：

```json
{
  "id": "file-id-or-generated-hash",
  "kind": "uploaded | generated | image | download | unresolved",
  "filename": "example.pdf",
  "mime_type": "application/pdf",
  "source_message_id": "message-id",
  "source_url": "https://...",
  "local_path": "assets/generated/example.pdf",
  "sha256": "...",
  "download_status": "success | failed | skipped",
  "failure_reason": ""
}
```

## 5. ChatGPT Archive Extension 分阶段计划

### 阶段 C1：当前聊天文本归档 MVP

目标：支持用户打开一个 ChatGPT 网页对话后，一键导出当前聊天文本。

实现内容：

- 浏览器扩展基础框架。
- 识别当前页面是否为 ChatGPT 聊天页面。
- 提取聊天标题、URL、conversation id。
- 提取可见用户消息和 AI 回复。
- 保留代码块、列表、表格、链接。
- 生成 `conversation.md`。
- 生成 `conversation.json`。

验收标准：

- 用户打开任意一个 ChatGPT 聊天页面，点击“Archive Current Chat”。
- 本地生成一个聊天目录。
- `conversation.md` 中能清楚标注 `User` 和 `Assistant`。
- 代码块格式保持为 Markdown fenced code block。
- 同一聊天重复导出不会产生重复消息。

### 阶段 C2：增量更新

目标：让同一聊天可以反复同步，只追加新增内容或更新变化内容。

实现内容：

- 为每条消息生成稳定 hash。
- 建立 `manifest.json`。
- 比较已有消息与页面消息。
- 新增消息追加到 JSON。
- Markdown 重新渲染。
- 记录每次同步时间和同步结果。

验收标准：

- 第一次同步后，继续在 ChatGPT 中提问。
- 第二次点击同步，只新增后续消息。
- `manifest.json` 记录两次同步时间。
- 不出现重复消息。

### 阶段 C3：AI 生成文件与图片归档

目标：尽可能保存 AI 回复中生成的文件、图片和下载产物。

实现内容：

- 扫描 AI 回复中的图片元素、下载按钮、文件链接。
- 尝试下载可访问资源。
- 保存到 `assets/generated/`、`assets/images/` 或 `assets/downloads/`。
- 计算文件 hash。
- 在 Markdown 中插入本地文件引用。
- 对失败下载写入 `assets/unresolved/` 或 `manifest.json`。

验收标准：

- 当 AI 回复包含可下载文件时，同步后本地能看到该文件。
- 当 AI 回复包含图片时，同步后本地能看到图片副本。
- 如果文件无法下载，manifest 中记录失败原因。
- Markdown 中能看到文件列表和本地路径。

### 阶段 C4：当前 Project 一键同步

目标：支持对当前 ChatGPT Project 中的聊天进行批量增量同步。

实现内容：

- 识别当前 Project 页面。
- 读取 Project 标题、URL、可见聊天列表。
- 支持用户选择全部聊天或部分聊天。
- 逐个打开或加载聊天内容。
- 调用 C1-C3 的归档能力。
- 增加限速、失败重试、断点续传。

验收标准：

- 用户进入一个 Project 页面，点击“Sync Current Project”。
- 系统列出可同步聊天数量。
- 同步完成后，每个聊天都有独立目录。
- 中途中断后再次同步，可以从未完成项继续。
- 同步报告列出成功、失败、跳过数量。

### 阶段 C5：官方数据导出包导入

目标：支持导入 OpenAI 官方数据导出 ZIP，用于补齐历史聊天。

实现内容：

- 解析官方导出 ZIP。
- 识别 conversations 数据。
- 将历史聊天转换为统一 JSON。
- 与浏览器扩展已归档聊天合并。
- 对无法对应的聊天建立 standalone 目录。

验收标准：

- 用户选择官方导出 ZIP 后，可以生成 Markdown 和 JSON。
- 已存在聊天不会重复导入。
- 导入报告显示聊天数量、消息数量、合并数量和失败数量。

### 阶段 C6：搜索与上下文包导出

目标：把归档内容变成可检索、可再次喂给大模型的资料库。

实现内容：

- 全文搜索聊天标题、消息、文件名。
- 按 Project、日期、标签筛选。
- 一键导出“上下文包”。
- 上下文包包含 Markdown、manifest 和附件索引。
- 支持按 token 预算切分输出。

验收标准：

- 用户能搜索关键词并定位到对应聊天。
- 用户能选择一个或多个聊天导出上下文包。
- 上下文包可直接交给大模型进行总结或关键信息提取。

## 6. 产品二：Codex Project Journal

### 6.1 产品定位

Codex Project Journal 是一个本地开发过程归档工具，用于记录 Codex 在软件项目中每轮迭代做了什么、改了哪些文件、为什么改、如何验证、生成了哪些产物。

它不替代 git，而是补充 git commit 难以完整保存的 AI 协作过程。

### 6.2 核心功能

- 项目级 AI 工作日志。
- 每轮任务开始与结束记录。
- 文件变更检测。
- git diff 快照。
- 命令与测试结果摘要。
- 生成文件与输出目录登记。
- 自动生成阶段摘要。
- 可选 checkpoint commit。

### 6.3 目录结构

```text
project-root/
  .ai-archive/
    journal.jsonl
    sessions/
      session-id/
        session.md
        session.json
        diffs/
          turn-001.patch
          turn-002.patch
        commands/
          turn-001.json
        artifacts/
          manifest.json
    summaries/
      weekly-summary.md
      release-summary.md
  docs/
    ai-worklog.md
```

### 6.4 数据模型

每轮开发记录：

```json
{
  "turn_id": "turn-001",
  "session_id": "session-id",
  "started_at": "ISO-8601",
  "ended_at": "ISO-8601",
  "user_request": "...",
  "assistant_summary": "...",
  "files_changed": [],
  "git_diff_path": "diffs/turn-001.patch",
  "commands_run": [],
  "tests": [],
  "artifacts": [],
  "status": "completed | failed | interrupted"
}
```

## 7. Codex Project Journal 分阶段计划

### 阶段 D1：项目日志基础设施

目标：在本地项目中建立标准归档目录和日志格式。

实现内容：

- 初始化 `.ai-archive/`。
- 创建 `journal.jsonl`。
- 创建 `docs/ai-worklog.md`。
- 定义 session、turn、artifact、command 的 JSON schema。
- 提供 CLI 命令：`journal init`、`journal status`。

验收标准：

- 在任意 git 项目中运行初始化命令后，生成标准目录结构。
- `journal status` 能显示当前项目是否已启用归档。
- JSON schema 可用于校验样例日志。

### 阶段 D2：文件变更与 git diff 快照

目标：自动记录每轮开发前后的文件变化。

实现内容：

- 读取 git 工作区状态。
- 记录任务开始时的 baseline。
- 任务结束时生成 `git diff` patch。
- 记录新增、修改、删除、重命名文件。
- 计算关键文件 hash。

验收标准：

- 修改文件后运行归档命令，会生成 patch 文件。
- `session.md` 中显示本轮修改文件列表。
- patch 可以用于人工审查本轮变化。
- 没有变化时不会生成空 patch。

### 阶段 D3：命令与测试结果记录

目标：保存开发过程中执行过的重要命令和验证结果。

实现内容：

- 记录命令、退出码、开始结束时间。
- 保存 stdout/stderr 摘要。
- 标记测试命令。
- 在 session Markdown 中生成验证章节。
- 对长输出做截断并保留原始输出文件。

验收标准：

- 执行测试命令后，日志中能看到命令、退出码和摘要。
- 失败命令会被明确标记。
- `session.md` 能说明本轮是否通过验证。

### 阶段 D4：Codex 协作约定集成

目标：让 Codex 每轮任务结束后自动或半自动写入开发日志。

实现内容：

- 提供 AGENTS.md 模板。
- 要求每轮完成后更新 `.ai-archive/journal.jsonl` 或 `docs/ai-worklog.md`。
- 提供“本轮总结”模板。
- 记录用户需求、实现摘要、验证结果和后续建议。

验收标准：

- 在启用模板的项目中，Codex 完成任务后会生成结构化工作日志。
- 日志中包含用户需求、修改摘要、文件列表和验证结果。
- 用户无需手工整理 git diff。

### 阶段 D5：实时 watcher

目标：对 Codex 开发过程进行更实时的文件变化记录。

实现内容：

- 文件系统 watcher 监听项目变更。
- 忽略 `.git/`、`node_modules/`、构建产物等目录。
- 将文件变化事件写入 session timeline。
- 自动登记 `outputs/`、报告、图片、文档等产物。
- 支持暂停、恢复、结束 session。

验收标准：

- 开启 watcher 后，文件修改会被记录到 timeline。
- 被忽略目录不会产生噪音。
- 新生成的文档或图片会进入 artifact manifest。
- 关闭 watcher 后不再记录事件。

### 阶段 D6：阶段摘要与版本叙事

目标：自动生成面向人的版本迭代说明。

实现内容：

- 按 session、日期、git branch 或 release tag 聚合日志。
- 生成阶段摘要。
- 生成“本阶段实现了什么、修复了什么、验证了什么、遗留什么”。
- 支持导出 release note、PR 描述、项目日报。

验收标准：

- 用户选择一个时间范围后，可以生成阶段摘要。
- 摘要能列出主要功能、主要文件、测试情况和风险。
- 输出可直接作为 PR 描述或版本说明草稿。

### 阶段 D7：可选 checkpoint commit

目标：为重要节点提供自动 checkpoint，但不强制改变用户 git 流程。

实现内容：

- 用户配置是否启用自动 checkpoint。
- 每轮完成后可创建 git commit 或 git stash-like patch。
- commit message 由日志摘要生成。
- 支持 dry-run。

验收标准：

- 默认不自动 commit。
- 启用后，每轮完成可生成 checkpoint commit。
- dry-run 能预览 commit message 和文件列表。
- 用户可以关闭该功能。

## 8. 统一工作站阶段计划

### 阶段 W1：统一本地归档目录

目标：让 ChatGPT 和 Codex 的归档进入同一个本地知识库，并为浏览器扩展提供可授权的本地写入通道。

实现内容：

- 设计统一 archive root。
- 定义 source 类型：`chatgpt-web`、`chatgpt-export`、`codex-project`。
- 统一 manifest 字段。
- 建立全局索引 `index.json`。
- 增加本地助手程序设计，用于在用户授权后接收浏览器扩展提交的归档包并写入指定 archive root。
- 定义扩展与本地助手的本机通信协议，例如 `POST /archive/chatgpt/current-chat` 或 Native Messaging 消息格式。
- 为本地助手增加最小安全边界：仅监听 `127.0.0.1` 或使用 Native Messaging；首次配对生成 token；只允许写入用户配置的 archive root；拒绝绝对路径穿越和 `..` 路径。

验收标准：

- 一个本地目录中同时存在 ChatGPT 和 Codex 归档。
- 全局索引能列出所有项目、聊天、文件和更新时间。
- 浏览器扩展可以把当前聊天归档请求交给本地助手，由本地助手自动写入统一 archive root，不依赖浏览器下载目录。
- 未完成配对、token 错误或目标路径越界时，本地助手拒绝写入并记录失败原因。

### 阶段 W2：桌面管理界面

目标：提供一个本地 GUI 查看和管理归档，并管理本地助手程序的启动、配置和授权状态。

实现内容：

- 展示项目列表、聊天列表、Codex session 列表。
- 查看 Markdown 内容。
- 查看附件和生成文件。
- 搜索与筛选。
- 手动触发同步。
- 提供 archive root 选择、权限检测和路径变更确认。
- 展示本地助手运行状态、监听地址、扩展配对状态和最近写入记录。
- 提供扩展连接向导：生成配对 token、检测扩展是否可连接、显示失败原因和修复建议。
- 支持从 GUI 启动/停止本地助手，或引导用户安装为开机自启/后台托盘服务。

验收标准：

- 用户可以在界面中找到某个聊天或某个开发 session。
- 可以打开对应 Markdown 和附件。
- 可以从界面触发 ChatGPT 当前聊天同步或 Codex 项目摘要生成。
- 用户可以在界面中设置统一归档目录，并看到本地助手是否可用。
- 浏览器扩展完成配对后，点击归档可以自动写入 GUI 配置的归档目录。
- 当本地助手未运行、权限不足或 token 失效时，界面和扩展能给出中文错误提示。

### 阶段 W3：大模型总结接口

目标：支持把归档内容再次交给大模型总结和抽取关键信息。

实现内容：

- 用户选择聊天、项目或时间范围。
- 生成上下文包。
- 支持本地模型或云端模型接口。
- 输出摘要、TODO、决策记录、关键文件、风险点。

验收标准：

- 用户可以选择一个 Project 并生成总结。
- 总结结果引用原始消息或文件路径。
- 输出可保存为 Markdown。

## 9. 推荐开发顺序

推荐先做最有价值、风险最低的闭环：

1. ChatGPT 当前聊天文本归档 MVP。
2. ChatGPT 当前聊天增量更新。
3. AI 生成文件下载与 manifest。
4. Codex 项目日志基础设施。
5. Codex git diff 快照与 session Markdown。
6. ChatGPT Project 批量同步。
7. Codex watcher 与阶段摘要。
8. W1 本地助手程序与统一 archive root。
9. W2 统一工作站 UI 与本地助手管理。

## 10. 技术选型建议

### ChatGPT Archive Extension

- 浏览器扩展：Manifest V3。
- 前端：TypeScript。
- 页面采集：content script。
- 后台任务：service worker。
- 文件保存：Chrome Downloads API 或 File System Access API。
- 数据格式：Markdown、JSON、JSONL。

### Codex Project Journal

- CLI：Python 或 Node.js。
- 文件监听：Python watchdog 或 Node chokidar。
- git 集成：调用 git CLI。
- 日志格式：JSONL + Markdown。
- 配置文件：`.ai-archive/config.json`。

### 统一工作站

- 桌面端：Tauri 或 Electron。
- 本地助手程序：优先随桌面端一起提供；也可单独提供轻量 CLI/后台服务。
- 扩展到本地助手通信：优先 Native Messaging；若采用本机 HTTP，只监听 `127.0.0.1`，并使用一次性配对 token。
- 搜索：SQLite FTS 或 Lunr/FlexSearch。
- 数据库：SQLite。
- 文件存储：本地目录。
- 安全策略：本地助手只写入用户配置的 archive root；所有相对路径必须规范化并校验不能逃逸归档目录。

## 11. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| ChatGPT 网页 DOM 改版 | 扩展失效 | 抽象采集层，增加选择器版本检测 |
| 生成文件链接过期 | 无法下载历史文件 | 同步时尽快下载，失败写入 manifest |
| 上传文件无法事后下载 | 归档不完整 | 记录文件名和来源消息；未来支持发送前归档 |
| Project 批量同步触发风控 | 同步失败或账号风险 | 用户主动触发、限速、断点续传、不全账号扫描 |
| Codex 日志噪音过多 | 难以阅读 | 默认忽略构建目录和依赖目录，摘要化输出 |
| 自动 commit 干扰开发流程 | 用户不信任 | 默认关闭，只提供可选 checkpoint |
| 浏览器扩展无法直接指定绝对保存目录 | 无法自动写入用户指定 archive root | W1 增加本地助手程序，由用户授权后负责本地文件写入；扩展侧保留 ZIP 下载兜底 |
| 本地助手被未授权页面调用 | 可能写入垃圾数据或暴露本地能力 | 仅监听本机地址或使用 Native Messaging；配对 token；校验来源、路径和请求大小 |

## 12. 第一版 MVP 定义

第一版建议只交付两个闭环：

### MVP-A：ChatGPT 当前聊天增量归档

必须实现：

- 当前聊天一键导出。
- 用户/AI 消息标注。
- Markdown + JSON 输出。
- 重复同步去重。
- AI 生成文件尽力下载。
- manifest 记录文件状态。

不要求实现：

- Project 批量同步。
- 官方导出 ZIP 导入。
- 桌面 GUI。
- 自动总结。

### MVP-B：Codex 项目开发日志

必须实现：

- 初始化 `.ai-archive/`。
- 每轮生成 session Markdown。
- 保存 git diff patch。
- 记录修改文件列表。
- 记录验证命令和结果摘要。
- 生成阶段总结草稿。

不要求实现：

- 实时 watcher。
- 自动 commit。
- GUI 管理。
- 云端同步。

## 13. 最终交付形态

最终项目可以包含四个模块：

```text
ai-archive-workstation/
  browser-extension/
    chatgpt-archive-extension/
  cli/
    codex-project-journal/
  local-helper/
    archive-helper/
  desktop-app/
    archive-workstation/
  docs/
    product-plan.md
    technical-design.md
    data-schema.md
```

最终用户体验：

1. 用户在 ChatGPT 网页端打开一个聊天，点击“一键同步”，本地得到完整 Markdown、JSON 和可下载生成文件。
2. 用户在 ChatGPT Project 页面点击“同步项目”，本地增量更新该项目的所有聊天。
3. 用户在 Codex 开发项目中启用 Journal，之后每轮开发自动形成开发日志、diff、验证记录和产物清单。
4. 用户在统一工作站中配置 archive root 并完成浏览器扩展配对，之后扩展可通过本地助手自动写入指定目录；如果本地助手不可用，则回退为 ZIP 下载。
5. 用户在统一工作站中搜索、查看、导出上下文包，并把上下文包交给大模型做总结和关键信息提取。

## 14. 下一步建议

下一步应进入技术设计阶段，优先拆出：

1. ChatGPT 当前聊天页面的 DOM 采集方案。
2. 统一 JSON schema。
3. 本地归档目录规范。
4. Codex Project Journal CLI 命令设计。
5. MVP 的任务列表和开发排期。
