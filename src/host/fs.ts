import { Buffer } from 'node:buffer'

export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif',
])

export const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export interface SortableEntry {
  name: string
  type: 'file' | 'directory' | 'other'
}

export function sortEntries<T extends SortableEntry>(entries: T[]): T[] {
  const collator = NAME_COLLATOR
  return entries.slice().sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'directory') return -1
      if (b.type === 'directory') return 1
    }
    return collator.compare(a.name, b.name)
  })
}

export function bufferToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}
