import { useState } from 'react'
import { useThemeStore } from '../../../store/themeStore'
import { useToastStore } from '../../../store/toastStore'
import type { PlanContent } from '../../../lib/api-types'

interface PlanJsonViewerProps {
  content: PlanContent
}

export default function PlanJsonViewer({ content }: PlanJsonViewerProps) {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'
  const [copied, setCopied] = useState(false)

  const jsonString = JSON.stringify(content, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopied(true)
      addToast({ message: 'JSON copied to clipboard', type: 'success' })
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      addToast({ message: 'Failed to copy', type: 'error' })
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isDark ? 'border-border-dark' : 'border-border'
      }`}>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span className={`text-body-sm font-mono ${
            isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
          }`}>
            Raw JSON Structure
          </span>
        </div>

        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-sm transition-colors ${
            copied
              ? 'bg-green-500/10 text-green-500'
              : isDark
                ? 'bg-surface-dark-secondary text-content-inverse hover:bg-surface-dark-tertiary'
                : 'bg-surface-secondary text-content hover:bg-surface-tertiary'
          }`}
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* JSON Content */}
      <div className={`flex-1 overflow-auto p-4 ${
        isDark ? 'bg-neutral-900' : 'bg-neutral-50'
      }`}>
        <pre className={`text-xs font-mono whitespace-pre-wrap ${
          isDark ? 'text-neutral-100' : 'text-neutral-900'
        }`}>
          {jsonString}
        </pre>
      </div>

      {/* Stats */}
      <div className={`px-4 py-3 border-t flex items-center gap-4 ${
        isDark ? 'border-border-dark' : 'border-border'
      }`}>
        <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
          {content.states.length} {content.states.length === 1 ? 'state' : 'states'}
        </span>
        <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
          {content.states.reduce((acc, s) => acc + s.tasks.length, 0)} tasks
        </span>
        <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
          {content.states.reduce((acc, s) => acc + s.tasks.reduce((acc2, t) => acc2 + t.deliverables.length, 0), 0)} deliverables
        </span>
        <span className={`text-caption ml-auto ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
          {jsonString.length.toLocaleString()} characters
        </span>
      </div>
    </div>
  )
}
