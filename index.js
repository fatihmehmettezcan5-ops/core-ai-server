// index.js
// ═══════════════════════════════════════════════════════════════
// CORE AI SERVER v8.0 - Gelişmiş Konuşma Hafızası
// ═══════════════════════════════════════════════════════════════

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";
import { saveMemory, getMemory, getAllSessions, deleteSession, getConversationContext } from "./core/memory.js";
import {
  saveConversation,
  recallConversation,
  searchMemory,
  listConversations,
  summarizeConversation,
  deleteConversation,
  buildContextForAI,
  rebuildIndex
} from "./core/conversation-memory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Sunucu başlatıldığında indeksi yeniden oluştur
rebuildIndex();

/* ===============================
   CHAT REST API (Mevcut - Değişiklik yok)
   ================================ */

// Tüm sohbetleri listele
app.get("/chats", (req, res) => {
  const sessions = getAllSessions();
  res.json({ success: true, chats: sessions });
});

// Yeni sohbet oluştur
app.post("/chats", (req, res) => {
  const sessionId = crypto.randomUUID();
  const title = req.body.title || "New Chat";
  saveMemory(sessionId, { title, messages: [], createdAt: new Date().toISOString() });
  res.json({ success: true, sessionId, title });
});

// Tek sohbeti getir
app.get("/chats/:sessionId", (req, res) => {
  const data = getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  res.json({ success: true, chat: data });
});

// Sohbet başlığını düzenle
app.patch("/chats/:sessionId", (req, res) => {
  const data = getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  if (req.body.title) {
    data.title = req.body.title;
    data.titleSet = true;
  }
  saveMemory(req.params.sessionId, data);
  res.json({ success: true, chat: data });
});

// Sohbeti sil
app.delete("/chats/:sessionId", (req, res) => {
  const deleted = deleteSession(req.params.sessionId);
  deleteConversation(req.params.sessionId); // İndeksten de sil
  res.json({ success: true, deleted });
});

// Mesaj ekle
app.post("/chats/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;
  const { role, content } = req.body;

  let data = getMemory(sessionId);
  if (!data) {
    data = { title: "New Chat", messages: [], createdAt: new Date().toISOString() };
  }

  data.messages.push({ role, content, timestamp: new Date().toISOString() });

  if (!data.titleSet && role === "user") {
    data.title = content.slice(0, 80);
    data.titleSet = true;
  }

  saveMemory(sessionId, data);
  res.json({ success: true, messageCount: data.messages.length });
});

// Tek mesajı düzenle
app.patch("/chats/:sessionId/messages/:msgIndex", (req, res) => {
  const data = getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  const idx = parseInt(req.params.msgIndex);
  if (!data.messages || idx < 0 || idx >= data.messages.length) {
    return res.status(400).json({ error: "Invalid message index" });
  }
  data.messages[idx].content = req.body.content;
  data.messages[idx].editedAt = new Date().toISOString();
  saveMemory(req.params.sessionId, data);
  res.json({ success: true, message: data.messages[idx] });
});

// Tek mesajı sil
app.delete("/chats/:sessionId/messages/:msgIndex", (req, res) => {
  const data = getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  const idx = parseInt(req.params.msgIndex);
  if (!data.messages || idx < 0 || idx >= data.messages.length) {
    return res.status(400).json({ error: "Invalid message index" });
  }
  data.messages.splice(idx, 1);
  saveMemory(req.params.sessionId, data);
  res.json({ success: true, remaining: data.messages.length });
});

/* ===============================
   HAFIZA REST API (YENİ)
   ================================ */

// Hafızada arama yap
app.get("/memory/search", (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ error: "Query parameter 'q' is required" });
  const results = searchMemory(q, parseInt(limit) || 10);
  res.json({ success: true, ...results });
});

// Konuşma özetini al
app.get("/memory/summary/:sessionId", (req, res) => {
  const result = summarizeConversation(req.params.sessionId);
  res.json({ success: true, ...result });
});

// Tüm konuşmaları listele (gelişmiş)
app.get("/memory/conversations", (req, res) => {
  const { limit, sort } = req.query;
  const result = listConversations(parseInt(limit) || 50, sort || "date");
  res.json({ success: true, ...result });
});

// İndeksi yeniden oluştur
app.post("/memory/rebuild-index", (req, res) => {
  const result = rebuildIndex();
  res.json({ success: true, ...result });
});

/* ===============================
   MCP JSON-RPC HANDLER (GÜNCELLENMİŞ)
   ================================ */

