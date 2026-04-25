import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";
import { saveMemory, getMemory, getAllSessions, deleteSession } from "./core/memory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ===============================
   CHAT REST API
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
  saveMemory(sessionId, {
    title,
    messages: [],
    createdAt: new Date().toISOString()
  });
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
  res.json({ success: true, deleted });
});

// Mesaj ekle
app.post("/chats/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;
  const { role, content } = req.body;

  let data = getMemory(sessionId);
  if (!data) {
    data = {
      title: "New Chat",
      messages: [],
      createdAt: new Date().toISOString()
    };
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
   MCP JSON-RPC HANDLER
================================ */

app.post("/mcp", async (req, res) => {
  const body = req.body;
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const request of requests) {
    const { method, params, id } = request;
    console.log(">>> MCP Request:", method, JSON.stringify(request));

    try {
      if (method === "initialize") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
            serverInfo: { name: "core-ai-engine", version: "7.0.0" }
          }
        });
        continue;
      }

      if (method === "notifications/initialized" || method === "notifications/progress") {
        continue;
      }

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
                  required: ["task"]
                }
              }
            ]
          }
        });
        continue;
      }

      if (method === "tools/call" || method === "call_tool") {
        const { task } = params.arguments;
        const sessionId = params.sessionId || "default";
        let memory = getMemory(sessionId);

        const planningPrompt = createPlan(task);

        // Sohbet geçmişini AI'a gönder (bağlam koruması)
        const history = memory?.messages || [];
        const result = await callCoreModel(planningPrompt, history);

        if (memory) {
          memory.messages = memory.messages || [];
          memory.messages.push(
            { role: "user", content: task, timestamp: new Date().toISOString() },
            { role: "assistant", content: result, timestamp: new Date().toISOString() }
          );
          saveMemory(sessionId, memory);
        }

        responses.push({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: result }] }
        });
        continue;
      }

      if (method === "ping") {
        responses.push({ jsonrpc: "2.0", id, result: {} });
        continue;
      }

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
  console.log(`✅ Core AI Server v7.0 Running (port ${port})`);
});
