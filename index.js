import express from "express";
import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";
import { saveMemory } from "./core/memory.js";

const app = express();
app.use(express.json());

/* ===============================
   MCP JSON-RPC HANDLER
================================ */

app.post("/mcp", async (req, res) => {
  const { method, params, id } = req.body;

  console.log("Incoming MCP:", method);

  try {
    // 1️⃣ INITIALIZE
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "core-ai-engine", version: "5.0.0" }
        }
      });
    }

    // 2️⃣ TOOLS LIST
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "analyze_and_plan",
              description: "Analyze task and create execution plan",
              inputSchema: {
                type: "object",
                properties: {
                  task: { type: "string" }
                },
                required: ["task"]
              }
            }
          ]
        }
      });
    }

    // 3️⃣ TOOL CALL
    if (method === "tools/call") {
      const { task } = params.arguments;
      const planningPrompt = createPlan(task);
      const result = await callCoreModel(planningPrompt);

      // ✅ Memory'e kaydet
      saveMemory(id || Date.now(), { task, result: result.slice(0, 200) });

      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: result
            }
          ]
        }
      });
    }

    // 4️⃣ UNKNOWN METHOD
    res.status(400).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "Method not found"
      }
    });
  } catch (err) {
    console.error("MCP Error:", err);
    res.status(500).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err.message
      }
    });
  }
});

/* ===============================
   HEALTH CHECK
================================ */

app.get("/", (req, res) => {
  res.send("✅ Core AI Server Running (JSON-RPC Mode)");
});

/* ===============================
   START
================================ */

const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`✅ Core AI Server Running (port ${port})`);
});