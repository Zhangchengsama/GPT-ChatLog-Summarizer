"use strict";

const DB_NAME = "chatgpt-archive-extension";
const DB_VERSION = 2;
const HANDLE_STORE_NAME = "handles";
const CONVERSATION_STORE_NAME = "conversations";
const MANIFEST_STORE_NAME = "manifests";
const ROOT_HANDLE_KEY = "archive-root";
const CRC32_TABLE = createCrc32Table();

const chooseFolderButton = document.getElementById("chooseFolderButton");
const archiveButton = document.getElementById("archiveButton");
const folderStatus = document.getElementById("folderStatus");
const statusNode = document.getElementById("status");
const detailsNode = document.getElementById("details");

document.addEventListener("DOMContentLoaded", () => {
  chooseFolderButton.addEventListener("click", onChooseFolder);
  archiveButton.addEventListener("click", onArchiveCurrentChat);
  refreshFolderStatus();
});

async function onChooseFolder() {
  setBusy(true);
  clearDetails();
  try {
    const handle = await pickArchiveRoot();
    await saveRootHandle(handle);
    setStatus("已选择归档文件夹。", "success");
    folderStatus.textContent = `归档文件夹：${handle.name}`;
  } catch (error) {
    setStatus(readableError(error), "error");
    setDetails(folderPickerHelp(error));
  } finally {
    setBusy(false);
  }
}

async function onArchiveCurrentChat() {
  setBusy(true);
  clearDetails();
  try {
    const tab = await getActiveTab();
    assertSupportedTab(tab);
    const rootHandle = await getPermittedArchiveRoot();

    setStatus("正在读取当前 ChatGPT 页面...");
    const conversation = await extractConversation(tab.id);
    if (conversation && conversation.error) {
      throw new Error(conversation.error);
    }

    if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) {
      throw new Error("没有在当前页面找到可读取的用户或助手消息。请确认已经打开具体的 ChatGPT 对话页面。");
    }

    setStatus("正在合并增量消息...");
    const safeConversationId = sanitizePathSegment(conversation.conversation_id);
    const writeResult = rootHandle
      ? await tryWriteArchiveToFolder(rootHandle, safeConversationId, conversation)
      : await writeArchiveToDownloads(safeConversationId, conversation);
    const syncSummary = writeResult.syncRun;

    setStatus(
      `同步完成：新增 ${syncSummary.added_count} 条，更新 ${syncSummary.updated_count} 条，跳过 ${syncSummary.skipped_count} 条。`,
      "success"
    );
    setDetails([
      `标题：${conversation.title}`,
      `对话 ID：${safeConversationId}`,
      `消息总数：${writeResult.conversation.messages.length}`,
      `保存方式：${writeResult.modeLabel}`,
      ...(writeResult.warning ? [`兜底原因：${writeResult.warning}`] : []),
      "文件：",
      ...writeResult.paths
    ].join("\n"));
  } catch (error) {
    setStatus(readableError(error), "error");
    setDetails(genericErrorHelp(error));
  } finally {
    setBusy(false);
  }
}

async function pickArchiveRoot() {
  if (!("showDirectoryPicker" in window)) {
    throw new Error("当前浏览器不支持文件夹授权访问。请使用较新版 Chrome、Edge，或兼容该能力的 Chromium 浏览器。");
  }

  const handle = await window.showDirectoryPicker({
    id: "chatgpt-archive-root",
    mode: "readwrite"
  });

  await verifyPermission(handle, { request: true });
  return handle;
}

async function getPermittedArchiveRoot() {
  const handle = await getRootHandle();
  if (!handle) {
    folderStatus.textContent = "尚未选择归档文件夹，将下载 ZIP 包。";
    return null;
  }

  try {
    await verifyPermission(handle, { request: false });
    folderStatus.textContent = `归档文件夹：${handle.name}`;
    return handle;
  } catch {
    folderStatus.textContent = "归档文件夹权限不可用，将下载 ZIP 包。";
    return null;
  }
}

async function verifyPermission(handle, behavior = {}) {
  const permissionOptions = { mode: "readwrite" };
  if ((await handle.queryPermission(permissionOptions)) === "granted") {
    return;
  }

  if (!behavior.request) {
    throw new Error("归档文件夹权限不可用。");
  }

  if ((await handle.requestPermission(permissionOptions)) !== "granted") {
    throw new Error("未获得文件夹读写权限。请重新选择归档文件夹并允许访问。");
  }
}

