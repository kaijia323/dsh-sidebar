import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsDirEntry } from '@deepseek-ai/dsh-fs'
import type { Config } from './config'
import { bufferToBase64, IMAGE_EXTENSIONS, MIME_BY_EXTENSION, sortEntries } from './fs'
import { domainError } from './result'
import type { SidebarValue } from './types'
import { errorMessage, fsCode, readString } from './utils'

export async function handleList(ctx: Context, config: Config, payload: unknown, signal: AbortSignal): Promise<SidebarValue> {
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

export async function handleRead(ctx: Context, config: Config, payload: unknown, signal: AbortSignal): Promise<SidebarValue> {
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
