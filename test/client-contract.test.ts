import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('client source always passes a selector to standard snapshot hooks', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /useSessions\s*\(\s*\)/, 'useSessions must receive a selector')
  assert.doesNotMatch(source, /useWorkspaces\s*\(\s*\)/, 'useWorkspaces must receive a selector')
})

test('sidebar mounts as a body sibling instead of taking the native details slot', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.match(source, /document\.body\.appendChild/, 'sidebar host must be appended to document.body')
  assert.match(source, /data-dsh-ymc-sidebar-root/, 'sidebar host must carry a stable marker')
  assert.match(source, /createRoot\(host\)/, 'sidebar must render through its own React root')
  assert.doesNotMatch(source, /name: 'details'/, 'must not register into the native details slot')
  assert.doesNotMatch(source, /shell\.overlay/, 'must not register into shell overlay')
  assert.doesNotMatch(source, /ctx\.layout\.openDetails/, 'must not depend on the native details layout service')
})

test('sidebar keeps its own open state and pushes #root instead of overlaying', async () => {
  const [source, css, fallback] = await Promise.all([
    readFile(new URL('../src/client.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.fallback.css', import.meta.url), 'utf8'),
  ])
  assert.match(source, /--dsh-ymc-sidebar-width/, 'sidebar must drive a layout-push CSS variable')
  assert.match(source, /setOpen/, 'sidebar must own its open/close state')
  assert.match(css + fallback, /#root\s*\{[^}]*margin-right:\s*var\(--dsh-ymc-sidebar-width/, 'root must give up width while the sidebar is open')
  assert.match(css + fallback, /\.ymc-sidebar-root\s*\{[^}]*position:\s*fixed/, 'panel may be fixed as long as root is pushed')
  assert.doesNotMatch(css + fallback, /ymc-overlay-panel|ymc-panel-overlay|ymc-details-toggle/, 'must not keep old overlay/floating panel styles')
})

test('client styles follow DSH alias tokens and use Tailwind entry', async () => {
  const [css, fallback, source] = await Promise.all([
    readFile(new URL('../src/client.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.fallback.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(css, /@tailwind (components|utilities)/, 'client.css must be a Tailwind entry')
  assert.doesNotMatch(css, /@tailwind base/, 'must not inject Tailwind preflight into the DSH host')
  assert.match(css + fallback + source, /--dsw-alias-/, 'styles must consume DSH theme alias tokens')
  assert.doesNotMatch(css + fallback, /--ymc-/, 'custom ymc color palette must not be used')
})

test('client style installer is hot-swap safe (one style element per fiber)', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.match(source, /const element = document\.createElement\('style'\)/, 'installStyles must create a fresh style element')
  assert.doesNotMatch(source, /querySelector\('style\[data-dsh-ymc-sidebar-style\]'\)/, 'installStyles must not steal another fiber\'s style element')
  assert.match(source, /return \(\) => element\.remove\(\)/, 'installStyles must remove only its own element')
})

test('client bundle materializes as a lazy-CJS plugin factory', async () => {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory: ((require: (specifier: string) => unknown) => unknown) | undefined
  const context = {
    window: {
      __ModuleLoader__: {
        load(handoff: { id: string; factory: typeof factory }) {
          assert.equal(handoff.id, 'dsh-ymc-sidebar')
          factory = handoff.factory
        },
      },
    },
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

  assert.equal(plugin.name, 'dsh-ymc-sidebar')
  assert.deepEqual(Array.from(plugin.inject), ['sessions', 'workspaces', 'connection'])
  assert.equal(typeof plugin.apply, 'function')
})
