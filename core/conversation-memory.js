// core/conversation-memory.js
import { getDB } from "./db.js";

function col(name) {
  return getDB().collection(name);
}

export async function saveConversation(sessionId, userMessage, assistantMessage, metadata = {}) {
  const timestamp = new Date().toISOString();
  const existing = await col("sessions").findOne({ sessionId });

  let title = "";
  let tags = [];

  if (!existing) {
    title = userMessage ? generateTitle(userMessage) : "New Chat";
    tags = userMessage ? extractTags(userMessage) : [];

    await col("sessions").insertOne({
      sessionId, title, tags, summary: "",
      metadata, createdAt: timestamp, updatedAt: timestamp
    });
  } else {
    title = existing.title;
    tags = existing.tags || [];

    if (!title && userMessage) title = generateTitle(userMessage);

    if (userMessage) {
      const newTags = extractTags(userMessage);
      tags = [...new Set([...tags, ...newTags])];
    }

    await col("sessions").updateOne(
      { sessionId },
      { $set: { title, tags, updatedAt: timestamp } }
    );
  }

  const currentCount = await col("messages").countDocuments({ sessionId });
  let order = currentCount;

  if (userMessage) {
    await col("messages").insertOne({
      sessionId, _order: order++, role: "user",
      content: userMessage, timestamp
    });
  }

  if (assistantMessage) {
    await col("messages").insertOne({
      sessionId, _order: order++, role: "assistant",
      content: assistantMessage, timestamp
    });
  }

  const messageCount = await col("messages").countDocuments({ sessionId });

  if (messageCount % 10 === 0) {
    const summary = await generateLocalSummaryFromDB(sessionId);
    await col("sessions").updateOne({ sessionId }, { $set: { summary } });
  }

  return { sessionId, title, messageCount, tags };
}

export async function recallConversation(sessionId, lastN = 0) {
  const session = await col("sessions").findOne({ sessionId });

  if (!session) {
    return { found: false, error: `"${sessionId}" ID'li konuşma bulunamadı.` };
  }

  const totalCount = await col("messages").countDocuments({ sessionId });

  let msgs;
  if (lastN > 0) {
    msgs = await col("messages")
      .find({ sessionId })
      .sort({ _order: -1 })
      .limit(lastN)
      .toArray();
    msgs = msgs.reverse();
  } else {
    msgs = await col("messages")
      .find({ sessionId })
      .sort({ _order: 1 })
      .toArray();
  }

  return {
    found: true,
    sessionId: session.sessionId,
    title: session.title,
    tags: session.tags || [],
    summary: session.summary,
    messageCount: totalCount,
    returnedCount: msgs.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: msgs.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp
    }))
  };
}

export async function searchMemory(query, maxResults = 10) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const sessions = await col("sessions").find({}).toArray();
  const results = [];

  for (const session of sessions) {
    const sessionId = session.sessionId;
    let sessionRelevance = 0;
    const matchingMessages = [];

    if (session.title && session.title.toLowerCase().includes(queryLower)) {
      sessionRelevance += 10;
    }

    if (session.tags) {
      for (const tag of session.tags) {
        if (tag.toLowerCase().includes(queryLower) || queryLower.includes(tag.toLowerCase())) {
          sessionRelevance += 5;
        }
      }
    }

    const regex = new RegExp(escapeRegex(query), "i");
    const matchedMsgs = await col("messages")
      .find({ sessionId, content: { $regex: regex } })
      .sort({ _order: 1 })
      .toArray();

    for (const msg of matchedMsgs) {
      const contentLower = (msg.content || "").toLowerCase();
      let messageScore = 0;

      if (contentLower.includes(queryLower)) messageScore += 5;

      for (const word of queryWords) {
        if (contentLower.includes(word)) messageScore += 1;
      }

      if (messageScore > 0) {
        sessionRelevance += messageScore;
        matchingMessages.push({
          index: msg._order,
          role: msg.role,
          content: highlightMatch(msg.content, query, 200),
          score: messageScore,
          timestamp: msg.timestamp
        });
      }
    }

    if (matchingMessages.length === 0 && queryWords.length > 0) {
      for (const word of queryWords) {
        const wordRegex = new RegExp(escapeRegex(word), "i");
        const wordMsgs = await col("messages")
          .find({ sessionId, content: { $regex: wordRegex } })
          .limit(5)
          .toArray();

        for (const msg of wordMsgs) {
          sessionRelevance += 1;
          matchingMessages.push({
            index: msg._order,
            role: msg.role,
            content: highlightMatch(msg.content, word, 200),
            score: 1,
            timestamp: msg.timestamp
          });
        }
      }
    }

    if (sessionRelevance > 0) {
      const totalMessages = await col("messages").countDocuments({ sessionId });

      results.push({
        sessionId,
        title: session.title,
        tags: session.tags || [],
        relevanceScore: sessionRelevance,
        matchCount: matchingMessages.length,
        totalMessages,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        topMatches: matchingMessages
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
      });
    }
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    query,
    totalResults: results.length,
    results: results.slice(0, maxResults)
  };
}

