import { useSyncExternalStore } from "react";

/** The only four states a farmer can see for an individual save. */
export const SAVE_RECEIPT_STATES = [
  "saving",
  "saved",
  "queued offline",
  "needs attention",
] as const;
export type SaveReceiptState = (typeof SAVE_RECEIPT_STATES)[number];

const values = new Map<string, SaveReceiptState>();
const listeners = new Set<() => void>();
export function getSaveReceipt(id: string) { return values.get(id) ?? null }
export function setSaveReceipt(id: string, state: SaveReceiptState) {
  values.set(id, state);
  listeners.forEach((listener) => listener());
  if (state === "saved") setTimeout(() => {
    if (values.get(id) === "saved") { values.delete(id); listeners.forEach((listener) => listener()); }
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
  "queued offline": "Queued offline — will save when connected.",
  "needs attention": "Needs attention — this save was not applied. Reopen it to review.",
};
