import type { FieldsData } from './fields'
import type { PositionScope } from './grain'
import type { BudgetCostLineWrite } from './ProfitabilityDataGateway'
import { defaultMatrixValues } from './profitabilityCalculations'
import { validateRevenueProtectionInputs } from './insuranceMath'
import { SOURCED_COST_LINE_EDIT_MESSAGE, type BudgetCostLine, type BudgetFieldAllocation, type CropBudget, type InsuranceBudgetPatch, type ProfitabilityMatrixStep, type ProfitabilityRepository, type ProfitabilityWorkspace } from './profitability'
import { ProfitabilityWriteQueue, type ProfitabilityQueueEntryV1, profitabilityWriteQueueKey } from './profitabilityWriteQueue'
import { isTransportFailure } from './QueuedFieldsRepository'
import { manualCostLineWrite, type ProfitabilityOperationWriter } from './SupabaseProfitabilityRepository'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { readNeedsAttention } from './needsAttentionStore'
import type { StorageLike } from './writeQueue'
import { setSaveReceipt } from '../lib/saveReceipt'
import { SAVE_DURABILITY_UPDATE_MESSAGE } from './saveDurability'
import { captureWorkspaceCacheFence, financialCacheMaxAgeMs, readWorkspaceCache, WorkspaceMemoryChangedError, WorkspaceMemoryScope, writeWorkspaceCache, type WorkspaceMemoryGuard } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { verifyFarmOperationContext, type FarmOperationContext } from './farmOperationContext'
import { captureQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'

type Context = { userId: string; farmId: string }
type Dependencies = { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'; const offlineMessage = 'Your saved entries are waiting on this device. Connect to load your farm.'
function replace<T extends { id: string }>(rows: T[], value: T) { return rows.some((row) => row.id === value.id) ? rows.map((row) => row.id === value.id ? value : row) : [...rows, value] }
function mintCostLine(value: BudgetCostLine, siblings: BudgetCostLineWrite[]): BudgetCostLineWrite {
  const existing = siblings.find((line) => line.id === value.id)
  if (existing) return { ...value, sort_order: existing.sort_order }
  const budgetSiblings = siblings.filter((line) => line.budget_id === value.budget_id)
  return { ...value, sort_order: budgetSiblings.length ? Math.max(...budgetSiblings.map((line) => line.sort_order)) + 1 : 0 }
}
function overlayRawCostLines(raw: BudgetCostLineWrite[], entries: ProfitabilityQueueEntryV1[]): BudgetCostLineWrite[] {
  let next = raw
  for (const entry of entries) {
    if (entry.kind === 'saveCostLine') next = next.some((line) => line.id === entry.row.id) ? next.map((line) => line.id === entry.row.id ? entry.row : line) : [...next, entry.row]
    else if (entry.kind === 'deleteCostLine') next = next.filter((line) => line.id !== entry.id)
    else if (entry.kind === 'copyBudget') next = [...next, ...entry.costLines]
  }
  return next
}

export class QueuedProfitabilityRepository implements ProfitabilityRepository {
  private workspace: ProfitabilityWorkspace | null = null
  private rawCostLineCache: BudgetCostLineWrite[] = []
  private readonly memoryScope = new WorkspaceMemoryScope()
  constructor(private readonly writer: ProfitabilityRepository & ProfitabilityOperationWriter, private readonly dependencies: Dependencies) { if (typeof window !== 'undefined') window.addEventListener('online', () => { void this.replayCurrent() }); setModuleSyncRetryAction('profitability', () => this.replayCurrent()) }
  private async contextAndQueue() { const operationContext = await captureQueuedOperationContext(this.dependencies); const context = { userId: operationContext.userId, farmId: operationContext.farmId }; const queue = new ProfitabilityWriteQueue(this.dependencies.storage, profitabilityWriteQueueKey(this.dependencies.projectRef, context.userId, context.farmId)); const memoryGuard = this.memoryScope.enter(this.dependencies.storage, { projectRef: this.dependencies.projectRef, ...context, module: 'profitability' }, () => { this.workspace = null; this.rawCostLineCache = [] }); return { context, operationContext, queue, memoryGuard } }
  async getNeedsAttentionQueueKey() { return (await this.contextAndQueue()).queue.key }
  async getInsuranceDraftContext() { const { context } = await this.contextAndQueue(); return { projectRef: this.dependencies.projectRef, ...context } }
  private async locked<T>(queue: ProfitabilityWriteQueue, task: (verify: () => void) => Promise<T>) { return queueTransaction(queue.key, this.dependencies.storage, this.dependencies.createId, task) }
  async inspectAndReplay() { await this.replayCurrent() }
  async getSaveDurabilityCapability() { return this.writer.getSaveDurabilityCapability() }
  async getWorkspace(): Promise<ProfitabilityWorkspace> {
    const { context, operationContext, queue, memoryGuard } = await this.contextAndQueue()
    const verifyRead = () => verifyQueuedReadContext(this.dependencies, operationContext)
    const cacheScope = { projectRef: this.dependencies.projectRef, ...context, module: 'profitability' }
    try {
      await this.replayCurrent(); await verifyRead()
      const cacheFence = captureWorkspaceCacheFence(cacheScope)
      const workspace = await this.writer.getWorkspace(); await verifyRead()
      this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      let rawCostLines: BudgetCostLineWrite[] = []
      try { rawCostLines = await this.writer.rawCostLines(); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard) }
      catch (error) { await verifyRead(); if (error instanceof WorkspaceMemoryChangedError) throw error; /* best-effort cache refresh; an empty auxiliary cache is safe */ }
      this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      this.workspace = workspace
      this.rawCostLineCache = rawCostLines
      await writeWorkspaceCache(cacheScope, { workspace, rawCostLines }, cacheFence); await verifyRead()
      this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      const result = await this.locked(queue, () => { this.memoryScope.verify(this.dependencies.storage, memoryGuard); return Promise.resolve(this.overlay(workspace, queue.read().entries)) })
      await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      return result
    } catch (error) {
      await verifyRead()
      const entries = await this.locked(queue, () => Promise.resolve(queue.read().entries)); await verifyRead()
      if (!this.workspace && isTransportFailure(error, this.dependencies.isOffline())) { const cached = await readWorkspaceCache<{ workspace: ProfitabilityWorkspace; rawCostLines: BudgetCostLineWrite[] }>(cacheScope, financialCacheMaxAgeMs); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard); if (cached) { this.workspace = cached.data.workspace; this.rawCostLineCache = cached.data.rawCostLines } }
      if (this.workspace && isTransportFailure(error, this.dependencies.isOffline())) { await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard); return this.overlay(this.workspace, entries) }
      if (!this.workspace && entries.length && isTransportFailure(error, this.dependencies.isOffline())) throw new Error(offlineMessage)
      throw error
    }
  }
  private async currentWorkspace(): Promise<ProfitabilityWorkspace> { if (this.workspace) { const { queue, memoryGuard } = await this.contextAndQueue(); const workspace = this.workspace; const result = await this.locked(queue, () => { this.memoryScope.verify(this.dependencies.storage, memoryGuard); return Promise.resolve(this.overlay(workspace, queue.read().entries)) }); this.memoryScope.verify(this.dependencies.storage, memoryGuard); return result } return this.getWorkspace() }
  private async effectiveRawCostLines(): Promise<BudgetCostLineWrite[]> { const { queue, memoryGuard } = await this.contextAndQueue(); const raw = this.rawCostLineCache; const entries = await this.locked(queue, () => { this.memoryScope.verify(this.dependencies.storage, memoryGuard); return Promise.resolve(queue.read().entries) }); this.memoryScope.verify(this.dependencies.storage, memoryGuard); return overlayRawCostLines(raw, entries) }
  private queuedBase(kind: ProfitabilityQueueEntryV1['kind'], context: Context) { return { version: 1 as const, module: 'profitability' as const, kind, operationId: this.dependencies.createId(), userId: context.userId, farmId: context.farmId, enqueuedAt: this.dependencies.clock() } }
  private async write(entry: ProfitabilityQueueEntryV1, operationContext: FarmOperationContext) {
    const current = await this.dependencies.getContext()
    if (current.userId !== entry.userId || current.farmId !== entry.farmId || operationContext.userId !== entry.userId || operationContext.farmId !== entry.farmId) throw new Error(blocked)
    switch (entry.kind) {
      case 'createBudget': return this.writer.createBudgetOperation(entry.row, entry.priceSteps, entry.yieldSteps, operationContext)
      case 'saveBudget': return this.writer.saveBudgetOperation(entry.row, operationContext)
      case 'saveCostLine': return this.writer.saveCostLineOperation(entry.row, operationContext)
      case 'deleteCostLine': return this.writer.deleteCostLineOperation(entry.id, operationContext)
      case 'replaceMatrixSteps': if ('legacyUnknownSnapshot' in entry) throw new Error('LEGACY_MATRIX_UNKNOWN_SNAPSHOT'); return this.writer.replaceMatrixStepsOperation(entry.budgetId, entry.steps, entry.expectedSteps, operationContext)
      case 'saveAllocation': return this.writer.saveAllocationOperation(entry.row, operationContext)
      case 'deleteAllocation': return this.writer.deleteAllocationOperation(entry.id, operationContext)
      case 'copyBudget': return this.writer.copyBudgetOperation(entry.sourceBudgetId, entry.budget, entry.costLines, entry.matrixSteps, operationContext)
    }
  }
  private async verifyDirect(context: Context, operationContext: FarmOperationContext, memoryGuard: WorkspaceMemoryGuard) { const current = await this.dependencies.getContext(); if (current.userId !== context.userId || current.farmId !== context.farmId || operationContext.userId !== context.userId || operationContext.farmId !== context.farmId) throw new Error(blocked); verifyFarmOperationContext(this.dependencies.storage, operationContext, memoryGuard.fence); this.memoryScope.verify(this.dependencies.storage, memoryGuard) }
  private async verifyOperation(entry: ProfitabilityQueueEntryV1, operationContext: FarmOperationContext, memoryGuard: WorkspaceMemoryGuard) { await this.verifyDirect(entry, operationContext, memoryGuard) }
  private mutableKey(entry: ProfitabilityQueueEntryV1) { return ['saveBudget', 'saveCostLine', 'saveAllocation'].includes(entry.kind) && 'row' in entry ? `${entry.kind}:${entry.row.id}` : null }
  private rebase(entry: ProfitabilityQueueEntryV1, versions: Map<string, string>): ProfitabilityQueueEntryV1 { const key = this.mutableKey(entry); if (!key || !versions.has(key) || !('row' in entry)) return entry; return { ...entry, row: { ...entry.row, updated_at: versions.get(key)! } } as ProfitabilityQueueEntryV1 }
  private syncOrParked(queue: ProfitabilityWriteQueue) { const parked = readNeedsAttention(this.dependencies.storage, queue.key).length; setModuleSyncStatus('profitability', parked ? { kind: 'blocked', pending: parked, message: `${parked} saves need attention.` } : { kind: 'synced', pending: 0 }) }
  private receiptId(entry: ProfitabilityQueueEntryV1) { if (entry.kind === 'createBudget' || entry.kind === 'saveBudget') return entry.row.id; if (entry.kind === 'copyBudget') return entry.budget.id; if (entry.kind === 'saveCostLine' || entry.kind === 'saveAllocation') return entry.row.id; return entry.kind === 'replaceMatrixSteps' ? entry.budgetId : entry.id }
  private async save(entry: ProfitabilityQueueEntryV1, operationContext: FarmOperationContext): Promise<'saved' | 'queued offline'> { const { context, queue, memoryGuard } = await this.contextAndQueue(); if (entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked); await this.verifyOperation(entry, operationContext, memoryGuard); const receiptId = this.receiptId(entry); setSaveReceipt(receiptId, 'saving'); const disposition = await this.locked(queue, async (verify) => { verify(); const enqueue = async () => { verify(); await this.verifyOperation(entry, operationContext, memoryGuard); const next = queue.append(entry); setModuleSyncStatus('profitability', { kind: 'pending', pending: next.entries.length }); if (this.workspace) { this.memoryScope.verify(this.dependencies.storage, memoryGuard); this.workspace = this.overlay(this.workspace, next.entries) } setSaveReceipt(receiptId, 'queued offline'); return 'queued offline' as const }; await this.verifyOperation(entry, operationContext, memoryGuard); if (queue.read().entries.length || this.dependencies.isOffline()) return enqueue(); try { await this.write(entry, operationContext); verify(); await this.verifyOperation(entry, operationContext, memoryGuard); this.syncOrParked(queue); setSaveReceipt(receiptId, 'saved'); return 'saved' as const } catch (error) { await this.verifyOperation(entry, operationContext, memoryGuard); if (isTransportFailure(error, this.dependencies.isOffline())) return enqueue(); setSaveReceipt(receiptId, 'needs attention'); throw error } }); void this.replayCurrent(); return disposition }

  async createBudget(value: CropBudget) {
    const { context, memoryGuard } = await this.contextAndQueue()
    const normalized: CropBudget = { ...value, farm_id: context.farmId, copied_from_budget_id: null }
    this.validateInsurance(normalized)
    const { priceValues, yieldValues } = defaultMatrixValues(normalized)
    const priceSteps: ProfitabilityMatrixStep[] = priceValues.map((amount, index) => ({ id: this.dependencies.createId(), budget_id: normalized.id, axis: 'price', value: amount, sort_order: index }))
    const yieldSteps: ProfitabilityMatrixStep[] = yieldValues.map((amount, index) => ({ id: this.dependencies.createId(), budget_id: normalized.id, axis: 'yield', value: amount, sort_order: index }))
    return this.save({ ...this.queuedBase('createBudget', context), kind: 'createBudget', row: normalized, priceSteps, yieldSteps }, memoryGuard.fence)
  }
  async saveBudget(value: CropBudget) { const { context, memoryGuard } = await this.contextAndQueue(); const row = { ...value, farm_id: context.farmId }; this.validateInsurance(row); return this.save({ ...this.queuedBase('saveBudget', context), kind: 'saveBudget', row }, memoryGuard.fence) }
  /** Insurance uses a focused SQL UPDATE, so a delayed card cannot replay stale price/yield values. */
  async saveBudgetInsurance(budgetId: string, patch: InsuranceBudgetPatch, expectedUpdatedAt?: string | null) { if (this.dependencies.isOffline()) throw new Error('Insurance changes need a connection before they can be confirmed.'); const { context, memoryGuard } = await this.contextAndQueue(); await this.verifyDirect(context, memoryGuard.fence, memoryGuard); await this.writer.saveBudgetInsuranceOperation(budgetId, patch, expectedUpdatedAt, memoryGuard.fence); await this.verifyDirect(context, memoryGuard.fence, memoryGuard); return 'saved' as const }
  async saveCostLine(value: BudgetCostLine) {
    const { context, memoryGuard } = await this.contextAndQueue()
    if (!this.workspace) { try { await this.getWorkspace() } catch { /* offline with nothing cached yet is handled by mintCostLine below */ } }
    const raw = await this.effectiveRawCostLines()
    const existing = raw.find((line) => line.id === value.id)
    if (existing && existing.source_kind !== undefined && existing.source_kind !== 'manual') throw new Error(SOURCED_COST_LINE_EDIT_MESSAGE)
    const minted = manualCostLineWrite(mintCostLine(value, raw))
    const disposition = await this.save({ ...this.queuedBase('saveCostLine', context), kind: 'saveCostLine', row: minted }, memoryGuard.fence)
    // Keep the raw cache current so back-to-back saves (coach "Add typical lines",
    // university-budget seeding) mint distinct sort_orders: a flushed online write leaves
    // the queue immediately, so without this the next mint reuses its sort_order and the
    // database's unique (budget_id, sort_order) rejects it.
    this.memoryScope.verify(this.dependencies.storage, memoryGuard)
    this.rawCostLineCache = this.rawCostLineCache.some((line) => line.id === minted.id) ? this.rawCostLineCache.map((line) => line.id === minted.id ? minted : line) : [...this.rawCostLineCache, minted]
    return disposition
  }
  async deleteCostLine(id: string) { const { context, memoryGuard } = await this.contextAndQueue(); return this.save({ ...this.queuedBase('deleteCostLine', context), kind: 'deleteCostLine', id }, memoryGuard.fence) }
  async replaceMatrixSteps(budgetId: string, steps: ProfitabilityMatrixStep[]) { const { context, memoryGuard } = await this.contextAndQueue(); const workspace = await this.currentWorkspace(); const expectedSteps = workspace.matrix_steps.filter((step) => step.budget_id === budgetId); return this.save({ ...this.queuedBase('replaceMatrixSteps', context), kind: 'replaceMatrixSteps', budgetId, steps: steps.map((step) => ({ ...step, budget_id: budgetId })), expectedSteps }, memoryGuard.fence) }
  async saveAllocation(value: BudgetFieldAllocation) { const { context, memoryGuard } = await this.contextAndQueue(); return this.save({ ...this.queuedBase('saveAllocation', context), kind: 'saveAllocation', row: value }, memoryGuard.fence) }
  async deleteAllocation(id: string) { const { context, memoryGuard } = await this.contextAndQueue(); return this.save({ ...this.queuedBase('deleteAllocation', context), kind: 'deleteAllocation', id }, memoryGuard.fence) }
  async copyBudget(sourceBudgetId: string, copy: CropBudget) {
    const { context, memoryGuard } = await this.contextAndQueue()
    const workspace = await this.currentWorkspace()
    if (!workspace.budgets.some((item) => item.id === sourceBudgetId)) throw new Error('Choose a budget from this farm to copy.')
    const costLines: BudgetCostLineWrite[] = workspace.cost_lines.filter((line) => line.budget_id === sourceBudgetId).map((line, index) => manualCostLineWrite({ ...structuredClone(line), id: this.dependencies.createId(), budget_id: copy.id, sort_order: index }))
    const matrixSteps: ProfitabilityMatrixStep[] = workspace.matrix_steps.filter((step) => step.budget_id === sourceBudgetId).map((step) => ({ ...structuredClone(step), id: this.dependencies.createId(), budget_id: copy.id }))
    const normalizedCopy: CropBudget = { ...copy, farm_id: context.farmId, copied_from_budget_id: sourceBudgetId }
    this.validateInsurance(normalizedCopy)
    return this.save({ ...this.queuedBase('copyBudget', context), kind: 'copyBudget', sourceBudgetId, budget: normalizedCopy, costLines, matrixSteps }, memoryGuard.fence)
  }
  async getBreakeven(scope: PositionScope, fields: FieldsData): Promise<number | null> { return this.writer.getBreakeven(scope, fields) }

  private validateInsurance(budget: CropBudget) { const errors = validateRevenueProtectionInputs(budget); if (errors.length) throw new Error(errors[0]) }

  private overlay(workspace: ProfitabilityWorkspace, entries: ProfitabilityQueueEntryV1[]): ProfitabilityWorkspace {
    let next = structuredClone(workspace)
    for (const entry of entries) {
      if (entry.kind === 'createBudget') { next.budgets = replace(next.budgets, entry.row); next.matrix_steps = [...next.matrix_steps.filter((step) => step.budget_id !== entry.row.id), ...entry.priceSteps, ...entry.yieldSteps] }
      else if (entry.kind === 'saveBudget') next.budgets = replace(next.budgets, entry.row)
      else if (entry.kind === 'saveCostLine') { const { sort_order: _sortOrder, ...publicLine } = entry.row; next.cost_lines = replace(next.cost_lines, publicLine) }
      else if (entry.kind === 'deleteCostLine') next.cost_lines = next.cost_lines.filter((line) => line.id !== entry.id)
      else if (entry.kind === 'replaceMatrixSteps') next.matrix_steps = [...next.matrix_steps.filter((step) => step.budget_id !== entry.budgetId), ...entry.steps]
      else if (entry.kind === 'saveAllocation') next.allocations = replace(next.allocations, entry.row)
      else if (entry.kind === 'deleteAllocation') next.allocations = next.allocations.filter((row) => row.id !== entry.id)
      else if (entry.kind === 'copyBudget') { next.budgets = replace(next.budgets, entry.budget); next.cost_lines = [...next.cost_lines, ...entry.costLines.map(({ sort_order: _sortOrder, ...rest }) => rest)]; next.matrix_steps = [...next.matrix_steps, ...entry.matrixSteps] }
    }
    return next
  }
  async replayCurrent() {
    let source: Awaited<ReturnType<QueuedProfitabilityRepository['contextAndQueue']>>
    try { source = await this.contextAndQueue() } catch { return }
    const { context, queue, memoryGuard } = source
    try {
      await this.locked(queue, async (verify) => {
        let envelope = queue.read()
        if (!envelope.entries.length) { const parked = readNeedsAttention(this.dependencies.storage, queue.key).length; setModuleSyncStatus('profitability', parked ? { kind: 'blocked', pending: parked, message: `${parked} saves need attention.` } : { kind: 'synced', pending: 0 }); return }
        if (this.dependencies.isOffline()) { setModuleSyncStatus('profitability', { kind: 'pending', pending: envelope.entries.length }); return }
        const versions = new Map<string, string>()
        while (envelope.entries.length) {
          const head = envelope.entries[0]
          if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked)
          await this.verifyOperation(head, memoryGuard.fence, memoryGuard)
          setModuleSyncStatus('profitability', { kind: 'syncing', pending: envelope.entries.length })
          try { const saved = await this.write(this.rebase(head, versions), memoryGuard.fence); const key = this.mutableKey(head); if (key && saved && typeof saved === 'object' && typeof (saved as { updated_at?: unknown }).updated_at === 'string') versions.set(key, (saved as { updated_at: string }).updated_at); verify(); await this.verifyOperation(head, memoryGuard.fence, memoryGuard); envelope = queue.removeConfirmedHead(head.operationId) }
          catch (error) {
            await this.verifyOperation(head, memoryGuard.fence, memoryGuard)
            if (isTransportFailure(error, this.dependencies.isOffline())) { setModuleSyncStatus('profitability', { kind: 'pending', pending: envelope.entries.length }); return }
            const updateRequired = error instanceof Error && error.message === SAVE_DURABILITY_UPDATE_MESSAGE
            envelope = queue.parkHead(head.operationId, updateRequired ? SAVE_DURABILITY_UPDATE_MESSAGE : ('legacyUnknownSnapshot' in head ? 'This older matrix save needs attention because its original matrix snapshot is unknown. Review it after the database update.' : 'This save needs attention before it can be retried.'), updateRequired ? 'database_update_required' : undefined); continue
          }
        }
        const parked = readNeedsAttention(this.dependencies.storage, queue.key).length; setModuleSyncStatus('profitability', parked ? { kind: 'blocked', pending: parked, message: `${parked} saves need attention.` } : { kind: 'synced', pending: 0 })
      })
    } catch { setModuleSyncStatus('profitability', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
