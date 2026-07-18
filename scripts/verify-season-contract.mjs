import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

const MANIFEST_PATH = "tests/season/season-2027.manifest.json";
const WORKFLOWS_PATH = "docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md";
const EXPECTED_SCHEMA = "farm-rx-season-contract";
const EXPECTED_VERSION = 1;
const EXPECTED_YEAR = 2027;
const EXPECTED_TIMEZONE = "America/Chicago";
const EXPECTED_FIXTURE_COUNT = 81;

const EXPECTED_SCENARIOS = new Map([
  ["MR", { fixedInstant: "2027-01-12T08:00:00-06:00", role: "owner", network: "online-local" }],
  ["NF", { fixedInstant: "2027-02-09T08:00:00-06:00", role: "owner", network: "online-local" }],
  ["PS", { fixedInstant: "2027-06-15T14:10:00-05:00", role: "manager", network: "online-local" }],
  ["HR", { fixedInstant: "2027-10-11T17:30:00-05:00", role: "owner", network: "online-local" }],
  ["CC", { fixedInstant: "2027-07-07T13:20:00-05:00", role: "owner", network: "provider-double" }],
  ["PH", { fixedInstant: "2027-08-04T14:00:00-05:00", role: "worker", network: "forced offline" }],
]);

const ALLOWED_ROLES = new Set(["owner", "manager", "worker", "read_only", "named rep", "fixture controller"]);
const ALLOWED_NETWORKS = new Set(["online-local", "provider-double", "forced offline", "reconnect", "revoked reconnect"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?([+-])(\d{2}):(\d{2})$/;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

const HARNESS_FILES = [
  "package.json",
  "scripts/verify-season.ps1",
  "scripts/verify-season-contract.mjs",
  "scripts/verify-season-contract.regression.mjs",
  MANIFEST_PATH,
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertExactKeys(value, expectedKeys, location) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${location} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${location} keys do not match the closed contract.`);
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${path} is not valid JSON.`);
  }
}

export function parseAcceptedFixtureMap(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\|\s*Fixture\s*\|\s*UUID\s*\|$/.test(line));
  assert(headerIndex >= 0, "Accepted workflow fixture table header is missing.");

  const entries = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const match = line.match(/^\|\s*(.+?)\s*\|\s*`([0-9a-f-]{36})`\s*\|$/i);
    assert(match, "Accepted workflow fixture table contains an unreadable row.");
    entries.push([match[1], match[2].toLowerCase()]);
  }

  assert(entries.length === EXPECTED_FIXTURE_COUNT, `Accepted workflow fixture table must contain exactly ${EXPECTED_FIXTURE_COUNT} rows.`);
  const fixtureMap = new Map(entries);
  assert(fixtureMap.size === entries.length, "Accepted workflow fixture labels must be unique.");
  assert(new Set(entries.map(([, uuid]) => uuid)).size === entries.length, "Accepted workflow fixture UUIDs must be unique.");
  return fixtureMap;
}