async function refreshFolderStatus() {
  try {
    const handle = await getRootHandle();
    folderStatus.textContent = handle
      ? `归档文件夹：${handle.name}`
      : "尚未选择归档文件夹。";
  } catch {
    folderStatus.textContent = "尚未选择归档文件夹。";
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("没有找到当前活动标签页。");
  }
  return tab;
}

function assertSupportedTab(tab) {
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    throw new Error("当前标签页没有可读取的 URL。");
  }

  const supportedHost = url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com";
  if (!supportedHost) {
    throw new Error("当前页面不支持归档。请先打开 chatgpt.com 或 chat.openai.com 上的具体对话页面。");
  }
}

async function extractConversation(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_CURRENT_CHAT" });
  } catch (firstError) {
    if (!String(firstError && firstError.message).includes("Receiving end does not exist")) {
      throw firstError;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return chrome.tabs.sendMessage(tabId, { type: "EXTRACT_CURRENT_CHAT" });
  }
}

async function ensureDirectoryPath(rootHandle, segments) {
  let current = rootHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(sanitizePathSegment(segment), { create: true });
  }
  return current;
}

async function writeTextFile(directoryHandle, filename, content) {
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readTextFile(directoryHandle, filename) {
  try {
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (error) {
    if (error && (error.name === "NotFoundError" || error.name === "NotFound")) {
      return "";
    }
    throw error;
  }
}

async function tryWriteArchiveToFolder(rootHandle, conversationId, currentConversation) {
  try {
    return await writeArchiveToFolder(rootHandle, conversationId, currentConversation);
  } catch (error) {
    folderStatus.textContent = "文件夹读写失败，已改用浏览器下载 ZIP 包。";
    const fallbackResult = await writeArchiveToDownloads(conversationId, currentConversation);
    fallbackResult.modeLabel = `${fallbackResult.modeLabel}（文件夹失败后兜底）`;
    fallbackResult.warning = readableError(error);
    return fallbackResult;
  }
}

async function writeArchiveToFolder(rootHandle, conversationId, currentConversation) {
  const chatDir = await ensureDirectoryPath(rootHandle, [
    "chatgpt",
    "standalone-chats",
    conversationId
  ]);

  const existingConversation = parseJsonOrNull(await readTextFile(chatDir, "conversation.json"));
  const existingManifest = parseJsonOrNull(await readTextFile(chatDir, "manifest.json"));
  const syncResult = mergeArchiveState(existingConversation, existingManifest, currentConversation, "folder");
  const markdown = renderConversationMarkdown(syncResult.conversation);
  const json = `${JSON.stringify(syncResult.conversation, null, 2)}\n`;
  const manifestJson = `${JSON.stringify(syncResult.manifest, null, 2)}\n`;

  await writeTextFile(chatDir, "conversation.md", markdown);
  await writeTextFile(chatDir, "conversation.json", json);
  await writeTextFile(chatDir, "manifest.json", manifestJson);
  await saveArchiveBaseline(conversationId, syncResult.conversation, syncResult.manifest);

  return {
    modeLabel: "已授权文件夹",
    conversation: syncResult.conversation,
    manifest: syncResult.manifest,
    syncRun: syncResult.syncRun,
    paths: [
      `chatgpt/standalone-chats/${conversationId}/conversation.md`,
      `chatgpt/standalone-chats/${conversationId}/conversation.json`,
      `chatgpt/standalone-chats/${conversationId}/manifest.json`
    ]
  };
}

async function writeArchiveToDownloads(conversationId, currentConversation) {
  const basePath = `chatgpt/standalone-chats/${conversationId}`;
  const existingConversation = await getStoredConversation(conversationId);
  const existingManifest = await getStoredManifest(conversationId);
  const syncResult = mergeArchiveState(existingConversation, existingManifest, currentConversation, "zip");
  const markdown = renderConversationMarkdown(syncResult.conversation);
  const json = `${JSON.stringify(syncResult.conversation, null, 2)}\n`;
  const manifestJson = `${JSON.stringify(syncResult.manifest, null, 2)}\n`;
  const zipBlob = createZipBlob([
    {
      path: `${basePath}/conversation.md`,
      content: markdown
    },
    {
      path: `${basePath}/conversation.json`,
      content: json
    },
    {
      path: `${basePath}/manifest.json`,
      content: manifestJson
    }
  ]);
  const zipFilename = `chatgpt-archive-${conversationId}.zip`;
  await downloadBlobFile(zipFilename, zipBlob);
  await saveArchiveBaseline(conversationId, syncResult.conversation, syncResult.manifest);

  return {
    modeLabel: "浏览器下载 ZIP 包",
    conversation: syncResult.conversation,
    manifest: syncResult.manifest,
    syncRun: syncResult.syncRun,
    paths: [
      `下载目录/${zipFilename}`,
      `ZIP 内/${basePath}/conversation.md`,
      `ZIP 内/${basePath}/conversation.json`,
      `ZIP 内/${basePath}/manifest.json`
    ]
  };
}

async function downloadBlobFile(filename, blob) {
  if (!chrome.downloads || !chrome.downloads.download) {
    throw new Error("当前浏览器不支持扩展下载 API。请换用 Chrome 或 Edge 后重试。");
  }

  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url,
        filename,
        conflictAction: "overwrite",
        saveAs: false
      }, (downloadId) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }

        resolve(downloadId);
      });
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function mergeArchiveState(existingConversation, existingManifest, currentConversation, mode) {
  const syncedAt = new Date().toISOString();
  const existingMessages = Array.isArray(existingConversation && existingConversation.messages)
    ? existingConversation.messages.map((message) => ({ ...message }))
    : [];
  const currentMessages = Array.isArray(currentConversation.messages)
    ? currentConversation.messages.map((message) => ({ ...message }))
    : [];
  const mergedMessages = existingMessages.slice();
  const hashToIndex = new Map();
  const idToIndex = new Map();
  const positionToIndex = new Map();
  const consumedExistingIndexes = new Set();
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  indexMessages(mergedMessages, hashToIndex, idToIndex, positionToIndex);

  currentMessages.forEach((message, currentIndex) => {
    const normalizedMessage = normalizeMessageForArchive(message, currentConversation.conversation_id);
    const positionKey = `${normalizedMessage.role}:${currentIndex}`;
    const hashMatchIndex = takeAvailableIndex(hashToIndex, normalizedMessage.hash, consumedExistingIndexes);

    if (Number.isInteger(hashMatchIndex)) {
      consumedExistingIndexes.add(hashMatchIndex);
      skippedCount += 1;
      return;
    }

    const idMatchIndex = takeAvailableIndex(idToIndex, normalizedMessage.id, consumedExistingIndexes);
    const positionMatchIndex = takeAvailableIndex(positionToIndex, positionKey, consumedExistingIndexes);
    const existingIndex = Number.isInteger(idMatchIndex) ? idMatchIndex : positionMatchIndex;

    if (Number.isInteger(existingIndex)) {
      mergedMessages[existingIndex] = {
        ...mergedMessages[existingIndex],
        ...normalizedMessage
      };
      consumedExistingIndexes.add(existingIndex);
      updatedCount += 1;
    } else {
      mergedMessages.push(normalizedMessage);
      addedCount += 1;
    }
  });

  const createdAt = existingConversation && existingConversation.created_at
    ? existingConversation.created_at
    : syncedAt;
  const conversation = {
    conversation_id: currentConversation.conversation_id,
    title: currentConversation.title || (existingConversation && existingConversation.title) || "未命名 ChatGPT 对话",
    url: currentConversation.url || (existingConversation && existingConversation.url) || "",
    source: currentConversation.source || "chatgpt-web",
    created_at: createdAt,
    updated_at: syncedAt,
    exported_at: syncedAt,
    sync_version: 2,
    messages: mergedMessages
  };

  const syncRun = {
    synced_at: syncedAt,
    mode,
    seen_count: currentMessages.length,
    added_count: addedCount,
    updated_count: updatedCount,
    skipped_count: skippedCount,
    status: "completed",
    failure_reason: ""
  };
  const manifest = buildManifest(conversation, existingManifest, syncRun);

  return {
    conversation,
    manifest,
    syncRun
  };
}

