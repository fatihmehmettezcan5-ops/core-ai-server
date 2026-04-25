// core/memory.js
// ═══════════════════════════════════════════════════════════════
// TEMEL HAFIZA MODÜLÜ (Geriye uyumlu + Gelişmiş entegrasyon)
// ═══════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";

const MEMORY_DIR = path.join(process.cwd(), "chat_data");
const MAX_CONTEXT_SIZE = 800_000;
const MAX_MESSAGES_IN_CONTEXT = 100;

if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function sessionFilePath(sessionId) {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(MEMORY_DIR, `${safe}.json`);
}

export function saveMemory(sessionId, data) {
  const filePath = sessionFilePath(sessionId);
  const record = {
    ...data,
    sessionId,
    updatedAt: new Date().toISOString(),
    createdAt: data.createdAt || new Date().toISOString()
  };

  if (record.messages && Array.isArray(record.messages)) {
    record.messages = trimMessages(record.messages);
  }

  // Otomatik etiketleme (yeni eklenen)
  if (!record.tags && record.messages) {
    record.tags = autoTag(record.messages);
  }

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
}

export function getMemory(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getAllSessions() {
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith(".json") && f !== "_index.json");
    return files.map(f => {
      const filePath = path.join(MEMORY_DIR, f);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        return {
          sessionId: data.sessionId || f.replace(".json", ""),
          title: data.title || "Untitled Chat",
          tags: data.tags || [],
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          messageCount: data.messages?.length || 0
        };
      } catch {
        return { sessionId: f.replace(".json", ""), title: "Untitled" };
      }
    }).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch {
    return [];
  }
}

export function deleteSession(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Belirli bir oturumun konuşma geçmişini AI context formatında döner
 * (Yeni eklenen fonksiyon)
 */
export function getConversationContext(sessionId, maxMessages = 30) {
  const data = getMemory(sessionId);
  if (!data || !data.messages) return [];

  return data.messages
    .slice(-maxMessages)
    .map(m => ({ role: m.role, content: m.content }));
}

function trimMessages(messages) {
  if (messages.length > MAX_MESSAGES_IN_CONTEXT) {
    const systemMsgs = messages.filter(m => m.role === "system");
    const nonSystem = messages.filter(m => m.role !== "system");
    const kept = nonSystem.slice(-MAX_MESSAGES_IN_CONTEXT);
    messages = [...systemMsgs, ...kept];
  }

  let totalSize = JSON.stringify(messages).length;
  while (totalSize > MAX_CONTEXT_SIZE && messages.length > 2) {
    const firstNonSystemIdx = messages.findIndex(m => m.role !== "system");
    if (firstNonSystemIdx === -1) break;
    messages.splice(firstNonSystemIdx, 2);
    totalSize = JSON.stringify(messages).length;
  }

  if (totalSize > MAX_CONTEXT_SIZE) {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "system" && typeof messages[i].content === "string") {
        if (messages[i].content.length > 10000) {
          messages[i].content =
            messages[i].content.slice(0, 5000) +
            "\n\n[... içerik boyut sınırı nedeniyle kırpıldı ...]";
        }
      }
    }
  }

  return messages;
}

function autoTag(messages) {
  const userText = messages
    .filter(m => m.role === "user")
    .map(m => m.content || "")
    .join(" ")
    .toLowerCase();

  const tags = [];
  const keywords = [
    "javascript", "python", "react", "api", "database", "html", "css",
    "node", "sql", "docker", "git", "web", "mobile", "ai", "ml",
    "kod", "programlama", "tasarım", "analiz", "mcp", "server"
  ];

  for (const kw of keywords) {
    if (userText.includes(kw)) tags.push(kw);
  }

  return tags.slice(0, 10);
}
