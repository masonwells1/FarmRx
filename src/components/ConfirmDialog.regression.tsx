import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { ConfirmDialogHost, cancelPendingDialogs, confirmDialog, hasOpenDialog, promptDialog } from './ConfirmDialog'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, HTMLButtonElement: win.HTMLButtonElement, Node: win.Node, Event: win.Event, InputEvent: win.InputEvent, MouseEvent: win.MouseEvent, KeyboardEvent: win.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const { createRoot } = await import('react-dom/client')
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null
const buttonNamed = (text: string) => [...document.querySelectorAll('button')].find((button) => button.textContent === text) as HTMLButtonElement | undefined
const focusedText = () => (document.activeElement as HTMLElement | null)?.textContent ?? null
const click = async (button: HTMLElement | undefined) => { assert(button, `Missing button.`); await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }) }

// 1. Without a host, the browser dialog is the fallback so a flow never proceeds unasked.
let fallbackSeen = ''
const priorConfirm = window.confirm; const priorPrompt = window.prompt
window.confirm = (message = '') => { fallbackSeen = message; return false }
window.prompt = () => null
assert((await confirmDialog({ title: 'Delete this?', body: 'It is gone for good.' })) === false && fallbackSeen === 'Delete this? It is gone for good.', 'Without a host, confirmDialog must fall back to window.confirm with the full text and honour its answer.')
assert((await promptDialog({ title: 'Why?', label: 'Reason', required: true })) === null, 'Without a host, promptDialog must fall back to window.prompt.')
window.confirm = () => { throw new Error('window.confirm must not be used while a host is mounted.') }
window.prompt = () => { throw new Error('window.prompt must not be used while a host is mounted.') }

// 2. With the host mounted, the request renders in-app and resolves from the buttons.
const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
await act(async () => { root.render(createElement(ConfirmDialogHost)); await flush() })
assert(dialog() === null && !hasOpenDialog(), 'The host renders nothing while no request is open.')

let answer: boolean | null = null
const pending = confirmDialog({ title: 'Delete this alert rule?', body: 'Past notifications stay.', confirmLabel: 'Delete rule', destructive: true }).then((value) => { answer = value })
await act(async () => { await flush() })
const open = dialog(); assert(open && open.getAttribute('aria-modal') === 'true' && open.textContent?.includes('Delete this alert rule?') && open.textContent?.includes('Past notifications stay.'), 'The dialog must render title and body with aria-modal.')
assert(focusedText() === 'Go back', 'A destructive dialog must start focus on the safe button.')
const destructive = buttonNamed('Delete rule'); assert(destructive?.className.includes('confirm-dialog__destructive'), 'A destructive confirm must use the solid red style.')
await click(buttonNamed('Go back')); await pending
assert(answer === false && dialog() === null, 'Go back must resolve false and close the dialog.')

answer = null
const accept = confirmDialog({ title: 'Use the harvest total as Grain actual?', body: 'This changes Grain actual only; it does not change bins.', confirmLabel: 'Use harvest total' }).then((value) => { answer = value })
await act(async () => { await flush() })
assert(focusedText() === 'Use harvest total', 'A non-destructive dialog must start focus on the confirm button.')
await click(buttonNamed('Use harvest total')); await accept
assert(answer === true && dialog() === null, 'The confirm button must resolve true.')

// 3. Escape cancels.
answer = null
const escaped = confirmDialog({ title: 'Switch farms?' }).then((value) => { answer = value })
await act(async () => { await flush() })
await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush() }); await escaped
assert(answer === false && dialog() === null, 'Escape must cancel the dialog.')

// 4. Queued requests show one at a time, in order.
const answers: boolean[] = []
const first = confirmDialog({ title: 'First question?' }).then((value) => { answers.push(value) })
const second = confirmDialog({ title: 'Second question?' }).then((value) => { answers.push(value) })
await act(async () => { await flush() })
assert(dialog()?.textContent?.includes('First question?') && !dialog()?.textContent?.includes('Second question?'), 'Only the first queued request may show.')
await click(buttonNamed('Yes, continue')); await first
assert(dialog()?.textContent?.includes('Second question?'), 'The second request must show after the first resolves.')
await click(buttonNamed('Go back')); await second
assert(answers.length === 2 && answers[0] === true && answers[1] === false && dialog() === null, 'Queued answers must arrive in order.')