export async function listConversations(limit = 50, sortBy = "date") {
  let sortObj;
  switch (sortBy) {
    case "messages": sortObj = null; break;
    case "title": sortObj = { title: 1 }; break;
    case "date":
    default: sortObj = { updatedAt: -1 };
  }

  let sessions;
  if (sortObj) {
    sessions = await col("sessions").find({}).sort(sortObj).limit(limit).toArray();
  } else {
    sessions = await col("sessions").find({}).toArray();
  }

  const totalConversations = await col("sessions").countDocuments();

  const conversations = [];
  for (const s of sessions) {
    const messageCount = await col("messages").countDocuments({ sessionId: s.sessionId });
    conversations.push({
      sessionId: s.sessionId,
      title: s.title || "İsimsiz Sohbet",
      tags: s.tags || [],
      messageCount,
      summary: s.summary || "",
      createdAt: s.createdAt,
      lastUpdated: s.updatedAt
    });
  }

  if (sortBy === "messages") {
    conversations.sort((a, b) => b.messageCount - a.messageCount);
  }

  return {
    totalConversations,
    returned: conversations.slice(0, limit).length,
    sortedBy: sortBy,
    conversations: conversations.slice(0, limit)
  };
}

export async function summarizeConversation(sessionId) {
  const session = await col("sessions").findOne({ sessionId });

  if (!session) {
    return { found: false, error: `"${sessionId}" ID'li konuşma bulunamadı.` };
  }

  const messages = await col("messages")
    .find({ sessionId })
    .sort({ _order: 1 })
    .toArray();

  if (messages.length === 0) {
    return { found: true, sessionId, summary: "Bu konuşmada henüz mesaj yok." };
  }

  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");

  const allUserText = userMessages.map(m => m.content).join(" ");
  const topics = extractTags(allUserText);

  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];

  const summaryParts = [];
  summaryParts.push(`📋 Konuşma: "${session.title}"`);
  summaryParts.push(`📅 Tarih: ${formatDate(firstMsg.timestamp)} → ${formatDate(lastMsg.timestamp)}`);
  summaryParts.push(`💬 Toplam: ${messages.length} mesaj (${userMessages.length} kullanıcı, ${assistantMessages.length} asistan)`);
  summaryParts.push(`🏷️ Konular: ${topics.length > 0 ? topics.join(", ") : "Belirsiz"}`);
  summaryParts.push("");
  summaryParts.push("📝 Konuşma Akışı:");

  userMessages.forEach((msg, idx) => {
    const preview = msg.content.length > 150 ? msg.content.slice(0, 150) + "..." : msg.content;
    summaryParts.push(`  ${idx + 1}. [Kullanıcı]: ${preview}`);
  });

  summaryParts.push("");
  summaryParts.push("🔑 Önemli Noktalar:");
  const keyPoints = extractKeyPoints(messages);
  keyPoints.forEach((point, idx) => {
    summaryParts.push(`  ${idx + 1}. ${point}`);
  });

  const summary = summaryParts.join("\n");

  await col("sessions").updateOne({ sessionId }, { $set: { summary } });

  return {
    found: true,
    sessionId,
    title: session.title,
    tags: topics,
    messageCount: messages.length,
    summary
  };
}

