// core/conversation-memory.js
// ═══════════════════════════════════════════════════════════════
// GELIŞMIŞ KONUŞMA HAFIZA MOTORU
// Yapay zekanın geçmiş sohbetleri hatırlaması, araması
// ve bağlam olarak kullanması için tasarlanmıştır.
// ═══════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import crypto from "crypto";

const MEMORY_DIR = path.join(process.cwd(), "chat_data");
const MEMORY_INDEX_FILE = path.join(MEMORY_DIR, "_index.json");

// Dizin yoksa oluştur
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════════════════════════

function safeFileName(sessionId) {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sessionFilePath(sessionId) {
  return path.join(MEMORY_DIR, `${safeFileName(sessionId)}.json`);
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ═══════════════════════════════════════════════════════════════
// İNDEKS YÖNETİMİ
// Tüm sohbetlerin hızlı aranabilir indeksini tutar
// ═══════════════════════════════════════════════════════════════

function loadIndex() {
  return readJSON(MEMORY_INDEX_FILE) || { sessions: {} };
}

function saveIndex(index) {
  writeJSON(MEMORY_INDEX_FILE, index);
}

function updateIndex(sessionId, metadata) {
  const index = loadIndex();
  index.sessions[sessionId] = {
    ...index.sessions[sessionId],
    ...metadata,
    sessionId,
    lastUpdated: new Date().toISOString()
  };
  saveIndex(index);
}

function removeFromIndex(sessionId) {
  const index = loadIndex();
  delete index.sessions[sessionId];
  saveIndex(index);
}

// ═══════════════════════════════════════════════════════════════
// ANA HAFIZA FONKSİYONLARI
// ═══════════════════════════════════════════════════════════════

/**
 * Yeni bir konuşma oturumu oluşturur veya mevcut oturuma mesaj ekler
 */
export function saveConversation(sessionId, userMessage, assistantMessage, metadata = {}) {
  const filePath = sessionFilePath(sessionId);
  let session = readJSON(filePath) || {
    sessionId,
    title: "",
    tags: [],
    summary: "",
    messages: [],
    createdAt: new Date().toISOString(),
    messageCount: 0
  };

  // Mesajları ekle
  const timestamp = new Date().toISOString();

  if (userMessage) {
    session.messages.push({
      role: "user",
      content: userMessage,
      timestamp
    });
  }

  if (assistantMessage) {
    session.messages.push({
      role: "assistant",
      content: assistantMessage,
      timestamp
    });
  }

  // Otomatik başlık oluştur (ilk mesajdan)
  if (!session.title && userMessage) {
    session.title = generateTitle(userMessage);
  }

  // Otomatik etiketler oluştur
  if (userMessage) {
    const newTags = extractTags(userMessage);
    session.tags = [...new Set([...session.tags, ...newTags])];
  }

  // Meta verileri güncelle
  session.messageCount = session.messages.length;
  session.updatedAt = timestamp;
  session.metadata = { ...session.metadata, ...metadata };

  // Özet güncelle (her 10 mesajda bir)
  if (session.messages.length % 10 === 0) {
    session.summary = generateLocalSummary(session.messages);
  }

  writeJSON(filePath, session);

  // İndeksi güncelle
  updateIndex(sessionId, {
    title: session.title,
    tags: session.tags,
    messageCount: session.messageCount,
    summary: session.summary?.slice(0, 200),
    createdAt: session.createdAt
  });

  return {
    sessionId,
    title: session.title,
    messageCount: session.messageCount,
    tags: session.tags
  };
}

/**
 * Belirli bir konuşmayı geri getirir
 * @param {string} sessionId - Oturum ID'si
 * @param {number} lastN - Son N mesajı getir (0 = tümü)
 */
export function recallConversation(sessionId, lastN = 0) {
  const filePath = sessionFilePath(sessionId);
  const session = readJSON(filePath);

  if (!session) {
    return { found: false, error: `"${sessionId}" ID'li konuşma bulunamadı.` };
  }

  let messages = session.messages || [];

  if (lastN > 0 && messages.length > lastN) {
    messages = messages.slice(-lastN);
  }

  return {
    found: true,
    sessionId: session.sessionId,
    title: session.title,
    tags: session.tags,
    summary: session.summary,
    messageCount: session.messages.length,
    returnedCount: messages.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp
    }))
  };
}

/**
 * Tüm konuşmalarda anahtar kelime / ifade arar
 * @param {string} query - Aranacak metin
 * @param {number} maxResults - Maksimum sonuç sayısı
 */
