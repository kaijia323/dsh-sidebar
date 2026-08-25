import { execFile } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { domainError } from './result'
import type { GitDiffOk, GitStatusEntry, GitStatusOk, SidebarValue } from './types'
import { errorMessage } from './utils'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER = 16 * 1024 * 1024
const repoRootCache = new Map<string, string>()

async function runGit(root: string, args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    signal,
    encoding: 'utf8',
  })
  return stdout
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

export async function handleGitStatus(root: string, signal: AbortSignal): Promise<SidebarValue> {
  if (!isAbsolute(root)) return domainError('invalid-path', 'root must be absolute')
  try {
    const [output, repoRoot] = await Promise.all([
      runGit(root, ['-c', 'core.untrackedCache=true', 'status', '--porcelain=v1', '-z', '--branch', '--', '.'], signal),
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
