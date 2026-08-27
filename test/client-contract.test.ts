import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const CLIENT_SOURCE_DIR = new URL('../src/client/', import.meta.url)

async function readClientSources(): Promise<string> {
  const entry = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const files = await readdir(CLIENT_SOURCE_DIR, { withFileTypes: true })
  const moduleSources = await Promise.all(
    files
      .filter((file) => file.isFile() && /\.(ts|tsx)$/.test(file.name))
      .map((file) => readFile(new URL(file.name, CLIENT_SOURCE_DIR), 'utf8')),
  )
  return [entry, ...moduleSources].join('\n')
}

test('client source always passes a selector to standard snapshot hooks', async () => {
  const source = await readClientSources()
  assert.doesNotMatch(source, /useSessions\s*\(\s*\)/, 'useSessions must receive a selector')
  assert.doesNotMatch(source, /useWorkspaces\s*\(\s*\)/, 'useWorkspaces must receive a selector')
})

test('sidebar mounts as a body sibling instead of taking the native details slot', async () => {
  const source = await readClientSources()
  assert.match(source, /document\.body\.appendChild/, 'sidebar host must be appended to document.body')
  assert.match(source, /data-dsh-sidebar-root/, 'sidebar host must carry a stable marker')
  assert.match(source, /createRoot\(host\)/, 'sidebar must render through its own React root')
  assert.doesNotMatch(source, /name: 'details'/, 'must not register into the native details slot')
  assert.doesNotMatch(source, /shell\.overlay/, 'must not register into shell overlay')
  assert.doesNotMatch(source, /ctx\.layout\.openDetails/, 'must not depend on the native details layout service')
})

