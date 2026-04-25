// core/memory.js
import { getDB } from "./db.js";

const MAX_MESSAGES_IN_CONTEXT = 100;
const MAX_CONTEXT_SIZE = 800_000;

function col(name) {
  return getDB().collection(name);
}

export async function saveMemory(sessionId, data) {
  const tags = data.tags || autoTag(data.messages || []);
  const messages = data.messages ? trimMessages(data.messages) : [];

  await col("sessions").updateOne(
    { sessionId },
    {
      $set: {
        sessionId,
        title: data.title || "New Chat",
        tags,
        titleSet: !!data.titleSet,
        metadata: data.metadata || {},
        updatedAt: new Date().toISOString()
      },
      $setOnInsert: {
        createdAt: data.createdAt || new Date().toISOString()
      }
    },
    { upsert: true }
  );

  if (messages.length > 0) {
    await col("messages").deleteMany({ sessionId });
    const docs = messages.map((msg, i) => ({
      sessionId,
      _order: i,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp || new Date().toISOString(),
      editedAt: msg.editedAt || null
    }));
    await col("messages").insertMany(docs);
  }
}

export async function getMemory(sessionId) {
  const session = await col("sessions").findOne({ sessionId });
  if (!session) return null;

  const msgs = await col("messages")
    .find({ sessionId })
    .sort({ _order: 1 })
    .toArray();

  return {
    sessionId: session.sessionId,
    title: session.title,
    tags: session.tags || [],
    titleSet: !!session.titleSet,
    summary: session.summary || "",
    metadata: session.metadata || {},
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: msgs.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      editedAt: m.editedAt
    }))
  };
}

export async function getAllSessions() {
  const sessions = await col("sessions")
    .find({})
    .sort({ updatedAt: -1 })
    .toArray();

  const results = [];
  for (const s of sessions) {
    const count = await col("messages").countDocuments({ sessionId: s.sessionId });
    results.push({
      sessionId: s.sessionId,
      title: s.title || "Untitled Chat",
      tags: s.tags || [],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: count
    });
  }
  return results;
}

export async function deleteSession(sessionId) {
  await col("messages").deleteMany({ sessionId });
  const result = await col("sessions").deleteOne({ sessionId });
  return result.deletedCount > 0;
}

export async function getConversationContext(sessionId, maxMessages = 30) {
  const msgs = await col("messages")
    .find({ sessionId })
    .sort({ _order: -1 })
    .limit(maxMessages)
    .toArray();

  return msgs.reverse().map(m => ({
    role: m.role,
    content: m.content
  }));
}

function trimMessages(messages) {
  let result = [...messages];

  if (result.length > MAX_MESSAGES_IN_CONTEXT) {
    const systemMsgs = result.filter(m => m.role === "system");
    const nonSystem = result.filter(m => m.role !== "system");
    const kept = nonSystem.slice(-MAX_MESSAGES_IN_CONTEXT);
    result = [...systemMsgs, ...kept];
  }

  let totalSize = JSON.stringify(result).length;
  while (totalSize > MAX_CONTEXT_SIZE && result.length > 2) {
    const firstNonSystemIdx = result.findIndex(m => m.role !== "system");
    if (firstNonSystemIdx === -1) break;
    result.splice(firstNonSystemIdx, 2);
    totalSize = JSON.stringify(result).length;
  }

  if (totalSize > MAX_CONTEXT_SIZE) {
    for (let i = 0; i < result.length; i++) {
      if (result[i].role !== "system" && typeof result[i].content === "string") {
        if (result[i].content.length > 10000) {
          result[i].content = result[i].content.slice(0, 5000) +
            "\n\n[... içerik boyut sınırı nedeniyle kırpıldı ...]";
        }
      }
    }
  }

  return result;
}

function autoTag(messages) {
  const userText = messages
    .filter(m => m.role === "user")
    .map(m => m.content || "")
    .join(" ")
    .toLowerCase();

  const tags = [];
  const keywords = [
    "javascript", "python", "react", "api", "database",
    "html", "css", "node", "sql", "docker", "git",
    "web", "mobile", "ai", "ml", "kod", "programlama",
    "tasarım", "analiz", "mcp", "server", "openrouter"
  ];

  for (const kw of keywords) {
    if (userText.includes(kw)) tags.push(kw);
  }
  return tags.slice(0, 10);
}
