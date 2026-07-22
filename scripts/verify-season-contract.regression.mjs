import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  REPOSITORY_ROOT,
  loadSeasonContractInputs,
  validateHarnessIsolation,
  validateSeasonContract,
} from "./verify-season-contract.mjs";

const HARNESS_FILES = [
  "package.json",
  "scripts/verify-season.ps1",
  "scripts/verify-season-contract.mjs",
  "scripts/verify-season-contract.regression.mjs",
  "tests/season/season-2027.manifest.json",
];

const EXPECTED_PACKAGE_COMMAND = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-season.ps1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return structuredClone(value);
}

function expectContractFailure(name, candidate, workflowMarkdown, expectedPattern) {
  let failure;
  try {
    validateSeasonContract(candidate, workflowMarkdown);
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, `Season contract mutation ${name} was incorrectly accepted.`);
  assert(
    expectedPattern.test(failure.message),
    `Season contract mutation ${name} failed with an unexpected error: ${failure.message}`,
  );
  console.log(`Season contract mutation ${name}: EXPECTED FAIL (${failure.message})`);
}

async function createTemporaryHarness() {
  const root = await mkdtemp(join(tmpdir(), "farmrx-season-regression-"));
  for (const file of HARNESS_FILES) {
    const target = join(root, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(REPOSITORY_ROOT, file), "utf8"), "utf8");
  }
  return root;
}

async function expectIsolationFailure(name, root, expectedPattern) {
  let failure;
  try {
    await validateHarnessIsolation(root);
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, `Season isolation mutation ${name} was incorrectly accepted.`);
  assert(
    expectedPattern.test(failure.message),
    `Season isolation mutation ${name} failed with an unexpected error: ${failure.message}`,
  );
  console.log(`Season isolation mutation ${name}: EXPECTED FAIL (${failure.message})`);
}

async function runAppendIsolationMutation(name, relativePath, appendText, expectedPattern) {
  const root = await createTemporaryHarness();
  try {
    const target = join(root, relativePath);
    const content = await readFile(target, "utf8");
    await writeFile(target, `${content}\n${appendText}\n`, "utf8");
    await expectIsolationFailure(name, root, expectedPattern);
  } finally {
    assert(root.startsWith(join(tmpdir(), "farmrx-season-regression-")), "Refusing to clean an unexpected regression path.");
    await rm(root, { recursive: true, force: true });
  }
}

async function runReplacementIsolationMutation(name, relativePath, expectedText, replacementText, expectedPattern) {
  const root = await createTemporaryHarness();
  try {
    const target = join(root, relativePath);
    const content = await readFile(target, "utf8");
    assert(content.includes(expectedText), `Season isolation mutation ${name} could not find its target text.`);
    await writeFile(target, content.replace(expectedText, replacementText), "utf8");
    await expectIsolationFailure(name, root, expectedPattern);
  } finally {
    assert(root.startsWith(join(tmpdir(), "farmrx-season-regression-")), "Refusing to clean an unexpected regression path.");
    await rm(root, { recursive: true, force: true });
  }
}

const { manifest, workflowMarkdown } = await loadSeasonContractInputs();
const goodResult = validateSeasonContract(manifest, workflowMarkdown);
await validateHarnessIsolation();
console.log(`Season contract good fixture: PASS (${goodResult.fixtureCount} fixtures)`);

let candidate = clone(manifest);
candidate.fixtures[1].uuid = candidate.fixtures[0].uuid;
expectContractFailure("duplicate UUID", candidate, workflowMarkdown, /^Duplicate fixture UUID at manifest\.fixtures\[1\]\.$/);

candidate = clone(manifest);
candidate.fixtures[0].uuid = "28000000-0000-4000-8000-000000000001";
expectContractFailure(
  "changed or unlisted UUID",
  candidate,
  workflowMarkdown,
  /^Fixture UUID for owner user is unlisted or differs from the accepted workflow manifest\.$/,
);

candidate = clone(manifest);
candidate.scenarios[0].fixedInstant = "2026-01-12T08:00:00-06:00";
expectContractFailure("2026 clock", candidate, workflowMarkdown, /^manifest\.scenarios\[0\]\.fixedInstant must be a 2027 instant\.$/);

candidate = clone(manifest);
candidate.scenarios[0].remoteEndpoint = ["ht", "tps://example.invalid/season"].join("");
expectContractFailure(
  "HTTP URL value",
  candidate,
  workflowMarkdown,
  /^Remote URL values are forbidden at manifest\.scenarios\[0\]\.remoteEndpoint\.$/,
);

candidate = clone(manifest);
const forbiddenKey = ["run", "id"].join("_");
candidate.scenarios[0][forbiddenKey] = "proof";
expectContractFailure(
  "run identity key",
  candidate,
  workflowMarkdown,
  /^Proof-only run identity key is forbidden at manifest\.scenarios\[0\]\.$/,
);

candidate = clone(manifest);
delete candidate.scenarios[0].expectedNonWrites;
expectContractFailure(
  "missing expectedNonWrites",
  candidate,
  workflowMarkdown,
  /^manifest\.scenarios\[0\] keys do not match the closed contract\.$/,
);

