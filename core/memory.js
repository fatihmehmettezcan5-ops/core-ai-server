const memoryStore = new Map();

export function saveMemory(sessionId, data) {
  memoryStore.set(sessionId, {
    ...data,
    timestamp: new Date().toISOString()
  });
}

export function getMemory(sessionId) {
  return memoryStore.get(sessionId) || null;
}

export function getAllSessions() {
  return Array.from(memoryStore.keys());
}