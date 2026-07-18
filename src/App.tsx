import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Navigate,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "./auth/AuthProvider";
import { minimumPasswordLength, passwordEmailDeliveryEnabled, passwordResetPublicResponse, passwordStrength, passwordValidationMessage } from './auth/passwordRecovery';
import {
  bootstrapInitialOwnerFarm,
} from "./auth/bootstrapFarm";
import { FarmAccessProvider, useFarmAccess } from "./auth/FarmAccessContext";
import { beginFarmReplayAuthorization, canAccessFarmModule, canEditFarmModule, canReplayFarmModule, createFarmAccessValidationGate, FarmAccessStorageUnsafeError, hasPendingFarmWork, loadFarmAccess, loadFarmAccessProfile, publishFarmReadyAuthorization, selectFarm, type FarmAccess, type FarmAppModule, type LoadedFarmAccessProfile } from "./auth/farmContext";
import { RevokedFarmRecovery } from './components/RevokedFarmRecovery';
import { LazyRouteErrorBoundary } from "./components/LazyRouteErrorBoundary";
import { createSubmitLock } from "./lib/submitLock";
import { RequireSession } from "./auth/RequireSession";
import { NotificationsPage, NotificationBell } from "./NotificationsModule";
import {
  equipmentTasksRepository,
  farmSharingRepository,
  fieldLogRepository,
  fieldsRepository,
  generateDueEquipmentTasks,
  generateDueProgramItems,
  grainServices,
  harvestRepository,
  inventoryRepository,
  inspectEquipmentTasksQueue,
  notificationsRepository,
  programsRepository,
  replayFieldLocationQueue,
  replayFieldLogQueue,
  replayFieldsQueue,
  replayGrainQueue,
  replayHarvestQueue,
  replayInventoryQueue,
  replayNotificationsQueue,
  replayProfitabilityQueue,
  replayProgramsQueue,
  replayScoutingQueue,
  scoutingRepository,
} from "./data";
import {
  getSyncStatus,
  getSyncNoticeState,
  retrySavedChanges,
  setModuleSyncStatus,
  setModuleSyncRetryAction,
  subscribeSyncStatus,
} from "./data/syncStatus";
import type { EntityType } from "./data/fields";
import { getWorkspaceCacheNotices, subscribeWorkspaceCacheNotices } from "./data/workspaceCache";
import { farmerError } from "./lib/farmerErrors";
import { recoverLazyRoute } from "./lib/lazyRouteRecovery";

const FieldDetailPage = lazy(() => recoverLazyRoute("field-detail", () => import("./FieldsModule")).then((module) => ({ default: module.FieldDetailPage })));
const FieldFormPage = lazy(() => recoverLazyRoute("field-form", () => import("./FieldsModule")).then((module) => ({ default: module.FieldFormPage })));
const FieldsPage = lazy(() => recoverLazyRoute("fields", () => import("./FieldsModule")).then((module) => ({ default: module.FieldsPage })));
const GrainPage = lazy(() => recoverLazyRoute("grain", () => import("./GrainModule")).then((module) => ({ default: module.GrainPage })));
const ProfitabilityPage = lazy(() => recoverLazyRoute("profitability", () => import("./ProfitabilityModule")).then((module) => ({ default: module.ProfitabilityPage })));
const InventoryPage = lazy(() => recoverLazyRoute("inventory", () => import("./InventoryModule")).then((module) => ({ default: module.InventoryPage })));
const EquipmentPage = lazy(() => recoverLazyRoute("equipment", () => import("./EquipmentTasksModule")).then((module) => ({ default: module.EquipmentPage })));
const TasksPage = lazy(() => recoverLazyRoute("tasks", () => import("./EquipmentTasksModule")).then((module) => ({ default: module.TasksPage })));
const WeatherPage = lazy(() => recoverLazyRoute("weather", () => import("./WeatherModule")).then((module) => ({ default: module.WeatherPage })));
const FieldLogPage = lazy(() => recoverLazyRoute("field-log", () => import("./FieldLogModule")).then((module) => ({ default: module.FieldLogPage })));
const ScoutingPage = lazy(() => recoverLazyRoute("scouting", () => import("./ScoutingModule")).then((module) => ({ default: module.ScoutingPage })));
const HarvestPage = lazy(() => recoverLazyRoute("harvest", () => import("./HarvestModule")).then((module) => ({ default: module.HarvestPage })));
const ProgramsPage = lazy(() => recoverLazyRoute("programs", () => import("./ProgramsModule")).then((module) => ({ default: module.ProgramsPage })));
const FarmPrivacyPage = lazy(() => recoverLazyRoute("farm-privacy", () => import("./FarmPrivacyPage")).then((module) => ({ default: module.FarmPrivacyPage })));