// 5. A required prompt stays disabled until text is typed and returns the trimmed text.
let reason: string | null | undefined
const prompted = promptDialog({ title: 'Cancel this received receipt?', label: 'Why are you cancelling it?', required: true, confirmLabel: 'Cancel receipt', cancelLabel: 'Keep receipt', destructive: true }).then((value) => { reason = value })
await act(async () => { await flush() })
const input = document.querySelector('[role="dialog"] input') as HTMLInputElement | null; assert(input && document.activeElement === input, 'A prompt must render its input and focus it.')
assert(buttonNamed('Cancel receipt')?.disabled === true, 'A required prompt must keep the confirm button disabled while empty.')
await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, '  Wrong lot number  '); input.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true }) as unknown as Event); await flush() })
assert(buttonNamed('Cancel receipt')?.disabled === false, 'Typing must enable the confirm button.')
await click(buttonNamed('Cancel receipt')); await prompted
assert(reason === 'Wrong lot number' && dialog() === null, 'A prompt must resolve the trimmed text.')

reason = undefined
const kept = promptDialog({ title: 'Cancel this received receipt?', label: 'Why?', required: true }).then((value) => { reason = value })
await act(async () => { await flush() })
await click(buttonNamed('Go back')); await kept
assert(reason === null, 'Cancelling a prompt must resolve null.')

// 6. A queued prompt after a prompt mounts fresh: no carried-over text, focus on its own input, and Escape cancels the current request only.
const firstReason: { value?: string | null } = {}; const secondReason: { value?: string | null } = {}
const firstPrompt = promptDialog({ title: 'First reason?', label: 'Why?', required: true }).then((value) => { firstReason.value = value })
const secondPrompt = promptDialog({ title: 'Second reason?', label: 'Why?', required: true }).then((value) => { secondReason.value = value })
await act(async () => { await flush() })
const firstInput = document.querySelector('[role="dialog"] input') as HTMLInputElement | null; assert(firstInput, 'First queued prompt must render its input.')
await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(firstInput, 'Rain delay'); firstInput.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true }) as unknown as Event); await flush() })
await click(buttonNamed('Yes, continue')); await firstPrompt
assert(firstReason.value === 'Rain delay' && dialog()?.textContent?.includes('Second reason?'), 'The first prompt must resolve its text and hand off to the second request.')
const secondInput = document.querySelector('[role="dialog"] input') as HTMLInputElement | null
assert(secondInput && secondInput !== firstInput && secondInput.value === '' && document.activeElement === secondInput && buttonNamed('Yes, continue')?.disabled === true, 'The second queued prompt must mount a fresh card: empty text, focused input, confirm disabled.')
await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush() }); await secondPrompt
assert(secondReason.value === null && dialog() === null && !hasOpenDialog(), 'Escape on the second queued request must cancel that request and close the dialog.')

// 7. Tab and Shift+Tab stay inside the card.
let trapped: boolean | null = null
const trappedDialog = confirmDialog({ title: 'Delete this task?', confirmLabel: 'Delete task', destructive: true }).then((value) => { trapped = value })
await act(async () => { await flush() })
const trapButtons = [...document.querySelectorAll('[role="dialog"] button')] as HTMLButtonElement[]
assert(trapButtons.length === 2 && document.activeElement === trapButtons[0], 'The destructive dialog must start on the safe button.')
await act(async () => { trapButtons[1].focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); await flush() })
assert(document.activeElement === trapButtons[0], 'Tab from the last control must wrap to the first control inside the dialog.')
await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); await flush() })
assert(document.activeElement === trapButtons[1], 'Shift+Tab from the first control must wrap to the last control inside the dialog.')
await click(buttonNamed('Go back')); await trappedDialog
assert(trapped === false, 'The trapped dialog must still answer normally.')

// 8. cancelPendingDialogs answers every waiting request as Go back and closes the card.
let staleConfirm: boolean | null = null; let staleReason: string | null | undefined
const staleA = confirmDialog({ title: 'Delete this field log entry?' }).then((value) => { staleConfirm = value })
const staleB = promptDialog({ title: 'Cancel this receipt?', label: 'Why?', required: true }).then((value) => { staleReason = value })
await act(async () => { await flush() })
assert(dialog() !== null && hasOpenDialog(), 'Requests must be open before the view goes away.')
await act(async () => { cancelPendingDialogs(); await flush() }); await staleA; await staleB
assert(staleConfirm === false && staleReason === null && dialog() === null && !hasOpenDialog(), 'Cancelling pending dialogs must resolve confirm false, prompt null, and close the card.')
cancelPendingDialogs()

await act(async () => { root.unmount() }); container.remove()
window.confirm = priorConfirm; window.prompt = priorPrompt
console.log('ConfirmDialog regression passed.')
