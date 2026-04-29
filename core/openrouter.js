// core/openrouter.js
import fetch from "node-fetch";
import { ELITE_SYSTEM_PROMPT, MEMORY_RECALL_PROMPT } from "./system.js";
import { scheduleAutoSave } from "./auto-save.js";

export async function callCoreModel(
  prompt,
  conversationHistory = [],
  memoryContext = "",
  opts = {} // { sessionId, autoSave = true }
) {
  let systemContent = ELITE_SYSTEM_PROMPT;
  if (memoryContext) {
    systemContent += `\n\n${MEMORY_RECALL_PROMPT}\n\n--- RECALLED CONTEXT ---\n${memoryContext}\n--- END CONTEXT ---`;
  }

  const messages = [
    { role: "system", content: systemContent },
    ...conversationHistory.slice(-20).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: prompt },
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-sonnet",
      messages,
      temperature: 0.3,
      stream: false,
    }),
  });

  const data = await response.json();
  const assistantMessage = data?.choices?.[0]?.message?.content || "No response.";

  // ═══════════ OUTPUT BİTTİ → OTOMATİK KAYDET ═══════════
  if (opts.autoSave !== false && opts.sessionId) {
    scheduleAutoSave({
      sessionId: opts.sessionId,
      userMessage: prompt,
      assistantMessage,
      meta: {
        assistantMeta: {
          model: "anthropic/claude-3.5-sonnet",
          usage: data?.usage,
        },
      },
    });
  }

  return assistantMessage;
}
