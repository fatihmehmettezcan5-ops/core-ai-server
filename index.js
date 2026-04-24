import express from "express";
import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";

const app = express();
app.use(express.json());

/* ===============================
   MCP JSON-RPC HANDLER
================================ */

app.post("/mcp", async (req, res) => {
  const body = req.body;
  
  // Batch request desteği
  const requests = Array.isArray(body) ? body : [body];
  
  const responses = [];

  for (const request of requests) {
    const { method, params, id } = request;
    
    console.log(">>> MCP Request:", method, JSON.stringify(request));

    try {
      // 1️⃣ INITIALIZE
      if (method === "initialize") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: true },
              resources: {},
              prompts: {}
            },
            serverInfo: {
              name: "core-ai-engine",
              version: "5.1.0"
            }
          }
        });
        continue;
      }

      // 2️⃣ NOTIFICATIONS (no response needed)
      if (method === "notifications/initialized" || method === "notifications/progress") {
        // No response for notifications
        continue;
      }

      // 3️⃣ TOOLS LIST (multiple method names for compatibility)
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
                  properties: {
                    task: { type: "string" }
                  },
                  required: ["task"]
                }
              }
            ]
          }
        });
        continue;
      }

      // 4️⃣ TOOL CALL
      if (method === "tools/call" || method === "call_tool") {
        const { task } = params.arguments;
        const planningPrompt = createPlan(task);
        const result = await callCoreModel(planningPrompt);

        responses.push({
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
        continue;
      }

      // 5️⃣ PING / HEALTH
      if (method === "ping") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {}
        });
        continue;
      }

      // Unknown method
      responses.push({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      });

    } catch (err) {
      console.error("MCP Error:", err);
      responses.push({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err.message
        }
      });
    }
  }

  // Single request ise single response, batch ise array
  const finalResponse = Array.isArray(body) ? responses : responses[0];
  
  if (finalResponse) {
    res.json(finalResponse);
  } else {
    res.status(200).send();
  }
});

/* ===============================
   HEALTH CHECK
================================ */

app.get("/", (req, res) => {
  res.send("✅ Core AI Server Running (Robust Mode)");
});

/* ===============================
   START
================================ */

const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`✅ Core AI Server Running (port ${port})`);
});