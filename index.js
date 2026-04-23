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

const server = new Server(
  { name: "core-ai-engine", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

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

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  // MCPJam mesajları buradan gider
});

app.listen(process.env.PORT || 10000, () => {
  console.log("✅ Core AI Server Running");
});