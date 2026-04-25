// core/openrouter.js
// ═══════════════════════════════════════════════════════════════
// AI MODEL ÇAĞRISI (Hafıza bağlamı desteği eklenmiş)
// ═══════════════════════════════════════════════════════════════

import fetch from "node-fetch";
import { ELITE_SYSTEM_PROMPT, MEMORY_RECALL_PROMPT } from "./system.js";

/**
 * Ana model çağrı fonksiyonu
 * @param {string} prompt - Kullanıcı prompt'u
 * @param {Array} conversationHistory - Mevcut oturum geçmişi
 * @param {string} memoryContext - Geçmiş sohbetlerden çekilen bağlam
 */
export async function callCoreModel(prompt, conversationHistory = [], memoryContext = "") {
  // System prompt'u oluştur
  let systemContent = ELITE_SYSTEM_PROMPT;

  // Eğer geçmiş sohbetlerden bağlam varsa, system prompt'a ekle
  if (memoryContext) {
    systemContent += `\n\n${MEMORY_RECALL_PROMPT}\n\n--- RECALLED CONTEXT ---\n${memoryContext}\n--- END CONTEXT ---`;
  }

  // Mesajları oluştur
  const messages = [
    { role: "system", content: systemContent },
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
