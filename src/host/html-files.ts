import { readdir, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'
import { domainError } from './result'
import type { SidebarValue } from './types'
import { fsCode, readString } from './utils'

const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml', '.shtml'])
const SKIP_DIRECTORIES = new Set(['node_modules', '.git'])
const MAX_HTML_FILES = 2000
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function isHtmlFile(name: string): boolean {
  return HTML_EXTENSIONS.has(extname(name).toLowerCase())
}

/**
 * Recursively collects HTML files under the current workspace root for the
 * browser panel's quick-open dropdown. Only regular files (and symlinks to
 * regular files) with HTML-like extensions are returned. Generated/vendor
 * directories such as node_modules and .git are skipped so the scan stays
 * quick for normal projects.
 */
export async function handleHtmlFiles(payload: unknown, signal: AbortSignal): Promise<SidebarValue> {
  const root = readString(payload, 'root')
  if (!isAbsolute(root)) {
    return domainError('invalid-path', 'root must be absolute')
  }

  const files: { path: string; name: string; relativePath: string }[] = []
  let truncated = false

  async function walk(directory: string): Promise<void> {
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    if (truncated || files.length >= MAX_HTML_FILES) return

    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' })
    } catch (error) {
      const code = fsCode(error)
      // Missing, unreadable, or permission-denied directories are not fatal for
      // a quick-open picker; the rest of the workspace can still be scanned.
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') return
      throw error
    }

    for (const entry of entries) {
      if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      if (truncated || files.length >= MAX_HTML_FILES) return

      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        await walk(fullPath)
        continue
      }

      if (entry.isFile()) {
        if (isHtmlFile(entry.name)) {
          files.push({
            path: fullPath,
            name: entry.name,
            relativePath: relative(root, fullPath).replace(/\\/g, '/'),
          })
        }
        continue
      }

      if (entry.isSymbolicLink()) {
        try {
          const info = await stat(fullPath)
          if (info.isFile() && isHtmlFile(entry.name)) {
            files.push({
              path: fullPath,
              name: entry.name,
              relativePath: relative(root, fullPath).replace(/\\/g, '/'),
            })
          }
        } catch {
          // Broken or unreadable symlinks are ignored by the quick picker.
        }
      }
    }
  }

  await walk(root)

  if (files.length >= MAX_HTML_FILES) truncated = true
  files.sort((a, b) => NAME_COLLATOR.compare(a.relativePath, b.relativePath))

  return {
    kind: 'html-files',
    root,
    files,
    truncated,
  }
}
