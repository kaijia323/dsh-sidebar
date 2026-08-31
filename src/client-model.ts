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
  updatedAt?: number
}

export interface WorkspaceViewLike {
  workspaceId: string
  path: string
  sessionIds?: readonly string[]
  createdAt?: string
  updatedAt?: string
}

export interface SessionListLike {
  byId: Record<string, SessionSummaryLike>
}

export interface WorkspaceListLike {
  items: readonly WorkspaceViewLike[]
}

function deriveRecentWorkspaceId(sessions: SessionListLike, workspaces: WorkspaceListLike): string | undefined {
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces.items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds ?? []) {
      const session = sessions.byId[sessionId]
      if (session?.updatedAt !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY && workspace.createdAt) {
      latest = Date.parse(workspace.createdAt)
    }
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

export function dirname(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/[\\/]+$/, '')
  if (!normalized) return path.slice(0, 1) || ''
  // A Windows drive root should stay a root: 'C:\' / 'C:/', not 'C:'.
  if (/^[A-Za-z]:$/.test(normalized) && /^[A-Za-z]:[\\/]/.test(path)) {
    return path.slice(0, 3)
  }
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (index <= 0) {
    if (index === 0) return normalized.slice(0, 1)
    return normalized
  }
  // Same drive-root preservation for 'C:\file.txt'.
  if (index === 2 && /^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized.slice(0, 3)
  }
  return normalized.slice(0, index)
}

export function isPathInside(path: string, ancestor: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedAncestor = ancestor.replace(/\\/g, '/')
  if (normalizedPath === normalizedAncestor) return true
  const prefix = normalizedAncestor.endsWith('/') ? normalizedAncestor : normalizedAncestor + '/'
  return normalizedPath.startsWith(prefix)
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

export function isHtmlPath(path: string): boolean {
  return /\.(?:html?|xhtml|shtml)$/i.test(path)
}

/**
 * Build the sidebar-local URL used by the browser view to load an absolute
 * file path through the plugin's loopback file server. Each path segment is
 * percent-encoded, while slashes remain real URL separators so relative
 * assets referenced by an HTML page resolve under the same directory.
 */
export function toFileBrowserUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const encoded = parts.map((part) => encodeURIComponent(part))
  return `/dsh-sidebar/files/${encoded.join('/')}`
}

export function resolveRoot(sessionId: string, sessions: SessionListLike, workspaces: WorkspaceListLike): string | undefined {
  const current = sessions.byId[sessionId]
  if (current?.cwd) return current.cwd
  const recentId = deriveRecentWorkspaceId(sessions, workspaces)
  const recent = recentId ? workspaces.items.find((item) => item.workspaceId === recentId) : undefined
  if (recent?.path) return recent.path
  return workspaces.items[0]?.path
}

export interface TreeInteractionState {
  expanded: ReadonlySet<string>
  entering: ReadonlySet<string>
  collapsing: ReadonlySet<string>
}

export type TreeInteractionAction =
  | { type: 'toggle'; path: string }
  | { type: 'finishExpand'; path: string }
  | { type: 'finishCollapse'; path: string }
  | { type: 'reset'; root?: string }

function addPath(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(set)
  next.add(path)
  return next
}

function removePath(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(set)
  next.delete(path)
  return next
}

export function treeInteractionReducer(state: TreeInteractionState, action: TreeInteractionAction): TreeInteractionState {
  switch (action.type) {
    case 'toggle': {
      const { path } = action
      if (state.collapsing.has(path)) {
        return {
          ...state,
          collapsing: removePath(state.collapsing, path),
        }
      }
      if (state.expanded.has(path)) {
        return {
          expanded: state.expanded,
          entering: removePath(state.entering, path),
          collapsing: addPath(state.collapsing, path),
        }
      }
      return {
        expanded: addPath(state.expanded, path),
        entering: addPath(state.entering, path),
        collapsing: removePath(state.collapsing, path),
      }
    }
    case 'finishExpand': {
      return {
        ...state,
        entering: removePath(state.entering, action.path),
      }
    }
    case 'finishCollapse': {
      return {
        expanded: removePath(state.expanded, action.path),
        entering: removePath(state.entering, action.path),
        collapsing: removePath(state.collapsing, action.path),
      }
    }
    case 'reset': {
      return {
        expanded: action.root ? new Set([action.root]) : new Set<string>(),
        entering: new Set<string>(),
        collapsing: new Set<string>(),
      }
    }
  }
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
