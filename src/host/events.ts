import { execFile } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'
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

export const EVENTS_PATH = '/dsh-sidebar/events'

export interface FileChangePayload {
  kind: 'change'
  path: string
  event: string
}

export interface GitChangePayload {
  kind: 'git-change'
  path: string
  event: string
}

/**
 * Git metadata directories that can produce huge, high-frequency events (and
 * whose contents are not needed by the sidebar). The git watcher still sees
 * HEAD, index, packed-refs, refs/, logs/ and other small state files. Linked
 * worktree metadata under `worktrees/` is also watched because each worktree
 * has its own HEAD/index/logs and must trigger Git refreshes too.
 */
function isHeavyGitPath(gitDir: string, candidate: string): boolean {
  const rel = relative(gitDir, candidate)
  if (!rel || rel === '.') return false
  const parts = rel.split(/[\\/]/)
  return parts.some((part) => part === 'objects' || part === 'hooks' || part === 'info')
}

interface SseClient {
  id: number
  root: string
  response: ServerResponse
  heartbeat: ReturnType<typeof setInterval> | undefined
}

export function isLoopbackAuthority(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * Broadcasts filesystem and Git metadata changes detected by chokidar to
 * browser sidebar clients over a same-origin SSE stream. One file watcher and
 * one Git metadata watcher are shared per watched root; watchers are created
 * lazily on first subscriber and closed when the last subscriber for that root
 * disconnects.
 */
export class FileWatchHub {
  private readonly clients = new Set<SseClient>()
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly watcherTasks = new Map<string, Promise<void>>()
  private readonly gitWatchers = new Map<string, FSWatcher>()
  private readonly gitWatcherTasks = new Map<string, Promise<void>>()
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
    void this.ensureGitWatcher(root)
  }

  private removeClient(client: SseClient): void {
    if (!this.clients.delete(client)) return
    if (client.heartbeat) clearInterval(client.heartbeat)
    if (!this.hasSubscribers(client.root)) {
      this.stopWatcher(client.root)
      this.stopGitWatcher(client.root)
    }
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
      console.warn(`[dsh-sidebar] file watcher error for ${root}:`, error)
    })

    // The watcher may finish starting after the last subscriber disconnected;
    // don't leave an orphan watcher behind in that race.
    if (!this.hasSubscribers(root)) {
      void watcher.close()
      return
    }
    this.watchers.set(root, watcher)
    void this.applyGitIgnored(root, watcher)
  }

  private async ensureGitWatcher(root: string): Promise<void> {
    if (!this.config.watchEnabled) return
    if (this.gitWatchers.has(root)) return
    const pending = this.gitWatcherTasks.get(root)
    if (pending) return pending

    const task = this.createGitWatcher(root)
    this.gitWatcherTasks.set(root, task)
    try {
      await task
    } finally {
      this.gitWatcherTasks.delete(root)
    }
  }

  private async createGitWatcher(root: string): Promise<void> {
    let gitWatchDir: string
    try {
      const options = {
        encoding: 'utf8' as const,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 5000,
      }
      const [gitDirResult, commonDirResult] = await Promise.all([
        execFileAsync('git', ['-C', root, 'rev-parse', '--absolute-git-dir'], options),
        execFileAsync('git', ['-C', root, 'rev-parse', '--git-common-dir'], options),
      ])
      const gitDir = gitDirResult.stdout.trim()
      const rawCommon = commonDirResult.stdout.trim()
      // Watch the common Git dir: it contains shared refs/logs and, for linked
      // worktrees, the per-worktree HEAD/index/logs under worktrees/.
      gitWatchDir = rawCommon ? resolve(root, rawCommon) : gitDir
      if (!gitWatchDir) return
    } catch {
      // Not a Git repository; nothing to watch for Git state changes.
      return
    }

    const watcher = watch(gitWatchDir, {
      ignoreInitial: true,
      persistent: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.watchDebounceMs,
        pollInterval: 30,
      },
      ignored: (candidate: string) => isHeavyGitPath(gitWatchDir, candidate),
    })

    watcher.on('all', (event, path) => {
      this.broadcastGit(root, { kind: 'git-change', path, event })
    })
    watcher.on('error', (error) => {
      console.warn(`[dsh-sidebar] git watcher error for ${root}:`, error)
    })

    // Same race guard as the file watcher: don't keep a Git watcher alive
    // when every subscriber went away while it was starting.
    if (!this.hasSubscribers(root)) {
      void watcher.close()
      return
    }
    this.gitWatchers.set(root, watcher)
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

  private stopGitWatcher(root: string): void {
    const watcher = this.gitWatchers.get(root)
    if (!watcher) return
    this.gitWatchers.delete(root)
    void watcher.close()
  }

  private writeEvent(root: string, eventName: string, payload: FileChangePayload | GitChangePayload): void {
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const client of this.clients) {
      if (client.root !== root || client.response.writableEnded) continue
      try {
        client.response.write(data)
      } catch {
        // The close handler will remove the client on the next socket event.
      }
    }
  }

  private broadcast(root: string, payload: FileChangePayload): void {
    this.writeEvent(root, 'change', payload)
  }

  private broadcastGit(root: string, payload: GitChangePayload): void {
    this.writeEvent(root, 'git-change', payload)
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
    for (const watcher of this.gitWatchers.values()) {
      void watcher.close()
    }
    this.gitWatchers.clear()
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
  }, 'dsh-sidebar: file watch SSE')
}