function NavGlyph({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

type NavigationItem = { label: string; path: string; icon: ReactNode; module: FarmAppModule };
const navigation: NavigationItem[] = [
  {
    label: "Fields",
    path: "/fields",
    module: "fields",
    icon: <NavGlyph d="M4 4h16v16H4zM4 12h16M12 4v16" />,
  },
  {
    label: "Grain",
    path: "/grain",
    module: "grain",
    icon: <NavGlyph d="M3 20h18M6 20V8l6-4 6 4v12" />,
  },
  {
    label: "Privacy",
    path: "/privacy",
    module: "fields",
    icon: <NavGlyph d="M12 3l8 4v5c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V7l8-4zM9 12l2 2 4-4" />,
  },
  {
    label: "Inventory",
    path: "/inventory",
    module: "inventory",
    icon: <NavGlyph d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />,
  },
  {
    label: "Profitability",
    path: "/profitability",
    module: "profitability",
    icon: (
      <NavGlyph d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    ),
  },
  {
    label: "Equipment",
    path: "/equipment",
    module: "equipment",
    icon: (
      <NavGlyph d="M7 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 16h4M4 13V7h9l3 5h4v4" />
    ),
  },
  {
    label: "Tasks",
    path: "/tasks",
    module: "tasks",
    icon: (
      <NavGlyph d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    ),
  },
  {
    label: "Weather",
    path: "/weather",
    module: "weather",
    icon: (
      <NavGlyph d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
    ),
  },
  {
    label: "Field Log",
    path: "/field-log",
    module: "field_log",
    icon: <NavGlyph d="M4 6h16M4 12h16M4 18h10" />,
  },
  {
    label: "Scouting",
    path: "/scouting",
    module: "scouting",
    icon: (
      <NavGlyph d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
    ),
  },
  {
    label: "Harvest",
    path: "/harvest",
    module: "harvest",
    icon: (
      <NavGlyph d="M12 3v6M12 9c-3 0-5 2-5 5v7h10v-7c0-3-2-5-5-5zM9 3c0 2 1 3 3 3s3-1 3-3" />
    ),
  },
  {
    label: "Programs",
    path: "/programs",
    module: "programs",
    icon: <NavGlyph d="M8 4h12M8 12h12M8 20h12M4 4h.01M4 12h.01M4 20h.01" />,
  },
  {
    label: "Alerts",
    path: "/notifications",
    module: "notifications",
    icon: (
      <NavGlyph d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    ),
  },
];

const mobilePrimaryPaths = new Set(["/fields", "/grain", "/tasks", "/weather"]);

function CapabilityRoute({ module, editOnly = false, lockWrites = false, children }: { module: FarmAppModule; editOnly?: boolean; lockWrites?: boolean; children: ReactNode }) {
  const { profile } = useFarmAccess();
  if (!canAccessFarmModule(profile, module) || editOnly && !canEditFarmModule(profile, module)) return <Navigate to="/fields" replace />;
  if (lockWrites && !canEditFarmModule(profile, module)) return <fieldset disabled aria-label="Read-only farm data" style={{ border: 0, margin: 0, minInlineSize: 0, padding: 0 }}>{children}</fieldset>;
  return children;
}

export function FarmSwitcher({ farms, activeFarm, chooseFarm }: { farms: FarmAccess["farms"]; activeFarm: FarmAccess["farms"][number]; chooseFarm: (farmId: string) => Promise<void> }) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switchLock = useRef(createSubmitLock());
  async function switchTo(farmId: string) {
    if (!switchLock.current.acquire()) return;
    setSwitching(true);
    setError(null);
    try {
      await chooseFarm(farmId);
    } catch (caught) {
      setError(farmerError(caught, "switch farms"));
    } finally {
      setSwitching(false);
      switchLock.current.release();
    }
  }
  return (
    <div>
      <label className="farm-switcher">Farm
        <select value={activeFarm.id} disabled={switching} onChange={(event) => { void switchTo(event.target.value) }} aria-label="Active farm">
          {farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}
        </select>
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  );
}

function AppLayout() {
  const { signOut, user } = useAuth();
  const { farms, activeFarm, profile, source, chooseFarm } = useFarmAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const signOutLock = useRef(createSubmitLock());
  const farmName = activeFarm.name;
  async function handleSignOut() {
    if (!signOutLock.current.acquire()) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      setSignOutError(
        "Farm Rx could not sign you out right now. Please try again.",
      );
    } finally {
      setSigningOut(false);
      signOutLock.current.release();
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Farm Rx navigation">
        <div className="farm-lockup">
          <div className="farm-name">{farmName}</div>
          <div className="farm-logo-note">Your farm</div>
        </div>
        <Navigation className="sidebar-nav" items={navigation.filter((item) => canAccessFarmModule(profile, item.module))} />
        <div className="powered-by">
          <div className="powered-mark">
            Crop <span>RX</span>
          </div>
          <div>Powered by Crop RX</div>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="product-name">
            Farm <span>Rx</span>
          </div>
          <div className="farm-summary">
            {farms.length > 1 ? (
              <FarmSwitcher farms={farms} activeFarm={activeFarm} chooseFarm={chooseFarm} />
            ) : farmName}
            {source === "offline" && <span className="offline-context">Offline access</span>}
          </div>
          <div className="topbar-actions">
            {canAccessFarmModule(profile, "notifications") && <NotificationBell repository={notificationsRepository} />}
            <button
              className="sign-out"
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </header>
        {signOutError && (
          <p className="auth-error" role="alert">
            {signOutError}
          </p>
        )}
        <SyncNotice />
        <OfflineDataNotice />
        <div className="content-area">
          <RevokedFarmRecovery userId={user?.id ?? null} />
          <LazyRouteErrorBoundary key={location.pathname}>
            <Suspense fallback={<p className="loading-state" role="status">Opening this page…</p>}>
            <Routes>
            <Route path="/fields" element={<CapabilityRoute module="fields" lockWrites><FieldsPage /></CapabilityRoute>} />
            <Route path="/fields/new" element={<CapabilityRoute module="fields" editOnly><FieldFormPage /></CapabilityRoute>} />
            <Route path="/fields/:id" element={<CapabilityRoute module="fields" lockWrites><FieldDetailPage /></CapabilityRoute>} />
            <Route path="/fields/:id/edit" element={<CapabilityRoute module="fields" editOnly><FieldFormPage /></CapabilityRoute>} />
            <Route
              path="/grain/*"
              element={<CapabilityRoute module="grain" lockWrites><GrainPage services={grainServices} /></CapabilityRoute>}
            />
            <Route
              path="/inventory"
              element={<CapabilityRoute module="inventory" lockWrites><InventoryPage repository={inventoryRepository} /></CapabilityRoute>}
            />
            <Route path="/profitability/*" element={<CapabilityRoute module="profitability" lockWrites><ProfitabilityPage /></CapabilityRoute>} />
            <Route
              path="/equipment"
              element={<CapabilityRoute module="equipment" lockWrites><EquipmentPage repository={equipmentTasksRepository} /></CapabilityRoute>}
            />
            <Route
              path="/tasks"
              element={<CapabilityRoute module="tasks" lockWrites><TasksPage repository={equipmentTasksRepository} /></CapabilityRoute>}
            />
            <Route path="/weather" element={<CapabilityRoute module="weather"><WeatherPage /></CapabilityRoute>} />
            <Route
              path="/field-log"
              element={
                <CapabilityRoute module="field_log" lockWrites><FieldLogPage
                  fieldLogRepository={fieldLogRepository}
                  fieldsRepository={fieldsRepository}
                /></CapabilityRoute>
              }
            />
            <Route
              path="/scouting"
              element={
                <CapabilityRoute module="scouting" lockWrites><ScoutingPage
                  scoutingRepository={scoutingRepository}
                  fieldsRepository={fieldsRepository}
                /></CapabilityRoute>
              }
            />
            <Route
              path="/harvest"
              element={<CapabilityRoute module="harvest" lockWrites><HarvestPage harvestRepository={harvestRepository} /></CapabilityRoute>}
            />
            <Route
              path="/programs"
              element={
                <CapabilityRoute module="programs" lockWrites><ProgramsPage
                  repository={programsRepository}
                /></CapabilityRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <CapabilityRoute module="notifications"><NotificationsPage
                  repository={notificationsRepository}
                /></CapabilityRoute>
              }
            />
            <Route path="/privacy" element={<FarmPrivacyPage repository={farmSharingRepository} />} />
            <Route path="*" element={<Navigate to="/fields" replace />} />
            </Routes>
            </Suspense>
          </LazyRouteErrorBoundary>
        </div>
      </main>
      <MobileNavigation />
    </div>
  );
}

export function SyncNotice() {
  const { source, checkSignal } = useFarmAccess();
  const status = useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatus,
    getSyncStatus,
  );
  const retryLock = useRef(createSubmitLock());
  const [retryError, setRetryError] = useState<string | null>(null);
  const retry = async () => {
    if (!retryLock.current.acquire()) return;
    try {
      setRetryError(null);
      if (source === "offline") await checkSignal();
      else await retrySavedChanges();
    } catch (caught) {
      setRetryError(farmerError(caught, "retry saved changes"));
    } finally {
      retryLock.current.release();
    }
  };
  const notice = getSyncNoticeState(status, retryError);
  if (notice.kind === "retry_failed")
    return (
      <div className="sync-notice blocked" role="alert">
        <span>{notice.message}</span>
        <button type="button" onClick={() => void retry()}>
          Try again
        </button>
      </div>
    );
  if (notice.kind === "synced")
    return (
      <div className="sync-notice synced" role="status">
        {source === "offline" ? <><span>Working offline. Saved changes stay on this device.</span><button type="button" onClick={() => void retry()}>Check signal</button></> : "All changes synced."}
      </div>
    );
  if (notice.kind === "pending")
    return (
      <div className="sync-notice pending" role="status">
        <span>Saved on this device — waiting for signal. {notice.pending} change
        {notice.pending === 1 ? "" : "s"} pending.</span>
        {source === "offline" && <button type="button" onClick={() => void retry()}>Check signal</button>}
      </div>
    );
  if (notice.kind === "syncing")
    return (
      <div className="sync-notice syncing" role="status">
        Sending saved changes…
      </div>
    );
  return (
    <div className="sync-notice blocked" role="alert">
      <span>
        {notice.pending} saved change{notice.pending === 1 ? "" : "s"} needs
        attention. Nothing was deleted.
      </span>
      <button type="button" onClick={() => void retry()}>
        Try again
      </button>
    </div>
  );
}

