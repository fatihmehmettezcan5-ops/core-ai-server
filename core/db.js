// core/db.js
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
let _db = null;

export async function connectDB() {
  if (_db) return _db;
  await client.connect();
  _db = client.db("core_ai");

  const sessions = _db.collection("sessions");
  const messages = _db.collection("messages");

  await sessions.createIndex({ sessionId: 1 }, { unique: true });
  await sessions.createIndex({ updatedAt: -1 });
  await sessions.createIndex({ tags: 1 });
  await messages.createIndex({ sessionId: 1, _order: 1 });
  await messages.createIndex({ sessionId: 1, role: 1 });

  console.log("✅ MongoDB bağlantısı ve indeksler hazır");
  return _db;
}

export function getDB() {
  if (!_db) throw new Error("DB henüz bağlanmadı! Önce connectDB() çağır.");
  return _db;
}
