import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";

const app = express();
app.use(express.json());

/* ===============================
   MCP SERVER INITIALIZATION
================================ */

const server = new Server(
  { name: "core-ai-engine", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

/* ===============================
   TOOL LIST
================================ */

server.setRequestHandler(ListToolsRequestSchema, async () => ({
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
}));

/* ===============================
   TOOL EXECUTION
================================ */

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { task } = req.params.arguments;

  const planningPrompt = createPlan(task);
  const result = await callCoreModel(planningPrompt);

  return {
    content: [
      {
        type: "text",
        text: result
      }
    ]
  };
});

/* ===============================
   SSE TRANSPORT HANDLING
================================ */

const sessions = new Map();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);

  sessions.set(transport.sessionId, transport);

  res.on("close", () => {
    sessions.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sessions.get(sessionId);

  if (!transport) {
    res.status(400).send("Invalid session");
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

/* ===============================
   SERVER START
================================ */

const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log("✅ Core AI Server Running (SSE mode)");
});