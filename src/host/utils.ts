export function readString(payload: unknown, key: string): string {
  if (typeof payload !== 'object' || payload === null) throw new Error('payload must be an object')
  const value = (payload as Record<string, unknown>)[key]
  if (typeof value !== 'string') throw new Error(`"${key}" must be a string`)
  return value
}

export function readOptionalNumber(payload: unknown, key: string): number | undefined {
  if (typeof payload !== 'object' || payload === null) throw new Error('payload must be an object')
  const value = (payload as Record<string, unknown>)[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${key}" must be a finite number`)
  return value
}

export function fsCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
