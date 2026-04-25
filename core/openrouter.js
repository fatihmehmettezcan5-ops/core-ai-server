import fetch from "node-fetch";
import { ELITE_SYSTEM_PROMPT } from "./system.js";

export async function callCoreModel(prompt, conversationHistory = []) {
  // Geçmiş mesajları dahil et
  const messages = [
    { role: "system", content: ELITE_SYSTEM_PROMPT },
    ...conversationHistory.slice(-20).map(m => ({
      role: m.role,
      content: m.content
    })),
    { role: "user", content: prompt }
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-sonnet",
      messages,
      temperature: 0.3,
      stream: false
    })
  });

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "No response.";
}
