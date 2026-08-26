import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as plugin from '../lib/index.js'

const execFileAsync = promisify(execFile)

let gitAvailable = true
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' })
} catch {
  gitAvailable = false
}

interface MockFsOptions {
  readTextError?: { code: string; message: string }
}

function targetFor(displayPath: string) {
  return { targetKey: displayPath, displayPath }
}

async function createMockFs(root: string, options: MockFsOptions = {}) {
  return {
    async resolve(input: string) {
      return targetFor(path.resolve(input))
    },
    async stat(target: { displayPath: string }) {
      try {
        const info = await stat(target.displayPath)
        return {
          version: 'test-version',
          type: info.isDirectory() ? 'directory' as const : info.isFile() ? 'file' as const : 'other' as const,
          size: info.size,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async listDir(target: { displayPath: string }) {
      const names = await readdir(target.displayPath)
      return Promise.all(names.map(async (name) => {
        const childPath = path.join(target.displayPath, name)
        const info = await stat(childPath)
        return {
          name,
          type: info.isDirectory() ? 'directory' as const : info.isFile() ? 'file' as const : 'other' as const,
          target: targetFor(childPath),
          size: info.size,
        }
      }))
    },
    async readText(target: { displayPath: string }) {
      if (options.readTextError) throw options.readTextError
      return readFile(target.displayPath, 'utf8')
    },
    async readBytes(target: { displayPath: string }) {
      return new Uint8Array(await readFile(target.displayPath))
    },
  }
}

async function createHandler(config: Partial<plugin.Config> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-sidebar-test-'))
  const fs = await createMockFs(dir)
  let captured: { channel: string; handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<any> }
  plugin.apply({
    fs,
    connection: {
      rpc: {
        handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<any>) {
          captured = { channel, handler }
        },
      },
    },
    effect() {},
  }, {
    maxTextBytes: 1024,
    maxImageBytes: 2048,
    maxEntriesPerDirectory: 10,
    maxTreeRows: 100,
    watchEnabled: true,
    watchDebounceMs: 200,
    watchIgnored: ['**/node_modules/**', '**/.git/**'],
    ...config,
  })
  return { dir, handler: captured!.handler }
}

test('meta returns resolved limits', async () => {
  const { dir, handler } = await createHandler({ maxTextBytes: 333 })
  try {
    const result = await handler('meta', {}, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'meta')
    assert.equal(result.value.maxTextBytes, 333)
    assert.equal(result.value.watchEnabled, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('list returns directories first and truncates by config', async () => {
  const { dir, handler } = await createHandler({ maxEntriesPerDirectory: 2 })
  try {
    await mkdir(path.join(dir, 'zdir'))
    await writeFile(path.join(dir, 'a.txt'), 'a', 'utf8')
    await writeFile(path.join(dir, 'b.txt'), 'b', 'utf8')
    const result = await handler('list', { path: dir }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'list')
    assert.equal(result.value.entries[0].type, 'directory')
    assert.equal(result.value.truncated, true)
    assert.equal(result.value.entries.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('read returns utf-8 text', async () => {
  const { dir, handler } = await createHandler()
  try {
    await writeFile(path.join(dir, 'hello.txt'), 'hello dsh', 'utf8')
    const result = await handler('read', { path: path.join(dir, 'hello.txt') }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.result.kind, 'text')
    assert.equal(result.value.result.content, 'hello dsh')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('read returns base64 image for image extensions', async () => {
  const { dir, handler } = await createHandler()
  try {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02])
    await writeFile(path.join(dir, 'pixel.png'), bytes)
    const result = await handler('read', { path: path.join(dir, 'pixel.png') }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.result.kind, 'image')
    assert.equal(result.value.result.mime, 'image/png')
    assert.equal(result.value.result.base64, bytes.toString('base64'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('read reports binary files and too-large files as domain values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-sidebar-test-'))
  const fs = await createMockFs(dir, { readTextError: { code: 'FS_NOT_TEXT', message: 'not text' } })
  let captured: any
  plugin.apply({
    fs,
    connection: { rpc: { handle(_channel: string, handler: any) { captured = handler } } },
    effect() {},
  }, { maxTextBytes: 4, maxImageBytes: 16, maxEntriesPerDirectory: 10, maxTreeRows: 100, watchEnabled: true, watchDebounceMs: 200, watchIgnored: [] })
  try {
    await writeFile(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2]))
    const binary = await captured('read', { path: path.join(dir, 'blob.bin') }, new AbortController().signal)
    assert.equal(binary.value.result.kind, 'binary')

    await writeFile(path.join(dir, 'big.txt'), '12345', 'utf8')
    const tooLarge = await captured('read', { path: path.join(dir, 'big.txt') }, new AbortController().signal)
    assert.equal(tooLarge.value.result.kind, 'too-large')
    assert.equal(tooLarge.value.result.limit, 4)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git-status returns branch and categorized changes', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })

    await writeFile(path.join(dir, 'a.txt'), 'modified', 'utf8')
    await writeFile(path.join(dir, 'new.txt'), 'new', 'utf8')
    await execFileAsync('git', ['add', 'a.txt'], { cwd: dir })

    const result = await handler('git-status', { root: dir }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'git-status')
    assert.equal(result.value.branch, 'main')
    const paths = result.value.entries.map((entry: { path: string }) => entry.path)
    assert.ok(paths.includes('a.txt'))
    assert.ok(paths.includes('new.txt'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git-diff returns staged diff text', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })

    await writeFile(path.join(dir, 'a.txt'), 'modified', 'utf8')
    await execFileAsync('git', ['add', 'a.txt'], { cwd: dir })

    const result = await handler('git-diff', { root: dir, path: 'a.txt', staged: true }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'git-diff')
    assert.equal(result.value.staged, true)
    assert.match(result.value.diff, /\+modified/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git-log returns commit history with parsed metadata', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'first commit'], { cwd: dir })
    await writeFile(path.join(dir, 'b.txt'), 'second', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'second commit'], { cwd: dir })

    const result = await handler('git-log', { root: dir, limit: 10 }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'git-log')
    assert.equal(result.value.commits.length, 2)
    assert.equal(result.value.commits[0].subject, 'second commit')
    assert.equal(result.value.commits[1].subject, 'first commit')
    for (const commit of result.value.commits) {
      assert.match(commit.hash, /^[0-9a-f]{40}$/, 'hash must not contain leading whitespace')
    }
    assert.equal(result.value.commits[0].authorName, 'Test')
    assert.ok(result.value.commits[0].authorDate.includes('T'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git-show returns commit metadata and a patch diff', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'changed', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'change'], { cwd: dir })

    const log = await handler('git-log', { root: dir, limit: 2 }, new AbortController().signal)
    assert.equal(log.ok, true)
    const commit = log.value.commits[1].hash
    const result = await handler('git-show', { root: dir, commit }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'git-show')
    assert.equal(result.value.commit.subject, 'init')
    assert.match(result.value.diff, /^diff --git /)
    assert.match(result.value.diff, /\+base/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git-branches lists local branches and marks the current one', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
    await execFileAsync('git', ['branch', 'feature'], { cwd: dir })

    const result = await handler('git-branches', { root: dir }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'git-branches')
    assert.equal(result.value.current, 'main')
    const names = result.value.branches.map((branch: { name: string }) => branch.name)
    assert.ok(names.includes('main'))
    assert.ok(names.includes('feature'))
    assert.equal(result.value.branches.find((branch: { name: string }) => branch.name === 'main')?.isCurrent, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git-switch switches to another local branch', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
    await execFileAsync('git', ['branch', 'feature'], { cwd: dir })

    const result = await handler('git-switch', { root: dir, target: 'feature' }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'git-operation')
    assert.equal(result.value.action, 'switch')

    const status = await handler('git-status', { root: dir }, new AbortController().signal)
    assert.equal(status.ok, true)
    assert.equal(status.value.branch, 'feature')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git-switch creates a local tracking branch from a remote branch', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.com/repo.git'], { cwd: dir })
    await execFileAsync('git', ['update-ref', 'refs/remotes/origin/feature', 'HEAD'], { cwd: dir })

    const result = await handler('git-switch', { root: dir, target: 'origin/feature' }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(result.value.kind, 'git-operation')
    assert.equal(result.value.action, 'switch')

    const status = await handler('git-status', { root: dir }, new AbortController().signal)
    assert.equal(status.ok, true)
    assert.equal(status.value.branch, 'feature')
    const upstream = await execFileAsync('git', ['config', '--get', 'branch.feature.remote'], { cwd: dir })
    assert.equal(upstream.stdout.trim(), 'origin')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('git status scopes to a subdirectory workspace and diff resolves the repo root', async () => {
  if (!gitAvailable) return
  const { dir, handler } = await createHandler()
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    const sub = path.join(dir, 'sub')
    await mkdir(sub)
    await writeFile(path.join(sub, 'a.txt'), 'base', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })

    await writeFile(path.join(sub, 'a.txt'), 'modified', 'utf8')
    await writeFile(path.join(dir, 'root.txt'), 'outside', 'utf8')

    const status = await handler('git-status', { root: sub }, new AbortController().signal)
    assert.equal(status.ok, true)
    assert.deepEqual(status.value.entries.map((entry: { path: string }) => entry.path).sort(), ['a.txt'])

    const diff = await handler('git-diff', { root: sub, path: 'a.txt', staged: false }, new AbortController().signal)
    assert.equal(diff.ok, true)
    assert.equal(diff.value.kind, 'git-diff')
    assert.match(diff.value.diff, /\+modified/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('list rejects relative paths and unknown endpoints fail closed', async () => {
  const { dir, handler } = await createHandler()
  try {
    const relative = await handler('list', { path: 'relative/path' }, new AbortController().signal)
    assert.equal(relative.ok, true)
    assert.equal(relative.value.kind, 'domain-error')
    assert.equal(relative.value.code, 'invalid-path')

    const unknown = await handler('nope', {}, new AbortController().signal)
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'internal')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
