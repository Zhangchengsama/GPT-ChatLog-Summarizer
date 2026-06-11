"use strict";

if (!window.__chatgptArchiveContentLoaded) {
  window.__chatgptArchiveContentLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "EXTRACT_CURRENT_CHAT") {
      return false;
    }

    extractCurrentChat()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          error: error && error.message ? error.message : String(error),
          messages: []
        });
      });

    return true;
  });
}

async function extractCurrentChat() {
  const url = new URL(window.location.href);
  const supportedHost = url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com";
  if (!supportedHost) {
    throw new Error("当前页面不支持归档。请先打开具体的 ChatGPT 对话页面。");
  }

  const title = extractTitle();
  const rawConversationId = await extractConversationId(title, window.location.href);
  const conversationId = sanitizePathSegment(rawConversationId);
  const messages = await extractMessages(conversationId);

  if (messages.length === 0) {
    throw new Error("没有在当前 ChatGPT 页面找到可读取的用户或助手消息。请确认聊天内容已经加载出来。");
  }

  return {
    conversation_id: conversationId,
    title,
    url: window.location.href,
    source: "chatgpt-web",
    exported_at: new Date().toISOString(),
    messages
  };
}

function extractTitle() {
  const heading = document.querySelector("main h1, h1");
  const headingText = normalizeWhitespace(heading && heading.textContent);
  if (headingText && !/^chatgpt$/i.test(headingText)) {
    return headingText;
  }

  const documentTitle = normalizeWhitespace(document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, ""));
  return documentTitle || "未命名 ChatGPT 对话";
}

