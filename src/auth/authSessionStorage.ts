type AuthSessionStorageTarget = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AuthSessionRemovalTicket {
  sessionBytes: string;
  intentBytes: string | null;
}

interface RemovalState {
  candidate?: AuthSessionRemovalTicket & { projectRef: string; stage: "session" | "verifier"; createdAtMs: number };
  ticket?: AuthSessionRemovalTicket & { projectRef: string; createdAtMs: number };
}

const removalStates = new WeakMap<AuthSessionStorageTarget, RemovalState>();
const removalTicketLifetimeMs = 10_000;

function removalState(target: AuthSessionStorageTarget): RemovalState {
  const existing = removalStates.get(target);
  if (existing) return existing;
  const created: RemovalState = {};
  removalStates.set(target, created);
  return created;
}

export function consumeAuthSessionRemovalTicket(target: AuthSessionStorageTarget, projectRef: string): AuthSessionRemovalTicket | null {
  const state = removalState(target);
  const ticket = state.ticket;
  state.ticket = undefined;
  if (!ticket || ticket.projectRef !== projectRef || Date.now() - ticket.createdAtMs > removalTicketLifetimeMs) return null;
  return { sessionBytes: ticket.sessionBytes, intentBytes: ticket.intentBytes };
}

/**
 * Supabase keeps its in-memory session immediately after a password response.
 * Its storage callbacks are synchronous and therefore cannot acquire Farm Rx's
 * asynchronous cross-tab lock without a check/write race. Farm Rx's
 * AuthProvider alone publishes or removes the shared session under that lock;
 * Supabase may still read the resulting bytes and keep its in-memory session.
 */
export function createAuthSessionStorage(target: AuthSessionStorageTarget, projectRef: string) {
  const sessionKey = `farm-rx-auth:${projectRef}`;
  const verifierKey = `${sessionKey}-code-verifier`;
  const userKey = `${sessionKey}-user`;
  const intentKey = `farm-rx-auth-intent:v1:${projectRef}`;
  return {
    getItem(key: string) {
      return target.getItem(key);
    },
    setItem(key: string, value: string) {
      if (key === sessionKey) {
        const state = removalState(target);
        state.candidate = undefined;
        state.ticket = undefined;
        return;
      }
      target.setItem(key, value);
    },
    removeItem(key: string) {
      const state = removalState(target);
      if (key === sessionKey) {
        const sessionBytes = target.getItem(sessionKey);
        state.candidate = sessionBytes === null ? undefined : {
          projectRef,
          sessionBytes,
          intentBytes: target.getItem(intentKey),
          stage: "session",
          createdAtMs: Date.now(),
        };
        return;
      }
      if (key === verifierKey && state.candidate?.projectRef === projectRef && state.candidate.stage === "session" && Date.now() - state.candidate.createdAtMs <= removalTicketLifetimeMs) {
        state.candidate.stage = "verifier";
        target.removeItem(key);
        return;
      }
      if (key === userKey && state.candidate?.projectRef === projectRef && state.candidate.stage === "verifier" && Date.now() - state.candidate.createdAtMs <= removalTicketLifetimeMs) {
        const { sessionBytes, intentBytes } = state.candidate;
        state.ticket = { projectRef, sessionBytes, intentBytes, createdAtMs: Date.now() };
        state.candidate = undefined;
        target.removeItem(key);
        return;
      }
      state.candidate = undefined;
      target.removeItem(key);
    },
  };
}
