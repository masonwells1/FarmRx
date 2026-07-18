type AuthSessionStorageTarget = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function acceptedIntent(target: AuthSessionStorageTarget, projectRef: string) {
  const serialized = target.getItem(`farm-rx-auth-intent:v1:${projectRef}`);
  if (serialized === null) return null;
  try {
    const intent = JSON.parse(serialized) as { version?: unknown; nonce?: unknown; phase?: unknown; userId?: unknown; sessionLineage?: unknown; startedAtMs?: unknown } | null;
    return intent?.version === 1
      && typeof intent.nonce === "string"
      && intent.nonce.length > 0
      && intent.phase === "accepted"
      && typeof intent.userId === "string"
      && intent.userId.length > 0
      && typeof intent.sessionLineage === "string"
      && intent.sessionLineage.length > 0
      && typeof intent.startedAtMs === "number"
      && Number.isFinite(intent.startedAtMs)
      ? { userId: intent.userId, sessionLineage: intent.sessionLineage }
      : false;
  } catch {
    return false;
  }
}

function serializedSessionIdentity(serialized: string) {
  try {
    const session = JSON.parse(serialized) as { user?: { id?: unknown }; access_token?: unknown } | null;
    if (!session || typeof session.user?.id !== "string" || typeof session.access_token !== "string") return null;
    const encoded = session.access_token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { sub?: unknown; session_id?: unknown };
    return payload.sub === session.user.id && typeof payload.session_id === "string"
      ? { userId: session.user.id, sessionLineage: payload.session_id }
      : null;
  } catch {
    return null;
  }
}

/**
 * Supabase keeps its in-memory session immediately after a password response.
 * Farm Rx alone publishes the shared session bytes after the matching sign-in
 * intent wins cross-tab coordination. Accepted and legacy sessions still let
 * Supabase persist normal refreshes.
 */
export function createAuthSessionStorage(target: AuthSessionStorageTarget, projectRef: string) {
  const sessionKey = `farm-rx-auth:${projectRef}`;
  return {
    getItem(key: string) {
      return target.getItem(key);
    },
    setItem(key: string, value: string) {
      if (key === sessionKey) {
        const intent = acceptedIntent(target, projectRef);
        if (intent !== null) {
          const session = serializedSessionIdentity(value);
          if (!intent || !session || intent.userId !== session.userId || intent.sessionLineage !== session.sessionLineage) return;
        }
      }
      target.setItem(key, value);
    },
    removeItem(key: string) {
      // Once Farm Rx has an intent fence, its AuthProvider owns session removal.
      // This prevents a stale tab's auth client from deleting a newer session.
      if (key === sessionKey && target.getItem(`farm-rx-auth-intent:v1:${projectRef}`) !== null) return;
      target.removeItem(key);
    },
  };
}
