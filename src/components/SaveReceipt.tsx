import { saveReceiptMessage, type SaveReceiptState } from "../lib/saveReceipt";

export function SaveReceipt({ state }: { state: SaveReceiptState | null }) {
  return state ? <span className={`save-receipt save-receipt-${state.replaceAll(" ", "-")}`} role="status">{saveReceiptMessage[state]}</span> : null;
}