app.post("/mcp", async (req, res) => {
  const body = req.body;
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const request of requests) {
    const { method, params, id } = request;
    console.log(">>> MCP Request:", method, JSON.stringify(request));

    try {
      // ─── INITIALIZE ───
      if (method === "initialize") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
            serverInfo: { name: "core-ai-engine", version: "8.0.0" }
          }
        });
        continue;
      }

      if (method === "notifications/initialized" || method === "notifications/progress") {
        continue;
      }

      // ─── TOOLS LIST ───
      if (method === "tools/list" || method === "list_tools") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              // 1. Mevcut araç
              {
                name: "analyze_and_plan",
                description: "Analyze task and create execution plan",
                inputSchema: {
                  type: "object",
                  properties: { task: { type: "string" } },
                  required: ["task"]
                }
              },
              // 2. Konuşma kaydet
              {
                name: "save_conversation",
                description: "Save a conversation exchange (user message + assistant response) to persistent memory. Use this to store important conversations that should be remembered later.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description: "Unique session identifier. Use existing ID to continue a conversation, or a new UUID to start fresh."
                    },
                    userMessage: {
                      type: "string",
                      description: "The user's message to save"
                    },
                    assistantMessage: {
                      type: "string",
                      description: "The assistant's response to save"
                    }
                  },
                  required: ["sessionId", "userMessage", "assistantMessage"]
                }
              },
              // 3. Konuşma geri getir
              {
                name: "recall_conversation",
                description: "Recall/retrieve a past conversation by its session ID. Returns the full conversation history so the AI can remember what was discussed before.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description: "The session ID of the conversation to recall"
                    },
                    lastN: {
                      type: "number",
                      description: "Number of recent messages to retrieve (0 = all messages). Default: 0"
                    }
                  },
                  required: ["sessionId"]
                }
              },
              // 4. Hafızada ara
              {
                name: "search_memory",
                description: "Search across ALL past conversations for a keyword, phrase, or topic. Returns matching conversations and relevant message snippets. Use this when the user asks about something that might have been discussed before.",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Search query - keyword, phrase, or topic to search for"
                    },
                    maxResults: {
                      type: "number",
                      description: "Maximum number of results to return. Default: 10"
                    }
                  },
                  required: ["query"]
                }
              },
              // 5. Konuşmaları listele
              {
                name: "list_conversations",
                description: "List all saved conversations with their titles, tags, message counts, and dates. Use this to see what conversations are available in memory.",
                inputSchema: {
                  type: "object",
                  properties: {
                    limit: {
                      type: "number",
                      description: "Maximum number of conversations to list. Default: 50"
                    },
                    sortBy: {
                      type: "string",
                      description: "Sort order: 'date' (newest first), 'messages' (most messages first), 'title' (alphabetical). Default: 'date'",
                      enum: ["date", "messages", "title"]
                    }
                  }
                }
              },
              // 6. Konuşma özetle
              {
                name: "summarize_history",
                description: "Generate a structured summary of a past conversation including topics discussed, key points, and timeline. Use this to quickly understand what a conversation was about.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description: "The session ID of the conversation to summarize"
                    }
                  },
                  required: ["sessionId"]
                }
              },
              // 7. Konuşma sil
              {
                name: "delete_conversation",
                description: "Permanently delete a conversation from memory.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description: "The session ID of the conversation to delete"
                    }
                  },
                  required: ["sessionId"]
                }
              }
            ]
          }
        });
        continue;
      }

      // ─── TOOLS CALL ───
      if (method === "tools/call" || method === "call_tool") {
        const toolName = params.name;
        const args = params.arguments || {};

        // ── analyze_and_plan ──
        if (toolName === "analyze_and_plan") {
          const { task } = args;
          const sessionId = args.sessionId || params.sessionId || "default";

          let memory = getMemory(sessionId);
          const planningPrompt = createPlan(task);

          // Geçmiş sohbetlerden ilgili bağlamı çek
          const memoryContext = buildContextForAI(sessionId, task);
          const history = memory?.messages || [];

          const result = await callCoreModel(planningPrompt, history, memoryContext);

          // Konuşmayı kaydet
          if (memory) {
            memory.messages = memory.messages || [];
            memory.messages.push(
              { role: "user", content: task, timestamp: new Date().toISOString() },
              { role: "assistant", content: result, timestamp: new Date().toISOString() }
            );
            saveMemory(sessionId, memory);
          }

          // Gelişmiş hafızaya da kaydet
          saveConversation(sessionId, task, result);

          responses.push({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: result }] }
          });
          continue;
        }

        // ── save_conversation ──
        if (toolName === "save_conversation") {
          const { sessionId, userMessage, assistantMessage } = args;
          const result = saveConversation(sessionId, userMessage, assistantMessage);

          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "saved",
                  ...result
                }, null, 2)
              }]
            }
          });
          continue;
        }

        // ── recall_conversation ──
        if (toolName === "recall_conversation") {
          const { sessionId, lastN } = args;
          const result = recallConversation(sessionId, lastN || 0);

          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            }
          });
          continue;
        }

        // ── search_memory ──
        if (toolName === "search_memory") {
          const { query, maxResults } = args;
          const result = searchMemory(query, maxResults || 10);

          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            }
          });
          continue;
        }

        // ── list_conversations ──
        if (toolName === "list_conversations") {
          const { limit, sortBy } = args;
          const result = listConversations(limit || 50, sortBy || "date");

          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            }
          });
          continue;
        }

        // ── summarize_history ──
        if (toolName === "summarize_history") {
          const { sessionId } = args;
          const result = summarizeConversation(sessionId);

          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            }
          });
          continue;
        }

        // ── delete_conversation ──
        if (toolName === "delete_conversation") {
          const { sessionId } = args;
          const result = deleteConversation(sessionId);

          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            }
          });
          continue;
        }

        // Bilinmeyen tool
        responses.push({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` }
        });
        continue;
      }

      // ─── PING ───
      if (method === "ping") {
        responses.push({ jsonrpc: "2.0", id, result: {} });
        continue;
      }

      // ─── UNKNOWN METHOD ───
      responses.push({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });

    } catch (err) {
      console.error("MCP Error:", err);
      responses.push({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message }
      });
    }
  }

  const finalResponse = Array.isArray(body) ? responses : responses[0];
  if (finalResponse) res.json(finalResponse);
  else res.status(200).send();
});

/* ===============================
   HEALTH CHECK
   ================================ */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ===============================
   START
   ================================ */

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Core AI Server v8.0 Running with Memory System (port ${port})`);
});
