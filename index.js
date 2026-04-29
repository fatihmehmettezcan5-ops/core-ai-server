// index.js
// ═══════════════════════════════════════════════════════════════
// CORE AI SERVER v8.2 - MongoDB Kalıcı Hafıza + Otomatik Kaydetme
// ═══════════════════════════════════════════════════════════════

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";
import { connectDB } from "./core/db.js";
import {
  saveMemory,
  getMemory,
  getAllSessions,
  deleteSession,
  getConversationContext,
} from "./core/memory.js";
import {
  saveConversation,
  recallConversation,
  searchMemory,
  listConversations,
  summarizeConversation,
  deleteConversation,
  buildContextForAI,
  rebuildIndex,
} from "./core/conversation-memory.js";
import {
  scheduleAutoSave,
  flushAutoSave,
  getAutoSaveStats,
} from "./core/auto-save.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ═══════════════════════════════════════════════════════════════
// CHAT REST API
// ═══════════════════════════════════════════════════════════════

app.get("/chats", async (req, res) => {
  const sessions = await getAllSessions();
  res.json({ success: true, chats: sessions });
});

app.post("/chats", async (req, res) => {
  const sessionId = crypto.randomUUID();
  const title = req.body.title || "New Chat";
  await saveMemory(sessionId, {
    title,
    messages: [],
    createdAt: new Date().toISOString(),
  });
  res.json({ success: true, sessionId, title });
});

app.get("/chats/:sessionId", async (req, res) => {
  const data = await getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  res.json({ success: true, chat: data });
});

app.patch("/chats/:sessionId", async (req, res) => {
  const data = await getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  if (req.body.title) {
    data.title = req.body.title;
    data.titleSet = true;
  }
  await saveMemory(req.params.sessionId, data);
  res.json({ success: true, chat: data });
});

app.delete("/chats/:sessionId", async (req, res) => {
  const deleted = await deleteSession(req.params.sessionId);
  await deleteConversation(req.params.sessionId);
  res.json({ success: true, deleted });
});

app.post("/chats/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;
  const { role, content } = req.body;
  let data = await getMemory(sessionId);
  if (!data) {
    data = {
      title: "New Chat",
      messages: [],
      createdAt: new Date().toISOString(),
    };
  }
  data.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
  if (!data.titleSet && role === "user") {
    data.title = content.slice(0, 80);
    data.titleSet = true;
  }
  await saveMemory(sessionId, data);
  res.json({ success: true, messageCount: data.messages.length });
});

app.patch("/chats/:sessionId/messages/:msgIndex", async (req, res) => {
  const data = await getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  const idx = parseInt(req.params.msgIndex);
  if (!data.messages || idx < 0 || idx >= data.messages.length) {
    return res.status(400).json({ error: "Invalid message index" });
  }
  data.messages[idx].content = req.body.content;
  data.messages[idx].editedAt = new Date().toISOString();
  await saveMemory(req.params.sessionId, data);
  res.json({ success: true, message: data.messages[idx] });
});

app.delete("/chats/:sessionId/messages/:msgIndex", async (req, res) => {
  const data = await getMemory(req.params.sessionId);
  if (!data) return res.status(404).json({ error: "Chat not found" });
  const idx = parseInt(req.params.msgIndex);
  if (!data.messages || idx < 0 || idx >= data.messages.length) {
    return res.status(400).json({ error: "Invalid message index" });
  }
  data.messages.splice(idx, 1);
  await saveMemory(req.params.sessionId, data);
  res.json({ success: true, remaining: data.messages.length });
});

// ═══════════════════════════════════════════════════════════════
// UNIFIED CHAT ENDPOINT (otomatik kaydetme entegre)
// Frontend'in tek çağıracağı endpoint. Output bitince scheduleAutoSave
// otomatik tetiklenir -> hem memory hem conversation-memory'e yazılır.
// ═══════════════════════════════════════════════════════════════

