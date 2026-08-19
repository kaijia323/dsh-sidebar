import { isAbsolute } from 'node:path'
import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { FsDirEntry } from '@deepseek-ai/dsh-fs'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'

export const name = 'dsh-ymc-sidebar'
export const inject = ['fs', 'connection']

export interface Config {
  maxTextBytes: number
  maxImageBytes: number
  maxEntriesPerDirectory: number
  maxTreeRows: number
}

export const Config: Schema<Config> = Schema.object({
  maxTextBytes: Schema.number().min(16 * 1024).max(16 * 1024 * 1024).default(2 * 1024 * 1024),
  maxImageBytes: Schema.number().min(16 * 1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024),
  maxEntriesPerDirectory: Schema.number().min(10).max(100000).default(2000),
  maxTreeRows: Schema.number().min(100).max(1000000).default(100000),
})

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}

type SidebarValue =
  | { kind: 'meta'; maxTextBytes: number; maxImageBytes: number; maxEntriesPerDirectory: number; maxTreeRows: number }
  | { kind: 'list'; path: string; entries: SidebarEntry[]; truncated: boolean }
  | { kind: 'read'; path: string; size: number; result: ReadResult }
  | { kind: 'domain-error'; code: string; message: string }

interface SidebarEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

type ReadResult =
  | { kind: 'text'; content: string }
  | { kind: 'image'; mime: string; base64: string }
  | { kind: 'binary' }
  | { kind: 'too-large'; limit: number }
  | { kind: 'error'; code: string; message: string }

function ok(value: SidebarValue) {
  return { ok: true as const, value }
}

function fail(message: string) {
  return {
    ok: false as const,
    error: { code: 'internal' as const, message, details: {} },
  }
}

function domainError(code: string, message: string): SidebarValue {
  return { kind: 'domain-error', code, message }
}

function readString(payload: unknown, key: string): string {
  if (typeof payload !== 'object' || payload === null) throw new Error('payload must be an object')
  const value = (payload as Record<string, unknown>)[key]
  if (typeof value !== 'string') throw new Error(`"${key}" must be a string`)
  return value
}

function fsCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortEntries(entries: FsDirEntry[]): FsDirEntry[] {
  const collator = NAME_COLLATOR
  return entries.slice().sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'directory') return -1
      if (b.type === 'directory') return 1
    }
    return collator.compare(a.name, b.name)
  })
}

function bufferToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

async function handleList(ctx: Context, config: Config, payload: unknown, signal: AbortSignal): Promise<SidebarValue> {
  const requested = readString(payload, 'path')
  if (!isAbsolute(requested)) {
    return domainError('invalid-path', 'path must be absolute')
  }

  const target = await ctx.fs.resolve(requested, { signal })
  const info = await ctx.fs.stat(target, signal)
  if (!info) return domainError('not-found', `directory not found: ${requested}`)
  if (info.type !== 'directory') return domainError('not-directory', `not a directory: ${requested}`)

  let entries: FsDirEntry[]
  try {
    entries = sortEntries(await ctx.fs.listDir(target, signal))
  } catch (error) {
    const code = fsCode(error)
    if (code === 'FS_PERMISSION_DENIED') return domainError('permission-denied', errorMessage(error))
    throw error
  }

  const visible = entries.slice(0, config.maxEntriesPerDirectory)
  return {
    kind: 'list',
    path: target.displayPath,
    truncated: entries.length > visible.length,
    entries: visible.map((entry) => ({
      name: entry.name,
      path: entry.target.displayPath,
      type: entry.type,
      size: entry.size,
    })),
  }
}

async function handleRead(ctx: Context, config: Config, payload: unknown, signal: AbortSignal): Promise<SidebarValue> {
  const requested = readString(payload, 'path')
  if (!isAbsolute(requested)) {
    return domainError('invalid-path', 'path must be absolute')
  }

  const target = await ctx.fs.resolve(requested, { signal })
  const info = await ctx.fs.stat(target, signal)
  if (!info) return domainError('not-found', `file not found: ${requested}`)
  if (info.type !== 'file') return domainError('not-file', `not a regular file: ${requested}`)
  const size = info.size ?? 0

  const extension = requested.slice(requested.lastIndexOf('.')).toLowerCase()
  const asImage = IMAGE_EXTENSIONS.has(extension)

  if (asImage) {
    if (size > config.maxImageBytes) {
      return {
        kind: 'read',
        path: target.displayPath,
        size,
        result: { kind: 'too-large', limit: config.maxImageBytes },
      }
    }
    try {
      const bytes = await ctx.fs.readBytes(target, signal, config.maxImageBytes)
      return {
        kind: 'read',
        path: target.displayPath,
        size,
        result: {
          kind: 'image',
          mime: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
          base64: bufferToBase64(bytes),
        },
      }
    } catch (error) {
      const code = fsCode(error)
      if (code === 'FS_TOO_LARGE') {
        return { kind: 'read', path: target.displayPath, size, result: { kind: 'too-large', limit: config.maxImageBytes } }
      }
      if (code === 'FS_NOT_REGULAR_FILE' || code === 'FS_NOT_TEXT') {
        return { kind: 'read', path: target.displayPath, size, result: { kind: 'binary' } }
      }
      throw error
    }
  }

  if (size > config.maxTextBytes) {
    return {
      kind: 'read',
      path: target.displayPath,
      size,
      result: { kind: 'too-large', limit: config.maxTextBytes },
    }
  }

  try {
    const content = await ctx.fs.readText(target, signal)
    return {
      kind: 'read',
      path: target.displayPath,
      size,
      result: { kind: 'text', content },
    }
  } catch (error) {
    const code = fsCode(error)
    if (code === 'FS_NOT_TEXT' || code === 'FS_NOT_REGULAR_FILE') {
      return { kind: 'read', path: target.displayPath, size, result: { kind: 'binary' } }
    }
    if (code === 'FS_TOO_LARGE') {
      return { kind: 'read', path: target.displayPath, size, result: { kind: 'too-large', limit: config.maxTextBytes } }
    }
    if (code === 'FS_PERMISSION_DENIED') {
      return { kind: 'read', path: target.displayPath, size, result: { kind: 'error', code, message: errorMessage(error) } }
    }
    throw error
  }
}

export function apply(ctx: Context, config: Config) {
  const handler: ConnectionRpcHandler = async (endpoint, payload, signal) => {
    try {
      switch (endpoint) {
        case 'meta': {
          return ok({
            kind: 'meta',
            maxTextBytes: config.maxTextBytes,
            maxImageBytes: config.maxImageBytes,
            maxEntriesPerDirectory: config.maxEntriesPerDirectory,
            maxTreeRows: config.maxTreeRows,
          })
        }
        case 'list': {
          return ok(await handleList(ctx, config, payload, signal))
        }
        case 'read': {
          return ok(await handleRead(ctx, config, payload, signal))
        }
        default: {
          return fail(`unknown endpoint ${endpoint}`)
        }
      }
    } catch (error) {
      return fail(errorMessage(error))
    }
  }

  const options: ConnectionRpcHandlerOptions = { authority: 'loopback' }
  ctx.connection.rpc.handle('/dsh-ymc-sidebar', handler, options)
}
