import fs from "node:fs";
import path from "node:path";

const dbDir = path.resolve(process.cwd(), "server", "data");
const dbPath = path.join(dbDir, "users.json");
const inMemory = { users: new Map(), loaded: false };

const ensureDir = () => {
  fs.mkdirSync(dbDir, { recursive: true });
};

const flushDb = () => {
  ensureDir();
  const users = Array.from(inMemory.users.values());
  fs.writeFileSync(dbPath, JSON.stringify({ users }, null, 2), "utf8");
};

const loadDb = () => {
  if (inMemory.loaded) return;
  inMemory.loaded = true;
  try {
    if (!fs.existsSync(dbPath)) return;
    const raw = fs.readFileSync(dbPath, "utf8");
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed?.users) ? parsed.users : [];
    users.forEach((user) => {
      if (!user?.id) return;
      inMemory.users.set(user.id, user);
    });
  } catch {
    inMemory.users = new Map();
  }
};

export function initDb() {
  loadDb();
  return inMemory;
}

export function getUserById(id) {
  loadDb();
  return inMemory.users.get(id) || null;
}

export function upsertUser(profile) {
  loadDb();
  if (!profile?.id) return null;
  const next = {
    id: profile.id,
    name: profile.name || "guest",
    email: profile.email || "",
    avatarUrl: profile.avatarUrl || "",
    provider: profile.provider || "guest",
    updatedAt: Date.now(),
  };
  inMemory.users.set(profile.id, next);
  flushDb();
  return next;
}

