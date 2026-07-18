import assert from "node:assert/strict";
import { createAuthSessionStorage } from "./authSessionStorage";

const projectRef = "storage-fence-test";
const sessionKey = `farm-rx-auth:${projectRef}`;
const intentKey = `farm-rx-auth-intent:v1:${projectRef}`;
const values = new Map<string, string>();
const target = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const storage = createAuthSessionStorage(target, projectRef);
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const session = (userId: string, lineage: string) => JSON.stringify({
  access_token: `${encoded({ alg: "none" })}.${encoded({ sub: userId, session_id: lineage })}.signature`,
  refresh_token: `refresh-${userId}`,
  user: { id: userId },
});

storage.setItem(sessionKey, "legacy-session");
assert.equal(values.get(sessionKey), "legacy-session", "A legacy session without an intent must remain refreshable.");

target.setItem(intentKey, JSON.stringify({ version: 1, phase: "pending" }));
storage.setItem(sessionKey, "superseded-session");
assert.equal(values.get(sessionKey), "legacy-session", "Supabase published a session while a Farm Rx sign-in intent was pending.");
storage.removeItem(sessionKey);
assert.equal(values.get(sessionKey), "legacy-session", "Supabase removed rollback state while a Farm Rx sign-in intent was pending.");

target.setItem(sessionKey, "farm-rx-owned-session");
assert.equal(values.get(sessionKey), "farm-rx-owned-session", "Farm Rx could not directly persist its owned session.");

target.setItem(intentKey, JSON.stringify({ version: 1, phase: "signed_out" }));
storage.setItem(sessionKey, "resurrected-session");
assert.equal(values.get(sessionKey), "farm-rx-owned-session", "Supabase resurrected a session behind a signed-out fence.");

target.setItem(intentKey, "malformed");
storage.setItem(sessionKey, "malformed-intent-session");
assert.equal(values.get(sessionKey), "farm-rx-owned-session", "Supabase persisted a session behind malformed intent bytes.");

target.setItem(intentKey, JSON.stringify({ version: 1, phase: "accepted", userId: "user-a", sessionLineage: "lineage-a" }));
storage.setItem(sessionKey, session("user-a", "lineage-a"));
assert.equal(values.get(sessionKey), "farm-rx-owned-session", "A partial accepted intent bypassed the malformed-intent fence.");
target.setItem(intentKey, JSON.stringify({ version: 1, nonce: "accepted-a", phase: "accepted", userId: "user-a", sessionLineage: "", startedAtMs: 1 }));
storage.setItem(sessionKey, session("user-a", ""));
assert.equal(values.get(sessionKey), "farm-rx-owned-session", "An empty accepted lineage bypassed the malformed-intent fence.");

target.setItem(intentKey, JSON.stringify({ version: 1, nonce: "accepted-a", phase: "accepted", userId: "user-a", sessionLineage: "lineage-a", startedAtMs: 1 }));
storage.setItem(sessionKey, session("user-b", "lineage-b"));
assert.equal(values.get(sessionKey), "farm-rx-owned-session", "A stale account replaced the accepted session.");
storage.setItem(sessionKey, session("user-a", "old-lineage"));
assert.equal(values.get(sessionKey), "farm-rx-owned-session", "A stale lineage replaced the accepted session.");
const refreshedSession = session("user-a", "lineage-a");
storage.setItem(sessionKey, refreshedSession);
assert.equal(values.get(sessionKey), refreshedSession, "An accepted session refresh was blocked.");
storage.removeItem(sessionKey);
assert.equal(values.get(sessionKey), refreshedSession, "A stale auth client removed an accepted session.");
target.removeItem(sessionKey);
assert.equal(values.has(sessionKey), false, "Farm Rx could not directly remove its accepted session.");

console.log("Auth session storage fence regressions passed.");