export function searchMemory(query, maxResults = 10) {
  const index = loadIndex();
  const results = [];
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  for (const [sessionId, meta] of Object.entries(index.sessions)) {
    const filePath = sessionFilePath(sessionId);
    const session = readJSON(filePath);
    if (!session || !session.messages) continue;

    const matchingMessages = [];
    let sessionRelevance = 0;

    // Başlık eşleşmesi (yüksek ağırlık)
    if (session.title && session.title.toLowerCase().includes(queryLower)) {
      sessionRelevance += 10;
    }

    // Etiket eşleşmesi (yüksek ağırlık)
    if (session.tags) {
      for (const tag of session.tags) {
        if (tag.toLowerCase().includes(queryLower) || queryLower.includes(tag.toLowerCase())) {
          sessionRelevance += 5;
        }
      }
    }

    // Mesaj içeriği eşleşmesi
    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      const contentLower = (msg.content || "").toLowerCase();

      let messageScore = 0;

      // Tam ifade eşleşmesi
      if (contentLower.includes(queryLower)) {
        messageScore += 5;
      }

      // Kelime bazlı eşleşme
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          messageScore += 1;
        }
      }

      if (messageScore > 0) {
        sessionRelevance += messageScore;
        matchingMessages.push({
          index: i,
          role: msg.role,
          content: highlightMatch(msg.content, query, 200),
          score: messageScore,
          timestamp: msg.timestamp
        });
      }
    }

    if (sessionRelevance > 0) {
      results.push({
        sessionId,
        title: session.title,
        tags: session.tags,
        relevanceScore: sessionRelevance,
        matchCount: matchingMessages.length,
        totalMessages: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        topMatches: matchingMessages
          .sort((a, b) => b.score - a.score)
          .slice(0, 5) // Her sohbetten en fazla 5 eşleşme
      });
    }
  }

  // Relevance'a göre sırala
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    query,
    totalResults: results.length,
    results: results.slice(0, maxResults)
  };
}

/**
 * Tüm konuşmaları listeler (özet bilgilerle)
 * @param {number} limit - Maksimum sonuç
 * @param {string} sortBy - Sıralama: "date" | "messages" | "title"
 */
export function listConversations(limit = 50, sortBy = "date") {
  const index = loadIndex();
  let sessions = Object.values(index.sessions);

  // Sıralama
  switch (sortBy) {
    case "messages":
      sessions.sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0));
      break;
    case "title":
      sessions.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      break;
    case "date":
    default:
      sessions.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
  }

  sessions = sessions.slice(0, limit);

  return {
    totalConversations: Object.keys(index.sessions).length,
    returned: sessions.length,
    sortedBy: sortBy,
    conversations: sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title || "İsimsiz Sohbet",
      tags: s.tags || [],
      messageCount: s.messageCount || 0,
      summary: s.summary || "",
      createdAt: s.createdAt,
      lastUpdated: s.lastUpdated
    }))
  };
}

/**
 * Bir konuşmanın özetini çıkarır
 * @param {string} sessionId - Oturum ID'si
 */
export function summarizeConversation(sessionId) {
  const filePath = sessionFilePath(sessionId);
  const session = readJSON(filePath);

  if (!session) {
    return { found: false, error: `"${sessionId}" ID'li konuşma bulunamadı.` };
  }

  const messages = session.messages || [];

  if (messages.length === 0) {
    return { found: true, sessionId, summary: "Bu konuşmada henüz mesaj yok." };
  }

  // Konuşma akışını analiz et
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");

  // Konu çıkarımı
  const allUserText = userMessages.map(m => m.content).join(" ");
  const topics = extractTags(allUserText);

  // Zaman bilgisi
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];

  // Konuşma özeti oluştur
  const summaryParts = [];
  summaryParts.push(`📋 Konuşma: "${session.title}"`);
  summaryParts.push(`📅 Tarih: ${formatDate(firstMsg.timestamp)} → ${formatDate(lastMsg.timestamp)}`);
  summaryParts.push(`💬 Toplam: ${messages.length} mesaj (${userMessages.length} kullanıcı, ${assistantMessages.length} asistan)`);
  summaryParts.push(`🏷️ Konular: ${topics.length > 0 ? topics.join(", ") : "Belirsiz"}`);
  summaryParts.push("");
  summaryParts.push("📝 Konuşma Akışı:");

  // Kullanıcı mesajlarının özetini oluştur
  userMessages.forEach((msg, idx) => {
    const preview = msg.content.length > 150
      ? msg.content.slice(0, 150) + "..."
      : msg.content;
    summaryParts.push(`  ${idx + 1}. [Kullanıcı]: ${preview}`);
  });

  // Önemli bilgileri çıkar
  summaryParts.push("");
  summaryParts.push("🔑 Önemli Noktalar:");

  const keyPoints = extractKeyPoints(messages);
  keyPoints.forEach((point, idx) => {
    summaryParts.push(`  ${idx + 1}. ${point}`);
  });

  const summary = summaryParts.join("\n");

  // Özeti kaydet
  session.summary = summary;
  writeJSON(filePath, session);
  updateIndex(sessionId, { summary: summary.slice(0, 200) });

  return {
    found: true,
    sessionId,
    title: session.title,
    tags: topics,
    messageCount: messages.length,
    summary
  };
}

/**
 * Bir konuşmayı siler
 */
export function deleteConversation(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    removeFromIndex(sessionId);
    return { deleted: true, sessionId };
  }
  return { deleted: false, error: `"${sessionId}" ID'li konuşma bulunamadı.` };
}

/**
 * Belirli bir oturumun bağlamını AI'a gönderilecek formatta hazırlar
 * Geçmiş konuşmalardan ilgili bağlamı da ekler
 */
