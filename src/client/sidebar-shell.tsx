import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { clamp } from '../client-model'
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_STORAGE_KEY } from './constants'
import { FileTreePanel } from './file-tree-panel'
import { loadSidebarOpen, loadSidebarWidth, useSnapshotStore } from './hooks'
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
    // HMR overlap safety: only the fiber that last wrote the CSS variable is
    // allowed to remove it. An old fiber's disposer must not delete the new
    // fiber's live layout push.
    const owner = `dsh-ymc-sidebar-${Math.random().toString(36).slice(2)}`
    document.documentElement.setAttribute('data-dsh-ymc-sidebar-owner', owner)
    document.documentElement.style.setProperty('--dsh-ymc-sidebar-width', open ? `${width}px` : '0px')
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

  return (
    <>
      {!open && (
        <button
          type="button"
          className="ymc-sidebar-toggle"
          aria-label="打开文件树"
          title="打开文件树"
          onClick={() => setOpen(true)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 3.5h4l1.5 2h7.5v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      )}
      {open && (
        <div
          ref={panelRef}
          className="ymc-sidebar-root"
          style={{ width }}
        >
          <div
            className="ymc-sidebar-drag-handle"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
          />
          <div className="ymc-sidebar-body">
            <FileTreePanel
              api={api}
              sessionId={sessionId}
              sessions={sessions}
              workspaces={workspaces}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  )
}
