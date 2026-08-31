import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  basename,
  clamp,
  dirname,
  flattenTree,
  formatBytes,
  isHtmlPath,
  isImagePath,
  isMarkdownPath,
  isPathInside,
  resolveRoot,
  toFileBrowserUrl,
  treeInteractionReducer,
} from '../src/client-model.ts'

test('basename handles windows and posix paths', () => {
  assert.equal(basename('C:\\repo\\demo'), 'demo')
  assert.equal(basename('/home/me/work'), 'work')
  assert.equal(basename('C:\\repo\\demo\\'), 'demo')
  assert.equal(basename('C:\\'), 'C:')
  assert.equal(basename('/'), '')
})

test('dirname handles windows and posix paths', () => {
  assert.equal(dirname('C:\\repo\\demo\\a.txt'), 'C:\\repo\\demo')
  assert.equal(dirname('/home/me/work/a.txt'), '/home/me/work')
  assert.equal(dirname('C:\\repo\\demo'), 'C:\\repo')
  assert.equal(dirname('/root'), '/')
})

test('dirname keeps filesystem roots intact', () => {
  assert.equal(dirname('/'), '/')
  assert.equal(dirname('C:\\'), 'C:\\')
  assert.equal(dirname('C:/'), 'C:/')
  assert.equal(dirname('C:\\file.txt'), 'C:\\')
})

test('isPathInside handles equal and descendant paths', () => {
  assert.equal(isPathInside('/repo', '/repo'), true)
  assert.equal(isPathInside('/repo/sub/a.txt', '/repo'), true)
  assert.equal(isPathInside('/repo-other/a.txt', '/repo'), false)
  assert.equal(isPathInside('C:\\repo\\sub', 'C:\\repo'), true)
  assert.equal(isPathInside('C:\\repo-file', 'C:\\repo'), false)
})

test('isPathInside compares mixed windows/posix separators', () => {
  assert.equal(isPathInside('C:\\repo\\sub\\a.txt', 'C:/repo'), true)
  assert.equal(isPathInside('C:/repo/sub/a.txt', 'C:\\repo'), true)
  assert.equal(isPathInside('C:\\repo-file', 'C:/repo'), false)
})

test('formatBytes and clamp', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
})

test('path kind helpers', () => {
  assert.equal(isMarkdownPath('README.md'), true)
  assert.equal(isMarkdownPath('readme.MARKDOWN'), true)
  assert.equal(isMarkdownPath('a.txt'), false)
  assert.equal(isImagePath('photo.PNG'), true)
  assert.equal(isImagePath('photo.svg'), false)
})

test('html path helper identifies html files for browser opening', () => {
  assert.equal(isHtmlPath('index.html'), true)
  assert.equal(isHtmlPath('page.HTM'), true)
  assert.equal(isHtmlPath('dashboard.xhtml'), true)
  assert.equal(isHtmlPath('README.md'), false)
  assert.equal(isHtmlPath('style.css'), false)
})

test('toFileBrowserUrl maps absolute paths to the local file server', () => {
  assert.equal(toFileBrowserUrl('/home/me/project/index.html'), '/dsh-sidebar/files//home/me/project/index.html')
  assert.equal(toFileBrowserUrl('C:\\repo\\demo\\index.html'), '/dsh-sidebar/files/C%3A/repo/demo/index.html')
  assert.equal(toFileBrowserUrl('/has space/a b.html'), '/dsh-sidebar/files//has%20space/a%20b.html')
})

test('resolveRoot prefers session cwd then recent workspace then first workspace', () => {
  const sessions = {
    byId: {
      s1: { cwd: 'C:/work/s1', updatedAt: 100 },
      s2: { cwd: undefined, updatedAt: 200 },
      s3: { cwd: undefined, updatedAt: 50 },
    },
  }
  const workspaces = {
    items: [
      { workspaceId: 'w1', path: 'C:/work/w1', sessionIds: ['s1'], createdAt: '2026-01-01T00:00:00.000Z' },
      { workspaceId: 'w2', path: 'C:/work/w2', sessionIds: ['s2'], createdAt: '2026-01-02T00:00:00.000Z' },
      { workspaceId: 'w3', path: 'C:/work/w3', sessionIds: ['s3'], createdAt: '2026-01-03T00:00:00.000Z' },
    ],
  }
  // A session's own cwd wins before any workspace recency fallback.
  assert.equal(resolveRoot('s1', sessions, workspaces), 'C:/work/s1')
  // DSH 0.1.2 no longer exposes recentWorkspaceId; derive it from the
  // workspace whose sessions were most recently active.
  assert.equal(resolveRoot('s2', sessions, workspaces), 'C:/work/w2')
  assert.equal(resolveRoot('s3', sessions, workspaces), 'C:/work/w2')
  assert.equal(resolveRoot('nope', sessions, workspaces), 'C:/work/w2')
  assert.equal(resolveRoot('s2', sessions, { items: [] }), undefined)

  // Without membership/creation timestamps the first workspace is the fallback.
  const plain = {
    items: [
      { workspaceId: 'w1', path: 'C:/work/w1' },
      { workspaceId: 'w2', path: 'C:/work/w2' },
    ],
  }
  assert.equal(resolveRoot('nope', { byId: {} }, plain), 'C:/work/w1')
})

