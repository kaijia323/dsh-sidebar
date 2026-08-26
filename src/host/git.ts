import { execFile } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { domainError } from './result'
import type {
  GitAction,
  GitBranch,
  GitDiffOk,
  GitLogCommit,
  GitStatusEntry,
  GitStatusOk,
  SidebarValue,
} from './types'
import { errorMessage } from './utils'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER = 16 * 1024 * 1024
const GIT_LOG_DEFAULT_LIMIT = 100
const GIT_LOG_MAX_LIMIT = 500
const repoRootCache = new Map<string, string>()

/** Field separator for `git log --pretty=format` output. */
const LOG_FIELD = '\x1f'
/** Record separator for `git log --pretty=format` output. */
const LOG_RECORD = '\x1e'
const LOG_FORMAT = [
  '%H', '%h', '%P', '%an', '%ae', '%aI', '%cI', '%s', '%b', '%D',
].join(`%x${LOG_FIELD.charCodeAt(0).toString(16)}`) + `%x${LOG_RECORD.charCodeAt(0).toString(16)}`

async function runGit(root: string, args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await runGitFull(root, args, signal)
  return stdout
}

interface GitRunResult {
  stdout: string
  stderr: string
}

async function runGitFull(root: string, args: string[], signal: AbortSignal): Promise<GitRunResult> {
  const { stdout, stderr } = await execFileAsync('git', ['-C', root, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    signal,
    encoding: 'utf8',
    // Do not let read-only Git commands opportunistically refresh/rewrite
    // `.git/index`. The sidebar's own `.git` watcher would see that write and
    // trigger another Git refresh, creating a feedback loop / continuous CPU
    // churn while the Git panel is open.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
  return { stdout, stderr }
}

async function getRepoRoot(root: string, signal: AbortSignal): Promise<string> {
  const cached = repoRootCache.get(root)
  if (cached !== undefined) return cached
  const repoRoot = (await runGit(root, ['rev-parse', '--show-toplevel'], signal)).trim()
  repoRootCache.set(root, repoRoot)
  return repoRoot
}

function parseBranchHeader(header: string): string | null {
  const raw = header.slice(2).trim()
  if (!raw) return null
  if (raw.startsWith('No commits yet on ')) return raw.slice('No commits yet on '.length)
  const branch = raw.split('...')[0].split('[')[0].trim()
  return branch || null
}

function parseStatusOutput(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  const parts = output.split('\0')
  let index = 0
  if (parts[0]?.startsWith('##')) index = 1

  while (index < parts.length) {
    const token = parts[index]
    index += 1
    if (!token) continue
    if (token.length < 3 || token[2] !== ' ') continue
    const status = token.slice(0, 2)
    const path = token.slice(3)
    let originalPath: string | undefined
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') {
      originalPath = parts[index] || undefined
      if (parts[index] !== undefined) index += 1
    }
    entries.push({ status, path, originalPath })
  }
  return entries
}

function toWorkspaceRelative(root: string, repoRoot: string, repoPath: string): string {
  const absolute = resolve(repoRoot, repoPath)
  const result = relative(root, absolute)
  if (result.startsWith('..') || isAbsolute(result)) return repoPath
  return result.split(/[\\/]/).join('/')
}

function toRepoRelative(root: string, repoRoot: string, workspacePath: string): string {
  const absolute = resolve(root, workspacePath)
  const result = relative(repoRoot, absolute)
  if (result.startsWith('..') || isAbsolute(result)) return workspacePath
  return result.split(/[\\/]/).join('/')
}

function gitErrorCodeAndMessage(error: unknown): { code: string; message: string } {
  const message = errorMessage(error)
  if (/not a git repository/i.test(message)) {
    return { code: 'not-a-git-repository', message: '当前目录不是 Git 仓库，无法显示 Git 追踪状态。' }
  }
  if (/ENOENT|spawn git/i.test(message)) {
    return { code: 'git-unavailable', message: '未检测到 Git 命令，请先安装 Git。' }
  }
  return { code: 'git-error', message }
}

function parseRefs(refs: string): string[] {
  if (!refs) return []
  const names: string[] = []
  for (const raw of refs.split(',')) {
    const segment = raw.trim()
    if (!segment || segment === 'HEAD') continue
    if (segment.includes(' -> ')) {
      names.push(segment.slice(segment.indexOf(' -> ') + 4).trim())
    } else if (segment.startsWith('tag: ')) {
      names.push(segment.slice(5).trim())
    } else {
      names.push(segment)
    }
  }
  return names
}

function parseGitLogOutput(output: string): GitLogCommit[] {
  const commits: GitLogCommit[] = []
  for (const record of output.split(LOG_RECORD)) {
    if (!record) continue
    const fields = record.split(LOG_FIELD)
    if (fields.length < 10) continue
    const [
      hash, shortHash, parents, authorName, authorEmail,
      authorDate, committerDate, subject, body, refs,
    ] = fields
    commits.push({
      hash: hash.trim(),
      shortHash: shortHash.trim(),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName: authorName.trim(),
      authorEmail: authorEmail.trim(),
      authorDate: authorDate.trim(),
      committerDate: committerDate.trim(),
      subject: subject.trim(),
      body: body.trim(),
      refs: parseRefs(refs),
    })
  }
  return commits
}

function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (!track) return { ahead: 0, behind: 0, gone: false }
  if (track === '[gone]') return { ahead: 0, behind: 0, gone: true }
  const ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0)
  return { ahead, behind, gone: false }
}

