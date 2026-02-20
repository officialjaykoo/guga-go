const inMemory = {
  users: new Map(),
};

export function initDb() {
  // TODO: swap to real DB (Postgres/Mongo/SQLite) and migrations.
  return inMemory;
}

export function getUserById(id) {
  return inMemory.users.get(id) || null;
}

export function upsertUser(profile) {
  if (!profile?.id) {
    return null;
  }
  inMemory.users.set(profile.id, {
    id: profile.id,
    name: profile.name || "guest",
    email: profile.email || "",
    avatarUrl: profile.avatarUrl || "",
    provider: profile.provider || "guest",
    updatedAt: Date.now(),
  });
  return inMemory.users.get(profile.id);
}
