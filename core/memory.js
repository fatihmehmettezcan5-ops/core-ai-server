const memory = new Map();

export function getMemory(sessionId) {
  return memory.get(sessionId) || [];
}

export function saveMemory(sessionId, data) {
  memory.set(sessionId, data);
}