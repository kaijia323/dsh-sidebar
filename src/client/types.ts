import type { SidebarEntry } from '../client-model'

export interface Limits {
  maxTextBytes: number
  maxImageBytes: number
  maxEntriesPerDirectory: number
  maxTreeRows: number
  watchEnabled: boolean
}

export interface ListOk {
  kind: 'list'
  path: string
  entries: SidebarEntry[]
  truncated: boolean
}

export interface DomainError {
  kind: 'domain-error'
  code: string
  message: string
}

export type ListValue = ListOk | DomainError

export interface ReadOk {
  kind: 'read'
  path: string
  size: number
  result:
    | { kind: 'text'; content: string }
    | { kind: 'image'; mime: string; base64: string }
    | { kind: 'binary' }
    | { kind: 'too-large'; limit: number }
    | { kind: 'error'; code: string; message: string }
}

export type ReadValue = ReadOk | DomainError

export interface GitStatusEntry {
  status: string
  path: string
  originalPath?: string
}

export interface GitStatusOk {
  kind: 'git-status'
  root: string
  branch: string | null
  entries: GitStatusEntry[]
}

export type GitStatusValue = GitStatusOk | DomainError

export interface GitDiffOk {
  kind: 'git-diff'
  root: string
  path: string
  staged: boolean
  diff: string
}

export type GitDiffValue = GitDiffOk | DomainError

export interface GitLogCommit {
  hash: string
  shortHash: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: string
  committerDate: string
  subject: string
  body: string
  refs: string[]
}

export interface GitLogOk {
  kind: 'git-log'
  root: string
  commits: GitLogCommit[]
}

export type GitLogValue = GitLogOk | DomainError

export interface GitShowOk {
  kind: 'git-show'
  root: string
  commit: GitLogCommit
  diff: string
}

export type GitShowValue = GitShowOk | DomainError

export interface GitBranch {
  name: string
  isRemote: boolean
  isCurrent: boolean
  remote: string | null
  upstream: string | null
  ahead: number
  behind: number
  upstreamGone: boolean
}

export interface GitBranchesOk {
  kind: 'git-branches'
  root: string
  current: string | null
  branches: GitBranch[]
}

export type GitBranchesValue = GitBranchesOk | DomainError

export type GitAction = 'switch' | 'pull' | 'push'

export interface GitOperationOk {
  kind: 'git-operation'
  root: string
  action: GitAction
  output: string
}

export type GitOperationValue = GitOperationOk | DomainError

export interface FsApi {
  list(path: string, signal?: AbortSignal): Promise<ListValue>
  read(path: string, signal?: AbortSignal): Promise<ReadValue>
  meta(signal?: AbortSignal): Promise<Limits>
  gitStatus(root: string, signal?: AbortSignal): Promise<GitStatusValue>
  gitDiff(root: string, path: string, staged: boolean, signal?: AbortSignal): Promise<GitDiffValue>
  gitLog(root: string, limit?: number, skip?: number, signal?: AbortSignal): Promise<GitLogValue>
  gitShow(root: string, commit: string, signal?: AbortSignal): Promise<GitShowValue>
  gitBranches(root: string, signal?: AbortSignal): Promise<GitBranchesValue>
  gitSwitch(root: string, target: string, signal?: AbortSignal): Promise<GitOperationValue>
  gitPull(root: string, signal?: AbortSignal): Promise<GitOperationValue>
  gitPush(root: string, signal?: AbortSignal): Promise<GitOperationValue>
}

export interface SnapshotStore<T> {
  subscribe(callback: () => void): () => void
  getSnapshot(): T
}

export interface SelectedFile {
  path: string
  name: string
}

export interface BrowserOpenRequest {
  path: string
  id: number
  nonce?: number
}