function OfflineDataNotice() {
  const notices = useSyncExternalStore(subscribeWorkspaceCacheNotices, getWorkspaceCacheNotices, getWorkspaceCacheNotices);
  if (!notices.length) return null;
  const oldest = notices[0];
  return <div className="offline-data-notice" role="status">Showing an offline copy from {new Date(oldest.cachedAt).toLocaleString()}. Saved changes stay on this device until Farm Rx reconnects.</div>;
}

function FarmAccessGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user)
    return (
      <main className="login-page">
        <p className="opening-farm">Opening your farm…</p>
      </main>
    );
  return <FarmAccessGateForUser key={user.id} user={user}>{children}</FarmAccessGateForUser>;
}

const farmRetryModules = ["fields", "grain", "profitability", "inventory", "equipment_tasks", "weather", "fieldLog", "scouting", "harvest", "programs", "notifications"] as const;
function clearFarmRetryActions() { for (const module of farmRetryModules) setModuleSyncRetryAction(module, null) }
const farmSyncModule: Partial<Record<FarmAppModule, Parameters<typeof setModuleSyncStatus>[0]>> = { fields: "fields", grain: "grain", profitability: "profitability", inventory: "inventory", equipment: "equipment_tasks", weather: "weather", field_log: "fieldLog", scouting: "scouting", harvest: "harvest", programs: "programs", notifications: "notifications" };
function clearSkippedFarmModuleStatus(module: FarmAppModule) { const syncModule = farmSyncModule[module]; if (syncModule) setModuleSyncStatus(syncModule, { kind: "synced", pending: 0 }) }
function authorizedFarmRetry(latestProfile: LoadedFarmAccessProfile, module: FarmAppModule, action: () => Promise<unknown>) {
  return async () => {
    const authorization = beginFarmReplayAuthorization(latestProfile, undefined, { supersede: false });
    try {
      authorization.verify();
      if (!canReplayFarmModule(latestProfile, module)) throw new Error("Farm permissions no longer allow this saved work.");
      await action();
      authorization.verify();
    } finally { authorization.end(); }
  };
}
export function installFarmRetryActions(
  latestProfile: LoadedFarmAccessProfile,
  actions: FarmReplayWorkActions = defaultFarmReplayWorkActions,
  setRetryAction: typeof setModuleSyncRetryAction = setModuleSyncRetryAction,
  clearRetryActions: () => void = clearFarmRetryActions,
  revalidateAccess?: () => Promise<void>,
) {
  clearRetryActions();
  if (latestProfile.source === "offline" && revalidateAccess) {
    let revalidation: Promise<void> | null = null;
    const revalidateOnce = () => {
      if (!revalidation) revalidation = Promise.resolve().then(revalidateAccess).catch((error) => { revalidation = null; throw error; });
      return revalidation;
    };
    if (canReplayFarmModule(latestProfile, "fields")) { setRetryAction("fields", revalidateOnce); setRetryAction("weather", revalidateOnce) }
    if (canReplayFarmModule(latestProfile, "grain")) setRetryAction("grain", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "profitability")) setRetryAction("profitability", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "inventory")) setRetryAction("inventory", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "equipment")) setRetryAction("equipment_tasks", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "field_log")) setRetryAction("fieldLog", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "scouting")) setRetryAction("scouting", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "harvest")) setRetryAction("harvest", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "programs")) setRetryAction("programs", revalidateOnce);
    if (canReplayFarmModule(latestProfile, "notifications")) setRetryAction("notifications", revalidateOnce);
    return;
  }
  if (canReplayFarmModule(latestProfile, "fields")) { setRetryAction("fields", authorizedFarmRetry(latestProfile, "fields", actions.replayFieldsQueue)); setRetryAction("weather", authorizedFarmRetry(latestProfile, "fields", actions.replayFieldLocationQueue)) }
  if (canReplayFarmModule(latestProfile, "grain")) setRetryAction("grain", authorizedFarmRetry(latestProfile, "grain", actions.replayGrainQueue));
  if (canReplayFarmModule(latestProfile, "profitability")) setRetryAction("profitability", authorizedFarmRetry(latestProfile, "profitability", actions.replayProfitabilityQueue));
  if (canReplayFarmModule(latestProfile, "inventory")) setRetryAction("inventory", authorizedFarmRetry(latestProfile, "inventory", actions.replayInventoryQueue));
  if (canReplayFarmModule(latestProfile, "equipment")) setRetryAction("equipment_tasks", authorizedFarmRetry(latestProfile, "equipment", async () => { await actions.inspectEquipmentTasksQueue(); if (latestProfile.source === "live") await actions.generateDueEquipmentTasks() }));
  if (canReplayFarmModule(latestProfile, "field_log")) setRetryAction("fieldLog", authorizedFarmRetry(latestProfile, "field_log", actions.replayFieldLogQueue));
  if (canReplayFarmModule(latestProfile, "scouting")) setRetryAction("scouting", authorizedFarmRetry(latestProfile, "scouting", actions.replayScoutingQueue));
  if (canReplayFarmModule(latestProfile, "harvest")) setRetryAction("harvest", authorizedFarmRetry(latestProfile, "harvest", actions.replayHarvestQueue));
  if (canReplayFarmModule(latestProfile, "programs")) setRetryAction("programs", authorizedFarmRetry(latestProfile, "programs", async () => { await actions.replayProgramsQueue(); if (latestProfile.source === "live") await actions.generateDueProgramItems() }));
  if (canReplayFarmModule(latestProfile, "notifications")) setRetryAction("notifications", authorizedFarmRetry(latestProfile, "notifications", actions.replayNotificationsQueue));
}