export function buildContextForAI(sessionId, currentQuery) {
  const session = readJSON(sessionFilePath(sessionId));
  const contextParts = [];

  // 1. Mevcut oturumun geçmişi
  if (session && session.messages && session.messages.length > 0) {
    contextParts.push("=== MEVCUT SOHBET GEÇMİŞİ ===");
    const recentMessages = session.messages.slice(-30); // Son 30 mesaj
    recentMessages.forEach(m => {
      const role = m.role === "user" ? "Kullanıcı" : "Asistan";
      contextParts.push(`[${role}]: ${m.content}`);
    });
  }

  // 2. İlgili geçmiş sohbetlerden bağlam çek
  if (currentQuery) {
    const searchResults = searchMemory(currentQuery, 3);
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

// ═══════════════════════════════════════════════════════════════
// YARDIMCI İÇ FONKSİYONLAR
// ═══════════════════════════════════════════════════════════════

function generateTitle(text) {
  // İlk cümleyi veya ilk 80 karakteri başlık yap
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.slice(0, 77) + "...";
}

function extractTags(text) {
  const tags = [];
  const textLower = text.toLowerCase();

  // Teknik terimler
  const techTerms = [
    "javascript", "python", "react", "node", "nodejs", "api", "database",
    "html", "css", "typescript", "sql", "mongodb", "express", "vue",
    "angular", "docker", "kubernetes", "aws", "git", "linux", "server",
    "frontend", "backend", "fullstack", "mobile", "web", "ai", "ml",
    "yapay zeka", "makine öğrenmesi", "veri tabanı", "sunucu",
    "kod", "programlama", "uygulama", "tasarım", "analiz",
    "mcp", "tool", "araç", "hafıza", "memory", "sohbet", "chat"
  ];

  for (const term of techTerms) {
    if (textLower.includes(term)) {
      tags.push(term);
    }
  }

  return [...new Set(tags)].slice(0, 10); // Maks 10 etiket
}

function extractKeyPoints(messages) {
  const points = [];
  const assistantMessages = messages.filter(m => m.role === "assistant");

  for (const msg of assistantMessages) {
    const content = msg.content || "";

    // Numaralı liste öğelerini çıkar
    const listItems = content.match(/^\d+\.\s+.{10,100}/gm);
    if (listItems) {
      points.push(...listItems.slice(0, 3));
    }

    // Başlıkları çıkar
    const headers = content.match(/^#+\s+.{5,80}/gm);
    if (headers) {
      points.push(...headers.map(h => h.replace(/^#+\s+/, "")));
    }

    // Önemli cümleleri çıkar (kısa ve bilgi dolu)
    const sentences = content.split(/[.!?]\s/);
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length > 20 && trimmed.length < 200) {
        const importantWords = ["önemli", "dikkat", "sonuç", "çözüm", "important", "note", "result", "solution", "key"];
        if (importantWords.some(w => trimmed.toLowerCase().includes(w))) {
          points.push(trimmed);
        }
      }
    }

    if (points.length >= 10) break;
  }

  return [...new Set(points)].slice(0, 10);
}

function highlightMatch(content, query, maxLen = 200) {
  if (!content) return "";

  const idx = content.toLowerCase().indexOf(query.toLowerCase());

  if (idx === -1) {
    return content.length > maxLen ? content.slice(0, maxLen) + "..." : content;
  }

  // Eşleşme etrafında bağlam göster
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + query.length + 80);
  let snippet = content.slice(start, end);

  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  return snippet;
}

function generateLocalSummary(messages) {
  const userMsgs = messages.filter(m => m.role === "user");
  if (userMsgs.length === 0) return "";

  const topics = userMsgs.map(m => {
    const preview = m.content.slice(0, 100);
    return preview;
  });

  return `Konuşma ${userMsgs.length} kullanıcı sorusu içeriyor. Konular: ${topics.slice(0, 5).join(" | ")}`;
}

function formatDate(isoString) {
  if (!isoString) return "Bilinmiyor";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("tr-TR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return isoString;
  }
}

// ═══════════════════════════════════════════════════════════════
// İNDEKSİ YENİDEN OLUŞTUR (mevcut dosyalardan)
// ═══════════════════════════════════════════════════════════════

export function rebuildIndex() {
  const index = { sessions: {} };

  try {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith(".json") && f !== "_index.json");

    for (const file of files) {
      const filePath = path.join(MEMORY_DIR, file);
      const session = readJSON(filePath);
      if (!session) continue;

      const sessionId = session.sessionId || file.replace(".json", "");
      index.sessions[sessionId] = {
        sessionId,
        title: session.title || "İsimsiz",
        tags: session.tags || extractTags(
          (session.messages || []).filter(m => m.role === "user").map(m => m.content).join(" ")
        ),
        messageCount: session.messages?.length || 0,
        summary: session.summary?.slice(0, 200) || "",
        createdAt: session.createdAt,
        lastUpdated: session.updatedAt || session.createdAt
      };
    }
  } catch (err) {
    console.error("İndeks yeniden oluşturma hatası:", err);
  }

  saveIndex(index);
  return { rebuilt: true, sessionCount: Object.keys(index.sessions).length };
}
