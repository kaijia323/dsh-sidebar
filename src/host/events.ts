import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { watch, type FSWatcher } from 'chokidar'
import type { Config } from './config'

const execFileAsync = promisify(execFile)
const gitIgnoredCache = new Map<string, string[]>()

async function collectGitIgnored(root: string): Promise<string[]> {
  const cached = gitIgnoredCache.get(root)
  if (cached) return cached
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', root,
      '-c', 'core.untrackedCache=true',
      'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z',
    ], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5000,
    })
    const ignored = stdout.split('\0')
      .filter(Boolean)
      .map((entry) => entry.replace(/\/$/, ''))
      .filter((entry) => entry !== '.' && entry !== './')
    gitIgnoredCache.set(root, ignored)
    return ignored
  } catch {
    return []
  }
}

export const EVENTS_PATH = '/dsh-ymc-sidebar/events'

export interface FileChangePayload {
  kind: 'change'
  path: string
  event: string
}

interface SseClient {
  id: number
  root: string
  response: ServerResponse
  heartbeat: ReturnType<typeof setInterval> | undefined
}

function isLoopbackAuthority(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * Broadcasts filesystem changes detected by chokidar to browser sidebar
 * clients over a same-origin SSE stream. One chokidar watcher is shared per
 * watched root; watchers are created lazily on first subscriber and closed
 * when the last subscriber for that root disconnects.
 */
export class FileWatchHub {
  private readonly clients = new Set<SseClient>()
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly watcherTasks = new Map<string, Promise<void>>()
  private nextClientId = 1

  constructor(private readonly config: Pick<Config, 'watchEnabled' | 'watchDebounceMs' | 'watchIgnored'>) {}

  readonly handle = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' })
      res.end()
      return
    }

    if (!isLoopbackAuthority(req.headers.host)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }

    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const root = url.searchParams.get('root')
    if (!root || !isAbsolute(root)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('missing absolute root query parameter')
      return
    }

    const client: SseClient = {
      id: this.nextClientId,
      root,
      response: res,
      heartbeat: undefined,
    }
    this.nextClientId += 1

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')

    this.clients.add(client)
    client.heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n')
    }, 15000)

    res.on('close', () => this.removeClient(client))
    void this.ensureWatcher(root)
  }

  private removeClient(client: SseClient): void {
    if (!this.clients.delete(client)) return
    if (client.heartbeat) clearInterval(client.heartbeat)
    if (!this.hasSubscribers(client.root)) this.stopWatcher(client.root)
  }

  private hasSubscribers(root: string): boolean {
    for (const client of this.clients) {
      if (client.root === root) return true
    }
    return false
  }

  private async ensureWatcher(root: string): Promise<void> {
    if (!this.config.watchEnabled) return
    if (this.watchers.has(root)) return
    const pending = this.watcherTasks.get(root)
    if (pending) return pending

    const task = this.createWatcher(root)
    this.watcherTasks.set(root, task)
    try {
      await task
    } finally {
      this.watcherTasks.delete(root)
    }
  }

  private async createWatcher(root: string): Promise<void> {
    const watcher = watch(root, {
      ignoreInitial: true,
      persistent: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.watchDebounceMs,
        pollInterval: 30,
      },
      ignored: this.config.watchIgnored.length > 0 ? this.config.watchIgnored : undefined,
    })

    watcher.on('all', (event, path) => {
      this.broadcast(root, { kind: 'change', path, event })
    })
    watcher.on('error', (error) => {
      console.warn(`[dsh-ymc-sidebar] file watcher error for ${root}:`, error)
    })

    this.watchers.set(root, watcher)
    void this.applyGitIgnored(root, watcher)
  }

  private async applyGitIgnored(root: string, watcher: FSWatcher): Promise<void> {
    const ignored = await collectGitIgnored(root)
    if (this.watchers.get(root) !== watcher || ignored.length === 0) return
    watcher.unwatch(ignored)
  }

  private stopWatcher(root: string): void {
    const watcher = this.watchers.get(root)
    if (!watcher) return
    this.watchers.delete(root)
    void watcher.close()
  }

  private broadcast(root: string, payload: FileChangePayload): void {
    const data = `event: change\ndata: ${JSON.stringify(payload)}\n\n`
    for (const client of this.clients) {
      if (client.root !== root || client.response.writableEnded) continue
      try {
        client.response.write(data)
      } catch {
        // The close handler will remove the client on the next socket event.
      }
    }
  }

  dispose(): void {
    for (const client of this.clients) {
      if (client.heartbeat) clearInterval(client.heartbeat)
      try {
        client.response.end()
      } catch {
        // Response may already be closed.
      }
    }
    this.clients.clear()
    for (const watcher of this.watchers.values()) {
      void watcher.close()
    }
    this.watchers.clear()
  }
}

export function registerFileWatchRoute(ctx: Context, config: Config): void {
  const hub = new FileWatchHub(config)
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: EVENTS_PATH,
      handler: hub.handle,
    })
    return () => {
      disposeRoute()
      hub.dispose()
    }
  }, 'dsh-ymc-sidebar: file watch SSE')
}
