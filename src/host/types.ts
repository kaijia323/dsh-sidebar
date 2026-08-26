export interface SidebarEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

export type ReadResult =
  | { kind: 'text'; content: string }
  | { kind: 'image'; mime: string; base64: string }
  | { kind: 'binary' }
  | { kind: 'too-large'; limit: number }
  | { kind: 'error'; code: string; message: string }

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

export interface GitDiffOk {
  kind: 'git-diff'
  root: string
  path: string
  staged: boolean
  diff: string
}

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

export interface GitShowOk {
  kind: 'git-show'
  root: string
  commit: GitLogCommit
  diff: string
}

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

export type GitAction = 'switch' | 'pull' | 'push'

export interface GitOperationOk {
  kind: 'git-operation'
  root: string
  action: GitAction
  output: string
}

export type SidebarValue =
  | { kind: 'meta'; maxTextBytes: number; maxImageBytes: number; maxEntriesPerDirectory: number; maxTreeRows: number; watchEnabled: boolean }
  | { kind: 'list'; path: string; entries: SidebarEntry[]; truncated: boolean }
  | { kind: 'read'; path: string; size: number; result: ReadResult }
  | { kind: 'git-status'; root: string; branch: string | null; entries: GitStatusEntry[] }
  | { kind: 'git-diff'; root: string; path: string; staged: boolean; diff: string }
  | { kind: 'git-log'; root: string; commits: GitLogCommit[] }
  | { kind: 'git-show'; root: string; commit: GitLogCommit; diff: string }
  | { kind: 'git-branches'; root: string; current: string | null; branches: GitBranch[] }
  | { kind: 'git-operation'; root: string; action: GitAction; output: string }
  | { kind: 'domain-error'; code: string; message: string }
