import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

const MANIFEST_PATH = "tests/season/season-2027.manifest.json";
const WORKFLOWS_PATH = "docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md";
const EXPECTED_SCHEMA = "farm-rx-season-contract";
const EXPECTED_VERSION = 1;
const EXPECTED_YEAR = 2027;
const EXPECTED_TIMEZONE = "America/Chicago";
const EXPECTED_FIXTURE_COUNT = 81;
const EXPECTED_PACKAGE_COMMAND = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-season.ps1";
const EXPECTED_POWERSHELL_SHA256 = "419a68327bb080e63ea58ec48c06926c24ea9ebbb69a8022dea5e8723322a359";

const EXPECTED_SCENARIOS = new Map([
  [
    "MR",
    {
      fixedInstant: "2027-01-12T08:00:00-06:00",
      role: "owner",
      network: "online-local",
      expectedWrites: [
        "fields.field-and-crop-setup",
        "programs.assignment-and-draft",
        "inventory.receipt-and-application",
        "scouting.note",
        "tasks.lifecycle",
        "harvest.actuals",
        "grain.reconciliation-and-ledgers",
      ],
      expectedNonWrites: [
        "navigation.read-only",
        "planting.standalone-entity",
        "programs.free-text-inventory",
        "weather.provider-provenance",
        "grain.hidden-coupling",
        "year-end.finalization",
      ],
    },
  ],
  [
    "NF",
    {
      fixedInstant: "2027-02-09T08:00:00-06:00",
      role: "owner",
      network: "online-local",
      expectedWrites: ["privacy.explicit-toggle", "tasks.worker-create-manager-complete", "access.epoch-advance"],
      expectedNonWrites: ["permissions.denied-attempts", "farm-switching.stale-content", "private-data.cross-farm"],
    },
  ],
  [
    "PS",
    {
      fixedInstant: "2027-06-15T14:10:00-05:00",
      role: "manager",
      network: "online-local",
      expectedWrites: ["applications.completed-record-and-product", "inventory.derived-on-hand"],
      expectedNonWrites: [
        "programs.rows",
        "weather.provider-provenance",
        "crop-rx.delivery",
        "tasks.rows",
        "notifications.rows",
        "grain.rows",
        "scouting.rows",
      ],
    },
  ],
  [
    "HR",
    {
      fixedInstant: "2027-10-11T17:30:00-05:00",
      role: "owner",
      network: "online-local",
      expectedWrites: [
        "harvest.actual-fields",
        "grain.explicit-reconciliation",
        "bins.manual-out",
        "contracts.explicit-delivery",
      ],
      expectedNonWrites: [
        "grain.automatic-reconciliation",
        "bins.contract-coupling",
        "contracts.bin-coupling",
        "lots.automatic-creation",
      ],
    },
  ],
  [
    "CC",
    {
      fixedInstant: "2027-07-07T13:20:00-05:00",
      role: "owner",
      network: "provider-double",
      expectedWrites: ["applications.manual-weather-snapshot", "inventory.derived-on-hand", "scouting.note"],
      expectedNonWrites: [
        "weather.product-database",
        "weather.form-autofill",
        "weather.provider-provenance",
        "scouting.photos-tasks-notifications",
        "inventory.unrelated-rows",
      ],
    },
  ],
  [
    "PH",
    {
      fixedInstant: "2027-08-04T14:00:00-05:00",
      role: "worker",
      network: "forced offline",
      expectedWrites: ["queue.offline-custody", "field-log.reconnect-once", "access.revocation-fence"],
      expectedNonWrites: [
        "field-log.offline-server-write",
        "field-log.revoked-upload",
        "queue.cross-account-replay",
        "product.rows",
      ],
    },
  ],
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

const EXPECTED_STATIC_IMPORTS = new Map([
  [
    "scripts/verify-season-contract.mjs",
    [
      "node:crypto|default=|named=createHash",
      "node:fs/promises|default=|named=readFile",
      "node:path|default=|named=dirname,resolve",
      "node:url|default=|named=fileURLToPath",
      "typescript|default=ts|named=",
    ],
  ],
  [
    "scripts/verify-season-contract.regression.mjs",
    [
      "node:fs/promises|default=|named=mkdir,mkdtemp,readFile,rm,writeFile",
      "node:os|default=|named=tmpdir",
      "node:path|default=|named=dirname,join",
      "./verify-season-contract.mjs|default=|named=REPOSITORY_ROOT,loadSeasonContractInputs,validateHarnessIsolation,validateSeasonContract",
    ],
  ],
]);

const ALLOWED_IDENTIFIER_CALLS = new Map([
  [
    "scripts/verify-season-contract.mjs",
    new Set([
      "Number",
      "assert",
      "assertAllowedProcessReference",
      "assertExactKeys",
      "createHash",
      "dirname",
      "fail",
      "fileURLToPath",
      "importSignature",
      "loadSeasonContractInputs",
      "parseAcceptedFixtureMap",
      "parseJson",
      "readFile",
      "resolve",
      "runSeasonContractGate",
      "validateAcceptedScenarioReferences",
      "validateExecutableModule",
      "validateExpectationIdentifiers",
      "validateHarnessIsolation",
      "validateIso2027Instant",
      "validateReservedAndRemoteValues",
      "validateSeasonContract",
      "visit",
    ]),
  ],
  [
    "scripts/verify-season-contract.regression.mjs",
    new Set([
      "assert",
      "clone",
      "createTemporaryHarness",
      "dirname",
      "expectContractFailure",
      "expectIsolationFailure",
      "join",
      "loadSeasonContractInputs",
      "mkdir",
      "mkdtemp",
      "readFile",
      "rm",
      "runAppendIsolationMutation",
      "runReplacementIsolationMutation",
      "structuredClone",
      "tmpdir",
      "validateHarnessIsolation",
      "validateSeasonContract",
      "writeFile",
    ]),
  ],
]);

const ALLOWED_STATIC_CALLS = new Map([
  [
    "scripts/verify-season-contract.mjs",
    new Set([
      "Array.isArray",
      "Date.UTC",
      "Date.parse",
      "JSON.parse",
      "JSON.stringify",
      "Number.isFinite",
      "Object.entries",
      "Object.keys",
      "Promise.all",
      "console.error",
      "console.log",
      "ts.createSourceFile",
      "ts.forEachChild",
      "ts.isBinaryExpression",
      "ts.isCallExpression",
      "ts.isClassDeclaration",
      "ts.isClassExpression",
      "ts.isElementAccessExpression",
      "ts.isExportDeclaration",
      "ts.isFunctionDeclaration",
      "ts.isFunctionExpression",
      "ts.isIdentifier",
      "ts.isIfStatement",
      "ts.isImportDeclaration",
      "ts.isNamedImports",
      "ts.isNewExpression",
      "ts.isNumericLiteral",
      "ts.isParameter",
      "ts.isPropertyAccessExpression",
      "ts.isStringLiteral",
      "ts.isTaggedTemplateExpression",
      "ts.isVariableDeclaration",
    ]),
  ],
  ["scripts/verify-season-contract.regression.mjs", new Set(["console.log"])],
]);

const ALLOWED_INSTANCE_METHODS = new Set([
  "add",
  "digest",
  "entries",
  "filter",
  "findIndex",
  "forEach",
  "get",
  "getUTCDate",
  "getUTCFullYear",
  "getUTCHours",
  "getUTCMinutes",
  "getUTCMonth",
  "getUTCSeconds",
  "getText",
  "has",
  "includes",
  "indexOf",
  "join",
  "keys",
  "map",
  "match",
  "push",
  "replace",
  "slice",
  "sort",
  "split",
  "startsWith",
  "test",
  "toLowerCase",
  "update",
]);
const ALLOWED_NEW_TARGETS = new Set(["Date", "Error", "Map", "RegExp", "Set"]);
const FORBIDDEN_CAPABILITY_IDENTIFIERS = new Set([
  "ActiveXObject",
  "BroadcastChannel",
  "Bun",
  "Deno",
  "EventSource",
  "Function",
  "SharedWorker",
  "WebSocket",
  "WebTransport",
  "Worker",
  "XMLHttpRequest",
  "document",
  "eval",
  "fetch",
  "globalThis",
  "navigator",
  "require",
  "self",
  "window",
]);
const EXPECTED_FUNCTION_DECLARATIONS = new Map([
  [
    "scripts/verify-season-contract.mjs",
    [
      "fail",
      "assert",
      "assertExactKeys",
      "parseJson",
      "parseAcceptedFixtureMap",
      "validateIso2027Instant",
      "validateReservedAndRemoteValues",
      "validateExpectationIdentifiers",
      "validateAcceptedScenarioReferences",
      "validateSeasonContract",
      "importSignature",
      "assertAllowedProcessReference",
      "validateExecutableModule",
      "visit",
      "validateHarnessIsolation",
      "loadSeasonContractInputs",
      "runSeasonContractGate",
    ],
  ],
  [
    "scripts/verify-season-contract.regression.mjs",
    [
      "assert",
      "clone",
      "expectContractFailure",
      "createTemporaryHarness",
      "expectIsolationFailure",
      "runAppendIsolationMutation",
      "runReplacementIsolationMutation",
    ],
  ],
]);

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
    assert(
      JSON.stringify(scenario.expectedWrites) === JSON.stringify(expected.expectedWrites),
      `${location}.expectedWrites differs from the accepted scenario contract.`,
    );
    assert(
      JSON.stringify(scenario.expectedNonWrites) === JSON.stringify(expected.expectedNonWrites),
      `${location}.expectedNonWrites differs from the accepted scenario contract.`,
    );
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

function importSignature(node) {
  assert(ts.isStringLiteral(node.moduleSpecifier), "Executable module imports must use string-literal specifiers.");
  const clause = node.importClause;
  assert(clause && !clause.isTypeOnly, "Executable module imports must be runtime imports.");
  const defaultImport = clause.name?.text ?? "";
  const namedImports = [];
  if (clause.namedBindings) {
    assert(ts.isNamedImports(clause.namedBindings), "Executable module namespace imports are forbidden.");
    for (const element of clause.namedBindings.elements) {
      assert(!element.isTypeOnly && !element.propertyName, "Executable module import aliases are forbidden.");
      namedImports.push(element.name.text);
    }
  }
  return `${node.moduleSpecifier.text}|default=${defaultImport}|named=${namedImports.join(",")}`;
}

function assertAllowedProcessReference(node, sourceFile, file, counts) {
  assert(file === "scripts/verify-season-contract.mjs", `${file} contains forbidden process capability use.`);
  const propertyAccess = node.parent;
  assert(
    ts.isPropertyAccessExpression(propertyAccess) && propertyAccess.expression === node,
    `${file} contains forbidden process capability use.`,
  );

  if (propertyAccess.name.text === "argv") {
    const elementAccess = propertyAccess.parent;
    assert(
      ts.isElementAccessExpression(elementAccess) &&
        elementAccess.expression === propertyAccess &&
        ts.isNumericLiteral(elementAccess.argumentExpression) &&
        elementAccess.argumentExpression.text === "1",
      `${file} contains forbidden process capability use.`,
    );
    let ancestor = elementAccess.parent;
    while (ancestor && !ts.isVariableDeclaration(ancestor)) ancestor = ancestor.parent;
    assert(
      ancestor &&
        ts.isIdentifier(ancestor.name) &&
        ancestor.name.text === "invokedAsScript" &&
        ancestor.parent.parent.parent === sourceFile &&
        ancestor.initializer?.getText(sourceFile) ===
          "process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)",
      `${file} process.argv use must be confined to the top-level invokedAsScript declaration.`,
    );
    counts.argv += 1;
    return;
  }

  if (propertyAccess.name.text === "exitCode") {
    const assignment = propertyAccess.parent;
    assert(
      ts.isBinaryExpression(assignment) &&
        assignment.left === propertyAccess &&
        assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        assignment.getText(sourceFile) === "process.exitCode = 1",
      `${file} contains forbidden process capability use.`,
    );
    let topLevelStatement = assignment;
    while (topLevelStatement.parent !== sourceFile) topLevelStatement = topLevelStatement.parent;
    assert(
      ts.isIfStatement(topLevelStatement) &&
        ts.isIdentifier(topLevelStatement.expression) &&
        topLevelStatement.expression.text === "invokedAsScript",
      `${file} process.exitCode use must be confined to the top-level invokedAsScript block.`,
    );
    counts.exitCode += 1;
    return;
  }

  fail(`${file} contains forbidden process capability use.`);
}

function validateExecutableModule(content, file) {
  const expectedImports = EXPECTED_STATIC_IMPORTS.get(file);
  const allowedIdentifierCalls = ALLOWED_IDENTIFIER_CALLS.get(file);
  const allowedStaticCalls = ALLOWED_STATIC_CALLS.get(file);
  const expectedFunctions = EXPECTED_FUNCTION_DECLARATIONS.get(file);
  assert(
    expectedImports && allowedIdentifierCalls && allowedStaticCalls && expectedFunctions,
    `${file} has no executable-module policy.`,
  );

  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert(sourceFile.parseDiagnostics.length === 0, `${file} is not syntactically valid JavaScript.`);
  const actualImports = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) actualImports.push(importSignature(statement));
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      fail(`${file} re-export imports are forbidden.`);
    }
  }
  assert(
    JSON.stringify(actualImports) === JSON.stringify(expectedImports),
    `${file} static imports do not match the closed allowlist.`,
  );

  const processCounts = { argv: 0, exitCode: 0 };
  const actualFunctions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node)) {
      assert(node.name && ts.isIdentifier(node.name), `${file} contains an anonymous function declaration.`);
      actualFunctions.push(node.name.text);
    }
    assert(
      !ts.isClassDeclaration(node) && !ts.isClassExpression(node) && !ts.isFunctionExpression(node),
      `${file} contains a forbidden class or function-expression capability.`,
    );
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      (allowedIdentifierCalls.has(node.name.text) || ALLOWED_NEW_TARGETS.has(node.name.text))
    ) {
      fail(`${file} shadows allowlisted call target ${node.name.text}.`);
    }
    if (ts.isIdentifier(node)) {
      assert(
        !FORBIDDEN_CAPABILITY_IDENTIFIERS.has(node.text),
        `${file} contains forbidden ${node.text} capability.`,
      );
      if (node.text === "process") assertAllowedProcessReference(node, sourceFile, file, processCounts);
    }

    ts.forEachChild(node, visit);

    if (ts.isCallExpression(node)) {
      assert(!node.questionDotToken, `${file} contains an optional or dynamic call target.`);
      const target = node.expression;
      assert(target.kind !== ts.SyntaxKind.ImportKeyword, `${file} contains forbidden dynamic import.`);
      if (ts.isIdentifier(target)) {
        assert(allowedIdentifierCalls.has(target.text), `${file} contains unknown call target ${target.text}.`);
        return;
      }
      if (ts.isPropertyAccessExpression(target)) {
        const staticTarget = ts.isIdentifier(target.expression) ? `${target.expression.text}.${target.name.text}` : "";
        assert(
          allowedStaticCalls.has(staticTarget) || ALLOWED_INSTANCE_METHODS.has(target.name.text),
          `${file} contains unknown call target ${staticTarget || target.name.text}.`,
        );
        return;
      }
      fail(`${file} contains a computed or dynamic call target.`);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (
        ts.isIdentifier(node.left) &&
        (allowedIdentifierCalls.has(node.left.text) || ALLOWED_NEW_TARGETS.has(node.left.text))
      ) {
        fail(`${file} reassigns allowlisted call target ${node.left.text}.`);
      }
      if (ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression)) {
        const staticTarget = `${node.left.expression.text}.${node.left.name.text}`;
        assert(
          !allowedStaticCalls.has(staticTarget),
          `${file} reassigns allowlisted static call target ${staticTarget}.`,
        );
      }
    }

    if (ts.isNewExpression(node)) {
      assert(
        ts.isIdentifier(node.expression) && ALLOWED_NEW_TARGETS.has(node.expression.text),
        `${file} contains an unknown constructor target.`,
      );
    }
    assert(!ts.isTaggedTemplateExpression(node), `${file} contains a forbidden tagged-template call target.`);
  }
  visit(sourceFile);
  assert(
    JSON.stringify(actualFunctions) === JSON.stringify(expectedFunctions),
    `${file} function declarations do not match the closed allowlist.`,
  );

  const expectedArgvCount = file === "scripts/verify-season-contract.mjs" ? 2 : 0;
  const expectedExitCodeCount = file === "scripts/verify-season-contract.mjs" ? 1 : 0;
  assert(
    processCounts.argv === expectedArgvCount && processCounts.exitCode === expectedExitCodeCount,
    `${file} process capability structure does not match the closed allowlist.`,
  );
}

export async function validateHarnessIsolation(root = REPOSITORY_ROOT) {
  const packageText = await readFile(resolve(root, "package.json"), "utf8");
  const packageJson = parseJson(packageText, "package.json");
  assert(
    packageJson?.scripts?.["verify:season"] === EXPECTED_PACKAGE_COMMAND,
    "package.json verify:season command does not match the closed contract.",
  );

  const powershellContent = await readFile(resolve(root, "scripts/verify-season.ps1"), "utf8");
  const powershellHash = createHash("sha256").update(powershellContent).digest("hex");
  assert(
    powershellHash === EXPECTED_POWERSHELL_SHA256,
    "scripts/verify-season.ps1 does not match the pinned SHA-256.",
  );

  for (const file of ["scripts/verify-season-contract.mjs", "scripts/verify-season-contract.regression.mjs"]) {
    validateExecutableModule(await readFile(resolve(root, file), "utf8"), file);
  }

  const manifestText = await readFile(resolve(root, MANIFEST_PATH), "utf8");
  validateReservedAndRemoteValues(parseJson(manifestText, MANIFEST_PATH));
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
