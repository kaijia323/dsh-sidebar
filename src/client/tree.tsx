import * as React from 'react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { animate } from 'animejs'
import { flattenTree, type DirData, type FlatRow, type SidebarEntry } from '../client-model'
import { COLLAPSE_MS, ENTER_MS, OVERSCAN, TREE_ROW_HEIGHT } from './constants'
import { Chevron, FileIcon, FolderIcon } from './icons'

function isPathInside(path: string, ancestor: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedAncestor = ancestor.replace(/\\/g, '/')
  if (normalizedPath === normalizedAncestor) return false
  const prefix = normalizedAncestor.endsWith('/') ? normalizedAncestor : normalizedAncestor + '/'
  return normalizedPath.startsWith(prefix)
}

interface TreeRowProps {
  row: FlatRow
  expanded: boolean
  loading: boolean
  selected: boolean
  style: CSSProperties
  onToggle: (row: FlatRow) => void
  onSelect: (row: FlatRow) => void
}

const TreeRow = React.memo(function TreeRow({ row, expanded, loading, selected, style, onToggle, onSelect }: TreeRowProps) {
  const padding = 8 + row.depth * 14
  const className = [
    'kaijia-tree-row',
    'flex',
    'items-center',
    'gap-1',
    'select-none',
    'whitespace-nowrap',
    'cursor-pointer',
    row.type === 'directory' ? 'kaijia-tree-dir' : row.type === 'file' ? 'kaijia-tree-file' : 'kaijia-tree-note',
    selected ? 'kaijia-tree-row-selected' : '',
  ].filter(Boolean).join(' ')

  function handleChevron(event: React.MouseEvent) {
    event.stopPropagation()
    onToggle(row)
  }

  return (
    <div
      className={className}
      style={{ ...style, paddingLeft: padding }}
      title={row.path}
      data-dsh-sidebar-row=""
      data-row-key={row.key}
      aria-expanded={row.type === 'directory' ? expanded : undefined}
      onClick={() => {
        if (row.type === 'directory') onToggle(row)
        else if (row.type === 'file') onSelect(row)
      }}
    >
      <span className="kaijia-tree-chevron-slot">
        {row.type === 'directory' && !loading && <span className="kaijia-tree-chevron" onClick={handleChevron}><Chevron open={expanded} /></span>}
        {row.type === 'directory' && loading && <span className="kaijia-tree-spinner" />}
      </span>
      {row.type === 'directory' ? <FolderIcon open={expanded} /> : <FileIcon name={row.name} />}
      <span className="kaijia-tree-label">{row.name}</span>
    </div>
  )
})

interface TreeProps {
  root: string
  dirs: Record<string, DirData>
  expanded: ReadonlySet<string>
  loading: ReadonlySet<string>
  entering: ReadonlySet<string>
  collapsing: ReadonlySet<string>
  selectedPath: string | undefined
  maxRows: number
  onToggle: (path: string) => void
  onSelectFile: (entry: SidebarEntry) => void
  onCollapseEnd: (path: string) => void
  onExpandEnd: (path: string) => void
}

