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

export type SidebarValue =
  | { kind: 'meta'; maxTextBytes: number; maxImageBytes: number; maxEntriesPerDirectory: number; maxTreeRows: number; watchEnabled: boolean }
  | { kind: 'list'; path: string; entries: SidebarEntry[]; truncated: boolean }
  | { kind: 'read'; path: string; size: number; result: ReadResult }
  | { kind: 'git-status'; root: string; branch: string | null; entries: GitStatusEntry[] }
  | { kind: 'git-diff'; root: string; path: string; staged: boolean; diff: string }
  | { kind: 'domain-error'; code: string; message: string }
