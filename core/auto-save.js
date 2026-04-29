// core/auto-save.js
// ═══════════════════════════════════════════════════════════════
// OTOMATİK KAYDETME ALTYAPISI
// Her AI output'u tamamlandığında tetiklenen merkezi hook.
// - Fire-and-forget queue (response gecikmez)
// - Retry + exponential backoff
// - Dedup (aynı (sessionId,userMsg,assistantMsg) iki kez yazılmaz)
// - Graceful shutdown (pending kayıtlar flush edilir)
// ═══════════════════════════════════════════════════════════════

import crypto from "crypto";
import { saveMemory, getMemory } from "./memory.js";
import { saveConversation } from "./conversation-memory.js";

const queue = [];
let processing = false;
const recentHashes = new Map(); // hash -> timestamp (dedup penceresi)
const DEDUP_WINDOW_MS = 10_000;
const MAX_RETRIES = 3;

function hashExchange(sessionId, userMsg, assistantMsg) {
    return crypto
        .createHash("sha1")
        .update(`${sessionId}|${userMsg}|${assistantMsg}`)
        .digest("hex");
}

function cleanupDedup() {
    const now = Date.now();
    for (const [h, t] of recentHashes) {
        if (now - t > DEDUP_WINDOW_MS) recentHashes.delete(h);
    }
}

/**
 * Public API: output bittiği anda çağırılır.
 * Non-blocking; hata fırlatmaz.
 */
export function scheduleAutoSave({ sessionId, userMessage, assistantMessage, meta = {} }) {
    if (!sessionId || !userMessage || !assistantMessage) return;

    cleanupDedup();
    const h = hashExchange(sessionId, userMessage, assistantMessage);
    if (recentHashes.has(h)) {
        console.log("↺ auto-save dedup skip:", sessionId);
        return;
    }
    recentHashes.set(h, Date.now());

    queue.push({
        sessionId,
        userMessage,
        assistantMessage,
        meta,
        attempts: 0,
        enqueuedAt: Date.now(),
    });

    // Asenkron işle
    setImmediate(drain);
}

async function drain() {
    if (processing) return;
    processing = true;
    while (queue.length > 0) {
        const job = queue.shift();
        try {
            await persist(job);
        } catch (err) {
            job.attempts++;
            if (job.attempts < MAX_RETRIES) {
                const delay = 250 * Math.pow(2, job.attempts);
                console.warn(
                    `⚠ auto-save retry ${job.attempts}/${MAX_RETRIES} in ${delay}ms:`,
                    err.message
                );
                setTimeout(() => {
                    queue.push(job);
                    drain();
                }, delay);
            } else {
                console.error("❌ auto-save FAILED permanently:", {
                    sessionId: job.sessionId,
                    error: err.message,
                });
            }
        }
    }
    processing = false;
}

async function persist(job) {
    const { sessionId, userMessage, assistantMessage, meta } = job;
    const timestamp = new Date().toISOString();

    // 1) Session memory (oturum geçmişi)
    let data = await getMemory(sessionId);
    if (!data) {
        data = {
            title: userMessage.slice(0, 80),
            titleSet: true,
            messages: [],
            createdAt: timestamp,
        };
    }
    data.messages = data.messages || [];

    // Son mesaj zaten bu user mesajıysa (manuel eklenmiş) tekrar ekleme
    const last = data.messages[data.messages.length - 1];
    const lastUser = data.messages[data.messages.length - 2];
    const alreadyHasUser =
        lastUser?.role === "user" && lastUser.content === userMessage &&
        last?.role === "assistant" && last.content === assistantMessage;

    if (!alreadyHasUser) {
        data.messages.push(
            { role: "user", content: userMessage, timestamp, ...meta.userMeta },
            { role: "assistant", content: assistantMessage, timestamp, ...meta.assistantMeta }
        );
    }

    if (!data.titleSet) {
        data.title = userMessage.slice(0, 80);
        data.titleSet = true;
    }
    await saveMemory(sessionId, data);

    // 2) Persistent conversation memory (search/recall index)
    await saveConversation(sessionId, userMessage, assistantMessage);

    console.log(
        `✓ auto-saved [${sessionId.slice(0, 8)}…] msgs=${data.messages.length} lag=${Date.now() - job.enqueuedAt
        }ms`
    );
}

/**
 * Graceful shutdown: pending queue'yu bekle.
 */
export async function flushAutoSave(timeoutMs = 5000) {
    const start = Date.now();
    while ((queue.length > 0 || processing) && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 50));
    }
    return { drained: queue.length === 0, remaining: queue.length };
}

export function getAutoSaveStats() {
    return {
        queueLength: queue.length,
        processing,
        dedupCacheSize: recentHashes.size,
    };
}