export interface FarmReplayWorkActions {
  replayFieldsQueue: typeof replayFieldsQueue;
  replayFieldLocationQueue: typeof replayFieldLocationQueue;
  replayProgramsQueue: typeof replayProgramsQueue;
  generateDueProgramItems: typeof generateDueProgramItems;
  replayHarvestQueue: typeof replayHarvestQueue;
  replayGrainQueue: typeof replayGrainQueue;
  replayInventoryQueue: typeof replayInventoryQueue;
  replayProfitabilityQueue: typeof replayProfitabilityQueue;
  inspectEquipmentTasksQueue: typeof inspectEquipmentTasksQueue;
  generateDueEquipmentTasks: typeof generateDueEquipmentTasks;
  replayFieldLogQueue: typeof replayFieldLogQueue;
  replayScoutingQueue: typeof replayScoutingQueue;
  replayNotificationsQueue: typeof replayNotificationsQueue;
}

const defaultFarmReplayWorkActions: FarmReplayWorkActions = {
  replayFieldsQueue,
  replayFieldLocationQueue,
  replayProgramsQueue,
  generateDueProgramItems,
  replayHarvestQueue,
  replayGrainQueue,
  replayInventoryQueue,
  replayProfitabilityQueue,
  inspectEquipmentTasksQueue,
  generateDueEquipmentTasks,
  replayFieldLogQueue,
  replayScoutingQueue,
  replayNotificationsQueue,
};

