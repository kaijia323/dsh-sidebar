import { createElement, type ReactNode } from 'react'

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g
  let cursor = 0
  let index = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const [token, code, bold, italic, link] = match
    const key = `${keyPrefix}-i${index++}`
    if (code !== undefined) {
      nodes.push(<code key={key} className="kaijia-md-code">{code.slice(1, -1)}</code>)
    } else if (bold !== undefined) {
      nodes.push(<strong key={key}>{bold.slice(2, -2)}</strong>)
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{italic.slice(1, -1)}</em>)
    } else if (link !== undefined) {
      const open = link.indexOf('](')
      const label = link.slice(1, open)
      const href = link.slice(open + 2, -1)
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noreferrer">{label}</a>,
      )
    } else {
      nodes.push(token)
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function MarkdownView({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: ReactNode[] = []

  function flushList(key: number) {
    if (listItems.length === 0) return
    if (listType === 'ol') blocks.push(<ol key={`list-${key}`}>{listItems}</ol>)
    else blocks.push(<ul key={`list-${key}`}>{listItems}</ul>)
    listItems = []
    listType = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^```/.test(line)) {
      flushList(index)
      const fence: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        fence.push(lines[index])
        index += 1
      }
      blocks.push(
        <pre key={`code-${index}`} className="kaijia-md-pre"><code>{fence.join('\n')}</code></pre>,
      )
      continue
    }
    if (/^\s*$/.test(line)) {
      flushList(index)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList(index)
      const level = heading[1].length
      const content = renderInline(heading[2], `h${index}`)
      blocks.push(createElement(`h${level}`, { key: `h-${index}`, className: 'kaijia-md-heading' }, content))
      continue
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushList(index)
      blocks.push(<hr key={`hr-${index}`} className="kaijia-md-hr" />)
      continue
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (unordered) {
      if (listType !== 'ul') {
        flushList(index)
        listType = 'ul'
      }
      listItems.push(<li key={`li-${index}`}>{renderInline(unordered[1], `u${index}`)}</li>)
      continue
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      if (listType !== 'ol') {
        flushList(index)
        listType = 'ol'
      }
      listItems.push(<li key={`li-${index}`}>{renderInline(ordered[1], `o${index}`)}</li>)
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flushList(index)
      blocks.push(
        <blockquote key={`q-${index}`} className="kaijia-md-quote">{renderInline(quote[1], `q${index}`)}</blockquote>,
      )
      continue
    }
    flushList(index)
    blocks.push(<p key={`p-${index}`} className="kaijia-md-paragraph">{renderInline(line, `p${index}`)}</p>)
  }
  flushList(lines.length)
  return <div className="kaijia-markdown mx-auto max-w-[760px] p-3 leading-relaxed">{blocks}</div>
}
