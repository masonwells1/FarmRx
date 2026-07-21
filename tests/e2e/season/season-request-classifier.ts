export const readOnlySeasonAccessRpcs = new Set([
  'get_current_farm_access_epochs',
  'can_access_farm',
  'is_active_farm_member',
  'can_edit_farm',
  'can_manage_farm',
  'has_explicit_rep_access',
  'can_read_private_financials',
  'program_due_generation_status',
  'service_due_generation_status',
])

type RequestKind = 'pre-auth' | 'password-auth' | 'safe-read' | 'read-only-rpc' | 'target-mutation-rpc' | 'unexpected-rpc' | 'unexpected-non-read'

export function createSeasonRequestClassifier(options: {
  targetMutationRpcs?: Iterable<string>
  blockUnexpectedNonReadRequests?: boolean
} = {}) {
  const targetMutationRpcs = new Set(options.targetMutationRpcs)
  const observedTargetMutationRpcs: string[] = []
  const unexpectedRpcs: string[] = []
  const blockedNonReadRequests: string[] = []
  let armed = false

  return {
    observedTargetMutationRpcs,
    unexpectedRpcs,
    blockedNonReadRequests,
    observe(methodValue: string, urlValue: string): { kind: RequestKind; block: boolean } {
      const method = methodValue.toUpperCase()
      const url = new URL(urlValue)
      if (!armed) {
        if (method === 'POST' && url.pathname === '/auth/v1/token' && url.search === '?grant_type=password') {
          armed = true
          return { kind: 'password-auth', block: false }
        }
        return { kind: 'pre-auth', block: false }
      }

      const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)
      const rpcName = rpcMatch?.[1]
      if (rpcName) {
        if (method === 'POST' && readOnlySeasonAccessRpcs.has(rpcName)) return { kind: 'read-only-rpc', block: false }
        if (method === 'POST' && targetMutationRpcs.has(rpcName)) {
          observedTargetMutationRpcs.push(rpcName)
          return { kind: 'target-mutation-rpc', block: false }
        }
        unexpectedRpcs.push(`${method} ${url.pathname}`)
        return { kind: 'unexpected-rpc', block: options.blockUnexpectedNonReadRequests === true }
      }

      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return { kind: 'safe-read', block: false }
      if (options.blockUnexpectedNonReadRequests === true) blockedNonReadRequests.push(`${method} ${url.pathname}`)
      return { kind: 'unexpected-non-read', block: options.blockUnexpectedNonReadRequests === true }
    },
  }
}
