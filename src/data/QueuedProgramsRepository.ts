import { isTransportFailure } from './QueuedFieldsRepository'
import { ProgramsWriteQueue, programsWriteQueueKey, type ProgramsQueueEntryV1 } from './programsWriteQueue'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { normalizeProgramProductDraft, validateProgramDraft, validateProgramPassDraft, validateProgramProductDraft, type Program, type ProgramDraft, type ProgramPass, type ProgramPassDraft, type ProgramProductDraft, type ProgramsData, type ProgramsRepository } from './programs'
import type { StorageLike } from './writeQueue'
import type { SupabaseProgramsRepository } from './SupabaseProgramsRepository'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const offlineMessage = 'Your saved programs are waiting on this device. Connect to load your programs.'
type Context = { userId: string; farmId: string }
const processLocks = new Map<string, Promise<void>>()
const leaseTtl = 6_000

function pendingProgram(entry: Extract<ProgramsQueueEntryV1, { kind: 'save_program' }>, context: Context, existing?: Program): Program {
  return { ...entry.draft, id: entry.draft.id!, farm_id: context.farmId, revision: existing?.revision ?? 1, is_archived: existing?.is_archived ?? false, passes: existing?.passes ?? [], pending: true }
}
function pendingPass(entry: Extract<ProgramsQueueEntryV1, { kind: 'save_program_pass' }>, context: Context, existing?: ProgramPass): ProgramPass {
  return { ...entry.pass, id: entry.pass.id!, farm_id: context.farmId, program_id: entry.programId, sequence: existing?.sequence ?? 1, is_archived: false, products: entry.products.map((product, index) => ({ ...normalizeProgramProductDraft(product), id: product.id!, farm_id: context.farmId, program_pass_id: entry.pass.id!, sequence: index + 1, is_archived: false })), pending: true }
}
async function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = processLocks.get(key) ?? Promise.resolve(); let release!: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  processLocks.set(key, previous.then(() => next)); await previous
  try { return await task() } finally { release(); if (processLocks.get(key) === next) processLocks.delete(key) }
}
/** Matches Harvest/Fields: a Web Lock when available, otherwise a verified renewable storage lease. */
async function crossTabLock<T>(key: string, storage: StorageLike, createId: () => string, task: (verify: () => void) => Promise<T>): Promise<T> {
  const name = `farm-rx-programs:${key}`
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, async () => task(() => undefined))
  const leaseKey = `${key}:lease`; const token = createId(); let lease = ''
  const owns = () => storage.getItem(leaseKey) === lease
  const renew = () => { if (!owns()) throw new Error(blocked); lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked) }
  const existing = storage.getItem(leaseKey)
  try {
    if (existing) { const parsed = JSON.parse(existing) as { expiresAt?: unknown }; if (typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()) throw new Error(blocked) }
    lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked)
    const timer = setInterval(() => { try { renew() } catch { /* the guarded mutation fails closed */ } }, Math.floor(leaseTtl / 3))
    try { return await task(renew) } finally { clearInterval(timer); if (owns()) storage.removeItem(leaseKey) }
  } catch (error) { throw error instanceof Error ? error : new Error(blocked) }
}

export class QueuedProgramsRepository implements ProgramsRepository {
  private workspace: ProgramsData | null = null
  constructor(private readonly live: SupabaseProgramsRepository, private readonly d: { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }) {
    setModuleSyncRetryAction('programs', () => { void this.inspectAndReplay() })
    if (typeof window !== 'undefined') window.addEventListener('online', () => { void this.inspectAndReplay() })
  }
  private async source() { const context = await this.d.getContext(); return { context, queue: new ProgramsWriteQueue(this.d.storage, programsWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) } }
  private locked<T>(queue: ProgramsWriteQueue, task: (verify: () => void) => Promise<T>) { return serial(queue.key, () => crossTabLock(queue.key, this.d.storage, this.d.createId, task)) }
  private base<K extends ProgramsQueueEntryV1['kind']>(kind: K, context: Context) { return { version: 1 as const, module: 'programs' as const, kind, operationId: this.d.createId(), userId: context.userId, farmId: context.farmId, enqueuedAt: this.d.clock() } }
  private rawPending(queue: ProgramsWriteQueue) { return queue.hasStoredData() ? 1 : 0 }
  private markBlocked(queue: ProgramsWriteQueue) { setModuleSyncStatus('programs', { kind: 'blocked', pending: this.rawPending(queue), message: blocked }) }
  private async refreshWorkspace() { this.workspace = await this.live.getData(true); return this.workspace }