async function extractConversationId(title, href) {
  const url = new URL(href);
  const conversationMatch = url.pathname.match(/\/c\/([^/?#]+)/i);
  if (conversationMatch) {
    return conversationMatch[1];
  }

  const fallbackHash = await sha256(`${title}\n${href}`);
  return `chat-${fallbackHash.slice(0, 16)}`;
}

async function extractMessages(conversationId) {
  const roleElements = collectRoleElements();
  const messages = [];

  for (const [index, element] of roleElements.entries()) {
    const role = normalizeRole(element.getAttribute("data-message-author-role"));
    if (!role) {
      continue;
    }

    const contentRoot = findContentRoot(element, role);
    const contentMarkdown = domToMarkdown(contentRoot).trim();
    if (!contentMarkdown) {
      continue;
    }

    const normalizedContent = normalizeForHash(contentMarkdown);
    const hash = await sha256(`${role}\n${normalizedContent}`);
    messages.push({
      id: `${role}-${String(index + 1).padStart(4, "0")}`,
      conversation_id: conversationId,
      source: "chatgpt-web",
      role,
      created_at: null,
      content_markdown: contentMarkdown,
      content_blocks: [
        {
          type: "markdown",
          text: contentMarkdown
        }
      ],
      attachments: [],
      generated_files: [],
      links: extractLinks(contentRoot),
      hash
    });
  }

  return messages;
}

function collectRoleElements() {
  const directRoleElements = Array.from(document.querySelectorAll("[data-message-author-role]"))
    .filter((element) => normalizeRole(element.getAttribute("data-message-author-role")))
    .filter(isVisible);

  if (directRoleElements.length > 0) {
    return dedupeElements(directRoleElements);
  }

  const articleRoleElements = Array.from(document.querySelectorAll("article[data-testid^='conversation-turn-']"))
    .map((article) => article.querySelector("[data-message-author-role]"))
    .filter(Boolean)
    .filter(isVisible);

  return dedupeElements(articleRoleElements);
}

function findContentRoot(element, role) {
  if (role === "assistant") {
    const markdown = element.querySelector(".markdown, [data-message-id], [data-testid='markdown']");
    if (markdown) {
      return markdown;
    }
  }

  const prose = element.querySelector(".whitespace-pre-wrap, .break-words, [dir='auto']");
  return prose || element;
}

function normalizeRole(value) {
  if (value === "user" || value === "assistant") {
    return value;
  }
  return "";
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function dedupeElements(elements) {
  const seen = new Set();
  return elements.filter((element) => {
    if (seen.has(element)) {
      return false;
    }
    seen.add(element);
    return true;
  });
}

function extractLinks(root) {
  const links = [];
  const seen = new Set();
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.href;
    if (!href || seen.has(href)) {
      continue;
    }

    seen.add(href);
    links.push({
      text: normalizeWhitespace(anchor.textContent) || href,
      href
    });
  }
  return links;
}

function domToMarkdown(root) {
  const clone = root.cloneNode(true);
  removeNonContentElements(clone);
  return normalizeMarkdown(nodeToMarkdown(clone, { inPre: false, listDepth: 0 }));
}

function removeNonContentElements(root) {
  const selectors = [
    "button",
    "svg",
    "script",
    "style",
    "noscript",
    "[aria-hidden='true']",
    "[data-testid*='copy']",
    "[data-testid*='feedback']",
    "[data-testid*='share']"
  ];

  for (const element of root.querySelectorAll(selectors.join(","))) {
    element.remove();
  }
}

function nodeToMarkdown(node, context) {
  if (node.nodeType === Node.TEXT_NODE) {
    return context.inPre ? node.textContent : node.textContent.replace(/\s+/g, " ");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();

  if (tag === "br") {
    return "\n";
  }

  if (tag === "pre") {
    return renderCodeBlock(node);
  }

  if (tag === "code") {
    if (context.inPre) {
      return node.textContent;
    }
    return `\`${node.textContent.replace(/`/g, "\\`")}\``;
  }

  if (tag === "a") {
    const label = childrenToMarkdown(node, context).trim() || node.href;
    return node.href ? `[${label}](${node.href})` : label;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return `\n${"#".repeat(level)} ${childrenToMarkdown(node, context).trim()}\n\n`;
  }

  if (tag === "p") {
    return `${childrenToMarkdown(node, context).trim()}\n\n`;
  }

  if (tag === "strong" || tag === "b") {
    return `**${childrenToMarkdown(node, context).trim()}**`;
  }

  if (tag === "em" || tag === "i") {
    return `_${childrenToMarkdown(node, context).trim()}_`;
  }

  if (tag === "blockquote") {
    return `\n${prefixLines(childrenToMarkdown(node, context).trim(), "> ")}\n\n`;
  }

  if (tag === "ul" || tag === "ol") {
    return renderList(node, tag === "ol", context);
  }

  if (tag === "table") {
    return renderTable(node);
  }

  if (tag === "img") {
    const alt = node.getAttribute("alt") || "image";
    const src = node.getAttribute("src") || "";
    return src ? `![${alt}](${src})` : "";
  }

  if (isBlockElement(tag)) {
    return `${childrenToMarkdown(node, context).trim()}\n\n`;
  }

  return childrenToMarkdown(node, context);
}

function childrenToMarkdown(node, context) {
  return Array.from(node.childNodes).map((child) => nodeToMarkdown(child, context)).join("");
}

function renderCodeBlock(preNode) {
  const codeNode = preNode.querySelector("code") || preNode;
  const language = extractCodeLanguage(codeNode);
  const code = codeNode.textContent.replace(/\n+$/g, "");
  const fence = code.includes("```") ? "````" : "```";
  return `\n${fence}${language}\n${code}\n${fence}\n\n`;
}

function extractCodeLanguage(codeNode) {
  const className = codeNode.getAttribute("class") || "";
  const match = className.match(/language-([a-z0-9_+-]+)/i);
  return match ? match[1] : "";
}

function renderList(listNode, ordered, context) {
  const items = Array.from(listNode.children).filter((child) => child.tagName.toLowerCase() === "li");
  const lines = items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : "-";
    const indentation = "  ".repeat(context.listDepth || 0);
    const text = childrenToMarkdown(item, {
      ...context,
      listDepth: (context.listDepth || 0) + 1
    }).trim();
    return `${indentation}${marker} ${text.replace(/\n/g, `\n${indentation}  `)}`;
  });

  return `\n${lines.join("\n")}\n\n`;
}

function renderTable(tableNode) {
  const rows = Array.from(tableNode.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).map((cell) => normalizeWhitespace(cell.textContent)))
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const padded = row.slice();
    while (padded.length < columnCount) {
      padded.push("");
    }
    return padded.map(escapeTableCell);
  });

  const header = normalizedRows[0];
  const separator = header.map(() => "---");
  const body = normalizedRows.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`)
  ];

  return `\n${lines.join("\n")}\n\n`;
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function prefixLines(text, prefix) {
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function isBlockElement(tag) {
  return [
    "article",
    "aside",
    "div",
    "figure",
    "figcaption",
    "footer",
    "header",
    "main",
    "section"
  ].includes(tag);
}

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/^\s+|\s+$/g, "");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeForHash(value) {
  return normalizeWhitespace(value).toLowerCase();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
