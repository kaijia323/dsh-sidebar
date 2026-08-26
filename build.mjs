import { writeFile, mkdir, copyFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { rolldown } from 'rolldown'

await mkdir('lib', { recursive: true })

const packageJson = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
// DSH's client-modules loader keys bundles by package name; the handoff id
// must match the boot-graph entry id (here the scoped npm package name).
const clientModuleId = packageJson.name

async function buildClientCss() {
  let cliPath
  try {
    const require = createRequire(import.meta.url)
    cliPath = require.resolve('tailwindcss/lib/cli.js')
  } catch {
    console.warn('[build] tailwindcss not available, using fallback client CSS')
    await copyFile('src/client.fallback.css', 'lib/client.css')
    return readFile('lib/client.css', 'utf8')
  }

  try {
    execFileSync(process.execPath, [cliPath, '-i', 'src/client.css', '-o', 'lib/client.css', '--minify'], {
      stdio: 'inherit',
    })
  } catch (error) {
    console.error('[build] Tailwind CSS compilation failed')
    throw error
  }
  return readFile('lib/client.css', 'utf8')
}

const clientCss = await buildClientCss()

const hostBundle = await rolldown({
  input: 'src/index.ts',
  platform: 'node',
  external: (id) => id.startsWith('@deepseek-ai/'),
  treeshake: true,
})
const hostOutput = await hostBundle.generate({ format: 'esm' })
const hostCode = hostOutput.output[0].code
await writeFile('lib/index.js', hostCode + '\n', 'utf8')

const clientBundle = await rolldown({
  input: 'src/client.tsx',
  platform: 'browser',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  treeshake: true,
})
const clientOutput = await clientBundle.generate({ format: 'cjs' })
const clientCode = clientOutput.output[0].code
  .replace('__DSH_KAIJIA_CLIENT_CSS__', JSON.stringify(clientCss))
const clientFactory = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(clientModuleId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${clientCode
      .split('\n')
      .map((line) => '    ' + line)
      .join('\n')}
    return exports;
  },
});
`
await writeFile('lib/client.js', clientFactory, 'utf8')

const hostDts = `import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'

export declare const name: 'dsh-sidebar'
export declare const inject: string[]

export interface Config {
  maxTextBytes: number
  maxImageBytes: number
  maxEntriesPerDirectory: number
  maxTreeRows: number
  watchEnabled: boolean
  watchDebounceMs: number
  watchIgnored: string[]
}

export declare const Config: Schema<Config>

export declare function apply(ctx: Context, config: Config): void
`
await writeFile('lib/index.d.ts', hostDts, 'utf8')

const clientDts = `import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export declare const name: 'dsh-sidebar'
export declare const inject: string[]

export declare function apply(ctx: ClientContext): void
`
await writeFile('lib/client.d.ts', clientDts, 'utf8')

console.log('built lib/index.js and lib/client.js')