export async function deleteConversation(sessionId) {
  await col("messages").deleteMany({ sessionId });
  const result = await col("sessions").deleteOne({ sessionId });

  if (result.deletedCount > 0) {
    return { deleted: true, sessionId };
  }
  return { deleted: false, error: `"${sessionId}" ID'li konuşma bulunamadı.` };
}

export async function buildContextForAI(sessionId, currentQuery) {
  const contextParts = [];

  const recentMsgs = await col("messages")
    .find({ sessionId })
    .sort({ _order: -1 })
    .limit(30)
    .toArray();

  if (recentMsgs.length > 0) {
    contextParts.push("=== MEVCUT SOHBET GEÇMİŞİ ===");
    recentMsgs.reverse().forEach(m => {
      const role = m.role === "user" ? "Kullanıcı" : "Asistan";
      contextParts.push(`[${role}]: ${m.content}`);
    });
  }

  if (currentQuery) {
    const searchResults = await searchMemory(currentQuery, 3);
    const relatedContexts = searchResults.results.filter(r => r.sessionId !== sessionId);

    if (relatedContexts.length > 0) {
      contextParts.push("\n=== İLGİLİ GEÇMİŞ SOHBETLERDEN BAĞLAM ===");
      for (const related of relatedContexts) {
        contextParts.push(`\n--- Sohbet: "${related.title}" (${related.sessionId}) ---`);
        for (const match of related.topMatches.slice(0, 3)) {
          const role = match.role === "user" ? "Kullanıcı" : "Asistan";
          contextParts.push(`[${role}]: ${match.content}`);
        }
      }
    }
  }

  return contextParts.join("\n");
}

export async function rebuildIndex() {
  const count = await col("sessions").countDocuments();
  return { rebuilt: true, sessionsProcessed: count };
}

// ═══════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════

function generateTitle(text) {
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.slice(0, 77) + "...";
}

function extractTags(text) {
  const tags = [];
  const textLower = text.toLowerCase();
  const techTerms = [
    "javascript", "python", "react", "node", "nodejs", "api",
    "database", "html", "css", "typescript", "sql", "mongodb",
    "express", "vue", "angular", "docker", "kubernetes", "aws",
    "git", "linux", "server", "frontend", "backend", "fullstack",
    "mobile", "ai", "ml", "openai", "gpt", "claude", "openrouter",
    "mcp", "render", "deploy", "kod", "programlama",
    "tasarım", "analiz", "nemotron", "llama"
  ];
  for (const term of techTerms) {
    if (textLower.includes(term)) tags.push(term);
  }
  return [...new Set(tags)].slice(0, 10);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatch(text, query, maxLen = 200) {
  if (!text) return "";
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + query.length + 80);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

function formatDate(dateStr) {
  if (!dateStr) return "?";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return dateStr;
  }
}

function extractKeyPoints(messages) {
  const points = [];
  const userMessages = messages.filter(m => m.role === "user");
  for (const msg of userMessages.slice(0, 10)) {
    const content = msg.content || "";
    if (content.includes("?")) {
      const question = content.split("?")[0].trim() + "?";
      if (question.length < 150) points.push(`Soru: ${question}`);
    } else if (content.length < 100) {
      points.push(`Konu: ${content}`);
    }
  }
  return points.length > 0 ? points.slice(0, 5) : ["Genel konuşma"];
}

async function generateLocalSummaryFromDB(sessionId) {
  const msgs = await col("messages")
    .find({ sessionId, role: "user" })
    .sort({ _order: 1 })
    .toArray();
  const topics = msgs.map(m => m.content.slice(0, 50)).join("; ");
  return `${msgs.length} kullanıcı mesajı. Konular: ${topics}`;
}
