export type EntryType = 'file' | 'directory' | 'other'

export interface SidebarEntry {
  name: string
  path: string
  type: EntryType
  size?: number
}

export interface DirData {
  entries: SidebarEntry[]
  truncated: boolean
  error?: string
}

export interface FlatRow {
  key: string
  path: string
  name: string
  type: EntryType
  depth: number
}

export interface SessionSummaryLike {
  cwd?: string
}

export interface WorkspaceViewLike {
  workspaceId: string
  path: string
}

export interface SessionListLike {
  byId: Record<string, SessionSummaryLike>
}

export interface WorkspaceListLike {
  items: readonly WorkspaceViewLike[]
  recentWorkspaceId?: string
}

export function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd)$/i.test(path)
}

export function isImagePath(path: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(path)
}

export function resolveRoot(sessionId: string, sessions: SessionListLike, workspaces: WorkspaceListLike): string | undefined {
  const current = sessions.byId[sessionId]
  if (current?.cwd) return current.cwd
  const recentId = workspaces.recentWorkspaceId
  const recent = recentId ? workspaces.items.find((item) => item.workspaceId === recentId) : undefined
  if (recent?.path) return recent.path
  return workspaces.items[0]?.path
}

export function flattenTree(root: string, dirs: Record<string, DirData>, expanded: ReadonlySet<string>, maxRows: number): { rows: FlatRow[]; truncated: boolean } {
  const rows: FlatRow[] = []
  const seen = new Set<string>([root])
  const stack: FlatRow[] = [{ key: root, path: root, name: basename(root), type: 'directory', depth: 0 }]

  while (stack.length > 0) {
    const row = stack.pop()!
    rows.push(row)
    if (rows.length >= maxRows) return { rows, truncated: true }
    if (row.type !== 'directory' || !expanded.has(row.path)) continue
    const data = dirs[row.path]
    if (!data) continue
    if (data.truncated) {
      stack.push({
        key: row.path + '::truncated',
        path: row.path,
        name: '… 目录内容过多，已截断',
        type: 'other',
        depth: row.depth + 1,
      })
    }
    for (let index = data.entries.length - 1; index >= 0; index -= 1) {
      const entry = data.entries[index]
      if (seen.has(entry.path)) continue
      seen.add(entry.path)
      stack.push({ key: entry.path, path: entry.path, name: entry.name, type: entry.type, depth: row.depth + 1 })
    }
  }

  return { rows, truncated: false }
}
