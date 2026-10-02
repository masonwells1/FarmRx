import { useSyncExternalStore } from "react";

/** The only four states a farmer can see for an individual save. */
export const SAVE_RECEIPT_STATES = [
  "saving",
  "saved",
  "queued offline",
  "needs attention",
  "confirmation needed",
] as const;
export type SaveReceiptState = (typeof SAVE_RECEIPT_STATES)[number];

const values = new Map<string, SaveReceiptState>();
const publications = new Map<string, number>();
const listeners = new Set<() => void>();
let nextPublication = 0;
export function getSaveReceipt(id: string) { return values.get(id) ?? null }
export function setSaveReceipt(id: string, state: SaveReceiptState) {
  const publication = ++nextPublication;
  publications.set(id, publication);
  values.set(id, state);
  listeners.forEach((listener) => listener());
  if (state === "saved") setTimeout(() => {
    if (publications.get(id) === publication && values.get(id) === "saved") { values.delete(id); publications.delete(id); listeners.forEach((listener) => listener()); }
  }, 1800);
}
export function useSaveReceipt(id: string | null) {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => id ? values.get(id) ?? null : null,
    () => null,
  );
}
export const saveReceiptMessage: Record<SaveReceiptState, string> = {
  saving: "Saving…",
  saved: "Saved",
  "queued offline": "Saved on this phone. It will send when you have signal.",
  "needs attention": "Needs attention: this didn't save. Open it again to check it.",
  "confirmation needed": "Confirmation needed: this may already be recorded. Reload to check before trying again.",
};
