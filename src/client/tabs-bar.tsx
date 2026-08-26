import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { FileIcon } from './icons'
import type { SelectedFile } from './types'

interface TabsBarProps {
  tabs: SelectedFile[]
  activePath: string | undefined
  onCloseTab: (path: string) => void
  onSelectTab: (path: string) => void
}

export function TabsBar({ tabs, activePath, onCloseTab, onSelectTab }: TabsBarProps) {
  const [scrolling, setScrolling] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
  }, [])

  function handleScroll() {
    setScrolling(true)
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setScrolling(false), 600)
  }

  return (
    <div
      className={`kaijia-tabs-scroll flex-none overflow-x-auto${scrolling ? ' is-scrolling' : ''}`}
      onScroll={handleScroll}
    >
      <div className="kaijia-tabs inline-flex min-w-full items-stretch">
        {tabs.map((tab) => {
          const active = tab.path === activePath
          return (
            <div
              key={tab.path}
              className={`kaijia-tab group flex h-[30px] max-w-[180px] flex-none cursor-pointer items-center gap-1.5 px-2.5 text-xs whitespace-nowrap select-none${active ? ' kaijia-tab-active' : ''}`}
              onClick={() => onSelectTab(tab.path)}
              title={tab.path}
            >
              <FileIcon name={tab.name} />
              <span className="kaijia-tab-label min-w-0 truncate">{tab.name}</span>
              <button
                type="button"
                className="kaijia-tab-close inline-flex h-4 w-4 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-[var(--dsw-alias-label-tertiary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-primary)]"
                onClick={(event) => {
                  event.stopPropagation()
                  onCloseTab(tab.path)
                }}
                aria-label={`关闭 ${tab.name}`}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