async function getCurrentBranch(root: string, signal: AbortSignal): Promise<string | null> {
  try {
    const output = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
    return output.trim() || null
  } catch {
    // Detached HEAD or unborn branch; status still carries the branch name.
    return null
  }
}

function normalizeOperationOutput(output: string, fallback: string): string {
  return output.trim() || fallback
}

export async function handleGitLog(root: string, limit: number, skip: number, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  const safeLimit = Math.min(GIT_LOG_MAX_LIMIT, Math.max(1, Math.floor(limit || GIT_LOG_DEFAULT_LIMIT)))
  const safeSkip = Math.max(0, Math.floor(skip || 0))
  try {
    const repoRoot = await getRepoRoot(root, signal)
    const output = await runGit(repoRoot, [
      'log',
      '--no-color',
      '--date=iso-strict',
      `--pretty=format:${LOG_FORMAT}`,
      `--skip=${safeSkip}`,
      `--max-count=${safeLimit}`,
      'HEAD',
    ], signal)
    return { kind: 'git-log', root, commits: parseGitLogOutput(output) }
  } catch (error) {
    const message = errorMessage(error)
    if (/does not have any commits|unknown revision|bad revision|ambiguous argument/i.test(message)) {
      return { kind: 'git-log', root, commits: [] }
    }
    const { code, message: domainMessage } = gitErrorCodeAndMessage(error)
    return domainError(code, domainMessage)
  }
}

export async function handleGitShow(root: string, commit: string, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  if (!commit) return domainError('invalid-path', 'commit must be a non-empty string')
  try {
    const repoRoot = await getRepoRoot(root, signal)
    const metaOutput = await runGit(repoRoot, [
      'log', '-1', '--no-color', '--date=iso-strict',
      `--pretty=format:${LOG_FORMAT}`,
      commit,
    ], signal)
    const found = parseGitLogOutput(metaOutput)[0]
    if (!found) return domainError('not-found', `commit not found: ${commit}`)
    const diff = await runGit(repoRoot, [
      'show', '--no-color', '--no-ext-diff', '--find-renames', '--format=', commit,
    ], signal)
    return { kind: 'git-show', root, commit: found, diff }
  } catch (error) {
    const { code, message } = gitErrorCodeAndMessage(error)
    return domainError(code, message)
  }
}

export async function handleGitBranches(root: string, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  try {
    const repoRoot = await getRepoRoot(root, signal)
    const output = await runGit(repoRoot, [
      'for-each-ref',
      '--sort=-committerdate',
      `--format=%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00`,
      'refs/heads',
      'refs/remotes',
    ], signal)
    const branches: GitBranch[] = []
    let current: string | null = null
    for (const line of output.split('\n')) {
      if (!line.trim()) continue
      const [ref, name, , upstream, track, head] = line.split('\0')
      if (!ref || !name) continue
      const isRemote = ref.startsWith('refs/remotes/')
      const isCurrent = head === '*' && !isRemote
      if (isCurrent) current = name
      const remote = isRemote ? name.slice(0, name.indexOf('/')) || null : null
      const parsed = parseTrack(track ?? '')
      branches.push({
        name,
        isRemote,
        isCurrent,
        remote,
        upstream: upstream || null,
        ahead: parsed.ahead,
        behind: parsed.behind,
        upstreamGone: parsed.gone,
      })
    }
    if (!current) current = await getCurrentBranch(repoRoot, signal)
    if (current && !branches.some((branch) => branch.name === current)) {
      branches.unshift({
        name: current,
        isRemote: false,
        isCurrent: true,
        remote: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        upstreamGone: false,
      })
    }
    return { kind: 'git-branches', root, current, branches }
  } catch (error) {
    const { code, message } = gitErrorCodeAndMessage(error)
    return domainError(code, message)
  }
}

