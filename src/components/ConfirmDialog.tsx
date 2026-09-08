import { useEffect, useRef, useState, type FormEvent } from 'react'

/**
 * In-app replacement for window.confirm / window.prompt.
 *
 * Call confirmDialog() or promptDialog() from any handler; the single
 * ConfirmDialogHost mounted at the app root renders the request in the Crop RX
 * design system and resolves the promise when the farmer answers. If no host is
 * mounted (a bare component under test), the browser dialog is used so the flow
 * still blocks on a real answer instead of silently proceeding.
 */
export interface ConfirmDialogOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** A delete or other irreversible action: solid red confirm, focus starts on the safe button. */
  destructive?: boolean
}

export interface PromptDialogOptions extends ConfirmDialogOptions {
  label: string
  placeholder?: string
  /** When true the confirm button stays disabled until the farmer types something. */
  required?: boolean
}

type Request =
  | { id: number; kind: 'confirm'; options: ConfirmDialogOptions; resolve: (value: boolean) => void }
  | { id: number; kind: 'prompt'; options: PromptDialogOptions; resolve: (value: string | null) => void }

const queue: Request[] = []
let nextRequestId = 1
const listeners = new Set<() => void>()

function notify() { for (const listener of listeners) listener() }

function finish(request: Request) {
  const index = queue.indexOf(request)
  if (index >= 0) queue.splice(index, 1)
  notify()
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(window.confirm(options.body ? `${options.title} ${options.body}` : options.title))
  return new Promise((resolve) => { queue.push({ id: nextRequestId++, kind: 'confirm', options, resolve }); notify() })
}

export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  if (listeners.size === 0) {
    const answer = window.prompt(options.body ? `${options.title} ${options.body}` : options.title)
    return Promise.resolve(answer === null || (options.required && answer.trim() === '') ? null : answer)
  }
  return new Promise((resolve) => { queue.push({ id: nextRequestId++, kind: 'prompt', options, resolve }); notify() })
}

/** Test seam: true while a dialog is waiting for an answer. */
export function hasOpenDialog() { return queue.length > 0 }

export function ConfirmDialogHost() {
  const [current, setCurrent] = useState<Request | null>(queue[0] ?? null)
  useEffect(() => {
    const update = () => setCurrent(queue[0] ?? null)
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [])
  if (!current) return null
  // Keyed by request id so a queued request mounts a fresh card: cleared text, fresh focus, its own Escape handler.
  return <DialogCard key={current.id} request={current} />
}

function DialogCard({ request }: { request: Request }) {
  const { options } = request
  const [text, setText] = useState('')
  const cardRef = useRef<HTMLElement>(null)
  const safeButtonRef = useRef<HTMLButtonElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const required = request.kind === 'prompt' && Boolean(request.options.required)
  const canConfirm = !required || text.trim() !== ''

  const cancel = () => { if (request.kind === 'confirm') request.resolve(false); else request.resolve(null); finish(request) }
  const confirm = () => {
    if (!canConfirm) return
    if (request.kind === 'confirm') request.resolve(true); else request.resolve(text.trim())
    finish(request)
  }

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = request.kind === 'prompt' ? inputRef.current : options.destructive ? safeButtonRef.current : confirmButtonRef.current
    first?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
    // The request identity is fixed for the life of this card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (event: FormEvent) => { event.preventDefault(); confirm() }

  return <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel() }}>
    <section ref={cardRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby={options.body ? 'confirm-dialog-body' : undefined}>
      <form onSubmit={submit}>
        <h2 id="confirm-dialog-title">{options.title}</h2>
        {options.body && <p id="confirm-dialog-body">{options.body}</p>}
        {request.kind === 'prompt' && <label>
          <span>{request.options.label}</span>
          <input ref={inputRef} type="text" value={text} placeholder={request.options.placeholder} onChange={(event) => setText(event.target.value)} />
        </label>}
        <div className="confirm-dialog__actions">
          <button ref={safeButtonRef} type="button" className="secondary-action" onClick={cancel}>{options.cancelLabel ?? 'Go back'}</button>
          <button ref={confirmButtonRef} type="submit" className={options.destructive ? 'danger-action confirm-dialog__destructive' : 'primary-action'} disabled={!canConfirm}>{options.confirmLabel ?? 'Yes, continue'}</button>
        </div>
      </form>
    </section>
  </div>
}