function validateIso2027Instant(value, location) {
  assert(typeof value === "string", `${location} must be a full ISO instant string.`);
  const match = value.match(ISO_INSTANT);
  assert(match, `${location} must include seconds and an explicit UTC offset.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const values = [yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText].map(Number);
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = values;
  assert(year === EXPECTED_YEAR, `${location} must be a 2027 instant.`);
  assert(offsetHour <= 23 && offsetMinute <= 59, `${location} has an invalid UTC offset.`);
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  assert(
    wallClock.getUTCFullYear() === year &&
      wallClock.getUTCMonth() === month - 1 &&
      wallClock.getUTCDate() === day &&
      wallClock.getUTCHours() === hour &&
      wallClock.getUTCMinutes() === minute &&
      wallClock.getUTCSeconds() === second &&
      Number.isFinite(Date.parse(value)),
    `${location} is not a valid calendar instant.`,
  );
}

function validateReservedAndRemoteValues(value, location = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateReservedAndRemoteValues(entry, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assert(key !== "run_id" && key !== "runId", `Proof-only run identity key is forbidden at ${location}.`);
      validateReservedAndRemoteValues(entry, `${location}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;

  const remoteProtocol = new RegExp(`^${["ht", "tps?"].join("")}://`, "i");
  const hostedBackend = new RegExp(`${["supa", "base"].join("")}\\.(?:co|com)(?:[/:]|$)`, "i");
  assert(!remoteProtocol.test(value), `Remote URL values are forbidden at ${location}.`);
  assert(!hostedBackend.test(value), `Hosted backend values are forbidden at ${location}.`);
}

function validateExpectationIdentifiers(values, location) {
  assert(Array.isArray(values) && values.length > 0, `${location} must be a nonempty array.`);
  values.forEach((value, index) => {
    assert(typeof value === "string" && IDENTIFIER.test(value), `${location}[${index}] must be an explicit stable identifier.`);
  });
  assert(new Set(values).size === values.length, `${location} must not contain duplicate identifiers.`);
}

function validateAcceptedScenarioReferences(markdown) {
  for (const [id, expected] of EXPECTED_SCENARIOS) {
    const header = `## Scenario ${id} `;
    const start = markdown.indexOf(header);
    assert(start >= 0, `Accepted workflow scenario ${id} is missing.`);
    const next = markdown.indexOf("\n## Scenario ", start + header.length);
    const section = markdown.slice(start, next >= 0 ? next : undefined);
    assert(section.includes(`\`${expected.fixedInstant}\``), `Accepted workflow scenario ${id} does not contain its pinned instant.`);
  }
}

export function validateSeasonContract(manifest, workflowMarkdown) {
  validateReservedAndRemoteValues(manifest);
  assertExactKeys(manifest, ["schema", "version", "year", "timezone", "fixtures", "scenarios"], "manifest");
  assert(manifest.schema === EXPECTED_SCHEMA, `Manifest schema must be ${EXPECTED_SCHEMA}.`);
  assert(manifest.version === EXPECTED_VERSION, `Manifest version must be ${EXPECTED_VERSION}.`);
  assert(manifest.year === EXPECTED_YEAR, `Manifest year must be ${EXPECTED_YEAR}.`);
  assert(manifest.timezone === EXPECTED_TIMEZONE, `Manifest timezone must be ${EXPECTED_TIMEZONE}.`);

  const acceptedFixtureMap = parseAcceptedFixtureMap(workflowMarkdown);
  validateAcceptedScenarioReferences(workflowMarkdown);

  assert(Array.isArray(manifest.fixtures), "manifest.fixtures must be an array.");
  assert(manifest.fixtures.length === EXPECTED_FIXTURE_COUNT, `manifest.fixtures must contain exactly ${EXPECTED_FIXTURE_COUNT} entries.`);

  const labels = new Set();
  const fixtureIds = new Set();
  for (const [index, fixture] of manifest.fixtures.entries()) {
    assertExactKeys(fixture, ["label", "uuid"], `manifest.fixtures[${index}]`);
    assert(typeof fixture.label === "string" && fixture.label.length > 0, `manifest.fixtures[${index}].label must be nonempty.`);
    assert(!labels.has(fixture.label), `Duplicate fixture label at manifest.fixtures[${index}].`);
    labels.add(fixture.label);
    assert(typeof fixture.uuid === "string" && UUID_V4.test(fixture.uuid), `manifest.fixtures[${index}].uuid must be a valid UUID v4.`);
    const normalizedUuid = fixture.uuid.toLowerCase();
    assert(!fixtureIds.has(normalizedUuid), `Duplicate fixture UUID at manifest.fixtures[${index}].`);
    fixtureIds.add(normalizedUuid);
    assert(acceptedFixtureMap.get(fixture.label) === normalizedUuid, `Fixture UUID for ${fixture.label} is unlisted or differs from the accepted workflow manifest.`);
  }
  assert(labels.size === acceptedFixtureMap.size, "Manifest fixture labels do not exactly match the accepted workflow manifest.");
  for (const label of acceptedFixtureMap.keys()) {
    assert(labels.has(label), `Accepted fixture label is missing: ${label}.`);
  }

  assert(Array.isArray(manifest.scenarios), "manifest.scenarios must be an array.");
  assert(manifest.scenarios.length === EXPECTED_SCENARIOS.size, `manifest.scenarios must contain exactly ${EXPECTED_SCENARIOS.size} scenarios.`);
  const scenarioIds = new Set();
  for (const [index, scenario] of manifest.scenarios.entries()) {
    const location = `manifest.scenarios[${index}]`;
    assertExactKeys(scenario, ["id", "fixedInstant", "role", "network", "expectedWrites", "expectedNonWrites"], location);
    assert(typeof scenario.id === "string" && EXPECTED_SCENARIOS.has(scenario.id), `${location}.id is not an accepted scenario.`);
    assert(!scenarioIds.has(scenario.id), `Duplicate scenario ID ${scenario.id}.`);
    scenarioIds.add(scenario.id);
    validateIso2027Instant(scenario.fixedInstant, `${location}.fixedInstant`);
    assert(ALLOWED_ROLES.has(scenario.role), `${location}.role is outside the role allowlist.`);
    assert(ALLOWED_NETWORKS.has(scenario.network), `${location}.network is outside the network allowlist.`);
    const expected = EXPECTED_SCENARIOS.get(scenario.id);
    assert(scenario.fixedInstant === expected.fixedInstant, `${location}.fixedInstant differs from the accepted scenario contract.`);
    assert(scenario.role === expected.role, `${location}.role differs from the accepted scenario contract.`);
    assert(scenario.network === expected.network, `${location}.network differs from the accepted scenario contract.`);
    validateExpectationIdentifiers(scenario.expectedWrites, `${location}.expectedWrites`);
    validateExpectationIdentifiers(scenario.expectedNonWrites, `${location}.expectedNonWrites`);
    const overlap = scenario.expectedWrites.filter((identifier) => scenario.expectedNonWrites.includes(identifier));
    assert(overlap.length === 0, `${location} write and non-write identifiers must not overlap.`);
  }
  for (const id of EXPECTED_SCENARIOS.keys()) {
    assert(scenarioIds.has(id), `Accepted scenario ${id} is missing.`);
  }

  return {
    fixtureCount: manifest.fixtures.length,
    scenarioCount: manifest.scenarios.length,
    schema: manifest.schema,
    version: manifest.version,
  };
}

function forbiddenIsolationPatterns({ includeBrowserCommands }) {
  const commandPattern = (toolParts, verbs) =>
    new RegExp(`(?:^|[;&|]\\s*|\\{\\s*&\\s*)${toolParts.join("")}\\s+(?:${verbs.join("|")})\\b`, "im");
  const patterns = [
    ["remote URL literal", new RegExp(`\\b${["ht", "tps?"].join("")}://`, "i")],
    ["hosted backend literal", new RegExp(`${["supa", "base"].join("")}\\.(?:co|com)`, "i")],
    ["deployment host literal", new RegExp(`${["ver", "cel.app"].join("")}`, "i")],
    ["source-control host literal", new RegExp(`${["git", "hub.com"].join("")}`, "i")],
    ["network request function", new RegExp(`\\b${["fe", "tch"].join("")}\\s*\\(`, "i")],
    ["PowerShell web request", new RegExp(`\\b${["Invoke", "WebRequest"].join("-")}\\b`, "i")],
    ["command-line URL transfer", new RegExp(`(?:^|[;&|]\\s*)${["cu", "rl"].join("")}\\b`, "im")],
    ["backend CLI", commandPattern(["supa", "base"], ["start", "stop", "status", "db", "migration", "functions", "link", "secrets"])],
    ["deployment CLI", commandPattern(["ver", "cel"], ["deploy", "pull", "link", "env", "promote", "rollback", "inspect"])],
    ["source-control CLI", commandPattern(["g", "h"], ["api", "pr", "issue", "run", "workflow", "release", "repo"])],
    ["container CLI", commandPattern(["dock", "er"], ["run", "compose", "build", "pull", "push"])],
    ["database CLI", commandPattern(["ps", "ql"], ["-c", "-f", "--command", "--file"])],
    ["network module import", new RegExp(`node:${["ht", "tps?"].join("")}\\b`, "i")],
    ["child process import", new RegExp(`node:${["child", "_process"].join("")}\\b`, "i")],
    ["shell execution API", new RegExp(`\\b(?:${["ex", "ec"].join("")}(?:Sync)?|${["sp", "awn"].join("")}(?:Sync)?)\\s*\\(`, "i")],
  ];
  if (includeBrowserCommands) {
    patterns.push([
      "browser execution command",
      new RegExp(`\\b(?:${["play", "wright"].join("")}|browser)\\s+(?:test|open|run|launch|install|codegen)\\b`, "i"),
    ]);
  }
  return patterns;
}

function assertIsolationSurface(content, file, includeBrowserCommands) {
  for (const [label, pattern] of forbiddenIsolationPatterns({ includeBrowserCommands })) {
    assert(!pattern.test(content), `${file} contains forbidden ${label}.`);
  }
}

export async function validateHarnessIsolation(root = REPOSITORY_ROOT) {
  for (const file of HARNESS_FILES) {
    const content = await readFile(resolve(root, file), "utf8");
    assertIsolationSurface(content, file, file !== "package.json");
    if (file === "package.json") {
      const packageJson = parseJson(content, file);
      const seasonScript = packageJson?.scripts?.["verify:season"];
      assert(typeof seasonScript === "string" && seasonScript.length > 0, "package.json verify:season script is missing.");
      assertIsolationSurface(seasonScript, "package.json verify:season", true);
    }
  }
  return { checkedFiles: [...HARNESS_FILES] };
}

export async function loadSeasonContractInputs(root = REPOSITORY_ROOT) {
  const [manifestText, workflowMarkdown] = await Promise.all([
    readFile(resolve(root, MANIFEST_PATH), "utf8"),
    readFile(resolve(root, WORKFLOWS_PATH), "utf8"),
  ]);
  return {
    manifest: parseJson(manifestText, MANIFEST_PATH),
    workflowMarkdown,
  };
}

export async function runSeasonContractGate(root = REPOSITORY_ROOT) {
  const { manifest, workflowMarkdown } = await loadSeasonContractInputs(root);
  const contract = validateSeasonContract(manifest, workflowMarkdown);
  const isolation = await validateHarnessIsolation(root);
  return { ...contract, checkedFiles: isolation.checkedFiles };
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    const result = await runSeasonContractGate();
    console.log(`Season fixture contract: PASS (${result.fixtureCount} fixtures; ${result.scenarioCount} scenarios; ${result.checkedFiles.length} isolation-scanned files)`);
    console.log("Season proof boundary: contract/isolation only; disposable-backend and browser workflow proof not yet run");
  } catch (error) {
    console.error(`Season fixture contract: FAIL (${error instanceof Error ? error.message : "unknown validation error"})`);
    process.exitCode = 1;
  }
}