candidate = clone(manifest);
candidate.scenarios[0].network = "public internet";
expectContractFailure(
  "unknown network",
  candidate,
  workflowMarkdown,
  /^manifest\.scenarios\[0\]\.network is outside the network allowlist\.$/,
);

candidate = clone(manifest);
candidate.scenarios = candidate.scenarios.filter((scenario) => scenario.id !== "PH");
expectContractFailure(
  "missing scenario",
  candidate,
  workflowMarkdown,
  /^manifest\.scenarios must contain exactly 6 scenarios\.$/,
);

candidate = clone(manifest);
candidate.scenarios[0].expectedWrites.push("invented.contract-value");
expectContractFailure(
  "invented expectation",
  candidate,
  workflowMarkdown,
  /^manifest\.scenarios\[0\]\.expectedWrites differs from the accepted scenario contract\.$/,
);

await runAppendIsolationMutation(
  "split-string globalThis",
  "scripts/verify-season-contract.regression.mjs",
  'globalThis[["fe", "tch"].join("")](["ht", "tps://example.invalid"].join(""));',
  /^scripts\/verify-season-contract\.regression\.mjs contains forbidden globalThis capability\.$/,
);

await runAppendIsolationMutation(
  "unauthorized import",
  "scripts/verify-season-contract.regression.mjs",
  'import { request } from "node:https";',
  /^scripts\/verify-season-contract\.regression\.mjs static imports do not match the closed allowlist\.$/,
);

await runAppendIsolationMutation(
  "unauthorized call",
  "scripts/verify-season-contract.regression.mjs",
  "setTimeout(() => {}, 1);",
  /^scripts\/verify-season-contract\.regression\.mjs contains unknown call target setTimeout\.$/,
);

await runAppendIsolationMutation(
  "dynamic import",
  "scripts/verify-season-contract.regression.mjs",
  'await import("./unauthorized.mjs");',
  /^scripts\/verify-season-contract\.regression\.mjs contains forbidden dynamic import\.$/,
);

await runAppendIsolationMutation(
  "require capability",
  "scripts/verify-season-contract.regression.mjs",
  'require("./unauthorized.cjs");',
  /^scripts\/verify-season-contract\.regression\.mjs contains forbidden require capability\.$/,
);

await runAppendIsolationMutation(
  "eval capability",
  "scripts/verify-season-contract.regression.mjs",
  'eval("1 + 1");',
  /^scripts\/verify-season-contract\.regression\.mjs contains forbidden eval capability\.$/,
);

await runAppendIsolationMutation(
  "Function constructor capability",
  "scripts/verify-season-contract.regression.mjs",
  'new Function("return 1");',
  /^scripts\/verify-season-contract\.regression\.mjs contains forbidden Function capability\.$/,
);

await runAppendIsolationMutation(
  "process capability",
  "scripts/verify-season-contract.regression.mjs",
  "process.cwd();",
  /^scripts\/verify-season-contract\.regression\.mjs contains forbidden process capability use\.$/,
);

await runAppendIsolationMutation(
  "computed call target",
  "scripts/verify-season-contract.regression.mjs",
  "(0, clone)(manifest);",
  /^scripts\/verify-season-contract\.regression\.mjs contains a computed or dynamic call target\.$/,
);

await runAppendIsolationMutation(
  "binding-pattern shadow and constructor smuggling",
  "scripts/verify-season-contract.regression.mjs",
  `const { readFile } = { readFile: [].filter.constructor }; const { resolve } = { resolve: readFile("console.log('AST_BYPASS_EXECUTED')") }; resolve();`,
  /^scripts\/verify-season-contract\.regression\.mjs shadows allowlisted call target readFile\.$/,
);

await runAppendIsolationMutation(
  "array binding-pattern shadow",
  "scripts/verify-season-contract.regression.mjs",
  "const [readFile] = [];",
  /^scripts\/verify-season-contract\.regression\.mjs shadows allowlisted call target readFile\.$/,
);

await runAppendIsolationMutation(
  "unknown constructor",
  "scripts/verify-season-contract.regression.mjs",
  "new AbortController();",
  /^scripts\/verify-season-contract\.regression\.mjs contains an unknown constructor target\.$/,
);

await runReplacementIsolationMutation(
  "altered package command",
  "package.json",
  EXPECTED_PACKAGE_COMMAND,
  "node scripts/verify-season-contract.mjs",
  /^package\.json verify:season command does not match the closed contract\.$/,
);

await runAppendIsolationMutation(
  "PowerShell unauthorized mutation",
  "scripts/verify-season.ps1",
  "Invoke-WebRequest https://example.invalid",
  /^scripts\/verify-season\.ps1 does not match the pinned SHA-256\.$/,
);

console.log("Season contract regressions: PASS (9 rejected contract mutations; 14 rejected isolation mutations)");
console.log("Season regression proof boundary: contract/isolation only; disposable-backend and browser workflow proof not yet run");
