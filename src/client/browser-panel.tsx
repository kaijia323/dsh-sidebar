import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Home, Plus, RefreshCw, Search, X } from 'lucide-react'
import { toFileBrowserUrl } from '../client-model'
import { isDomainError } from './api'
import { Chevron, FileIcon, FolderIcon } from './icons'
import type { BrowserOpenRequest, FsApi, HtmlFileEntry } from './types'

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
  if (/^\/(?!\/)/.test(value)) return value
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#].*)?$/i.test(value)) return `http://${value}`
  return `https://${value}`
}

function tabTitle(tab: BrowserTab): string {
  if (tab.title?.trim()) return tab.title.trim()
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
  frameUrl: string
  homeQuery: string
  reloadKey: number
  title: string
}

interface HtmlTreeNode {
  key: string
  name: string
  relativePath: string
  path: string
  type: 'directory' | 'file'
  children: HtmlTreeNode[]
}

const HTML_TREE_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function buildHtmlTree(files: HtmlFileEntry[]): HtmlTreeNode[] {
  const roots: HtmlTreeNode[] = []
  const byPath = new Map<string, HtmlTreeNode>()

  function ensureDirectory(relativePath: string, name: string): HtmlTreeNode {
    const existing = byPath.get(relativePath)
    if (existing) return existing
    const node: HtmlTreeNode = {
      key: relativePath,
      name,
      relativePath,
      path: '',
      type: 'directory',
      children: [],
    }
    byPath.set(relativePath, node)
    return node
  }

  for (const file of files) {
    const parts = file.relativePath.split('/')
    let parent: HtmlTreeNode[] = roots
    let current = ''
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index]
      current = current ? `${current}/${part}` : part
      let directory = byPath.get(current)
      if (!directory) {
        directory = ensureDirectory(current, part)
        parent.push(directory)
      }
      parent = directory.children
    }
    const name = parts[parts.length - 1] ?? file.name
    parent.push({
      key: file.relativePath,
      name,
      relativePath: file.relativePath,
      path: file.path,
      type: 'file',
      children: [],
    })
  }

  function sortNodes(nodes: HtmlTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return HTML_TREE_COLLATOR.compare(a.name, b.name)
    })
    for (const node of nodes) sortNodes(node.children)
  }
  sortNodes(roots)

  return roots
}

interface BrowserPanelProps {
  active?: boolean
  openRequest?: BrowserOpenRequest | null
  root?: string
  api?: FsApi
}