export async function replayAuthorizedFarmWork(latestProfile: LoadedFarmAccessProfile, isCurrent: () => boolean = () => true, actions: FarmReplayWorkActions = defaultFarmReplayWorkActions) {
  if (!isCurrent()) throw new Error("Farm access validation was superseded.");
  const authorization = beginFarmReplayAuthorization(latestProfile);
  const verify = () => { authorization.verify(); if (!isCurrent()) throw new Error("Farm access validation was superseded."); };
  const replay = async (module: FarmAppModule, action: () => Promise<unknown>) => { verify(); if (canReplayFarmModule(latestProfile, module)) await action(); else clearSkippedFarmModuleStatus(module); verify(); };
  try {
    await replay("fields", actions.replayFieldsQueue);
    await replay("weather", actions.replayFieldLocationQueue);
    await replay("programs", actions.replayProgramsQueue);
    if (latestProfile.source === "live") await replay("programs", actions.generateDueProgramItems);
    await replay("harvest", actions.replayHarvestQueue);
    await replay("grain", actions.replayGrainQueue);
    await replay("inventory", actions.replayInventoryQueue);
    await replay("profitability", actions.replayProfitabilityQueue);
    await replay("equipment", actions.inspectEquipmentTasksQueue);
    if (latestProfile.source === "live") await replay("equipment", actions.generateDueEquipmentTasks);
    await replay("field_log", actions.replayFieldLogQueue);
    await replay("scouting", actions.replayScoutingQueue);
    await replay("notifications", actions.replayNotificationsQueue);
  } finally { authorization.end(); }
}

export interface FarmAccessGateDependencies {
  loadAccess: typeof loadFarmAccess;
  loadProfile: typeof loadFarmAccessProfile;
  replayWork: typeof replayAuthorizedFarmWork;
  installRetryActions: (latestProfile: LoadedFarmAccessProfile, revalidateAccess?: () => Promise<void>) => void;
  clearRetryActions: typeof clearFarmRetryActions;
  selectFarm: typeof selectFarm;
}

const defaultFarmAccessGateDependencies: FarmAccessGateDependencies = {
  loadAccess: loadFarmAccess,
  loadProfile: loadFarmAccessProfile,
  replayWork: replayAuthorizedFarmWork,
  installRetryActions: (latestProfile, revalidateAccess) => installFarmRetryActions(latestProfile, defaultFarmReplayWorkActions, setModuleSyncRetryAction, clearFarmRetryActions, revalidateAccess),
  clearRetryActions: clearFarmRetryActions,
  selectFarm,
};

async function restoreCurrentFarmAfterFailedSwitch(latestProfile: LoadedFarmAccessProfile, dependencies: FarmAccessGateDependencies, revalidateAccess?: () => Promise<void>) {
  const authorization = beginFarmReplayAuthorization(latestProfile);
  try {
    authorization.verify();
    dependencies.installRetryActions(latestProfile, revalidateAccess);
    authorization.verify();
    publishFarmReadyAuthorization(latestProfile);
  } finally {
    authorization.end();
  }
}