app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId: providedId } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message (string) required" });
    }

    const sessionId = providedId || crypto.randomUUID();
    const memory = await getMemory(sessionId);
    const history = memory?.messages || [];
    const memoryContext = await buildContextForAI(sessionId, message);

    // callCoreModel output bitince scheduleAutoSave'i çağırır
    const reply = await callCoreModel(message, history, memoryContext, {
      sessionId,
      autoSave: true,
    });

    res.json({
      success: true,
      sessionId,
      reply,
      isNewSession: !providedId,
    });
  } catch (err) {
    console.error("/chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// HAFIZA REST API
// ═══════════════════════════════════════════════════════════════

app.get("/memory/search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ error: "Query parameter 'q' is required" });
  const results = await searchMemory(q, parseInt(limit) || 10);
  res.json({ success: true, ...results });
});

app.get("/memory/summary/:sessionId", async (req, res) => {
  const result = await summarizeConversation(req.params.sessionId);
  res.json({ success: true, ...result });
});

app.get("/memory/conversations", async (req, res) => {
  const { limit, sort } = req.query;
  const result = await listConversations(parseInt(limit) || 50, sort || "date");
  res.json({ success: true, ...result });
});

app.post("/memory/rebuild-index", async (req, res) => {
  const result = await rebuildIndex();
  res.json({ success: true, ...result });
});

// Auto-save kuyruk durumu (izleme/debug için)
app.get("/memory/autosave/stats", (req, res) => {
  res.json({ success: true, ...getAutoSaveStats() });
});

// ═══════════════════════════════════════════════════════════════
// MCP JSON-RPC HANDLER
// ═══════════════════════════════════════════════════════════════

app.post("/mcp", async (req, res) => {
  const body = req.body;
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const request of requests) {
    const { method, params, id } = request;
    console.log(">>> MCP Request:", method);

    try {
      // ───── initialize ─────
      if (method === "initialize") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: true },
              resources: {},
              prompts: {},
            },
            serverInfo: { name: "core-ai-engine", version: "8.2.0" },
          },
        });
        continue;
      }

      if (
        method === "notifications/initialized" ||
        method === "notifications/progress"
      ) {
        continue;
      }

      // ───── tools/list ─────
      if (method === "tools/list" || method === "list_tools") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "analyze_and_plan",
                description: "Analyze task and create execution plan",
                inputSchema: {
                  type: "object",
                  properties: { task: { type: "string" } },
                  required: ["task"],
                },
              },
              {
                name: "save_conversation",
                description:
                  "Save a conversation exchange (user message + assistant response) to persistent memory. Use this to store important conversations that should be remembered later.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description:
                        "Unique session identifier. Use existing ID to continue a conversation, or a new UUID to start fresh.",
                    },
                    userMessage: {
                      type: "string",
                      description: "The user's message to save",
                    },
                    assistantMessage: {
                      type: "string",
                      description: "The assistant's response to save",
                    },
                  },
                  required: ["sessionId", "userMessage", "assistantMessage"],
                },
              },
              {
                name: "recall_conversation",
                description:
                  "Recall/retrieve a past conversation by its session ID. Returns the full conversation history so the AI can remember what was discussed before.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description: "The session ID of the conversation to recall",
                    },
                    lastN: {
                      type: "number",
                      description:
                        "Number of recent messages to retrieve (0 = all messages). Default: 0",
                    },
                  },
                  required: ["sessionId"],
                },
              },
              {
                name: "search_memory",
                description:
                  "Search across ALL past conversations for a keyword, phrase, or topic. Returns matching conversations and relevant message snippets. Use this when the user asks about something that might have been discussed before.",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description:
                        "Search query - keyword, phrase, or topic to search for",
                    },
                    maxResults: {
                      type: "number",
                      description: "Maximum number of results to return. Default: 10",
                    },
                  },
                  required: ["query"],
                },
              },
              {
                name: "list_conversations",
                description:
                  "List all saved conversations with their titles, tags, message counts, and dates. Use this to see what conversations are available in memory.",
                inputSchema: {
                  type: "object",
                  properties: {
                    limit: {
                      type: "number",
                      description: "Maximum number of conversations to list. Default: 50",
                    },
                    sortBy: {
                      type: "string",
                      description:
                        "Sort order: 'date' (newest first), 'messages' (most messages first), 'title' (alphabetical). Default: 'date'",
                      enum: ["date", "messages", "title"],
                    },
                  },
                },
              },
              {
                name: "summarize_history",
                description:
                  "Generate a structured summary of a past conversation including topics discussed, key points, and timeline. Use this to quickly understand what a conversation was about.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description: "The session ID of the conversation to summarize",
                    },
                  },
                  required: ["sessionId"],
                },
              },
              {
                name: "delete_conversation",
                description: "Permanently delete a conversation from memory.",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: {
                      type: "string",
                      description: "The session ID of the conversation to delete",
                    },
                  },
                  required: ["sessionId"],
                },
              },
            ],
          },
        });
        continue;
      }

      // ───── tools/call ─────
      if (method === "tools/call" || method === "call_tool") {
        const toolName = params.name;
        const args = params.arguments || {};

        // ═══ analyze_and_plan (auto-save entegre) ═══
        if (toolName === "analyze_and_plan") {
          const { task } = args;
          const sessionId =
            args.sessionId || params.sessionId || crypto.randomUUID();

          const memory = await getMemory(sessionId);
          const planningPrompt = createPlan(task);
          const memoryContext = await buildContextForAI(sessionId, task);
          const history = memory?.messages || [];

          // callCoreModel output bitince scheduleAutoSave'i tetikler
          const result = await callCoreModel(
            planningPrompt,
            history,
            memoryContext,
            { sessionId, autoSave: true }
          );

          responses.push({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: result }] },
          });
          continue;
        }

        // ═══ save_conversation (manuel kayıt - geriye uyumluluk) ═══
        if (toolName === "save_conversation") {
          // Manuel save: auto-save pipeline'ından geçir (dedup + retry)
          scheduleAutoSave({
            sessionId: args.sessionId,
            userMessage: args.userMessage,
            assistantMessage: args.assistantMessage,
            meta: { source: "mcp_manual" },
          });

          // Çağıran anında sonuç bekliyorsa saveConversation'ı da direkt çağır
          const result = await saveConversation(
            args.sessionId,
            args.userMessage,
            args.assistantMessage
          );

          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { status: "saved", ...result },
                    null,
                    2
                  ),
                },
              ],
            },
          });
          continue;
        }

        if (toolName === "recall_conversation") {
          const result = await recallConversation(
            args.sessionId,
            args.lastN || 0
          );
          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
          continue;
        }

        if (toolName === "search_memory") {
          const result = await searchMemory(args.query, args.maxResults || 10);
          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
          continue;
        }

        if (toolName === "list_conversations") {
          const result = await listConversations(
            args.limit || 50,
            args.sortBy || "date"
          );
          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
          continue;
        }

        if (toolName === "summarize_history") {
          const result = await summarizeConversation(args.sessionId);
          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
          continue;
        }

        if (toolName === "delete_conversation") {
          const result = await deleteConversation(args.sessionId);
          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
          continue;
        }

        responses.push({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
        continue;
      }

      // ───── ping ─────
      if (method === "ping") {
        responses.push({ jsonrpc: "2.0", id, result: {} });
        continue;
      }

      responses.push({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
    } catch (err) {
      console.error("MCP Error:", err);
      responses.push({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message },
      });
    }
  }

  if (responses.length === 1) res.json(responses[0]);
  else if (responses.length > 1) res.json(responses);
  else res.status(204).end();
});

// ═══════════════════════════════════════════════════════════════
// SUNUCU BAŞLAT + GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════

async function startServer() {
  await connectDB();
  await rebuildIndex();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Core AI Server v8.2 (MongoDB + AutoSave) running on port ${PORT}`);
  });
}

async function shutdown(signal) {
  console.log(`\n⏹  ${signal} alındı. Auto-save queue flush ediliyor...`);
  try {
    const result = await flushAutoSave(5000);
    console.log("✓ Flush sonucu:", result);
  } catch (err) {
    console.error("Flush hatası:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});

startServer().catch((err) => {
  console.error("❌ Sunucu başlatılamadı:", err);
  process.exit(1);
});