async function runGitSwitch(repoRoot: string, target: string, signal: AbortSignal): Promise<string> {
  let remoteExists = false
  try {
    await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/remotes/${target}`], signal)
    remoteExists = true
  } catch {
    remoteExists = false
  }

  if (remoteExists) {
    const localName = target.slice(target.indexOf('/') + 1)
    let localExists = false
    try {
      await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${localName}`], signal)
      localExists = true
    } catch {
      localExists = false
    }
    if (!localExists) {
      const output = await runGit(repoRoot, ['switch', '-c', localName, '--track', target], signal)
      return normalizeOperationOutput(output, `已切换到新分支 ${localName}`)
    }
    const output = await runGit(repoRoot, ['switch', localName], signal)
    return normalizeOperationOutput(output, `已切换到分支 ${localName}`)
  }

  const output = await runGit(repoRoot, ['switch', target], signal)
  return normalizeOperationOutput(output, `已切换到分支 ${target}`)
}

export async function handleGitSwitch(root: string, target: string, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  if (!target) return domainError('invalid-path', 'target must be a non-empty string')
  try {
    const repoRoot = await getRepoRoot(root, signal)
    const output = await runGitSwitch(repoRoot, target, signal)
    return { kind: 'git-operation', root, action: 'switch', output }
  } catch (error) {
    const { code, message } = gitErrorCodeAndMessage(error)
    return domainError(code, message)
  }
}

export async function handleGitPull(root: string, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  try {
    const output = await runGit(root, ['pull'], signal)
    return { kind: 'git-operation', root, action: 'pull', output: normalizeOperationOutput(output, '拉取完成。') }
  } catch (error) {
    const { code, message } = gitErrorCodeAndMessage(error)
    return domainError(code, message)
  }
}

export async function handleGitPush(root: string, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  try {
    try {
      const output = await runGit(root, ['push'], signal)
      return { kind: 'git-operation', root, action: 'push', output: normalizeOperationOutput(output, '推送完成。') }
    } catch (error) {
      const message = errorMessage(error)
      if (!/no upstream|set-upstream|set upstream|has no upstream branch|没有上游分支|src refspec.*does not match any/i.test(message)) throw error
      const branch = await getCurrentBranch(root, signal)
      if (!branch) throw error
      const output = await runGit(root, ['push', '-u', 'origin', branch], signal)
      return { kind: 'git-operation', root, action: 'push', output: normalizeOperationOutput(output, `已推送 ${branch} 并设置上游。`) }
    }
  } catch (error) {
    const { code, message } = gitErrorCodeAndMessage(error)
    return domainError(code, message)
  }
}

export async function handleGitStatus(root: string, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  try {
    const [output, repoRoot] = await Promise.all([
      runGit(root, ['-c', 'core.untrackedCache=true', 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--', '.'], signal),
      getRepoRoot(root, signal),
    ])
    const parts = output.split('\0')
    const header = parts[0]?.startsWith('##') ? parts[0] : undefined
    const branch = header ? parseBranchHeader(header) : null
    const entries = parseStatusOutput(output).map((entry) => ({
      ...entry,
      path: toWorkspaceRelative(root, repoRoot, entry.path),
      originalPath: entry.originalPath ? toWorkspaceRelative(root, repoRoot, entry.originalPath) : undefined,
    }))
    const value: GitStatusOk = {
      kind: 'git-status',
      root,
      branch,
      entries,
    }
    return value
  } catch (error) {
    const { code, message } = gitErrorCodeAndMessage(error)
    return domainError(code, message)
  }
}

export async function handleGitDiff(root: string, path: string, staged: boolean, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  if (!path) return domainError('invalid-path', 'path must be a non-empty string')
  try {
    const repoRoot = (await runGit(root, ['rev-parse', '--show-toplevel'], signal)).trim()
    const repoPath = toRepoRelative(root, repoRoot, path)
    const args = staged ? ['diff', '--cached', '--', repoPath] : ['diff', '--', repoPath]
    const diff = await runGit(repoRoot, args, signal)
    const value: GitDiffOk = {
      kind: 'git-diff',
      root,
      path,
      staged,
      diff,
    }
    return value
  } catch (error) {
    const { code, message } = gitErrorCodeAndMessage(error)
    return domainError(code, message)
  }
}