function normalizeMessageForArchive(message, conversationId) {
  return {
    id: message.id || `${message.role || "message"}-${message.hash || Date.now()}`,
    conversation_id: conversationId,
    source: message.source || "chatgpt-web",
    role: message.role,
    created_at: message.created_at || null,
    content_markdown: message.content_markdown || "",
    content_blocks: Array.isArray(message.content_blocks) ? message.content_blocks : [],
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    generated_files: Array.isArray(message.generated_files) ? message.generated_files : [],
    links: Array.isArray(message.links) ? message.links : [],
    hash: message.hash || ""
  };
}

function buildManifest(conversation, existingManifest, syncRun) {
  const existingRuns = Array.isArray(existingManifest && existingManifest.sync_runs)
    ? existingManifest.sync_runs
    : [];
  const createdAt = existingManifest && existingManifest.created_at
    ? existingManifest.created_at
    : conversation.created_at;

  return {
    conversation_id: conversation.conversation_id,
    title: conversation.title,
    url: conversation.url,
    source: conversation.source,
    created_at: createdAt,
    updated_at: conversation.updated_at,
    message_count: conversation.messages.length,
    message_hashes: conversation.messages.map((message) => message.hash).filter(Boolean),
    sync_runs: [...existingRuns, syncRun]
  };
}