test('sidebar keeps its own open state and pushes #root instead of overlaying', async () => {
  const [source, css, fallback] = await Promise.all([
    readClientSources(),
    readFile(new URL('../src/client.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.fallback.css', import.meta.url), 'utf8'),
  ])
  assert.match(source, /--dsh-sidebar-width/, 'sidebar must drive a layout-push CSS variable')
  assert.match(source, /setOpen/, 'sidebar must own its open/close state')
  assert.match(css + fallback, /#root\s*\{[^}]*margin-right:\s*var\(--dsh-sidebar-width/, 'root must give up width while the sidebar is open')
  assert.match(css + fallback, /\.kaijia-sidebar-root\s*\{[^}]*position:\s*fixed/, 'panel may be fixed as long as root is pushed')
  assert.doesNotMatch(css + fallback, /kaijia-overlay-panel|kaijia-panel-overlay|kaijia-details-toggle/, 'must not keep old overlay/floating panel styles')
})

test('client styles follow DSH alias tokens and use Tailwind entry', async () => {
  const [css, fallback, source] = await Promise.all([
    readFile(new URL('../src/client.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.fallback.css', import.meta.url), 'utf8'),
    readClientSources(),
  ])
  assert.match(css, /@tailwind (components|utilities)/, 'client.css must be a Tailwind entry')
  assert.doesNotMatch(css, /@tailwind base/, 'must not inject Tailwind preflight into the DSH host')
  assert.match(css + fallback + source, /--dsw-alias-/, 'styles must consume DSH theme alias tokens')
  assert.doesNotMatch(css + fallback, /--kaijia-/, 'custom color palette must not be used')
})

test('chevron flips in the same render that starts collapse and keeps 200ms rotation', async () => {
  const [source, css, fallback] = await Promise.all([
    readClientSources(),
    readFile(new URL('../src/client.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.fallback.css', import.meta.url), 'utf8'),
  ])
  assert.match(source, /expanded=\{expanded\.has\(row\.path\) && !collapsing\.has\(row\.path\)\}/)
  assert.match(source, /ChevronRight/)
  assert.match(css + fallback, /transition: transform 200ms cubic-bezier\(0\.2, 0, 0, 1\)/)
})

test('rapid directory clicks are throttled slightly beyond the animation duration', async () => {
  const source = await readClientSources()
  assert.match(source, /const TOGGLE_THROTTLE_MS = Math\.max\(ENTER_MS, COLLAPSE_MS\) \+ 50/)
  assert.match(source, /now - lastToggle < TOGGLE_THROTTLE_MS/)
})

test('tree rows use opaque sidebar background so overlapping rows occlude without z-index', async () => {
  const [source, css, fallback] = await Promise.all([
    readClientSources(),
    readFile(new URL('../src/client.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.fallback.css', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(source, /kaijia-tree-row-animating/)
  assert.doesNotMatch(source, /animating=\{enteringKeys\.has\(row\.key\)/)
  assert.match(css + fallback, /\.kaijia-tree-row\s*\{[^}]*background:\s*var\(--dsw-specific-sidebar-fill\)/)
  assert.doesNotMatch(css + fallback, /\.kaijia-tree-row\s*\{[^}]*z-index/)
  assert.doesNotMatch(css + fallback, /\.kaijia-tree-row-animating/)
})

test('sidebar subscribes to file-change SSE and auto-invalidates loaded directories', async () => {
  const source = await readClientSources()
  assert.match(source, /new EventSource\(/, 'sidebar must open an EventSource for file changes')
  assert.match(source, /\/dsh-sidebar\/events/, 'sidebar must subscribe to the plugin SSE channel')
  assert.match(source, /source\.addEventListener\('change'/, 'sidebar must listen to change SSE frames')
  assert.match(source, /setDirs\(/, 'sidebar must invalidate loaded directory snapshots on changes')
  assert.match(source, /setTabs\(/, 'sidebar must refresh the active preview after file changes')
})

test('client style installer is hot-swap safe (one style element per fiber)', async () => {
  const source = await readClientSources()
  assert.match(source, /const element = document\.createElement\('style'\)/, 'installStyles must create a fresh style element')
  assert.doesNotMatch(source, /querySelector\('style\[data-dsh-sidebar-style\]'\)/, 'installStyles must not steal another fiber\'s style element')
  assert.match(source, /return \(\) => element\.remove\(\)/, 'installStyles must remove only its own element')
})

test('sidebar exposes a browser view backed by an iframe', async () => {
  const source = await readClientSources()
  assert.match(source, /'explorer' \| 'git' \| 'browser'/, 'SidebarView must include the browser view')
  assert.match(source, /aria-label="浏览器"/, 'activity bar must include a browser trigger')
  assert.match(source, /<iframe/, 'browser view must render through an iframe')
  assert.match(source, /BrowserPanel active=\{view === 'browser'\}/, 'browser view must know when it is active')
})

test('browser view provides a built-in search homepage that defaults to Bing', async () => {
  const source = await readClientSources()
  assert.match(source, /kaijia-browser-home/, 'browser view must have a built-in search homepage')
  assert.match(source, /performSearch/, 'browser homepage must submit searches')
  assert.match(source, /https:\/\/cn\.bing\.com\/search\?q=/, 'browser homepage must use Bing search')
  assert.match(source, /必应搜索/, 'browser homepage must be labeled as Bing search')
})

test('browser view supports Edge-style new tabs with per-tab history', async () => {
  const source = await readClientSources()
  assert.match(source, /interface BrowserTab/, 'browser panel must model multiple tabs')
  assert.match(source, /function addTab\(\)/, 'browser panel must be able to create a new tab')
  assert.match(source, /function closeTab\(id: number\)/, 'browser panel must be able to close a tab')
  assert.match(source, /新建标签页/, 'browser panel must expose a new-tab action')
  assert.match(source, /kaijia-browser-tab-active/, 'browser panel must mark the active tab')
  assert.match(source, /kaijia-browser-tabs-bar/, 'browser panel must put tabs and new-tab action in a clearly separated bar')
  assert.match(source, /kaijia-browser-new-tab-zone/, 'new-tab action must have its own visually isolated zone')
})

test('browser tab titles use the loaded page title when available', async () => {
  const source = await readClientSources()
  assert.match(source, /contentDocument\?\.title/, 'browser tabs must read document.title from loaded iframes')
  assert.match(source, /onLoad=\{\(event\) => handleFrameLoad\(tab\.id, event\)\}/, 'loaded iframes must update their tab title')
  assert.match(source, /tab\.title/, 'tab rendering must prefer the fetched page title')
  assert.match(source, /title: string/, 'browser tab model must store a page title')
})

test('browser address bar follows the loaded iframe URL when same-origin', async () => {
  const source = await readClientSources()
  assert.match(source, /contentWindow\?\.location\?\.href/, 'browser tabs must read the actual iframe location on load')
  assert.match(source, /address: url \|\| tab\.address/, 'loaded iframes must update the address bar with the actual URL')
  assert.match(source, /popstate/, 'same-origin iframe back/forward navigation must refresh the address bar')
  assert.match(source, /hashchange/, 'same-origin iframe hash navigation must refresh the address bar')
  assert.match(source, /history\.pushState =/, 'same-origin SPA pushState navigation must refresh the address bar')
})

test('selecting an html file routes it to the browser view', async () => {
  const source = await readClientSources()
  assert.match(source, /isHtmlPath/, 'file tree must recognize html files')
  assert.match(source, /onOpenInBrowser/, 'file tree must expose an html-open callback')
  assert.match(source, /setView\('browser'\)/, 'opening an html file must switch to the browser view')
  assert.match(source, /openRequest=\{browserRequest\}/, 'sidebar must forward browser open requests')
  assert.match(source, /toFileBrowserUrl/, 'browser panel must translate file paths into local file URLs')
  assert.match(source, /openHtmlInNewTab\(url\)/, 'browser panel must open local html files in a new tab')
  assert.match(source, /createTab\(url\)/, 'local html tab must start with the file url as its initial history')
})

test('host registers a loopback local file route for html preview', async () => {
  const source = await readFile(new URL('../src/host/local-files.ts', import.meta.url), 'utf8')
  assert.match(source, /\/dsh-sidebar\/files/, 'local files must be served under the plugin file route')
  assert.match(source, /kind: 'prefix'/, 'file serving must use a prefix route so relative assets resolve')
  assert.match(source, /isLoopbackAuthority/, 'file serving must stay loopback-only')
  assert.match(source, /text\/html/, 'html files must be served with an html content type')
})

test('client bundle materializes as a lazy-CJS plugin factory', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory: ((require: (specifier: string) => unknown) => unknown) | undefined
  const context = {
    window: {
      __ModuleLoader__: {
        load(handoff: { id: string; factory: typeof factory }) {
          assert.equal(handoff.id, packageJson.name)
          factory = handoff.factory
        },
      },
    },
    // animejs is a browser animation library; keep the bundle materialization
    // test DOM-free by providing minimal browser global stubs.
    document: {
      addEventListener() {},
      hidden: false,
    },
    requestAnimationFrame: (_callback: FrameRequestCallback) => 0,
    cancelAnimationFrame: (_handle: number) => {},
    console,
  }
  runInNewContext(code, context)
  assert.ok(factory, 'factory must register through window.__ModuleLoader__.load')

  const plugin = factory!((specifier: string) => {
    if (specifier === 'react') {
      return {
        memo: (component: unknown) => component,
        createContext: (defaultValue?: unknown) => ({ Provider: () => null, Consumer: () => null, defaultValue }),
        forwardRef: (render: unknown) => render,
        useMemo: (fn: () => unknown) => fn(),
        useContext: () => ({}),
        useEffect: () => {},
        useRef: () => ({ current: null }),
        useState: (initial: unknown) => [initial, () => {}],
        useCallback: (fn: unknown) => fn,
        Fragment: Symbol('Fragment'),
      }
    }
    if (specifier === 'react/jsx-runtime') return {}
    if (specifier === 'react-dom/client') return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
    throw new Error('unexpected require: ' + specifier)
  }) as { name: string; inject: string[]; apply: (ctx: unknown) => void }

  assert.equal(plugin.name, 'dsh-sidebar')
  assert.deepEqual(Array.from(plugin.inject), ['sessions', 'workspaces', 'connection'])
  assert.equal(typeof plugin.apply, 'function')
})
