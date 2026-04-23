import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";

const app = express();
app.use(express.json());

const server = new Server(
  { name: "core-ai-engine", version: "3.0.0" },
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

/* ===============================
   HTTP BRIDGE
================================ */

const transport = new StdioServerTransport();

await server.connect(transport);

app.post("/mcp", async (req, res) => {
  const response = await server.handleMessage(req.body);
  res.json(response);
});

app.listen(process.env.PORT || 10000, () => {
  console.log("✅ Core AI Server Running (HTTP Bridge Mode)");
});