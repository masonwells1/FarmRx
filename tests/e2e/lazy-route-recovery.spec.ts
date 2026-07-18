import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const projectRef = "agvsozfbstpekuqxpqjr";
const userId = "00000000-0000-4000-8000-000000000001";
const farmId = "00000000-0000-4000-8000-000000000010";
const now = "2026-07-18T12:00:00.000Z";
const routeReloadMarker = "farm-rx:lazy-route-reload:v1:fields";

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
  const payload = Buffer.from(JSON.stringify({ sub: userId, aud: "authenticated", exp: expiresAt, session_id: `session-${userId}` }))
    .toString("base64url");
  return {
    access_token: `eyJhbGciOiJub25lIn0.${payload}.signature`,
    refresh_token: "lazy-route-test-refresh",
    expires_in: 86_400,
    expires_at: expiresAt,
    token_type: "bearer",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "farmer@example.test",
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: now,
    },
  };
}

async function seedSession(context: BrowserContext) {
  const value = session();
  await context.addInitScript(({ sessionKey, intentKey, storedSession, intent }) => {
    localStorage.setItem(sessionKey, JSON.stringify(storedSession));
    localStorage.setItem(intentKey, JSON.stringify(intent));
  }, {
    sessionKey: `farm-rx-auth:${projectRef}`,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    storedSession: value,
    intent: {
      version: 1,
      nonce: "lazy-route-test-session",
      phase: "accepted",
      userId,
      sessionLineage: `session-${userId}`,
      startedAtMs: Date.now(),
    },
  });
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  });
}

async function mockFarm(page: Page) {
  await page.route("https://*.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    if (url.pathname === "/auth/v1/user") return fulfillJson(route, session().user);
    if (url.pathname === "/rest/v1/rpc/get_current_farm_access_epochs") {
      return fulfillJson(route, [{ farm_id: farmId, access_epoch: 1 }]);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const rpc = url.pathname.split("/").at(-1);
      if (rpc === "generate_due_service_tasks") return fulfillJson(route, { created_count: 0 });
      if (rpc === "generate_due_program_items") return fulfillJson(route, { generated_count: 0 });
      return fulfillJson(route, rpc !== "has_explicit_rep_access");
    }
    if (table === "farms") {
      const farm = { id: farmId, name: "Prairie View", share_with_rep: false, created_by: userId, created_at: now, updated_at: now };
      return fulfillJson(route, url.searchParams.has("id") ? farm : [farm]);
    }
    if (table === "farm_memberships") {
      return fulfillJson(route, { farm_id: farmId, user_id: userId, role: "owner", status: "active", can_view_financials: true });
    }
    if (table === "farm_rep_access") return fulfillJson(route, null);
    if (table) return fulfillJson(route, []);
    await route.abort("blockedbyclient");
  });
}

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await seedSession(context);
  await mockFarm(page);
});

test("a stale lazy route reloads once and opens from the current deployment", async ({ page }) => {
  let chunkAttempts = 0;
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document" && new URL(request.url()).pathname === "/fields") documentLoads += 1;
  });
  await page.route(/\/assets\/FieldsModule-[^/]+\.js$/, async (route) => {
    chunkAttempts += 1;
    if (chunkAttempts === 1) await route.abort("failed");
    else await route.continue();
  });

  await page.goto("/fields").catch(() => undefined);

  await expect(page.getByRole("heading", { name: "Fields", exact: true })).toBeVisible();
  expect(chunkAttempts).toBe(2);
  expect(documentLoads).toBe(2);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), routeReloadMarker)).toBeNull();
});

test("a persistent lazy route failure stops reloading and offers a retry", async ({ page }) => {
  let chunkAttempts = 0;
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document" && new URL(request.url()).pathname === "/fields") documentLoads += 1;
  });
  await page.route(/\/assets\/FieldsModule-[^/]+\.js$/, async (route) => {
    chunkAttempts += 1;
    await route.abort("failed");
  });

  await page.goto("/fields").catch(() => undefined);

  await expect(page.getByRole("heading", { name: "This page could not open." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(chunkAttempts).toBe(2);
  expect(documentLoads).toBe(2);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), routeReloadMarker)).toBe("1");
});
