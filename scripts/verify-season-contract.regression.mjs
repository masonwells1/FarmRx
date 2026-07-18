import {
  loadSeasonContractInputs,
  validateHarnessIsolation,
  validateSeasonContract,
} from "./verify-season-contract.mjs";

function clone(value) {
  return structuredClone(value);
}

function expectFailure(name, sourceManifest, workflowMarkdown, mutate) {
  const candidate = clone(sourceManifest);
  mutate(candidate);
  try {
    validateSeasonContract(candidate, workflowMarkdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown validation error";
    console.log(`Season contract mutation ${name}: EXPECTED FAIL (${message})`);
    return;
  }
  throw new Error(`Season contract mutation ${name} was incorrectly accepted.`);
}

const { manifest, workflowMarkdown } = await loadSeasonContractInputs();
const goodResult = validateSeasonContract(manifest, workflowMarkdown);
await validateHarnessIsolation();
console.log(`Season contract good fixture: PASS (${goodResult.fixtureCount} fixtures)`);

expectFailure("duplicate UUID", manifest, workflowMarkdown, (candidate) => {
  candidate.fixtures[1].uuid = candidate.fixtures[0].uuid;
});

expectFailure("changed or unlisted UUID", manifest, workflowMarkdown, (candidate) => {
  candidate.fixtures[0].uuid = "28000000-0000-4000-8000-000000000001";
});

expectFailure("2026 clock", manifest, workflowMarkdown, (candidate) => {
  candidate.scenarios[0].fixedInstant = "2026-01-12T08:00:00-06:00";
});

expectFailure("HTTP URL value", manifest, workflowMarkdown, (candidate) => {
  candidate.scenarios[0].remoteEndpoint = ["ht", "tps://example.invalid/season"].join("");
});

expectFailure("run identity key", manifest, workflowMarkdown, (candidate) => {
  const forbiddenKey = ["run", "id"].join("_");
  candidate.scenarios[0][forbiddenKey] = "proof";
});

expectFailure("missing expectedNonWrites", manifest, workflowMarkdown, (candidate) => {
  delete candidate.scenarios[0].expectedNonWrites;
});

expectFailure("unknown network", manifest, workflowMarkdown, (candidate) => {
  candidate.scenarios[0].network = "public internet";
});

expectFailure("missing scenario", manifest, workflowMarkdown, (candidate) => {
  candidate.scenarios = candidate.scenarios.filter((scenario) => scenario.id !== "PH");
});

console.log("Season contract regressions: PASS (8 rejected mutations; imported validator logic)");
console.log("Season regression proof boundary: contract/isolation only; disposable-backend and browser workflow proof not yet run");
