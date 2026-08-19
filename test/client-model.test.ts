import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  basename,
  clamp,
  flattenTree,
  formatBytes,
  isImagePath,
  isMarkdownPath,
  resolveRoot,
} from '../src/client-model.ts'

test('basename handles windows and posix paths', () => {
  assert.equal(basename('C:\\repo\\demo'), 'demo')
  assert.equal(basename('/home/me/work'), 'work')
  assert.equal(basename('C:\\repo\\demo\\'), 'demo')
  assert.equal(basename('C:\\'), 'C:')
  assert.equal(basename('/'), '')
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

test('resolveRoot prefers session cwd then recent workspace then first workspace', () => {
  const sessions = { byId: { s1: { cwd: 'C:/work/s1' }, s2: {} } }
  const workspaces = {
    items: [
      { workspaceId: 'w1', path: 'C:/work/w1' },
      { workspaceId: 'w2', path: 'C:/work/w2' },
    ],
    recentWorkspaceId: 'w2',
  }
  assert.equal(resolveRoot('s1', sessions, workspaces), 'C:/work/s1')
  assert.equal(resolveRoot('s2', sessions, workspaces), 'C:/work/w2')
  assert.equal(resolveRoot('s2', sessions, { ...workspaces, recentWorkspaceId: undefined }), 'C:/work/w1')
  assert.equal(resolveRoot('s2', sessions, { items: [] }), undefined)
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