export function BrowserPanel({ active = true, openRequest = null, root, api }: BrowserPanelProps) {
  const nextIdRef = useRef(1)
  const lastOpenRequestRef = useRef<number | null>(null)
  const htmlRootRef = useRef<string | undefined>(undefined)
  const htmlPickerRef = useRef<HTMLDivElement>(null)
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createTab()])
  const [activeId, setActiveId] = useState<number>(() => tabs[0]?.id ?? 1)
  const [hasOpened, setHasOpened] = useState(active)
  const [htmlFiles, setHtmlFiles] = useState<HtmlFileEntry[]>([])
  const [htmlLoading, setHtmlLoading] = useState(false)
  const [htmlError, setHtmlError] = useState<string | null>(null)
  const [htmlTruncated, setHtmlTruncated] = useState(false)
  const [htmlRefreshKey, setHtmlRefreshKey] = useState(0)
  const [htmlPickerOpen, setHtmlPickerOpen] = useState(false)
  const [htmlExpanded, setHtmlExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const htmlTree = useMemo(() => buildHtmlTree(htmlFiles), [htmlFiles])

  useEffect(() => {
    if (active) setHasOpened(true)
  }, [active])

  useEffect(() => {
    if (!root || !api || (!active && !hasOpened)) return
    const controller = new AbortController()
    if (htmlRootRef.current !== root) {
      htmlRootRef.current = root
      setHtmlFiles([])
      setHtmlError(null)
      setHtmlTruncated(false)
      setHtmlExpanded(new Set())
      setHtmlPickerOpen(false)
    }
    setHtmlError(null)
    setHtmlTruncated(false)
    setHtmlLoading(true)
    api.htmlFiles(root, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        if (isDomainError(value)) {
          setHtmlError(value.message)
          setHtmlTruncated(false)
        } else {
          setHtmlFiles(value.files)
          setHtmlTruncated(value.truncated)
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setHtmlError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setHtmlLoading(false)
      })
    return () => controller.abort()
  }, [root, api, active, hasOpened, htmlRefreshKey])

  useEffect(() => {
    if (!htmlPickerOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (htmlPickerRef.current && !htmlPickerRef.current.contains(event.target as Node)) {
        setHtmlPickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [htmlPickerOpen])

  useEffect(() => {
    if (!openRequest) return
    if (lastOpenRequestRef.current === openRequest.id) return
    lastOpenRequestRef.current = openRequest.id
    setHasOpened(true)
    const path = toFileBrowserUrl(openRequest.path)
    const url = new URL(path, window.location.href).href
    openHtmlInNewTab(url)
  }, [openRequest?.id, openRequest?.nonce])

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1]

  function createTab(initialUrl = HOME): BrowserTab {
    const id = nextIdRef.current
    nextIdRef.current += 1
    return {
      id,
      history: [initialUrl],
      index: 0,
      address: initialUrl === HOME ? '' : initialUrl,
      frameUrl: initialUrl === HOME ? '' : initialUrl,
      homeQuery: '',
      reloadKey: 0,
      title: '',
    }
  }

  function updateTab(id: number, updater: (tab: BrowserTab) => BrowserTab) {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? updater(tab) : tab)))
  }

  function syncTabFromFrame(tabId: number, frame: HTMLIFrameElement) {
    let url = ''
    let title = ''
    try {
      url = frame.contentWindow?.location?.href ?? ''
    } catch {
      // Cross-origin iframes do not expose their location; keep the address bar as-is.
    }
    try {
      title = frame.contentDocument?.title?.trim() ?? ''
    } catch {
      // Cross-origin iframes do not expose their document; keep the URL fallback.
    }

    updateTab(tabId, (tab) => {
      const current = tab.history[tab.index] ?? HOME
      if (url && url !== current) {
        const history = tab.history.slice(0, tab.index + 1)
        history.push(url)
        return {
          ...tab,
          history,
          index: history.length - 1,
          address: url,
          title: title || tab.title,
        }
      }
      return {
        ...tab,
        address: url || tab.address,
        title: title || tab.title,
      }
    })
  }

  function watchFrameNavigation(tabId: number, frame: HTMLIFrameElement) {
    let win: Window
    try {
      win = frame.contentWindow!
      // Accessing href both confirms same-origin access and primes the sync.
      void win.location.href
    } catch {
      return
    }

    const marker = '__dshSidebarLocationSync'
    const tagged = win as Window & { [marker]?: boolean }
    if (tagged[marker]) return
    tagged[marker] = true

    const sync = () => syncTabFromFrame(tabId, frame)
    win.addEventListener('popstate', sync)
    win.addEventListener('hashchange', sync)

    const history = win.history
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState
    history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = originalPushState.apply(this, args)
      sync()
      return result
    }
    history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
      const result = originalReplaceState.apply(this, args)
      sync()
      return result
    }
  }

  function handleFrameLoad(tabId: number, event: SyntheticEvent<HTMLIFrameElement>) {
    syncTabFromFrame(tabId, event.currentTarget)
    watchFrameNavigation(tabId, event.currentTarget)
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
        frameUrl: url,
        reloadKey: tab.reloadKey + 1,
        title: '',
      }
    })
  }

  function navigateTo(input: string) {
    const url = normalizeUrl(input)
    if (!url || !activeTab) return
    if (url === current && !isHome) {
      updateTab(activeTab.id, (tab) => ({ ...tab, address: url, title: '' }))
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
        frameUrl: HOME,
        reloadKey: tab.reloadKey + 1,
        title: '',
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
      frameUrl: tab.history[nextIndex],
      reloadKey: tab.reloadKey + 1,
      title: '',
    }))
  }

  function goForward() {
    if (!activeTab || activeTab.index >= activeTab.history.length - 1) return
    const nextIndex = activeTab.index + 1
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      index: nextIndex,
      address: tab.history[nextIndex],
      frameUrl: tab.history[nextIndex],
      reloadKey: tab.reloadKey + 1,
      title: '',
    }))
  }

  function reload() {
    if (!activeTab || isHome) return
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      frameUrl: tab.history[tab.index] ?? HOME,
      reloadKey: tab.reloadKey + 1,
      title: '',
    }))
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

  function openHtmlInNewTab(url: string) {
    const tab = createTab(url)
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

  function toggleHtmlPicker() {
    setHtmlPickerOpen((open) => !open)
  }

  function toggleHtmlDirectory(key: string) {
    setHtmlExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openHtmlFile(path: string) {
    if (!path) return
    const url = toFileBrowserUrl(path)
    openHtmlInNewTab(url)
    setHtmlPickerOpen(false)
  }

  function renderHtmlNodes(nodes: HtmlTreeNode[], depth: number): ReactNode[] {
    return nodes.flatMap((node) => {
      const style = { paddingLeft: 8 + depth * 14 }
      if (node.type === 'directory') {
        const isOpen = htmlExpanded.has(node.relativePath)
        const rows = [
          <div
            key={`dir:${node.relativePath}`}
            className="kaijia-browser-html-tree-row kaijia-browser-html-tree-row-dir"
            style={style}
            onClick={() => toggleHtmlDirectory(node.relativePath)}
            title={node.relativePath}
            role="button"
            aria-expanded={isOpen}
          >
            <span className="kaijia-browser-html-tree-chevron"><Chevron open={isOpen} /></span>
            <FolderIcon open={isOpen} />
            <span className="kaijia-browser-html-tree-label">{node.name}</span>
          </div>,
        ]
        if (isOpen) rows.push(...renderHtmlNodes(node.children, depth + 1))
        return rows
      }
      return [(
        <div
          key={`file:${node.relativePath}`}
          className="kaijia-browser-html-tree-row kaijia-browser-html-tree-row-file"
          style={style}
          onClick={() => openHtmlFile(node.path)}
          title={node.relativePath}
          role="button"
        >
          <span className="kaijia-browser-html-tree-spacer" />
          <FileIcon name={node.name} />
          <span className="kaijia-browser-html-tree-label">{node.name}</span>
        </div>
      )]
    })
  }

  return (
    <div className="kaijia-panel">
      <div className="kaijia-browser-html-picker" ref={htmlPickerRef}>
        <div className="kaijia-panel-header">
          <Globe className="kaijia-panel-title-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="kaijia-panel-title whitespace-nowrap">浏览器</span>
          <button
            type="button"
            className="kaijia-browser-html-button ml-auto"
            onClick={toggleHtmlPicker}
            disabled={!root}
            title={htmlError ? `扫描失败：${htmlError}` : '打开工作区中的 HTML 文件'}
            aria-expanded={htmlPickerOpen}
            aria-label="打开工作区中的 HTML 文件"
          >
            <FolderIcon open={htmlPickerOpen} />
            <span>HTML</span>
            <Chevron open={htmlPickerOpen} />
          </button>
        </div>
        {htmlPickerOpen && (
          <div className="kaijia-browser-html-menu">
            <div className="kaijia-browser-html-menu-header">
              <span className="kaijia-browser-html-menu-title">
                {htmlLoading ? '正在扫描 HTML…' : htmlError ? `扫描失败：${htmlError}` : `工作区 HTML${htmlTruncated ? '（已截断）' : ''}`}
              </span>
              <button
                type="button"
                className="kaijia-browser-html-menu-refresh"
                onClick={() => setHtmlRefreshKey((key) => key + 1)}
                disabled={!root || htmlLoading}
                title="重新扫描工作区 HTML"
                aria-label="重新扫描工作区 HTML"
              >
                <RefreshCw size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="kaijia-browser-html-tree">
              {htmlLoading && htmlTree.length === 0 ? (
                <div className="kaijia-browser-html-tree-message">正在扫描工作区 HTML…</div>
              ) : htmlError && htmlTree.length === 0 ? (
                <div className="kaijia-browser-html-tree-message">扫描失败，请点击刷新重试。</div>
              ) : htmlTree.length === 0 ? (
                <div className="kaijia-browser-html-tree-message">当前工作区未找到 HTML 文件。</div>
              ) : renderHtmlNodes(htmlTree, 0)}
            </div>
          </div>
        )}
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
          const frameUrl = tab.frameUrl
          if (!frameUrl) return null
          const isActive = tab.id === activeId
          return (
            <iframe
              key={`${tab.id}:${tab.reloadKey}`}
              className={`kaijia-browser-iframe${isActive ? '' : ' kaijia-browser-iframe-hidden'}`}
              src={frameUrl}
              title="浏览器面板"
              onLoad={(event) => handleFrameLoad(tab.id, event)}
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
