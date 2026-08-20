import type { SidebarValue } from './types'

export function ok(value: SidebarValue) {
  return { ok: true as const, value }
}

export function fail(message: string) {
  return {
    ok: false as const,
    error: { code: 'internal' as const, message, details: {} },
  }
}

export function domainError(code: string, message: string): SidebarValue {
  return { kind: 'domain-error', code, message }
}
