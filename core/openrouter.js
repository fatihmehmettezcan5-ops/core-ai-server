import fetch from "node-fetch";
import { CORE_SYSTEM_PROMPT } from "./system.js";

export async function callCoreModel(prompt) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-sonnet",
      messages: [
        { role: "system", content: CORE_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      stream: false
    })
  });

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "No output";
}