function indexMessages(messages, hashToIndex, idToIndex, positionToIndex) {
  messages.forEach((message, index) => {
    if (message.hash) {
      addIndex(hashToIndex, message.hash, index);
    }
    if (message.id) {
      addIndex(idToIndex, message.id, index);
    }
    if (message.role) {
      addIndex(positionToIndex, `${message.role}:${index}`, index);
    }
  });
}

function addIndex(indexMap, key, index) {
  if (!indexMap.has(key)) {
    indexMap.set(key, []);
  }
  indexMap.get(key).push(index);
}

function takeAvailableIndex(indexMap, key, consumedIndexes) {
  if (!key || !indexMap.has(key)) {
    return null;
  }

  const indexes = indexMap.get(key);
  return indexes.find((index) => !consumedIndexes.has(index)) ?? null;
}

function parseJsonOrNull(text) {
  if (!text || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const pathBytes = encoder.encode(file.path.replace(/\\/g, "/"));
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);
    const timestamp = zipTimestamp(new Date());
    const localHeader = createLocalFileHeader(pathBytes, dataBytes, crc, timestamp);
    const centralHeader = createCentralDirectoryHeader(pathBytes, dataBytes, crc, timestamp, offset);

    localParts.push(localHeader, pathBytes, dataBytes);
    centralParts.push(centralHeader, pathBytes);
    offset += localHeader.byteLength + pathBytes.byteLength + dataBytes.byteLength;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const endRecord = createEndOfCentralDirectory(files.length, centralSize, offset);

  return new Blob([...localParts, ...centralParts, endRecord], {
    type: "application/zip"
  });
}

function createLocalFileHeader(pathBytes, dataBytes, crc, timestamp) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, timestamp.time, true);
  view.setUint16(12, timestamp.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, dataBytes.byteLength, true);
  view.setUint32(22, dataBytes.byteLength, true);
  view.setUint16(26, pathBytes.byteLength, true);
  view.setUint16(28, 0, true);
  return header;
}

function createCentralDirectoryHeader(pathBytes, dataBytes, crc, timestamp, localHeaderOffset) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, timestamp.time, true);
  view.setUint16(14, timestamp.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, dataBytes.byteLength, true);
  view.setUint32(24, dataBytes.byteLength, true);
  view.setUint16(28, pathBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);
  return header;
}

