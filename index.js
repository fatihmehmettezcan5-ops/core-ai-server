import express from "express";
import {
  Server,
  StreamableHTTPServerTransport
} from "@modelcontextprotocol/sdk/server";

import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types";

import { callCoreModel } from "./core/openrouter.js";
import { createPlan } from "./core/planner.js";

const app = express();
app.use(express.json());

const server = new Server(
  { name: "core-ai-engine", version: "2.1.0" },
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

const transport = new StreamableHTTPServerTransport(server);

app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res);
});

app.listen(process.env.PORT || 10000, () => {
  console.log("✅ Core AI Server Running (HTTP mode stable)");
});