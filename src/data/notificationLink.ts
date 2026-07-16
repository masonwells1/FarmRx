const fallback = '/notifications'
const unsafeCharacters = /[\\\u0000-\u001f\u007f]/

export function safeNotificationLink(value: unknown, origin: string): string {
  if (typeof value !== 'string' || value.length > 2_048 || !value.startsWith('/') || value.startsWith('//') || unsafeCharacters.test(value)) return fallback
  try {
    const resolved = new URL(value, origin)
    if (resolved.origin !== origin) return fallback
    const canonical = `${resolved.pathname}${resolved.search}${resolved.hash}`
    // URL dot-segment normalization can turn an apparently relative path such
    // as `/..//example.test` into a protocol-relative `//example.test` URL.
    // Validate the canonical value that will actually be opened, not only the
    // caller-provided spelling.
    if (!canonical.startsWith('/') || canonical.startsWith('//') || unsafeCharacters.test(canonical)) return fallback
    if (new URL(canonical, origin).origin !== origin) return fallback
    return canonical
  } catch { return fallback }
}
