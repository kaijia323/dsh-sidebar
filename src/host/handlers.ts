import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config'
import { bufferToBase64, IMAGE_EXTENSIONS, MIME_BY_EXTENSION, sortEntries } from './fs'
import { domainError } from './result'
import type { SidebarValue } from './types'
import { errorMessage, fsCode, readString } from './utils'

export async function handleList(config: Config, payload: unknown, signal: AbortSignal): Promise<SidebarValue> {
  const requested = readString(payload, 'path')
  if (!isAbsolute(requested)) {
    return domainError('invalid-path', 'path must be absolute')
  }

  // The DSH fs service's listDir performs a realpath + stat for every child,
  // which makes large directories very slow to appear in the sidebar. The file
  // tree only needs names, types and paths, so list directly through Node's
  // readdir (still read-only; file contents / Git still go through DSH APIs).
  let rawEntries
  try {
    rawEntries = await readdir(requested, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    const code = fsCode(error)
    if (code === 'ENOENT') return domainError('not-found', `directory not found: ${requested}`)
    if (code === 'ENOTDIR') return domainError('not-directory', `not a directory: ${requested}`)
    if (code === 'EACCES' || code === 'EPERM') return domainError('permission-denied', errorMessage(error))
    throw error
  }
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')

  const entries = await Promise.all(rawEntries.map(async (entry) => {
    const childPath = join(requested, entry.name)
    let type: 'file' | 'directory' | 'other'
    if (entry.isSymbolicLink()) {
      try {
        const info = await stat(childPath)
        type = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
      } catch {
        type = 'other'
      }
    } else {
      type = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
    }
    return { name: entry.name, path: childPath, type }
  }))

  const sorted = sortEntries(entries)
  const visible = sorted.slice(0, config.maxEntriesPerDirectory)
  return {
    kind: 'list',
    path: requested,
    truncated: sorted.length > visible.length,
    entries: visible,
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
