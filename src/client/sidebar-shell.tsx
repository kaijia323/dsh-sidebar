import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveRoot } from '../client-model'
import { ActivityBar, type SidebarView } from './activity-bar'
import { BrowserPanel } from './browser-panel'
import { ACTIVITY_BAR_WIDTH, SIDEBAR_MIN, SIDEBAR_STORAGE_KEY } from './constants'
import { FileTreePanel } from './file-tree-panel'
import { GitPanel } from './git-panel'
import { loadSidebarOpen, loadSidebarView, loadSidebarWidth, useSnapshotStore } from './hooks'
import type { BrowserOpenRequest, FsApi } from './types'

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
  const [browserRequest, setBrowserRequest] = useState<BrowserOpenRequest | null>(null)
  const browserRequestRef = useRef(0)
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
    const owner = `dsh-sidebar-${Math.random().toString(36).slice(2)}`
    document.documentElement.setAttribute('data-dsh-sidebar-owner', owner)
    document.documentElement.style.setProperty('--dsh-sidebar-width', open ? `${width}px` : `${ACTIVITY_BAR_WIDTH}px`)
    if (open) document.body.setAttribute('data-dsh-sidebar-open', '')
    else document.body.removeAttribute('data-dsh-sidebar-open')
    return () => {
      if (document.documentElement.getAttribute('data-dsh-sidebar-owner') === owner) {
        document.documentElement.style.removeProperty('--dsh-sidebar-width')
        document.documentElement.removeAttribute('data-dsh-sidebar-owner')
      }
      document.body.removeAttribute('data-dsh-sidebar-open')
      document.body.removeAttribute('data-dsh-sidebar-dragging')
    }
  }, [open, width])

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current }
    panelRef.current?.setAttribute('data-dragging', '')
    document.body.setAttribute('data-dsh-sidebar-dragging', '')
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const next = Math.max(SIDEBAR_MIN, drag.startWidth - (event.clientX - drag.startX))
    if (panelRef.current) panelRef.current.style.width = `${next}px`
    document.documentElement.style.setProperty('--dsh-sidebar-width', `${next}px`)
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const next = Math.max(SIDEBAR_MIN, drag.startWidth - (event.clientX - drag.startX))
    dragRef.current = null
    panelRef.current?.removeAttribute('data-dragging')
    document.body.removeAttribute('data-dsh-sidebar-dragging')
    setWidth(next)
  }

  const sessionId = sessions.current
  const root = useMemo(
    () => (sessionId ? resolveRoot(sessionId, sessions, workspaces) : undefined),
    [sessionId, sessions, workspaces],
  )

  function openHtmlInBrowser(path: string) {
    browserRequestRef.current += 1
    setBrowserRequest({ path, id: browserRequestRef.current, nonce: browserRequestRef.current })
    setView('browser')
    setOpen(true)
  }

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
      className={`kaijia-sidebar-root${open ? ' kaijia-sidebar-open' : ' kaijia-sidebar-collapsed'}`}
      style={open ? { width } : undefined}
    >
      {open && (
        <div
          className="kaijia-sidebar-drag-handle"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        />
      )}
      <div className="kaijia-sidebar-body">
        <div className={`kaijia-sidebar-view${open ? '' : ' kaijia-sidebar-view-closed'}`}>
          <div className={`kaijia-sidebar-view-pane${view === 'explorer' ? '' : ' kaijia-sidebar-view-hidden'}`}>
            <FileTreePanel
              api={api}
              sessionId={sessionId}
              sessions={sessions}
              workspaces={workspaces}
              onOpenInBrowser={openHtmlInBrowser}
              onOpenHtml={openHtmlInBrowser}
              onOpenHtmlFile={openHtmlInBrowser}
            />
          </div>
          <div className={`kaijia-sidebar-view-pane${view === 'git' ? '' : ' kaijia-sidebar-view-hidden'}`}>
            <GitPanel api={api} root={root} active={view === 'git'} />
          </div>
          <div className={`kaijia-sidebar-view-pane${view === 'browser' ? '' : ' kaijia-sidebar-view-hidden'}`}>
            <BrowserPanel active={view === 'browser'} openRequest={browserRequest} />
          </div>
        </div>
        <ActivityBar view={view} onSelect={selectView} />
      </div>
    </div>
  )
}