export function FarmAccessGateForUser({ children, user, dependencies = defaultFarmAccessGateDependencies }: { children: ReactNode; user: User; dependencies?: FarmAccessGateDependencies }) {
  const [state, setState] = useState<
    "checking" | "choose" | "ready" | "setup" | "blocked"
  >("checking");
  const [access, setAccess] = useState<FarmAccess | null>(null);
  const [profile, setProfile] = useState<LoadedFarmAccessProfile | null>(null);
  const [message, setMessage] = useState("");
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  const validationGate = useRef(createFarmAccessValidationGate());
  const openFarmRef = useRef<null | (() => Promise<FarmAccess["source"]>)>(null);
  const liveRevalidationRef = useRef<null | (() => Promise<void>)>(null);
  const retryLock = useRef(createSubmitLock());
  const beginValidation = () => {
    const isLatestGeneration = validationGate.current.begin();
    return () => mounted.current && isLatestGeneration();
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; validationGate.current.invalidate(); };
  }, []);
  useEffect(() => {
    let active = true;
    dependencies.clearRetryActions();
    const beginEffectValidation = () => {
      const isLatestGeneration = beginValidation();
      return () => active && isLatestGeneration();
    };
    const acceptValidatedAccess = async (latest: FarmAccess, isCurrent: () => boolean): Promise<FarmAccess["source"]> => {
      if (!isCurrent()) throw new Error("Farm access validation was superseded.");
      if (latest.userId !== user.id) throw new Error("Farm access validation no longer matches the signed-in account.");
      if (!latest.selectedFarmId) {
        setProfile(null);
        setAccess(latest);
        if (latest.farms.length) setState("choose");
        else if (user?.app_metadata.initial_farm_owner === true) setState("setup");
        else { setMessage("Crop RX needs to finish your farm setup."); setState("blocked"); }
        return latest.source;
      }
      const latestProfile = await dependencies.loadProfile(latest);
      if (!isCurrent()) throw new Error("Farm access validation was superseded.");
      if (latestProfile.userId !== user.id || latestProfile.farmId !== latest.selectedFarmId) throw new Error("Farm permissions no longer match the signed-in account or selected farm.");
      await dependencies.replayWork(latestProfile, isCurrent);
      if (!isCurrent()) throw new Error("Farm access validation was superseded.");
      dependencies.installRetryActions(latestProfile, liveRevalidationRef.current ?? undefined);
      publishFarmReadyAuthorization(latestProfile);
      setProfile(latestProfile);
      const acceptedSource = latest.source === "offline" || latestProfile.source === "offline" ? "offline" : "live";
      setAccess(acceptedSource === latest.source ? latest : { ...latest, source: acceptedSource });
      setState("ready");
      return acceptedSource;
    };
    const replayOnReconnect = async (showChecking = true, propagateFailure = false): Promise<FarmAccess["source"] | null> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const isCurrent = beginEffectValidation();
        if (!user) return null;
        dependencies.clearRetryActions();
        setAccess(null); setProfile(null); if (showChecking) setState("checking");
        try {
          const latest = await dependencies.loadAccess(user.id, true);
          if (!isCurrent()) return null;
          return await acceptValidatedAccess(latest, isCurrent);
        }
        catch (error) {
          if (!isCurrent()) return null;
          const message = error instanceof Error ? error.message : "";
          const supersededBySibling = message === "Farm access changed while permissions were loading."
            || message === "Access to this farm changed while work was being saved. Nothing was queued or replayed.";
          if (attempt === 0 && supersededBySibling) continue;
          setMessage(farmerError(error, "open your farm"));
          setState("blocked");
          if (propagateFailure) throw error;
          return null;
        }
      }
      return null;
    };
    const openFarm = async () => {
      const source = await replayOnReconnect(false, true);
      if (!source) throw new Error("Farm access validation was superseded.");
      return source;
    };
    const retrySavedWork = async () => {
      const source = await openFarm();
      if (source !== "live") throw new TypeError("We could not reach Farm Rx. Check your signal and try again.");
    };
    openFarmRef.current = openFarm;
    liveRevalidationRef.current = retrySavedWork;
    const reconnect = () => { void replayOnReconnect(true) };
    window.addEventListener("online", reconnect);
    if (user) void replayOnReconnect(true);
    return () => {
      active = false;
      validationGate.current.invalidate();
      dependencies.clearRetryActions();
      if (openFarmRef.current === openFarm) openFarmRef.current = null;
      if (liveRevalidationRef.current === retrySavedWork) liveRevalidationRef.current = null;
      window.removeEventListener("online", reconnect);
    };
  }, [dependencies, user?.app_metadata.initial_farm_owner, user?.id]);
  const retryOpenFarm = async () => {
    if (!retryLock.current.acquire()) return;
    setRetrying(true);
    try {
      const openFarm = openFarmRef.current;
      if (!openFarm) throw new Error("Farm access is not ready to retry.");
      await openFarm();
    } catch (error) {
      if (mounted.current) { setMessage(farmerError(error, "open your farm")); setState("blocked"); }
    } finally {
      setRetrying(false);
      retryLock.current.release();
    }
  };
  const completeInitialFarmSetup = async () => {
    const isCurrent = beginValidation();
    const latest = await dependencies.loadAccess(user.id, true);
    let acceptedSource = latest.source;
    if (!isCurrent()) return;
    if (latest.userId !== user.id) throw new Error("Farm access validation no longer matches the signed-in account.");
    if (latest.selectedFarmId) {
      const latestProfile = await dependencies.loadProfile(latest);
      if (!isCurrent()) return;
      if (latestProfile.userId !== user.id || latestProfile.farmId !== latest.selectedFarmId) throw new Error("Farm permissions no longer match the signed-in account or selected farm.");
      await dependencies.replayWork(latestProfile, isCurrent);
      if (!isCurrent()) return;
      dependencies.installRetryActions(latestProfile, liveRevalidationRef.current ?? undefined);
      publishFarmReadyAuthorization(latestProfile);
      setProfile(latestProfile);
      if (latestProfile.source === "offline") acceptedSource = "offline";
    } else setProfile(null);
    setAccess(acceptedSource === latest.source ? latest : { ...latest, source: acceptedSource });
    setState(latest.selectedFarmId ? "ready" : "choose");
  };
  if (state === "checking")
    return (
      <main className="login-page">
        <p className="opening-farm">Opening your farm…</p>
      </main>
    );
  if (state === "setup")
    return <InitialFarmSetup onComplete={completeInitialFarmSetup} />;
  if (state === "choose" && access?.userId === user.id)
    return <main className="login-page"><section className="login-panel farm-choice" aria-labelledby="farm-choice-title"><h1 id="farm-choice-title">Choose a farm</h1><p>Your records and saved offline work stay separated by farm.</p><div className="farm-choice-list">{access.farms.map((farm) => <button className="primary-action" type="button" key={farm.id} onClick={() => { void selectFarm(user.id, farm.id).then(() => window.location.assign('/fields')).catch((error) => { setMessage(farmerError(error, 'open this farm')); setState('blocked') }) }}>{farm.name}</button>)}</div><RevokedFarmRecovery userId={user.id} /></section></main>;
  if (state === "blocked")
    return (
      <main className="login-page">
        <section className="login-panel">
          <p className="opening-farm">{message}</p>
          <button className="primary-action" type="button" disabled={retrying} onClick={() => { void retryOpenFarm() }}>
            {retrying ? "Trying again…" : "Try again"}
          </button>
          <RevokedFarmRecovery userId={user.id} />
        </section>
      </main>
    );
  if (access?.userId !== user.id || !access.selectedFarmId || profile?.userId !== user.id || profile.farmId !== access.selectedFarmId)
    return (
      <main className="login-page">
        <p className="opening-farm">Opening your farm…</p>
      </main>
    );
  const activeFarm = access.farms.find((farm) => farm.id === access.selectedFarmId);
  if (!activeFarm) return null;
  const chooseFarm = async (farmId: string) => {
    if (farmId === activeFarm.id) return;
    if (hasPendingFarmWork(user.id, activeFarm.id) && !window.confirm(`Saved changes are still waiting for ${activeFarm.name}. They will stay with that farm. Switch farms anyway?`)) return;
    try {
      await dependencies.selectFarm(user.id, farmId);
    } catch (error) {
      if (error instanceof FarmAccessStorageUnsafeError) {
        dependencies.clearRetryActions();
        setAccess(null);
        setProfile(null);
        setMessage(error.message);
        setState("blocked");
        throw error;
      }
      try {
        await restoreCurrentFarmAfterFailedSwitch(profile, dependencies, liveRevalidationRef.current ?? undefined);
      } catch (recoveryError) {
        dependencies.clearRetryActions();
        setAccess(null);
        setProfile(null);
        setMessage(farmerError(recoveryError, "restore your farm"));
        setState("blocked");
      }
      throw error;
    }
    window.location.assign('/fields');
  };
  const checkSignal = async () => {
    const revalidate = liveRevalidationRef.current;
    if (!revalidate) throw new Error("Farm access is not ready to check the signal.");
    await revalidate();
  };
  return <FarmAccessProvider value={{ farms: access.farms, activeFarm, profile, source: access.source, chooseFarm, checkSignal }}>{children}</FarmAccessProvider>;
}

