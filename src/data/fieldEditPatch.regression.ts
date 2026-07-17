import type { Arrangement, Field, FieldDraft, FieldsData } from "./fields";
import { fieldsSeedForRegression } from "./MockFieldsRepository";
import { QueuedFieldsRepository } from "./QueuedFieldsRepository";
import {
  normalizeFieldDraft,
  type FieldsOperationWriter,
  type SavedFieldOperation,
} from "./SupabaseFieldsRepository";
import {
  createFieldEditDraft,
  currentArrangementForFieldEdit,
  resolveFieldDetail,
  resolveFieldForm,
  type FieldEditPatch,
} from "./fieldEditPatch";
import type { StorageLike } from "./writeQueue";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(action: () => Promise<unknown>, message: string) {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

function serialize(data: FieldsData, fieldId: string, patch: FieldEditPatch) {
  return normalizeFieldDraft(
    createFieldEditDraft(data, fieldId, patch),
    ids(),
  );
}

function ids() {
  let value = 8100;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

class ScenarioWriter implements FieldsOperationWriter {
  data = fieldsSeedForRegression();
  failLoad = false;
  readonly operations: FieldDraft[] = [];

  async getData(): Promise<FieldsData> {
    if (this.failLoad) throw new TypeError("network timeout");
    return structuredClone(this.data);
  }

  async saveField(draft: FieldDraft): Promise<Field> {
    return (await this.saveFieldOperation(draft, "direct-save")).field;
  }

  async saveFieldOperation(
    draft: FieldDraft,
    _operationId: string,
  ): Promise<SavedFieldOperation> {
    const fieldId = draft.id!;
    const currentField = this.data.fields.find((row) => row.id === fieldId)!;
    const currentArrangement = this.data.arrangements.find(
      (row) => row.field_id === fieldId && row.effective_to === null,
    )!;
    const field: Field = {
      ...currentField,
      id: fieldId,
      name: draft.name,
      operating_entity_id: draft.operating_entity_id,
      total_acres: draft.total_acres,
      county: draft.county,
      state: draft.state,
      legal_description: draft.legal_description,
      fsa_farm_number: draft.fsa_farm_number,
      fsa_tract_number: draft.fsa_tract_number,
      soil_productivity_index: draft.soil_productivity_index,
    };
    const arrangement: Arrangement = {
      ...currentArrangement,
      ...draft.arrangement,
      id: (draft.arrangement as { id?: string }).id ?? currentArrangement.id,
      farm_id: this.data.farm.id,
      field_id: fieldId,
      effective_to: null,
      created_at:
        (draft.arrangement as { id?: string }).id === currentArrangement.id
          ? currentArrangement.created_at
          : "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z",
    };
    this.operations.push(structuredClone(draft));
    this.data.fields = this.data.fields.map((row) =>
      row.id === fieldId ? field : row,
    );
    this.data.arrangements = [
      ...this.data.arrangements.filter(
        (row) => row.field_id !== fieldId || row.effective_to !== null,
      ),
      arrangement,
    ];
    return { field, arrangement, cropAssignments: [] };
  }
}

function createQueuedScenario(writer: ScenarioWriter, isOffline: () => boolean) {
  const userId = "00000000-0000-4000-8000-0000000000aa";
  return new QueuedFieldsRepository(writer, {
    getContext: async () => ({ userId, farmId: writer.data.farm.id }),
    projectRef: "field-edit-regression",
    storage: new MemoryStorage(),
    createId: ids(),
    clock: () => "2026-07-13T00:00:00.000Z",
    isOffline,
  });
}

async function regressionConfirmedReceiptSurvivesFailedRefresh() {
  const writer = new ScenarioWriter();
  const repository = createQueuedScenario(writer, () => false);
  const initial = await repository.getData();
  const field = initial.fields[1];
  const agreementPhone = "RECEIPT-AGREEMENT-SENTINEL";
  const basicsCounty = "RECEIPT-BASICS-SENTINEL";

  await repository.saveField(
    createFieldEditDraft(initial, field.id, {
      arrangement: { landlord_phone: agreementPhone },
    }),
  );
  writer.failLoad = true;
  const afterFailedRefresh = await repository.getData();
  await repository.saveField(
    createFieldEditDraft(afterFailedRefresh, field.id, {
      field: { county: basicsCounty },
    }),
  );

  assert(
    writer.operations[1].arrangement.landlord_phone === agreementPhone &&
      writer.operations[1].county === basicsCounty,
    "A save after a failed refresh rebuilt its bundle from a cache older than the confirmed receipt.",
  );
  const unrelated = afterFailedRefresh.fields.find((row) => row.id !== field.id)!;
  await rejects(
    () =>
      repository.saveField(
        createFieldEditDraft(afterFailedRefresh, unrelated.id, {
          field: { county: "NONCANONICAL-BLOCKED-SENTINEL" },
        }),
      ),
    "A stale fallback workspace was accepted as the canonical base for another field.",
  );
}

async function regressionOfflineAgreementThenBasicsPreservesAgreement() {
  let offline = true;
  const writer = new ScenarioWriter();
  const repository = createQueuedScenario(writer, () => offline);
  const initial = await repository.getData();
  const field = initial.fields[1];
  const agreementPhone = "OFFLINE-AGREEMENT-SENTINEL";
  const basicsCounty = "OFFLINE-BASICS-SENTINEL";

  writer.failLoad = true;
  await repository.saveField(
    createFieldEditDraft(initial, field.id, {
      arrangement: { landlord_phone: agreementPhone },
    }),
  );
  const agreementOverlay = await repository.getData();
  const currentAgreements = agreementOverlay.arrangements.filter(
    (row) => row.field_id === field.id && row.effective_to === null,
  );
  assert(
    currentAgreements.length === 1 &&
      currentAgreements[0].landlord_phone === agreementPhone,
    "The queued agreement overlay did not leave exactly one current agreement.",
  );
  await repository.saveField(
    createFieldEditDraft(agreementOverlay, field.id, {
      field: { county: basicsCounty },
    }),
  );

  offline = false;
  writer.failLoad = false;
  await repository.inspectAndReplay();
  assert(
    writer.operations.length === 2 &&
      writer.operations[1].arrangement.landlord_phone === agreementPhone &&
      writer.operations[1].county === basicsCounty,
    "Offline Agreement then Basics replay reverted the queued agreement change.",
  );
}

function regressionCancelledDraftsNeverReachTheLiveBundle() {
  const data = fieldsSeedForRegression();
  const field = data.fields[1];
  const cancelledName = "CANCELLED-BASICS-SENTINEL";
  const cancelledCommodity = "cancelled_record_sentinel";
  const reopenedCounty = "REOPENED-BASICS-SENTINEL";
  const changedAssignment = data.crop_assignments.find(
    (row) => row.field_id === field.id,
  )!;

  let activeBasicsPatch: FieldEditPatch | null = {
    field: { name: cancelledName },
  };
  const cancelledBasicsBundle = serialize(data, field.id, activeBasicsPatch);
  assert(
    cancelledBasicsBundle.name === cancelledName,
    "The cancelled Basics draft was not exercised by the lifecycle regression.",
  );
  activeBasicsPatch = null;
  activeBasicsPatch = { field: { county: reopenedCounty } };
  const reopenedBasicsBundle = serialize(data, field.id, activeBasicsPatch);

  let activeRecordsPatch: FieldEditPatch | null = {
    newCropAssignments: [
      {
        crop_year: 2099,
        commodity_id: cancelledCommodity,
        planted_acres: 1,
        planting_sequence: 1,
        variety: null,
        planting_date: null,
        harvest_date: null,
        harvested_bushels: null,
        expected_yield_per_acre: null,
        expected_price_per_bu: null,
        notes: null,
      },
    ],
  };
  const cancelledRecordsBundle = serialize(data, field.id, activeRecordsPatch);
  assert(
    cancelledRecordsBundle.crop_assignments.some(
      (row) => row.commodity_id === cancelledCommodity,
    ),
    "The cancelled Records draft was not exercised by the lifecycle regression.",
  );
  activeRecordsPatch = null;
  activeRecordsPatch = {
    cropAssignmentChanges: [
      { id: changedAssignment.id, harvested_bushels: 5432.1 },
    ],
  };
  const reopenedRecordsBundle = serialize(data, field.id, activeRecordsPatch);

  assert(
    reopenedBasicsBundle.name !== cancelledName &&
      reopenedBasicsBundle.county === reopenedCounty,
    "A cancelled Basics value reached the reopened save bundle.",
  );
  assert(
    reopenedRecordsBundle.crop_assignments.every(
      (row) => row.commodity_id !== cancelledCommodity,
    ),
    "A cancelled Records value reached the reopened save bundle.",
  );
}

function regressionBlankUiIdsBecomeDurableIds() {
  const data = fieldsSeedForRegression();
  const source = createFieldEditDraft(data, data.fields[1].id, {});
  const arrangementWithBlankId = {
    ...source.arrangement,
    id: "",
  } as FieldDraft["arrangement"] & { id: string };
  const normalized = normalizeFieldDraft(
    { ...source, id: "", arrangement: arrangementWithBlankId },
    ids(),
  );
  assert(
    normalized.id !== "" && normalized.arrangement.id !== "",
    "The Add field form's blank IDs were not replaced before an online save or offline queue append.",
  );
}

function regressionFieldDetailRecoveryStatesStayDistinct() {
  const data = fieldsSeedForRegression();
  const field = data.fields[1];
  const ready = resolveFieldDetail(data, field.id);
  assert(
    ready.kind === "ready" && ready.field.id === field.id,
    "A complete field did not resolve to its editable detail state.",
  );

  const withoutCurrentAgreement = structuredClone(data);
  withoutCurrentAgreement.arrangements = withoutCurrentAgreement.arrangements.filter(
    (row) => row.field_id !== field.id || row.effective_to !== null,
  );
  const repair = resolveFieldDetail(withoutCurrentAgreement, field.id);
  assert(
    repair.kind === "missing_arrangement" && repair.field.id === field.id,
    "A field missing only its current agreement was mislabeled as deleted.",
  );
  assert(
    resolveFieldDetail(data, "00000000-0000-4000-8000-999999999999").kind ===
      "missing_field",
    "A genuinely missing field did not retain the not-found state.",
  );

  const addForm = resolveFieldForm(data, undefined);
  assert(addForm.kind === "add", "The explicit Add Field route did not resolve as add.");
  assert(
    currentArrangementForFieldEdit(data, addForm) === null,
    "The Add Field path lost its deliberate new-field agreement default.",
  );
  const editForm = resolveFieldForm(data, field.id);
  assert(editForm.kind === "edit" && editForm.field.id === field.id, "A known field route did not resolve as edit.");
  assert(
    currentArrangementForFieldEdit(data, editForm)?.field_id === field.id,
    "An existing field with a real agreement could not preserve it.",
  );
  const missingForm = resolveFieldForm(data, "00000000-0000-4000-8000-999999999999");
  assert(
    missingForm.kind === "missing_field",
    "A supplied unknown edit ID was allowed to fall through to Add Field.",
  );
  const missingAgreementForm = resolveFieldForm(withoutCurrentAgreement, field.id);
  assert(missingAgreementForm.kind === "edit", "A field missing only its agreement did not remain an edit.");
  let missingAgreementRejected = false;
  try {
    currentArrangementForFieldEdit(withoutCurrentAgreement, missingAgreementForm);
  } catch (error) {
    missingAgreementRejected =
      error instanceof Error && /current agreement/i.test(error.message);
  }
  assert(
    missingAgreementRejected,
    "An existing field without an agreement could silently synthesize owned ground.",
  );
}

await regressionConfirmedReceiptSurvivesFailedRefresh();
await regressionOfflineAgreementThenBasicsPreservesAgreement();
regressionCancelledDraftsNeverReachTheLiveBundle();
regressionBlankUiIdsBecomeDurableIds();
regressionFieldDetailRecoveryStatesStayDistinct();
console.log("Field edit patch regressions passed.");
