import { ChevronRight, File, FileText, Image as ImageIcon } from 'lucide-react'
import { isImagePath, isMarkdownPath } from '../client-model'

export function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className="kaijia-chevron"
      size={12}
      strokeWidth={1.5}
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
      aria-hidden="true"
    />
  )
}

export function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg className="kaijia-icon kaijia-icon-folder" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {open === true
        ? <path d="M1.5 3.5h4l1.5 2h7.5v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        : <path d="M1.5 3.5h4l1.5 2h7.5v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="currentColor" opacity="0.35" />}
    </svg>
  )
}

export function FileIcon({ name }: { name: string }) {
  if (isImagePath(name)) {
    return <ImageIcon className="kaijia-icon kaijia-icon-image" size={14} strokeWidth={1.5} aria-hidden="true" />
  }
  if (isMarkdownPath(name)) {
    return <FileText className="kaijia-icon kaijia-icon-markdown" size={14} strokeWidth={1.5} aria-hidden="true" />
  }
  return <File className="kaijia-icon kaijia-icon-file" size={14} strokeWidth={1.5} aria-hidden="true" />
}