export function Tree({ root, dirs, expanded, loading, entering, collapsing, selectedPath, maxRows, onToggle, onSelectFile, onCollapseEnd, onExpandEnd }: TreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const collapseAnimationsRef = useRef(new Map<string, { revert(): void; cancel(): void }>())
  const expandAnimationsRef = useRef(new Map<string, { revert(): void; cancel(): void }>())
  const [viewport, setViewport] = useState({ top: 0, height: 0 })

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => setViewport((prev) => {
      const height = element.clientHeight
      return prev.height === height ? prev : { ...prev, height }
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const flattened = useMemo(() => flattenTree(root, dirs, expanded, maxRows), [root, dirs, expanded, maxRows])
  const rows = flattened.rows

  const enteringKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows) {
      for (const path of entering) {
        if (isPathInside(row.path, path)) keys.add(row.key)
      }
    }
    return keys
  }, [rows, entering])

  const leavingKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows) {
      for (const path of collapsing) {
        if (isPathInside(row.path, path)) keys.add(row.key)
      }
    }
    return keys
  }, [rows, collapsing])

  useEffect(() => {
    if (collapsing.size === 0) return
    const rowElements = Array.from(document.querySelectorAll<HTMLElement>('[data-dsh-sidebar-row]'))
    const rowByKey = new Map<string, { index: number }>()
    rows.forEach((row, index) => rowByKey.set(row.key, { index }))
    const spacer = spacerRef.current

    for (const path of collapsing) {
      if (collapseAnimationsRef.current.has(path)) continue
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        onCollapseEnd(path)
        continue
      }

      const subtreeIndices: number[] = []
      let lastSubtreeIndex = -1
      for (let index = 0; index < rows.length; index += 1) {
        if (isPathInside(rows[index].path, path)) {
          subtreeIndices.push(index)
          lastSubtreeIndex = index
        }
      }
      if (subtreeIndices.length === 0) {
        onCollapseEnd(path)
        continue
      }

      const removalCount = subtreeIndices.length
      const newHeight = (rows.length - removalCount) * TREE_ROW_HEIGHT

      const childTargets: HTMLElement[] = []
      const afterTargets: Array<{ el: HTMLElement; to: number }> = []
      for (const el of rowElements) {
        const key = el.dataset.rowKey
        if (!key) continue
        const entry = rowByKey.get(key)
        if (!entry) continue
        if (leavingKeys.has(key)) {
          childTargets.push(el)
        } else if (entry.index > lastSubtreeIndex) {
          afterTargets.push({
            el,
            to: (entry.index - removalCount) * TREE_ROW_HEIGHT,
          })
        }
      }

      const animations: Array<ReturnType<typeof animate>> = []
      let remaining = 0
      let settled = false
      const onOneComplete = () => {
        remaining -= 1
        if (remaining <= 0 && !settled) {
          settled = true
          collapseAnimationsRef.current.delete(path)
          onCollapseEnd(path)
        }
      }

      if (childTargets.length > 0) {
        remaining += 1
        animations.push(animate(childTargets, {
          opacity: 0,
          translateY: -6,
          duration: COLLAPSE_MS,
          ease: 'inOutQuad',
          onComplete: onOneComplete,
        }))
      }
      for (const item of afterTargets) {
        remaining += 1
        animations.push(animate(item.el, {
          top: item.to,
          duration: COLLAPSE_MS,
          ease: 'inOutQuad',
          onComplete: onOneComplete,
        }))
      }
      if (spacer) {
        remaining += 1
        animations.push(animate(spacer, {
          height: newHeight,
          duration: COLLAPSE_MS,
          ease: 'inOutQuad',
          onComplete: onOneComplete,
        }))
      }

      if (animations.length === 0) {
        onCollapseEnd(path)
        continue
      }

      collapseAnimationsRef.current.set(path, {
        revert() {
          for (const animation of animations) animation.revert()
        },
        cancel() {
          for (const animation of animations) animation.cancel()
        },
      })
    }
  }, [collapsing, leavingKeys, rows, onCollapseEnd])

  useEffect(() => {
    if (entering.size === 0) return
    const rowElements = Array.from(document.querySelectorAll<HTMLElement>('[data-dsh-sidebar-row]'))
    const rowByKey = new Map<string, { index: number }>()
    rows.forEach((row, index) => rowByKey.set(row.key, { index }))
    const spacer = spacerRef.current

    for (const path of entering) {
      if (expandAnimationsRef.current.has(path)) continue
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        onExpandEnd(path)
        continue
      }

      const subtreeIndices: number[] = []
      let lastSubtreeIndex = -1
      for (let index = 0; index < rows.length; index += 1) {
        if (isPathInside(rows[index].path, path)) {
          subtreeIndices.push(index)
          lastSubtreeIndex = index
        }
      }

      if (subtreeIndices.length === 0) {
        // If the directory has already been loaded and is empty, finish immediately.
        // Otherwise wait for the lazy directory load to populate rows.
        if (dirs[path]) onExpandEnd(path)
        continue
      }

      const addedCount = subtreeIndices.length
      const oldHeight = (rows.length - addedCount) * TREE_ROW_HEIGHT
      const newHeight = rows.length * TREE_ROW_HEIGHT

      const childTargets: HTMLElement[] = []
      const afterTargets: Array<{ el: HTMLElement; from: number; to: number }> = []
      for (const el of rowElements) {
        const key = el.dataset.rowKey
        if (!key) continue
        const entry = rowByKey.get(key)
        if (!entry) continue
        if (enteringKeys.has(key)) {
          childTargets.push(el)
        } else if (entry.index > lastSubtreeIndex) {
          afterTargets.push({
            el,
            from: (entry.index - addedCount) * TREE_ROW_HEIGHT,
            to: entry.index * TREE_ROW_HEIGHT,
          })
        }
      }

      const animations: Array<ReturnType<typeof animate>> = []
      let remaining = 0
      let settled = false
      const onOneComplete = () => {
        remaining -= 1
        if (remaining <= 0 && !settled) {
          settled = true
          expandAnimationsRef.current.delete(path)
          onExpandEnd(path)
        }
      }

      if (childTargets.length > 0) {
        remaining += 1
        animations.push(animate(childTargets, {
          opacity: [0, 1],
          translateY: [-6, 0],
          duration: ENTER_MS,
          ease: 'outQuad',
          onComplete: onOneComplete,
        }))
      }
      for (const item of afterTargets) {
        remaining += 1
        animations.push(animate(item.el, {
          top: [item.from, item.to],
          duration: ENTER_MS,
          ease: 'outQuad',
          onComplete: onOneComplete,
        }))
      }
      if (spacer) {
        remaining += 1
        animations.push(animate(spacer, {
          height: [oldHeight, newHeight],
          duration: ENTER_MS,
          ease: 'outQuad',
          onComplete: onOneComplete,
        }))
      }

      if (animations.length === 0) {
        onExpandEnd(path)
        continue
      }

      expandAnimationsRef.current.set(path, {
        revert() {
          for (const animation of animations) animation.revert()
        },
        cancel() {
          for (const animation of animations) animation.cancel()
        },
      })
    }
  }, [entering, enteringKeys, rows, dirs, onExpandEnd])

  useEffect(() => {
    for (const [path, animation] of expandAnimationsRef.current) {
      if (!entering.has(path)) {
        // If a collapse is taking over, freeze the expand at its current visual
        // state so the collapse animation can continue smoothly from there.
        // Otherwise revert to the stable pre-expand state.
        if (collapsing.has(path)) animation.cancel()
        else animation.revert()
        expandAnimationsRef.current.delete(path)
      }
    }
  }, [entering, collapsing])

  useEffect(() => {
    for (const [path, animation] of collapseAnimationsRef.current) {
      if (!collapsing.has(path)) {
        animation.revert()
        collapseAnimationsRef.current.delete(path)
      }
    }
  }, [collapsing])

  useEffect(() => () => {
    for (const animation of collapseAnimationsRef.current.values()) animation.revert()
    collapseAnimationsRef.current.clear()
    for (const animation of expandAnimationsRef.current.values()) animation.revert()
    expandAnimationsRef.current.clear()
  }, [])

  const start = Math.max(0, Math.floor(viewport.top / TREE_ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / TREE_ROW_HEIGHT) + OVERSCAN)

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop
    setViewport((prev) => (Math.abs(prev.top - top) < TREE_ROW_HEIGHT ? prev : { ...prev, top }))
  }

  function handleToggle(path: string) {
    onToggle(path)
  }

  const visible: ReactNode[] = []
  for (let index = start; index < end; index += 1) {
    const row = rows[index]
    visible.push(
      <TreeRow
        key={row.key}
        row={row}
        expanded={expanded.has(row.path) && !collapsing.has(row.path)}
        loading={loading.has(row.path)}
        selected={selectedPath === row.path}
        onToggle={(target) => handleToggle(target.path)}
        onSelect={(target) => onSelectFile({ name: target.name, path: target.path, type: target.type })}
        style={{ top: index * TREE_ROW_HEIGHT } as CSSProperties}
      />,
    )
  }

  return (
    <div className="kaijia-tree-scroll relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={onScroll}>
      {rows.length === 0
        ? <div className="kaijia-tree-empty flex h-full flex-col items-center justify-center">空目录</div>
        : (
            <div ref={spacerRef} className="kaijia-tree-spacer relative min-w-full" style={{ height: rows.length * TREE_ROW_HEIGHT }}>
              {visible}
            </div>
          )}
      {flattened.truncated && <div className="kaijia-tree-truncated">树已截断（超过 {maxRows} 行）</div>}
    </div>
  )
}
