# ChatGPT 当前聊天归档扩展

这是一个 Manifest V3 浏览器扩展，用于把当前打开的 ChatGPT 对话增量归档为 Markdown、JSON 和 manifest 文件。

当前版本是 C2 阶段：支持当前聊天重复同步、消息去重、变化更新和 `manifest.json` 同步记录。不包含 Project 批量同步、图片下载或 AI 生成文件下载。

## 本地加载

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启开发者模式。
3. 点击 **加载已解压的扩展程序** / **Load unpacked**。
4. 选择本目录：`browser-extension/chatgpt-archive-extension`。

## 浏览器适配与调试命令

### Chrome / Edge

当前版本优先适配 Chromium 系浏览器，推荐先用 Chrome 或 Edge 测试。

地址栏打开：

```text
chrome://extensions
edge://extensions
```

也可以用命令行临时加载扩展，路径请替换为你的实际项目路径：

```powershell
chrome.exe --load-extension="C:\Users\jxjnx\Desktop\AI信息总结插件\browser-extension\chatgpt-archive-extension"
msedge.exe --load-extension="C:\Users\jxjnx\Desktop\AI信息总结插件\browser-extension\chatgpt-archive-extension"
```

### 百度浏览器 / 夸克浏览器

百度浏览器和夸克浏览器通常基于 Chromium 内核，可以先按 Chrome 的方式尝试加载未打包扩展。不同版本的扩展管理页入口可能不同，优先尝试：

```text
chrome://extensions
browser://extensions
```

如果浏览器支持命令行加载 Chromium 扩展，可以尝试：

```powershell
"C:\Program Files\Baidu\BaiduBrowser\Application\baidubrowser.exe" --load-extension="C:\Users\jxjnx\Desktop\AI信息总结插件\browser-extension\chatgpt-archive-extension"
"C:\Program Files\Quark\Quark\Application\quark.exe" --load-extension="C:\Users\jxjnx\Desktop\AI信息总结插件\browser-extension\chatgpt-archive-extension"
```

如果你的安装路径不同，需要把前面的浏览器 exe 路径改成实际路径。若浏览器屏蔽了开发者模式或未打包扩展加载，则需要改用 Chrome / Edge 测试。

### Firefox

当前源码不能直接完整适配 Firefox，原因是本版本使用了 Chromium 优先的 File System Access API，也就是 `showDirectoryPicker()`。Firefox 需要单独改造保存方案，例如改为 `browser.downloads.download()` 下载文件，或者提供后端/本地应用桥接写入目录。

Firefox 临时加载扩展的入口是：

```text
about:debugging#/runtime/this-firefox
```

如果后续完成 Firefox 兼容改造，可以用 `web-ext` 调试：

```powershell
npm install --global web-ext
web-ext run --source-dir "C:\Users\jxjnx\Desktop\AI信息总结插件\browser-extension\chatgpt-archive-extension"
```

Firefox 适配时至少需要处理：

- 把 `chrome.*` 扩展 API 兼容为 `browser.*` 或加入 polyfill。
- 替换 `showDirectoryPicker()` 目录授权写入方案。
- 检查 Manifest V3 在 Firefox 当前版本中的权限和后台脚本兼容性。

## 使用方法

1. 在 `chatgpt.com` 或 `chat.openai.com` 打开一个 ChatGPT 对话页面。
2. 点击浏览器工具栏里的扩展图标。
3. 可以先选择一个本地归档目录，并授权读写权限。
4. 点击 **归档当前聊天**。

如果文件夹授权成功，扩展会在你选择的归档目录中写入：

```text
chatgpt/
  standalone-chats/
    {conversation-id}/
      conversation.md
      conversation.json
      manifest.json
```

如果文件夹授权失败，扩展会自动改用浏览器下载流程，下载一个 ZIP 包。部分国产 Chromium 浏览器会在这一步弹出窗口，让你选择这个 ZIP 文件保存在哪里。

```text
chatgpt-archive-{conversation-id}.zip
```

ZIP 包内部仍然保留标准目录结构：

```text
chatgpt/
  standalone-chats/
    {conversation-id}/
      conversation.md
      conversation.json
      manifest.json
```

这种备用方式不依赖系统文件夹授权，适合遇到系统权限、浏览器壳兼容性或 `showDirectoryPicker()` 被拦截的情况；同时只会触发一次保存窗口。

## 导出内容

- `conversation.md`：适合直接阅读或交给大模型总结的 Markdown 文本。
- `conversation.json`：结构化对话数据，包含标题、URL、conversation id、首次归档时间、最近同步时间和消息列表。
- `manifest.json`：归档审计记录，包含消息 hash 列表和每次同步的新增、更新、跳过数量。
- 消息会标注为 `用户` 或 `助手`。
- 代码块会尽量保留为 Markdown fenced code block。
- 链接、列表、表格会尽量转换为 Markdown。

## 增量同步规则

同一个聊天重复导出时，扩展会合并已有消息和当前页面消息：

- 已存在且 hash 相同的消息会跳过。
- 同一位置但内容变化的消息会更新。
- 新出现的消息会追加到归档末尾。
- `conversation.md` 每次都会按合并后的完整消息重新生成。
- `manifest.json` 会记录每次同步的时间、保存方式、新增数量、更新数量和跳过数量。

授权文件夹模式会读取已有的 `conversation.json` 和 `manifest.json` 后再合并。ZIP 兜底模式会用扩展自己的 IndexedDB 保存最近一次合并结果，下一次下载 ZIP 时继续基于这份浏览器内历史增量合并。

## 当前限制

- 只归档当前页面已经加载和可见的消息。
- 不下载图片、附件或 AI 生成文件。
- 不支持 ChatGPT Project 批量同步。
- ZIP 兜底模式的增量基线保存在扩展 IndexedDB 中；如果卸载扩展或清除扩展数据，下一次 ZIP 归档会重新建立基线。
- 如果 ChatGPT 页面 DOM 结构变化，消息提取规则可能需要更新。
