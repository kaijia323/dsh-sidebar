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

export interface FsApi {
  list(path: string, signal?: AbortSignal): Promise<ListValue>
  read(path: string, signal?: AbortSignal): Promise<ReadValue>
  meta(signal?: AbortSignal): Promise<Limits>
  gitStatus(root: string, signal?: AbortSignal): Promise<GitStatusValue>
  gitDiff(root: string, path: string, staged: boolean, signal?: AbortSignal): Promise<GitDiffValue>
}

export interface SnapshotStore<T> {
  subscribe(callback: () => void): () => void
  getSnapshot(): T
}

export interface SelectedFile {
  path: string
  name: string
}