test('flattenTree stays lazy until a directory is expanded', () => {
  const dirs = {
    root: {
      truncated: false,
      entries: [
        { name: 'a.txt', path: 'root/a.txt', type: 'file' as const },
        { name: 'sub', path: 'root/sub', type: 'directory' as const },
      ],
    },
  }
  const collapsed = flattenTree('root', dirs, new Set(), 100)
  assert.equal(collapsed.rows.length, 1)
  assert.equal(collapsed.rows[0].name, 'root')

  const expanded = flattenTree('root', dirs, new Set(['root']), 100)
  assert.deepEqual(expanded.rows.map((row) => row.name), ['root', 'a.txt', 'sub'])
  assert.deepEqual(expanded.rows.map((row) => row.depth), [0, 1, 1])
})

test('flattenTree respects maxRows and reports truncation', () => {
  const dirs = {
    root: {
      truncated: false,
      entries: [
        { name: 'a', path: 'root/a', type: 'file' as const },
        { name: 'b', path: 'root/b', type: 'file' as const },
        { name: 'c', path: 'root/c', type: 'file' as const },
      ],
    },
  }
  const result = flattenTree('root', dirs, new Set(['root']), 3)
  assert.equal(result.truncated, true)
  assert.equal(result.rows.length, 3)
})

test('flattenTree inserts a note for a truncated directory and breaks cycles', () => {
  const dirs = {
    root: {
      truncated: true,
      entries: [
        { name: 'self', path: 'root', type: 'directory' as const },
        { name: 'a.txt', path: 'root/a.txt', type: 'file' as const },
      ],
    },
  }
  const result = flattenTree('root', dirs, new Set(['root']), 100)
  const names = result.rows.map((row) => row.name)
  assert.ok(names.includes('… 目录内容过多，已截断'))
  // The self-referential directory path is deduplicated instead of looping forever.
  assert.equal(names.filter((name) => name === 'self').length, 0)
})

function treeState(expanded: string[] = [], entering: string[] = [], collapsing: string[] = []) {
  return {
    expanded: new Set(expanded),
    entering: new Set(entering),
    collapsing: new Set(collapsing),
  }
}

test('tree toggle: closed directory starts an expand transition', () => {
  const next = treeInteractionReducer(treeState(), { type: 'toggle', path: '/a' })
  assert.equal(next.expanded.has('/a'), true)
  assert.equal(next.entering.has('/a'), true)
  assert.equal(next.collapsing.has('/a'), false)
})

test('tree toggle: expanding directory switches to collapse in the same atomic update', () => {
  const next = treeInteractionReducer(treeState(['/a'], ['/a']), { type: 'toggle', path: '/a' })
  assert.equal(next.expanded.has('/a'), true)
  assert.equal(next.entering.has('/a'), false)
  assert.equal(next.collapsing.has('/a'), true)
})

test('tree toggle: collapsing directory cancels back to open without losing expanded state', () => {
  const next = treeInteractionReducer(treeState(['/a'], [], ['/a']), { type: 'toggle', path: '/a' })
  assert.equal(next.expanded.has('/a'), true)
  assert.equal(next.entering.has('/a'), false)
  assert.equal(next.collapsing.has('/a'), false)
})

test('tree reducer converges after rapid expand -> collapse -> cancel-collapse clicks', () => {
  let state = treeState()
  state = treeInteractionReducer(state, { type: 'toggle', path: '/a' })
  state = treeInteractionReducer(state, { type: 'toggle', path: '/a' })
  state = treeInteractionReducer(state, { type: 'toggle', path: '/a' })
  assert.equal(state.expanded.has('/a'), true)
  assert.equal(state.entering.has('/a'), false)
  assert.equal(state.collapsing.has('/a'), false)
})

test('tree reducer converges after rapid expand -> collapse -> finishCollapse', () => {
  let state = treeState()
  state = treeInteractionReducer(state, { type: 'toggle', path: '/a' })
  state = treeInteractionReducer(state, { type: 'toggle', path: '/a' })
  state = treeInteractionReducer(state, { type: 'finishCollapse', path: '/a' })
  assert.equal(state.expanded.has('/a'), false)
  assert.equal(state.entering.has('/a'), false)
  assert.equal(state.collapsing.has('/a'), false)
})

test('tree reducer finish actions clear only their own animation phase', () => {
  const expanded = treeInteractionReducer(treeState(['/a'], ['/a']), { type: 'finishExpand', path: '/a' })
  assert.equal(expanded.expanded.has('/a'), true)
  assert.equal(expanded.entering.has('/a'), false)

  const collapsed = treeInteractionReducer(treeState(['/a'], [], ['/a']), { type: 'finishCollapse', path: '/a' })
  assert.equal(collapsed.expanded.has('/a'), false)
  assert.equal(collapsed.collapsing.has('/a'), false)
})
