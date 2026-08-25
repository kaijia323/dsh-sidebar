import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { clamp } from '../client-model'
import { ActivityBar, type SidebarView } from './activity-bar'
import { ACTIVITY_BAR_WIDTH, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_STORAGE_KEY } from './constants'
import { FileTreePanel } from './file-tree-panel'
import { GitPanel } from './git-panel'
import { loadSidebarOpen, loadSidebarView, loadSidebarWidth, useSnapshotStore } from './hooks'
import type { FsApi } from './types'

interface SidebarShellProps {
  ctx: ClientContext
  api: FsApi
}

export function SidebarShell({ ctx, api }: SidebarShellProps) {
  const sessions = useSnapshotStore(ctx.sessions.list)
  const workspaces = useSnapshotStore(ctx.workspaces.list)
  const [open, setOpen] = useState<boolean>(loadSidebarOpen)
  const [width, setWidth] = useState<number>(loadSidebarWidth)
  const [view, setView] = useState<SidebarView>(loadSidebarView)
  const panelRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(width)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => { widthRef.current = width }, [width])

  useEffect(() => {
    try {
      localStorage.setItem(`${SIDEBAR_STORAGE_KEY}:open`, String(open))
    } catch { /* storage unavailable */ }
  }, [open])

  useEffect(() => {
    try {
      localStorage.setItem(`${SIDEBAR_STORAGE_KEY}:width`, String(width))
    } catch { /* storage unavailable */ }
  }, [width])

  useEffect(() => {
    try {
      localStorage.setItem(`${SIDEBAR_STORAGE_KEY}:view`, view)
    } catch { /* storage unavailable */ }
  }, [view])

  useEffect(() => {
    // HMR overlap safety: only the fiber that last wrote the CSS variable is
    // allowed to remove it. An old fiber's disposer must not delete the new
    // fiber's live layout push.
    const owner = `dsh-ymc-sidebar-${Math.random().toString(36).slice(2)}`
    document.documentElement.setAttribute('data-dsh-ymc-sidebar-owner', owner)
    document.documentElement.style.setProperty('--dsh-ymc-sidebar-width', open ? `${width}px` : `${ACTIVITY_BAR_WIDTH}px`)
    if (open) document.body.setAttribute('data-dsh-ymc-sidebar-open', '')
    else document.body.removeAttribute('data-dsh-ymc-sidebar-open')
    return () => {
      if (document.documentElement.getAttribute('data-dsh-ymc-sidebar-owner') === owner) {
        document.documentElement.style.removeProperty('--dsh-ymc-sidebar-width')
        document.documentElement.removeAttribute('data-dsh-ymc-sidebar-owner')
      }
      document.body.removeAttribute('data-dsh-ymc-sidebar-open')
      document.body.removeAttribute('data-dsh-ymc-sidebar-dragging')
    }
  }, [open, width])

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current }
    panelRef.current?.setAttribute('data-dragging', '')
    document.body.setAttribute('data-dsh-ymc-sidebar-dragging', '')
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const next = clamp(drag.startWidth - (event.clientX - drag.startX), SIDEBAR_MIN, SIDEBAR_MAX)
    if (panelRef.current) panelRef.current.style.width = `${next}px`
    document.documentElement.style.setProperty('--dsh-ymc-sidebar-width', `${next}px`)
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const next = clamp(drag.startWidth - (event.clientX - drag.startX), SIDEBAR_MIN, SIDEBAR_MAX)
    dragRef.current = null
    panelRef.current?.removeAttribute('data-dragging')
    document.body.removeAttribute('data-dsh-ymc-sidebar-dragging')
    setWidth(next)
  }

  const sessionId = sessions.current

  function selectView(next: SidebarView) {
    if (!open || next !== view) {
      setView(next)
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  return (
    <div
      ref={panelRef}
      className={`ymc-sidebar-root${open ? ' ymc-sidebar-open' : ' ymc-sidebar-collapsed'}`}
      style={open ? { width } : undefined}
    >
      {open && (
        <div
          className="ymc-sidebar-drag-handle"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        />
      )}
      <div className="ymc-sidebar-body">
        <div className={`ymc-sidebar-view${open ? '' : ' ymc-sidebar-view-closed'}`}>
          <div className={`ymc-sidebar-view-pane${view === 'explorer' ? '' : ' ymc-sidebar-view-hidden'}`}>
            <FileTreePanel
              api={api}
              sessionId={sessionId}
              sessions={sessions}
              workspaces={workspaces}
            />
          </div>
          <div className={`ymc-sidebar-view-pane${view === 'git' ? '' : ' ymc-sidebar-view-hidden'}`}>
            <GitPanel />
          </div>
        </div>
        <ActivityBar view={view} onSelect={selectView} />
      </div>
    </div>
  )
}
