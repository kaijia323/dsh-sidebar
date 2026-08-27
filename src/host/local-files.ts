import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const FILES_PREFIX = '/dsh-sidebar/files'
export const FILE_SERVER_PREFIX = FILES_PREFIX

export function isLoopbackAuthority(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

function isAbsoluteLike(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}/.test(value)
}

export function decodeLocalFilePath(pathname: string): string | undefined {
  const prefix = `${FILES_PREFIX}/`
  if (!pathname.startsWith(prefix)) return undefined
  const raw = pathname.slice(prefix.length)
  if (!raw) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  if (!decoded || decoded.includes('\0')) return undefined
  if (!isAbsoluteLike(decoded)) return undefined
  if (decoded.split(/[\\/]/).some((segment) => segment === '..')) return undefined
  return decoded
}

function contentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/**
 * Serves files selected from the sidebar file tree to the browser view. The
 * route is intentionally narrow: loopback-only, GET/HEAD only, and it maps the
 * encoded absolute file path from the URL back to a real filesystem path.
 */
export async function handleLocalFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }

  if (!isLoopbackAuthority(req.headers.host)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }

  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://dsh.internal')
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('invalid url')
    return
  }
  const filePath = decodeLocalFilePath(url.pathname)
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('invalid file path')
    return
  }

  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const body = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') {
      res.end()
    } else {
      res.end(body)
    }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    if (code === 'EACCES' || code === 'EPERM') {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
      return
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('internal error')
  }
}

export function registerLocalFileRoute(ctx: Context): void {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: FILES_PREFIX,
      handler: handleLocalFile,
    })
    return dispose
  }, 'dsh-sidebar: local file server')
}

export const registerFileServerRoute = registerLocalFileRoute