function createEndOfCentralDirectory(fileCount, centralSize, centralOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function zipTimestamp(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function renderConversationMarkdown(conversation) {
  const lines = [
    `# ${conversation.title || "未命名 ChatGPT 对话"}`,
    "",
    `- 来源：${conversation.source}`,
    `- URL: ${conversation.url}`,
    `- 对话 ID：${conversation.conversation_id}`,
    `- 首次归档：${conversation.created_at || conversation.exported_at}`,
    `- 最近同步：${conversation.updated_at || conversation.exported_at}`,
    `- 同步版本：${conversation.sync_version || 1}`,
    `- 消息总数：${Array.isArray(conversation.messages) ? conversation.messages.length : 0}`,
    "",
    "---",
    ""
  ];

  for (const message of conversation.messages) {
    const label = message.role === "user" ? "用户" : "助手";
    lines.push(`## ${label}`, "");
    lines.push((message.content_markdown || "").trim());
    lines.push("", "---", "");
  }

  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}

function sanitizePathSegment(value) {
  const cleaned = String(value || "untitled")
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

  return cleaned || "untitled";
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        database.createObjectStore(HANDLE_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(CONVERSATION_STORE_NAME)) {
        database.createObjectStore(CONVERSATION_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(MANIFEST_STORE_NAME)) {
        database.createObjectStore(MANIFEST_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRootHandle() {
  const database = await openDatabase();
  try {
    return await idbRequest(database.transaction(HANDLE_STORE_NAME, "readonly").objectStore(HANDLE_STORE_NAME).get(ROOT_HANDLE_KEY));
  } finally {
    database.close();
  }
}

async function saveRootHandle(handle) {
  const database = await openDatabase();
  try {
    await idbRequest(database.transaction(HANDLE_STORE_NAME, "readwrite").objectStore(HANDLE_STORE_NAME).put(handle, ROOT_HANDLE_KEY));
  } finally {
    database.close();
  }
}

async function getStoredConversation(conversationId) {
  const database = await openDatabase();
  try {
    return await idbRequest(
      database
        .transaction(CONVERSATION_STORE_NAME, "readonly")
        .objectStore(CONVERSATION_STORE_NAME)
        .get(conversationId)
    );
  } finally {
    database.close();
  }
}

async function getStoredManifest(conversationId) {
  const database = await openDatabase();
  try {
    return await idbRequest(
      database
        .transaction(MANIFEST_STORE_NAME, "readonly")
        .objectStore(MANIFEST_STORE_NAME)
        .get(conversationId)
    );
  } finally {
    database.close();
  }
}

async function saveArchiveBaseline(conversationId, conversation, manifest) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [CONVERSATION_STORE_NAME, MANIFEST_STORE_NAME],
      "readwrite"
    );
    await Promise.all([
      idbRequest(transaction.objectStore(CONVERSATION_STORE_NAME).put(conversation, conversationId)),
      idbRequest(transaction.objectStore(MANIFEST_STORE_NAME).put(manifest, conversationId))
    ]);
  } finally {
    database.close();
  }
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function setBusy(isBusy) {
  chooseFolderButton.disabled = isBusy;
  archiveButton.disabled = isBusy;
}

function setStatus(message, tone = "") {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`.trim();
}

function setDetails(message) {
  detailsNode.hidden = false;
  detailsNode.textContent = message;
}

function clearDetails() {
  detailsNode.hidden = true;
  detailsNode.textContent = "";
}

function readableError(error) {
  if (error && error.name === "AbortError") {
    return "文件夹选择没有完成。如果你确实已经点击了“选择文件夹”，可能是浏览器拒绝了该目录或中断了扩展弹窗授权；请换一个普通空文件夹重试，避免选择磁盘根目录、系统目录或受保护目录。";
  }

  return error && error.message ? error.message : String(error);
}

function folderPickerHelp(error) {
  const lines = [
    "排查建议：",
    "1. 先新建一个普通空文件夹，例如桌面上的“AI归档”，不要选择磁盘根目录或系统目录。",
    "2. 如果文件夹授权仍然失败，可以直接点击“归档当前聊天”，扩展会改为下载一个 ZIP 包。",
    "3. 修改扩展权限后，请在扩展管理页重新加载本扩展。"
  ];

  if (error) {
    lines.push("", `浏览器返回：${error.name || "Error"} ${error.message || ""}`.trim());
  }

  return lines.join("\n");
}

function genericErrorHelp(error) {
  if (!error) {
    return "";
  }

  return [
    "诊断信息：",
    `${error.name || "Error"}：${error.message || String(error)}`,
    "",
    "如果刚刚更新过扩展源码，请先到扩展管理页点击“重新加载”，再回到 ChatGPT 页面刷新后重试。"
  ].join("\n");
}
