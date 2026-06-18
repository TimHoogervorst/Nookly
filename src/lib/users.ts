import crypto from "crypto";
import { getDb } from "./db-core";
import { hashPassword } from "./auth";

export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: number;
  created_at: string;
}

// ── Users ───────────────────────────────────────────

export function createUser(username: string, passwordHash: string): { id: number; username: string } {
  const stmt = getDb().prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
  const result = stmt.run(username, passwordHash);
  const user = getDb().prepare("SELECT id, username FROM users WHERE id = ?").get(result.lastInsertRowid) as { id: number; username: string };
  return user;
}

export function getUserByUsername(username: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
}

export function getUserById(id: number): { id: number; username: string } | undefined {
  return getDb().prepare("SELECT id, username FROM users WHERE id = ?").get(id) as { id: number; username: string } | undefined;
}

export function countUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export function updateUserPassword(userId: number, newHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, userId);
}

// ── Sessions ────────────────────────────────────────

export function createUserSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  getDb().prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

export function getUserSession(token: string): Session | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(token) as Session | undefined;
}

export function deleteUserSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

// ── Settings ────────────────────────────────────────

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, value);
}

export function seedAdminUser(): void {
  const database = getDb();
  const existing = database.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (existing.count > 0) return;

  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!username || !password) {
    console.log("No ADMIN_USERNAME/ADMIN_PASSWORD env vars set — admin not seeded.");
    return;
  }

  if (password.length < 6) {
    console.log("ADMIN_PASSWORD must be at least 6 characters — admin not seeded.");
    return;
  }

  const passwordHash = hashPassword(password);
  database.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
  console.log("Admin user created from environment variables.");
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}
