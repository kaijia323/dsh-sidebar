import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clamp,
  dirname,
  isPathInside,
  resolveRoot,
  treeInteractionReducer,
  type DirData,
  type SessionListLike,
  type SidebarEntry,
  type WorkspaceListLike,
} from '../client-model'
import { isDomainError } from './api'
import { DEFAULT_LIMITS, TOGGLE_THROTTLE_MS } from './constants'
import { PanelHeader } from './panel-header'
import { PreviewPane } from './preview'
import { Tree } from './tree'
import type { FsApi, Limits, SelectedFile } from './types'

interface FileTreePanelProps {
  api: FsApi
  sessionId: string | undefined
  sessions: SessionListLike
  workspaces: WorkspaceListLike
}

export function FileTreePanel({ api, sessionId, sessions, workspaces }: FileTreePanelProps) {
  const root = useMemo(() => sessionId ? resolveRoot(sessionId, sessions, workspaces) : undefined, [sessionId, sessions, workspaces])

  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS)
  const [dirs, setDirs] = useState<Record<string, DirData>>({})
  const [treeState, dispatch] = useReducer(
    treeInteractionReducer,
    undefined,
    () => ({ expanded: new Set<string>(), entering: new Set<string>(), collapsing: new Set<string>() }),
  )
  const { expanded, entering, collapsing } = treeState
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [tabs, setTabs] = useState<SelectedFile[]>([])
  const [activePath, setActivePath] = useState<string | undefined>(undefined)
  const [rootError, setRootError] = useState<string | null>(null)
  const [split, setSplit] = useState(0.55)

  const bodyRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startSplit: number } | null>(null)
  const inflightRef = useRef(new Map<string, Promise<void>>())
  const controllersRef = useRef(new Map<string, AbortController>())
  const toggleThrottleRef = useRef(new Map<string, number>())
  const dirsRef = useRef(dirs)
  const activePathRef = useRef(activePath)
  const pendingChangesRef = useRef(new Set<string>())
  const watcherTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => { dirsRef.current = dirs }, [dirs])
  useEffect(() => { activePathRef.current = activePath }, [activePath])

  useEffect(() => {
    const controller = new AbortController()
    api.meta(controller.signal).then((value) => {
      if (!controller.signal.aborted) setLimits(value)
    }).catch(() => {})
    return () => controller.abort()
  }, [api])

  useEffect(() => {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    toggleThrottleRef.current.clear()
    inflightRef.current.clear()
    setDirs({})
    dispatch({ type: 'reset', root })
    setTabs([])
    setActivePath(undefined)
    setRootError(null)
    if (!root) setRootError('当前没有可用的工作区目录。请先打开一个工作区会话。')
  }, [root])

  useEffect(() => () => {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
  }, [])

  useEffect(() => {
    if (!root || !limits.watchEnabled) return

    const source = new EventSource(`/dsh-ymc-sidebar/events?root=${encodeURIComponent(root)}`)

    const applyChanges = () => {
      watcherTimerRef.current = undefined
      const changed: string[] = Array.from(pendingChangesRef.current)
      pendingChangesRef.current.clear()
      if (changed.length === 0) return

      const affected = new Set<string>()
      const active = activePathRef.current
      let activeDirty = false

      for (const path of changed) {
        const parent = dirname(path)
        if (parent) affected.add(parent)
        if (dirsRef.current[path]) affected.add(path)
        if (active && (path === active || isPathInside(active, path))) {
          activeDirty = true
        }
      }

      if (affected.size > 0) {
        setDirs((prev) => {
          const next = { ...prev }
          for (const path of affected) delete next[path]
          return next
        })
      }

      if (activeDirty && active) {
        // Force PreviewPane to re-read the active tab by giving it a new object.
        setTabs((prev) => prev.map((tab) => tab.path === active ? { ...tab } : tab))
      }
    }

    const handleChange = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { path?: unknown }
        if (typeof payload.path !== 'string') return
        pendingChangesRef.current.add(payload.path)
        if (watcherTimerRef.current === undefined) {
          watcherTimerRef.current = window.setTimeout(applyChanges, 150)
        }
      } catch {
        // Ignore malformed or unknown server frames; EventSource stays open.
      }
    }

    source.addEventListener('change', handleChange as EventListener)
    source.onerror = () => {
      // EventSource reconnects automatically; no user action needed.
    }

    return () => {
      source.close()
      source.removeEventListener('change', handleChange as EventListener)
      if (watcherTimerRef.current !== undefined) {
        window.clearTimeout(watcherTimerRef.current)
        watcherTimerRef.current = undefined
      }
      pendingChangesRef.current.clear()
    }
  }, [root, limits.watchEnabled])

  const finishCollapse = useCallback((path: string) => {
    dispatch({ type: 'finishCollapse', path })
  }, [])

  const finishExpand = useCallback((path: string) => {
    dispatch({ type: 'finishExpand', path })
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const body = bodyRef.current
      if (!drag || !body) return
      const rect = body.getBoundingClientRect()
      const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1)
      setSplit(clamp(ratio, 0.2, 0.8))
    }
    const handlePointerUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  const loadDir = useCallback(async (path: string): Promise<void> => {
    if (!path) return
    if (dirsRef.current[path]) return
    const existing = inflightRef.current.get(path)
    if (existing) return existing
    setLoading((prev) => new Set(prev).add(path))

    const controller = new AbortController()
    controllersRef.current.set(path, controller)

    const task = (async () => {
      try {
        const response = await api.list(path, controller.signal)
        if (controller.signal.aborted) return
        if (isDomainError(response)) {
          setDirs((prev) => ({ ...prev, [path]: { entries: [], truncated: false, error: response.message } }))
          return
        }
        setDirs((prev) => {
          const previous = prev[path]
          if (previous && previous.entries.length > 0) return prev
          return {
            ...prev,
            [path]: {
              entries: response.entries,
              truncated: response.truncated,
              error: response.truncated ? `目录条目过多，仅显示前 ${limits.maxEntriesPerDirectory} 项` : undefined,
            },
          }
        })
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        const message = error instanceof Error ? error.message : String(error)
        setDirs((prev) => ({ ...prev, [path]: { entries: [], truncated: false, error: message } }))
      } finally {
        controllersRef.current.delete(path)
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
        inflightRef.current.delete(path)
      }
    })()

    inflightRef.current.set(path, task)
    return task
  }, [api, limits.maxEntriesPerDirectory])

  useEffect(() => {
    for (const path of expanded) {
      if (!dirs[path] && !inflightRef.current.has(path)) void loadDir(path)
    }
  }, [expanded, dirs, loadDir])

  function toggleDirectory(path: string) {
    // Throttle rapid clicks on the same directory. The window is slightly longer
    // than the longest expand/collapse animation, so a new toggle only starts
    // after the previous animation has had time to settle.
    const now = Date.now()
    const lastToggle = toggleThrottleRef.current.get(path) ?? 0
    if (now - lastToggle < TOGGLE_THROTTLE_MS) return
    toggleThrottleRef.current.set(path, now)

    // All remaining state transitions are handled atomically by the reducer:
    // collapse-in-progress -> cancel back to open, open -> start collapse,
    // closed -> start expand.
    dispatch({ type: 'toggle', path })
  }

  function openFile(entry: SidebarEntry) {
    setTabs((prev) => prev.some((tab) => tab.path === entry.path) ? prev : [...prev, { path: entry.path, name: entry.name }])
    setActivePath(entry.path)
  }

  function closeTab(path: string) {
    const index = tabs.findIndex((tab) => tab.path === path)
    if (index === -1) return
    const next = tabs.filter((tab) => tab.path !== path)
    setTabs(next)
    if (activePath === path) {
      const neighbor = next[Math.min(index, next.length - 1)]
      setActivePath(neighbor?.path)
    }
  }

  function selectTab(path: string) {
    setActivePath(path)
  }

  function onDividerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const body = bodyRef.current
    if (!body) return
    event.preventDefault()
    const rect = body.getBoundingClientRect()
    dragRef.current = { startY: event.clientY, startSplit: split }
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1)
    const next = clamp(ratio, 0.2, 0.8)
    setSplit(next)
  }

  const panelClassName = 'ymc-panel flex h-full min-h-0 flex-col bg-transparent text-[var(--dsw-alias-label-primary)]'
  const rootData = root ? dirs[root] : undefined
  const rowLoading = root ? loading.has(root) : false
  const hasRootError = !!(rootData?.error && rootData.entries.length === 0)

  return (
    <div className={panelClassName}>
      {!root ? (
        <>
          <PanelHeader root={undefined} loadingRoot={false} />
          <div className="ymc-panel-message flex h-full flex-col items-center justify-center text-[var(--dsw-alias-label-tertiary)]">{rootError ?? '没有可显示的工作区目录。'}</div>
        </>
      ) : (
        <>
          <PanelHeader root={root} loadingRoot={rowLoading} />
          <div className="ymc-panel-body relative flex min-h-0 flex-1 flex-col" ref={bodyRef}>
            <div
              className="ymc-tree-pane relative flex min-h-[120px] shrink-0 flex-col overflow-hidden"
              style={
                tabs.length > 0
                  ? { flexBasis: `${Math.round(split * 100)}%`, flexGrow: 0, flexShrink: 0, minHeight: 120 }
                  : { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minHeight: 120 }
              }
            >
              {hasRootError
                ? <div className="ymc-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">{rootData!.error}</div>
                : (
                    <Tree
                      root={root}
                      dirs={dirs}
                      expanded={expanded}
                      loading={loading}
                      entering={entering}
                      collapsing={collapsing}
                      selectedPath={activePath}
                      maxRows={limits.maxTreeRows}
                      onToggle={toggleDirectory}
                      onSelectFile={openFile}
                      onCollapseEnd={finishCollapse}
                      onExpandEnd={finishExpand}
                    />
                  )}
            </div>
            {tabs.length > 0 && (
              <>
                <div className="ymc-divider relative flex h-[7px] flex-none touch-none items-center justify-center" onPointerDown={onDividerPointerDown}>
                  <span className="ymc-divider-grip h-[3px] w-[26px] rounded-sm bg-[var(--dsw-alias-border-l2)]" />
                </div>
                <div className="ymc-preview-pane relative flex min-h-[60px] flex-1 flex-col">
                  <PreviewPane
                    api={api}
                    tabs={tabs}
                    activePath={activePath}
                    limits={limits}
                    onCloseTab={closeTab}
                    onSelectTab={selectTab}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
