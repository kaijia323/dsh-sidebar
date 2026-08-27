import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Home, RefreshCw, Search } from 'lucide-react'

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

interface BrowserPanelProps {
  active?: boolean
}

export function BrowserPanel({ active = true }: BrowserPanelProps) {
  const [history, setHistory] = useState<string[]>([HOME])
  const [index, setIndex] = useState(0)
  const [address, setAddress] = useState('')
  const [homeQuery, setHomeQuery] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [hasOpened, setHasOpened] = useState(active)

  useEffect(() => {
    if (active) setHasOpened(true)
  }, [active])

  const current = history[index] ?? HOME
  const isHome = current === HOME

  function pushUrl(url: string) {
    const next = history.slice(0, index + 1)
    next.push(url)
    setHistory(next)
    setIndex(next.length - 1)
    setAddress(url)
    setReloadKey((value) => value + 1)
  }

  function navigateTo(input: string) {
    const url = normalizeUrl(input)
    if (!url) return
    if (url === current && !isHome) {
      setAddress(url)
      reload()
      return
    }
    pushUrl(url)
  }

  function goHome() {
    if (isHome) return
    pushUrl(HOME)
  }

  function goBack() {
    if (index <= 0) return
    const nextIndex = index - 1
    setIndex(nextIndex)
    setAddress(history[nextIndex])
    setReloadKey((value) => value + 1)
  }

  function goForward() {
    if (index >= history.length - 1) return
    const nextIndex = index + 1
    setIndex(nextIndex)
    setAddress(history[nextIndex])
    setReloadKey((value) => value + 1)
  }

  function reload() {
    if (isHome) return
    setReloadKey((value) => value + 1)
  }

  function performSearch(query: string) {
    const trimmed = query.trim()
    if (!trimmed) return
    pushUrl(`${BING_SEARCH}${encodeURIComponent(trimmed)}`)
  }

  function openExternal() {
    if (!isHome && current) window.open(current, '_blank', 'noopener,noreferrer')
  }

  function handleAddressSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = address.trim()
    if (!value) return
    if (isLikelyUrl(value)) navigateTo(value)
    else performSearch(value)
  }

  function handleHomeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = homeQuery.trim()
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
      <form className="kaijia-browser-toolbar" onSubmit={handleAddressSubmit}>
        <button
          type="button"
          className="kaijia-browser-button"
          onClick={goBack}
          disabled={index <= 0}
          title="后退"
          aria-label="后退"
        >
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kaijia-browser-button"
          onClick={goForward}
          disabled={index >= history.length - 1}
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
          value={address}
          onChange={(event) => setAddress(event.target.value)}
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
                value={homeQuery}
                onChange={(event) => setHomeQuery(event.target.value)}
                placeholder="输入关键词，回车搜索"
                spellCheck={false}
                autoComplete="off"
                aria-label="搜索"
              />
              <button type="submit" className="kaijia-browser-home-button">搜索</button>
            </form>
            <p className="kaijia-browser-home-hint">搜索结果由必应提供；也可以在上方地址栏直接输入网址。</p>
          </div>
        ) : hasOpened ? (
          <iframe
            key={reloadKey}
            className="kaijia-browser-iframe"
            src={current}
            title="浏览器面板"
          />
        ) : (
          <div className="kaijia-panel-message">切换到浏览器视图后开始加载页面。</div>
        )}
      </div>
    </div>
  )
}
