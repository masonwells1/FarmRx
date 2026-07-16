export type ExpectedGrainAlertAccess = { userId: string; farmId: string; accessEpoch: number }

export function parseExpectedGrainAlertAccess(headers: Headers, authenticatedUserId: string, farmId: string): ExpectedGrainAlertAccess | null {
  const expectedUserId = headers.get('x-farm-rx-expected-user-id')
  let accessEpoch: number | null = null
  try {
    const value = JSON.parse(headers.get('x-farm-rx-access-epochs') ?? 'null') as Record<string, unknown> | null
    const candidate = value?.[farmId]
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 1) accessEpoch = candidate
  } catch { /* fail closed below */ }
  return expectedUserId === authenticatedUserId && accessEpoch !== null ? { userId: authenticatedUserId, farmId, accessEpoch } : null
}

/** The email provider is an irreversible boundary. Callers must put every
 * recipient/config read before this helper so revocation gets one final check
 * immediately before the provider request. */
export async function runWithRetainedExpectedOwnerAccess<T>(retainsAccess: () => Promise<boolean>, providerRequest: () => Promise<T>): Promise<{ allowed: false } | { allowed: true; value: T }> {
  if (!await retainsAccess()) return { allowed: false }
  return { allowed: true, value: await providerRequest() }
}
