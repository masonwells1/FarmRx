import assert from "node:assert/strict";
import { consumeAuthSessionRemovalTicket, createAuthSessionStorage } from "./authSessionStorage";

const projectRef = "storage-fence-test";
const sessionKey = `farm-rx-auth:${projectRef}`;
const intentKey = `farm-rx-auth-intent:v1:${projectRef}`;
const values = new Map<string, string>();
let sessionMutationCalls = 0;
const target = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { if (key === sessionKey) sessionMutationCalls += 1; values.set(key, value); },
  removeItem: (key: string) => { if (key === sessionKey) sessionMutationCalls += 1; values.delete(key); },
};
const storage = createAuthSessionStorage(target, projectRef);

for (const intent of [
  null,
  JSON.stringify({ version: 1, phase: "pending" }),
  JSON.stringify({ version: 1, phase: "signed_out" }),
  JSON.stringify({ version: 1, nonce: "accepted", phase: "accepted", userId: "user-a", sessionLineage: "lineage-a", startedAtMs: 1 }),
  "malformed",
]) {
  if (intent === null) target.removeItem(intentKey); else target.setItem(intentKey, intent);
  target.setItem(sessionKey, "farm-rx-owned-session");
  const callsBefore = sessionMutationCalls;
  storage.setItem(sessionKey, "auth-js-session");
  storage.removeItem(sessionKey);
  assert.equal(sessionMutationCalls, callsBefore, "The synchronous auth wrapper reached a racy shared-session mutation.");
  assert.equal(values.get(sessionKey), "farm-rx-owned-session", "A stale auth client changed the Farm Rx-owned session.");
}

storage.setItem("farm-rx-auth-code-verifier", "verifier");
assert.equal(values.get("farm-rx-auth-code-verifier"), "verifier", "Non-session auth storage was unexpectedly blocked.");
storage.removeItem("farm-rx-auth-code-verifier");
assert.equal(values.has("farm-rx-auth-code-verifier"), false, "Non-session auth cleanup was unexpectedly blocked.");

target.setItem(intentKey, JSON.stringify({ version: 1, nonce: "accepted", phase: "accepted", userId: "user-a", sessionLineage: "lineage-a", startedAtMs: 1 }));
target.setItem(sessionKey, "accepted-session");
storage.removeItem(sessionKey);
storage.getItem(sessionKey);
storage.setItem("farm-rx-auth-unrelated", "interleaved");
storage.removeItem(`${sessionKey}-code-verifier`);
storage.getItem(intentKey);
storage.removeItem(`${sessionKey}-user`);
assert.deepEqual(consumeAuthSessionRemovalTicket(target, projectRef), {
  sessionBytes: "accepted-session",
  intentBytes: target.getItem(intentKey),
}, "A genuine auth-js teardown did not hand its exact local tuple to Farm Rx.");
assert.equal(consumeAuthSessionRemovalTicket(target, projectRef), null, "A local removal ticket was reusable.");
assert.equal(values.get(sessionKey), "accepted-session", "The synchronous wrapper deleted shared auth outside coordination.");

storage.removeItem(sessionKey);
storage.removeItem(`${sessionKey}-code-verifier`);
storage.removeItem(`${sessionKey}-user`);
storage.setItem(sessionKey, "concurrent-refresh");
assert.equal(consumeAuthSessionRemovalTicket(target, projectRef), null, "A newer auth-js session attempt did not cancel the older removal ticket.");
assert.equal(values.get(sessionKey), "accepted-session", "A suppressed auth-js refresh bypassed Farm Rx coordination.");

storage.removeItem(sessionKey);
storage.removeItem("farm-rx-auth-unexpected-cleanup");
storage.removeItem(`${sessionKey}-code-verifier`);
storage.removeItem(`${sessionKey}-user`);
assert.equal(consumeAuthSessionRemovalTicket(target, projectRef), null, "An interrupted cleanup sequence created removal authority.");

console.log("Auth session storage fence regressions passed.");
