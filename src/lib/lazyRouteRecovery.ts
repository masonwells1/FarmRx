const reloadMarkerPrefix = "farm-rx:lazy-route-reload:v1:";

function markerKey(routeKey: string) {
  return `${reloadMarkerPrefix}${routeKey}`;
}

function readMarker(routeKey: string) {
  try {
    return window.sessionStorage.getItem(markerKey(routeKey)) === "1";
  } catch {
    return true;
  }
}

function writeMarker(routeKey: string) {
  try {
    window.sessionStorage.setItem(markerKey(routeKey), "1");
    return true;
  } catch {
    return false;
  }
}

function clearMarker(routeKey: string) {
  try {
    window.sessionStorage.removeItem(markerKey(routeKey));
  } catch {
    // A blocked storage API must not keep an otherwise usable page from opening.
  }
}

export async function recoverLazyRoute<T>(routeKey: string, importer: () => Promise<T>): Promise<T> {
  try {
    const module = await importer();
    clearMarker(routeKey);
    return module;
  } catch (error) {
    const canReload = typeof window !== "undefined" && navigator.onLine !== false && !readMarker(routeKey);
    if (canReload && writeMarker(routeKey)) {
      window.location.reload();
      return new Promise<T>(() => undefined);
    }
    throw error;
  }
}