function InitialFarmSetup({ onComplete }: { onComplete: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(createSubmitLock());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submitLock.current.acquire()) return;
    try {
      setSubmitting(true);
      setError(null);
      const form = new FormData(event.currentTarget);
      await bootstrapInitialOwnerFarm({
        farmName: String(form.get("farmName") ?? ""),
        entityName: String(form.get("entityName") ?? ""),
        selectedEntityType: String(
          form.get("entityType") ?? "llc",
        ) as EntityType,
      });
      await onComplete();
    } catch (caught) {
      setError(farmerError(caught, "finish your setup"));
    } finally {
      submitLock.current.release();
      setSubmitting(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="setup-title">
        <div className="login-brand">
          <h1 id="setup-title">Set up your farm</h1>
          <p>Tell us the farm and operating name to get started.</p>
        </div>
        <form className="login-card" onSubmit={submit}>
          <label htmlFor="farmName">Farm name</label>
          <input id="farmName" name="farmName" required disabled={submitting} />
          <label htmlFor="entityName">Operating name</label>
          <input
            id="entityName"
            name="entityName"
            required
            disabled={submitting}
          />
          <label htmlFor="entityType">Entity type</label>
          <select
            id="entityType"
            name="entityType"
            defaultValue="llc"
            disabled={submitting}
          >
            <option value="individual">Individual</option>
            <option value="sole_proprietorship">Sole proprietorship</option>
            <option value="partnership">Partnership</option>
            <option value="llc">LLC</option>
            <option value="corporation">Corporation</option>
            <option value="trust">Trust</option>
          </select>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-action"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Save farm"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Navigation({ className, items, onNavigate }: { className: string; items: NavigationItem[]; onNavigate?: () => void }) {
  return (
    <div className={className}>
      {items.map((item) => (
        <NavLink key={item.path} className="nav-link" to={item.path} onClick={onNavigate}>
          <span className="nav-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}

function MobileNavigation() {
  const { profile } = useFarmAccess();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const allowed = navigation.filter((item) => canAccessFarmModule(profile, item.module));
  const mobilePrimaryNavigation = allowed.filter((item) => mobilePrimaryPaths.has(item.path));
  const mobileMoreNavigation = allowed.filter((item) => !mobilePrimaryPaths.has(item.path));
  const moreActive = mobileMoreNavigation.some((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));
  useEffect(() => setMoreOpen(false), [location.pathname]);
  return (
    <>
      {moreOpen && (
        <section className="mobile-more-menu" id="mobile-more-menu" aria-label="More Farm Rx destinations">
          <header><strong>More</strong><button type="button" onClick={() => setMoreOpen(false)} aria-label="Close more navigation">Close</button></header>
          <Navigation className="mobile-more-grid" items={mobileMoreNavigation} onNavigate={() => setMoreOpen(false)} />
        </section>
      )}
      <nav className="mobile-nav" aria-label="Farm Rx navigation">
        <div className="mobile-nav-list">
          {mobilePrimaryNavigation.map((item) => (
            <NavLink key={item.path} className="nav-link" to={item.path}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button className={`nav-link mobile-more-toggle${moreActive ? " active" : ""}`} type="button" aria-expanded={moreOpen} aria-controls="mobile-more-menu" onClick={() => setMoreOpen((open) => !open)}>
            <span className="nav-icon" aria-hidden="true"><NavGlyph d="M5 12h.01M12 12h.01M19 12h.01" /></span>
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function LoginPage() {
  const { phase, signIn, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotPassword, setForgotPassword] = useState(
    () => passwordEmailDeliveryEnabled && (location.state as { forgotPassword?: boolean } | null)?.forgotPassword === true,
  );
  const [resetResponse, setResetResponse] = useState<string | null>(null);
  const signInLock = useRef(createSubmitLock());

  if (phase === "restoring")
    return (
      <main className="login-page">
        <p className="opening-farm">Opening your farm…</p>
      </main>
    );
  if (phase === "signed_in") {
    const from = (location.state as { from?: string } | null)?.from;
    return (
      <Navigate
        to={from?.startsWith("/") && !from.startsWith("//") ? from : "/fields"}
        replace
      />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signInLock.current.acquire()) return;
    try {
      setSubmitting(true);
      setError(null);
      const form = new FormData(event.currentTarget);
      await signIn(
        String(form.get("email") ?? ""),
        String(form.get("password") ?? ""),
      );
      const from = (location.state as { from?: string } | null)?.from;
      navigate(
        from?.startsWith("/") && !from.startsWith("//") ? from : "/fields",
        { replace: true },
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message.toLowerCase() : "";
      if (
        /invalid login credentials|invalid.*password|invalid.*email/.test(
          message,
        )
      )
        setError(
          "That email or password did not work. Check both and try again.",
        );
      else if (/rate limit|too many requests/.test(message))
        setError("Too many tries. Wait a few minutes, then try again.");
      else if (/network|fetch|timeout|timed out|connection/.test(message))
        setError(
          "We could not reach Farm Rx. Check your signal and try again.",
        );
      else
        setError("Farm Rx could not sign you in right now. Please try again.");
    } finally {
      setSubmitting(false);
      signInLock.current.release();
    }
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordEmailDeliveryEnabled) return;
    if (!signInLock.current.acquire()) return;
    try {
      setSubmitting(true);
      setError(null);
      const form = new FormData(event.currentTarget);
      setResetResponse(await requestPasswordReset(String(form.get('email') ?? '')));
    } catch {
      // Account existence and delivery details are intentionally never shown.
      setResetResponse(passwordResetPublicResponse);
    } finally {
      setSubmitting(false);
      signInLock.current.release();
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="rx-mark" aria-hidden="true">
            ℞
          </div>
          <h1 id="login-title">
            Farm <span>Rx</span>
          </h1>
          <p>Farm records made clear.</p>
        </div>
        {forgotPassword ? <form className="login-card" onSubmit={handlePasswordReset}>
          <h2>Reset your password</h2>
          <p>Enter your email and we’ll send a link to choose a new password.</p>
          <label htmlFor="reset-email">Email address</label>
          <input id="reset-email" name="email" type="email" autoComplete="email" placeholder="you@farm.com" required disabled={submitting || Boolean(resetResponse)} />
          {resetResponse && <p className="reset-confirmation" role="status">{resetResponse}</p>}
          <button className="primary-action" type="submit" disabled={submitting || Boolean(resetResponse)}>{submitting ? 'Sending…' : 'Send reset link'}</button>
          <button className="auth-link" type="button" onClick={() => { setForgotPassword(false); setError(null); setResetResponse(null) }} disabled={submitting}>Back to sign in</button>
        </form> : <form className="login-card" onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@farm.com"
            required
            disabled={submitting}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            disabled={submitting}
          />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {(location.state as { expired?: boolean } | null)?.expired &&
            !error && (
              <p className="auth-error" role="alert">
                Your sign-in ended. Please sign in again.
              </p>
            )}
          <button
            className="primary-action"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
          {passwordEmailDeliveryEnabled
            ? <button className="auth-link" type="button" onClick={() => { setForgotPassword(true); setError(null) }} disabled={submitting}>Forgot password?</button>
            : <p className="auth-help">Need password help? Contact your Crop RX representative.</p>}
        </form>}
        <p className="slogan">INNOVATIVE SOLUTIONS. UNMATCHED RESULTS.</p>
        <p className="byline">by Crop RX Solutions</p>
      </section>
    </main>
  );
}

function UpdatePasswordPage() {
  const { passwordRecoveryPhase, updatePassword, cancelPasswordRecovery } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateLock = useRef(createSubmitLock());
  const validationMessage = passwordValidationMessage(password, confirmation);
  const strength = passwordStrength(password);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationMessage || !updateLock.current.acquire()) return;
    try {
      setSubmitting(true);
      setError(null);
      await updatePassword(password);
    } catch (caught) {
      setError(farmerError(caught, 'update your password'));
    } finally {
      setSubmitting(false);
      updateLock.current.release();
    }
  }

  async function cancelRecovery() {
    if (!updateLock.current.acquire()) return;
    try {
      setSubmitting(true);
      setError(null);
      await cancelPasswordRecovery();
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(farmerError(caught, 'cancel password recovery'));
      setSubmitting(false);
      updateLock.current.release();
    }
  }

  return <main className="login-page"><section className="login-panel" aria-labelledby="update-password-title">
    <div className="login-brand"><div className="rx-mark" aria-hidden="true">℞</div><h1 id="update-password-title">Choose a new password</h1><p>Keep your Farm Rx account secure.</p></div>
    {passwordRecoveryPhase === 'checking' && <p className="opening-farm" role="status">Checking your password-reset link…</p>}
    {passwordRecoveryPhase === 'invalid' && <div className="login-card"><p className="auth-error" role="alert">This password-reset link is invalid, expired, already used, or was interrupted when the page closed or refreshed. Request a fresh link or contact your Crop RX representative.</p>{passwordEmailDeliveryEnabled ? <Link className="primary-action" to="/login" state={{ forgotPassword: true }}>Request a new link</Link> : <Link className="primary-action" to="/login">Return to sign in</Link>}</div>}
    {passwordRecoveryPhase === 'complete' && <div className="login-card"><p className="reset-confirmation" role="status">Your password has been updated. Sign in with your new password.</p><Link className="primary-action" to="/login">Go to sign in</Link></div>}
    {passwordRecoveryPhase === 'complete_with_warning' && <div className="login-card"><p className="auth-error" role="alert">Your password was updated, but this device could not completely clear the reset session. Close every Farm Rx tab, reopen the app, and sign in with your new password. If that still fails, contact your Farm Rx administrator.</p></div>}
    {passwordRecoveryPhase === 'ready' && <form className="login-card" onSubmit={submit}>
      <p className="auth-help" role="note">For your security, keep this page open until your password is updated. Closing or refreshing it invalidates this reset session.</p>
      <label htmlFor="new-password">New password</label>
      <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={minimumPasswordLength} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
      <p className={`password-strength ${strength}`} aria-live="polite">{strength === 'too_short' ? `Use at least ${minimumPasswordLength} characters.` : strength === 'strong' ? 'Strong password.' : 'Good length. Add a mix of letters, numbers, or symbols to make it stronger.'}</p>
      <label htmlFor="confirm-password">Confirm new password</label>
      <input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={minimumPasswordLength} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={submitting} />
      {validationMessage && confirmation && <p className="auth-error" role="alert">{validationMessage}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-action" type="submit" disabled={submitting || Boolean(validationMessage)}>{submitting ? 'Updating…' : 'Update password'}</button>
      <button className="auth-link" type="button" disabled={submitting} onClick={() => { void cancelRecovery() }}>Cancel and return to sign in</button>
    </form>}
  </section></main>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />
      <Route
        path="/*"
        element={
          <RequireSession>
            <FarmAccessGate>
              <AppLayout />
            </FarmAccessGate>
          </RequireSession>
        }
      />
    </Routes>
  );
}
