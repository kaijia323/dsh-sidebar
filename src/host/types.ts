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

export type SidebarValue =
  | { kind: 'meta'; maxTextBytes: number; maxImageBytes: number; maxEntriesPerDirectory: number; maxTreeRows: number; watchEnabled: boolean }
  | { kind: 'list'; path: string; entries: SidebarEntry[]; truncated: boolean }
  | { kind: 'read'; path: string; size: number; result: ReadResult }
  | { kind: 'domain-error'; code: string; message: string }
