import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Home, Plus, RefreshCw, Search, X } from 'lucide-react'

const HOME = ''
const BING_SEARCH = 'https://cn.bing.com/search?q='

function isLikelyUrl(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  if (/^https?:\/\//i.test(value) || /^about:/i.test(value) || /^data:/i.test(value) || /^\/\//.test(value)) return true
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#].*)?$/i.test(value)) return true
  // A hostname/path without spaces is treated as a URL; plain words are searches.
  return !/\s/.test(value) && /[./]/.test(value)
}

function normalizeUrl(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value) || /^about:/i.test(value) || /^data:/i.test(value)) return value
  if (/^\/\//.test(value)) return `https:${value}`
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#].*)?$/i.test(value)) return `http://${value}`
  return `https://${value}`
}

function tabTitle(tab: BrowserTab): string {
  const url = tab.history[tab.index] ?? HOME
  if (!url) return '新标签页'
  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  } catch {
    return url
  }
}

interface BrowserTab {
  id: number
  history: string[]
  index: number
  address: string
  homeQuery: string
  reloadKey: number
}

interface BrowserPanelProps {
  active?: boolean
}

export function BrowserPanel({ active = true }: BrowserPanelProps) {
  const nextIdRef = useRef(1)
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createTab()])
  const [activeId, setActiveId] = useState<number>(() => tabs[0]?.id ?? 1)
  const [hasOpened, setHasOpened] = useState(active)

  useEffect(() => {
    if (active) setHasOpened(true)
  }, [active])

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1]

  function createTab(): BrowserTab {
    const id = nextIdRef.current
    nextIdRef.current += 1
    return {
      id,
      history: [HOME],
      index: 0,
      address: '',
      homeQuery: '',
      reloadKey: 0,
    }
  }

  function updateTab(id: number, updater: (tab: BrowserTab) => BrowserTab) {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? updater(tab) : tab)))
  }

  const current = activeTab ? activeTab.history[activeTab.index] ?? HOME : HOME
  const isHome = current === HOME

  function pushUrl(url: string) {
    if (!activeTab) return
    updateTab(activeTab.id, (tab) => {
      const history = tab.history.slice(0, tab.index + 1)
      history.push(url)
      return {
        ...tab,
        history,
        index: history.length - 1,
        address: url,
        reloadKey: tab.reloadKey + 1,
      }
    })
  }

  function navigateTo(input: string) {
    const url = normalizeUrl(input)
    if (!url || !activeTab) return
    if (url === current && !isHome) {
      updateTab(activeTab.id, (tab) => ({ ...tab, address: url }))
      reload()
      return
    }
    pushUrl(url)
  }

  function goHome() {
    if (!activeTab || isHome) return
    updateTab(activeTab.id, (tab) => {
      const history = tab.history.slice(0, tab.index + 1)
      history.push(HOME)
      return {
        ...tab,
        history,
        index: history.length - 1,
        address: '',
        reloadKey: tab.reloadKey + 1,
      }
    })
  }

  function goBack() {
    if (!activeTab || activeTab.index <= 0) return
    const nextIndex = activeTab.index - 1
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      index: nextIndex,
      address: tab.history[nextIndex],
      reloadKey: tab.reloadKey + 1,
    }))
  }

  function goForward() {
    if (!activeTab || activeTab.index >= activeTab.history.length - 1) return
    const nextIndex = activeTab.index + 1
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      index: nextIndex,
      address: tab.history[nextIndex],
      reloadKey: tab.reloadKey + 1,
    }))
  }

  function reload() {
    if (!activeTab || isHome) return
    updateTab(activeTab.id, (tab) => ({ ...tab, reloadKey: tab.reloadKey + 1 }))
  }

  function performSearch(query: string) {
    const trimmed = query.trim()
    if (!trimmed) return
    pushUrl(`${BING_SEARCH}${encodeURIComponent(trimmed)}`)
  }

  function openExternal() {
    if (!isHome && current) window.open(current, '_blank', 'noopener,noreferrer')
  }

  function addTab() {
    const tab = createTab()
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }

  function closeTab(id: number) {
    if (tabs.length <= 1) {
      const tab = createTab()
      setTabs([tab])
      setActiveId(tab.id)
      return
    }
    const closingIndex = tabs.findIndex((tab) => tab.id === id)
    if (closingIndex < 0) return
    const nextTabs = tabs.filter((tab) => tab.id !== id)
    setTabs(nextTabs)
    if (activeId === id) {
      const fallback = nextTabs[Math.min(closingIndex, nextTabs.length - 1)] ?? nextTabs[nextTabs.length - 1]
      if (fallback) setActiveId(fallback.id)
    }
  }

  function handleAddressSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = (activeTab?.address ?? '').trim()
    if (!value) return
    if (isLikelyUrl(value)) navigateTo(value)
    else performSearch(value)
  }

  function handleHomeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = (activeTab?.homeQuery ?? '').trim()
    if (!value) return
    if (isLikelyUrl(value)) navigateTo(value)
    else performSearch(value)
  }

  return (
    <div className="kaijia-panel">
      <div className="kaijia-panel-header">
        <Globe className="kaijia-panel-title-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="kaijia-panel-title whitespace-nowrap">浏览器</span>
      </div>
      <div className="kaijia-browser-tabs-bar">
        <div className="kaijia-browser-tabs-scroll">
          <div className="kaijia-browser-tabs" role="tablist">
            {tabs.map((tab) => {
              const isActive = tab.id === activeId
              return (
                <div
                  key={tab.id}
                  className={`kaijia-browser-tab${isActive ? ' kaijia-browser-tab-active' : ''}`}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveId(tab.id)}
                  title={tabTitle(tab)}
                >
                  <span className="kaijia-browser-tab-label">{tabTitle(tab)}</span>
                  <button
                    type="button"
                    className="kaijia-browser-tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(tab.id)
                    }}
                    aria-label={`关闭 ${tabTitle(tab)}`}
                  >
                    <X size={13} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div className="kaijia-browser-new-tab-zone">
          <button
            type="button"
            className="kaijia-browser-new-tab"
            onClick={addTab}
            title="新建标签页"
            aria-label="新建标签页"
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <form className="kaijia-browser-toolbar" onSubmit={handleAddressSubmit}>
        <button
          type="button"
          className="kaijia-browser-button"
          onClick={goBack}
          disabled={!activeTab || activeTab.index <= 0}
          title="后退"
          aria-label="后退"
        >
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kaijia-browser-button"
          onClick={goForward}
          disabled={!activeTab || activeTab.index >= activeTab.history.length - 1}
          title="前进"
          aria-label="前进"
        >
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kaijia-browser-button"
          onClick={reload}
          disabled={isHome}
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kaijia-browser-button"
          onClick={goHome}
          title="主页"
          aria-label="主页"
        >
          <Home size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <input
          className="kaijia-browser-address"
          value={activeTab?.address ?? ''}
          onChange={(event) => {
            if (!activeTab) return
            updateTab(activeTab.id, (tab) => ({ ...tab, address: event.target.value }))
          }}
          placeholder="搜索或输入网址"
          spellCheck={false}
          autoComplete="off"
          aria-label="搜索或输入网址"
        />
        <button type="submit" hidden aria-hidden="true" />
        <button
          type="button"
          className="kaijia-browser-button"
          onClick={openExternal}
          disabled={isHome}
          title="在新标签页打开"
          aria-label="在新标签页打开"
        >
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </form>
      <div className="kaijia-browser-frame">
        {hasOpened && tabs.map((tab) => {
          const current = tab.history[tab.index] ?? HOME
          if (!current) return null
          const isActive = tab.id === activeId
          return (
            <iframe
              key={`${tab.id}:${tab.reloadKey}`}
              className={`kaijia-browser-iframe${isActive ? '' : ' kaijia-browser-iframe-hidden'}`}
              src={current}
              title="浏览器面板"
            />
          )
        })}
        {isHome ? (
          <div className="kaijia-browser-home">
            <div className="kaijia-browser-home-mark" aria-hidden="true">
              <Search size={20} strokeWidth={1.5} />
            </div>
            <div className="kaijia-browser-home-title">必应搜索</div>
            <form className="kaijia-browser-home-form" onSubmit={handleHomeSubmit}>
              <Search className="kaijia-browser-home-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
              <input
                className="kaijia-browser-home-input"
                value={activeTab?.homeQuery ?? ''}
                onChange={(event) => {
                  if (!activeTab) return
                  updateTab(activeTab.id, (tab) => ({ ...tab, homeQuery: event.target.value }))
                }}
                placeholder="输入关键词，回车搜索"
                spellCheck={false}
                autoComplete="off"
                aria-label="搜索"
              />
              <button type="submit" className="kaijia-browser-home-button">搜索</button>
            </form>
            <p className="kaijia-browser-home-hint">搜索结果由必应提供；也可以在上方地址栏直接输入网址。</p>
          </div>
        ) : hasOpened ? null : (
          <div className="kaijia-panel-message">切换到浏览器视图后开始加载页面。</div>
        )}
      </div>
    </div>
  )
}