  async getData(includeArchived = false): Promise<ProgramsData> {
    const { queue } = await this.source()
    try {
      if (!this.d.isOffline()) { await this.inspectAndReplay(); await this.refreshWorkspace() }
      if (!this.workspace) throw new Error(offlineMessage)
      return await this.locked(queue, () => Promise.resolve(this.project(this.workspace!, queue.read().entries, includeArchived)))
    } catch (error) {
      try {
        const entries = await this.locked(queue, () => Promise.resolve(queue.read().entries))
        if (this.workspace && isTransportFailure(error, this.d.isOffline())) return this.project(this.workspace, entries, includeArchived)
        if (!this.workspace && entries.length && isTransportFailure(error, this.d.isOffline())) throw new Error(offlineMessage)
      } catch { this.markBlocked(queue) }
      throw error
    }
  }
  private project(workspace: ProgramsData, entries: ProgramsQueueEntryV1[], includeArchived: boolean) {
    const value = structuredClone(workspace.programs)
    for (const entry of entries) {
      if (entry.kind === 'save_program') {
        const index = value.findIndex((program) => program.id === entry.draft.id); const existing = index >= 0 ? value[index] : undefined; const next = pendingProgram(entry, { userId: entry.userId, farmId: entry.farmId }, existing)
        if (index >= 0) value[index] = next; else value.push(next)
      } else if (entry.kind === 'save_program_pass') {
        const program = value.find((item) => item.id === entry.programId); if (!program) continue
        const existing = program.passes.find((item) => item.id === entry.pass.id); const next = pendingPass(entry, { userId: entry.userId, farmId: entry.farmId }, existing)
        const without = program.passes.filter((item) => item.id !== next.id); const after = entry.placeAfterPassId === null ? -1 : without.findIndex((item) => item.id === entry.placeAfterPassId)
        if (entry.placeAfterPassId !== null && after < 0) throw new Error(blocked)
        program.passes = [...without.slice(0, after + 1), next, ...without.slice(after + 1)].map((item, index) => ({ ...item, sequence: index + 1 }))
      } else if (entry.kind === 'reorder_program_passes') {
        const program = value.find((item) => item.id === entry.programId); if (program) { const byId = new Map(program.passes.map((pass) => [pass.id, pass])); if (entry.orderedPassIds.length !== byId.size || entry.orderedPassIds.some((id) => !byId.has(id))) throw new Error(blocked); program.passes = entry.orderedPassIds.map((id, index) => ({ ...byId.get(id)!, sequence: index + 1, pending: true })) }
      } else if (entry.kind === 'delete_program_pass') {
        const program = value.find((item) => item.id === entry.programId); if (program) program.passes = program.passes.filter((pass) => pass.id !== entry.passId).map((pass, index) => ({ ...pass, sequence: index + 1, pending: true }))
      } else value.forEach((program) => { if (program.id === entry.programId) { program.is_archived = true; program.pending = true } })
    }
    return { ...workspace, programs: value.filter((program) => includeArchived || !program.is_archived).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) }
  }
  private send(entry: ProgramsQueueEntryV1) { if (entry.kind === 'save_program') return this.live.saveProgramOperation(entry.draft, entry.operationId); if (entry.kind === 'save_program_pass') return this.live.saveProgramPassOperation(entry.programId, entry.pass, entry.products, entry.placeAfterPassId, entry.operationId); if (entry.kind === 'reorder_program_passes') return this.live.reorderProgramPassesOperation(entry.programId, entry.orderedPassIds, entry.operationId); if (entry.kind === 'delete_program_pass') return this.live.deleteProgramPassOperation(entry.programId, entry.passId, entry.operationId); return this.live.deleteProgramOperation(entry.programId, entry.operationId) }
  private async submit(entry: ProgramsQueueEntryV1) {
    const { context, queue } = await this.source(); if (entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked)
    const result = await this.locked(queue, async (verify) => {
      verify(); const enqueue = () => { verify(); const next = queue.append(entry); setModuleSyncStatus('programs', { kind: 'pending', pending: next.entries.length }); return undefined }
      if (this.d.isOffline() || queue.read().entries.length) return enqueue()
      try { const sent = await this.send(entry); verify(); if (entry.kind === 'save_program_pass') await this.refreshWorkspace(); verify(); setModuleSyncStatus('programs', { kind: 'synced', pending: 0 }); return sent }
      catch (error) { if (!isTransportFailure(error, this.d.isOffline())) throw error; return enqueue() }
    })
    void this.inspectAndReplay(); return result
  }
  async saveProgram(draft: ProgramDraft) { const validation = validateProgramDraft(draft); if (validation) throw new Error(validation); const { context } = await this.source(); const entry = { ...this.base('save_program', context), draft: { ...draft, id: draft.id ?? this.d.createId() } } as Extract<ProgramsQueueEntryV1, { kind: 'save_program' }>; return (await this.submit(entry) as Program | undefined) ?? pendingProgram(entry, context, this.workspace?.programs.find((program) => program.id === entry.draft.id)) }
  async saveProgramPass(programId: string, pass: ProgramPassDraft, products: ProgramProductDraft[], placeAfterPassId: string | null) { const validation = validateProgramPassDraft(pass) ?? products.map(validateProgramProductDraft).find((message) => message) ?? null; if (validation) throw new Error(validation); const { context } = await this.source(); const entry = { ...this.base('save_program_pass', context), programId, pass: { ...pass, id: pass.id ?? this.d.createId() }, products: products.map((product) => ({ ...product, id: product.id ?? this.d.createId() })), placeAfterPassId } as Extract<ProgramsQueueEntryV1, { kind: 'save_program_pass' }>; const existing = this.workspace?.programs.find((program) => program.id === programId)?.passes.find((item) => item.id === entry.pass.id); return (await this.submit(entry) as ProgramPass | undefined) ?? pendingPass(entry, context, existing) }
  async reorderProgramPasses(programId: string, orderedPassIds: string[]) { const { context } = await this.source(); const entry = { ...this.base('reorder_program_passes', context), programId, orderedPassIds } as Extract<ProgramsQueueEntryV1, { kind: 'reorder_program_passes' }>; return (await this.submit(entry) as string[] | undefined) ?? orderedPassIds }
  async deleteProgramPass(programId: string, passId: string) { const { context } = await this.source(); await this.submit({ ...this.base('delete_program_pass', context), programId, passId } as Extract<ProgramsQueueEntryV1, { kind: 'delete_program_pass' }>) }
  async deleteProgram(programId: string) { const { context } = await this.source(); const result = await this.submit({ ...this.base('delete_program', context), programId } as Extract<ProgramsQueueEntryV1, { kind: 'delete_program' }>); return (result as Program | undefined) ?? { id: programId, farm_id: context.farmId, name: 'Archived program', program_kind: null, commodity_id: null, crop_year: null, notes: null, revision: this.workspace?.programs.find((program) => program.id === programId)?.revision ?? 1, is_archived: true, passes: [], pending: true } }
  async inspectAndReplay() {
    let source: Awaited<ReturnType<QueuedProgramsRepository['source']>>; try { source = await this.source() } catch { return }
    const { context, queue } = source
    try {
      await this.locked(queue, async (verify) => {
        let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('programs', { kind: 'synced', pending: 0 }); return }
        if (this.d.isOffline()) { setModuleSyncStatus('programs', { kind: 'pending', pending: envelope.entries.length }); return }
        while (envelope.entries.length) {
          const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked)
          setModuleSyncStatus('programs', { kind: 'syncing', pending: envelope.entries.length })
          try { await this.send(head); verify(); if (head.kind === 'save_program_pass') await this.refreshWorkspace(); verify(); envelope = queue.removeConfirmedHead(head.operationId) }
          catch (error) { if (isTransportFailure(error, this.d.isOffline())) { setModuleSyncStatus('programs', { kind: 'pending', pending: envelope.entries.length }); return }; setModuleSyncStatus('programs', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return }
        }
        setModuleSyncStatus('programs', { kind: 'synced', pending: 0 })
      })
    } catch { this.markBlocked(queue) }
  }
}
