import { useState } from 'react'
import { Check, Copy, Download, FileDown } from 'lucide-react'

import { profileWords } from '@/coach/profile'
import { exportFilename, recordToMarkdown } from '@/lib/export-markdown'
import type { DateRecord } from '@/types/date'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md p-2 text-fg-3 transition hover:bg-surface-muted hover:text-fg"
      title="Export everything as markdown"
    >
      <FileDown size={15} />
    </button>
  )
}

/**
 * The whole record as one markdown document, to keep or to paste somewhere else.
 *
 * It shows the text rather than just offering two buttons, and that is the point
 * of the modal existing at all: this is everything the app knows about a person,
 * about to leave it. Seeing it is what makes handing it to another chat a
 * decision rather than a guess — and read-only, because the document is derived,
 * so an edit here would have nowhere to go.
 *
 * Built on render rather than held in state: a rebuild replaces `record`
 * wholesale, and a copy taken on open would quietly hand over the version from
 * before it landed.
 */
export function ExportModal({
  open,
  record,
  onClose,
}: {
  open: boolean
  record: DateRecord
  onClose: () => void
}) {
  // What was copied, not that something was. Same hazard the comment above is
  // about: a run landing mid-tick replaces `record`, `markdown` rebuilds under
  // it, and a boolean would leave the tick asserting that *this* text is on the
  // clipboard when the copied version is already gone.
  const [copied, setCopied] = useState<string | null>(null)
  const markdown = open ? recordToMarkdown(record) : ''
  const isCopied = copied !== null && copied === markdown

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = exportFilename(record)
    link.click()
    // Not revoked inline: the click is synchronous, the read the browser does of
    // the blob behind it is not, and revoking first cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const copy = () => {
    navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(markdown)
        setTimeout(() => setCopied(null), 1600)
      })
      // Rejects when the document isn't focused. Nothing to say about it — the
      // tick doesn't appear, and the text is still on screen to select by hand.
      .catch(() => {})
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      eyebrow="Export"
      title={`Everything about ${record.name || 'them'}, as markdown`}
      footer={
        <>
          <span className="mr-auto text-[12px] text-fg-3">
            {profileWords(markdown)} words · {exportFilename(record)}
          </span>
          <Button variant="secondary" size="sm" onClick={copy}>
            {isCopied ? <Check size={13} className="text-yes" /> : <Copy size={13} />}
            {isCopied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="accent" size="sm" onClick={download}>
            <Download size={13} /> Download
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12px] leading-relaxed text-fg-3">
        The facts, both profiles with what they're based on, the whole conversation, and the
        research notes. Nothing here is sent anywhere — it's built in this tab.
      </p>
      <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-surface-sunken px-3.5 py-3 text-[11.5px] leading-relaxed text-fg-2">
        {markdown}
      </pre>
    </Modal>
  )
}
