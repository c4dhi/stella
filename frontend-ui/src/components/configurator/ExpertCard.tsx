/**
 * ExpertCard — expandable card for a single expert in the sidebar.
 *
 * Shows name, description, priority badge, enabled/alwaysTriggered toggles.
 * Expands to reveal: triggerCriteria, model, temperature, maxTokens, systemPrompt.
 * Drag handle for reordering (via @dnd-kit).
 */

import { memo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ExpertDefinition } from './useConfiguratorState'
import { PromptComposer, buildExpertBlocks } from './PromptComposer'

interface ExpertCardProps {
  expert: ExpertDefinition
  index: number
  isExpanded: boolean
  onToggleExpand: () => void
  onUpdate: (updates: Partial<ExpertDefinition>) => void
  onRemove?: () => void
  isDark: boolean
}

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1-nano']

function CollapsibleSettings({ isDark, children }: { isDark: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`rounded-lg border ${
      isDark ? 'bg-zinc-800/40 border-zinc-700/50' : 'bg-neutral-50/50 border-neutral-200/40'
    }`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors rounded-lg ${
          isDark ? 'hover:bg-zinc-700/40' : 'hover:bg-neutral-100/60'
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={isDark ? 'text-zinc-600' : 'text-neutral-400'}
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
        <span className={`flex-1 text-[10px] font-semibold tracking-wide uppercase ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
          Model Settings
        </span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''} ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-3 px-3 pb-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ExpertCardInner({
  expert,
  index,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  isDark,
}: ExpertCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: expert.name,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const inputClass = `w-full px-3 py-2 rounded-lg text-[13px] font-light focus:outline-none transition-all ${
    isDark
      ? 'bg-zinc-800/80 border border-zinc-600/80 text-zinc-100 focus:border-zinc-400'
      : 'bg-white border border-neutral-200 text-neutral-900 focus:border-neutral-400'
  }`

  const labelClass = `text-xs font-medium mb-1.5 block ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`rounded-xl border transition-all ${
          expert.isCustom
            ? isDark
              ? 'border-violet-500/30 bg-violet-500/5'
              : 'border-violet-200 bg-violet-50/30'
            : isDark
              ? 'border-zinc-700/60 bg-zinc-800/40'
              : 'border-neutral-200/60 bg-white'
        }`}
      >
        {/* Header row */}
        <div className="flex items-center gap-2.5 px-4 py-3">
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            style={{ touchAction: 'none' }}
            className={`cursor-grab active:cursor-grabbing p-1 rounded-md transition-colors ${
              isDark ? 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-700/50' : 'text-neutral-300 hover:text-neutral-500 hover:bg-neutral-100'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
              <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
              <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
            </svg>
          </button>

          {/* Priority badge */}
          <span className={`text-[10px] font-mono font-medium w-5 h-5 flex items-center justify-center rounded ${
            isDark ? 'text-zinc-500 bg-zinc-800' : 'text-neutral-400 bg-neutral-100'
          }`}>
            {index + 1}
          </span>

          {/* Name + description */}
          <button onClick={onToggleExpand} className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span
                className={`text-[13px] font-medium ${
                  expert.isCustom
                    ? isDark
                      ? 'text-violet-300'
                      : 'text-violet-700'
                    : isDark
                      ? 'text-zinc-100'
                      : 'text-neutral-800'
                }`}
              >
                {expert.name}
              </span>
              {expert.isCustom && (
                <span
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${
                    isDark ? 'bg-violet-500/20 text-violet-400' : 'bg-violet-100 text-violet-600'
                  }`}
                >
                  custom
                </span>
              )}
              {expert.alwaysTriggered && (
                <span
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${
                    isDark ? 'bg-sky-500/20 text-sky-400' : 'bg-sky-100 text-sky-600'
                  }`}
                >
                  always
                </span>
              )}
            </div>
            <p className={`text-[11px] font-light truncate mt-0.5 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
              {expert.description}
            </p>
          </button>

          {/* Remove (custom only) or Disable (built-in) */}
          {expert.isCustom && onRemove ? (
            <button
              onClick={onRemove}
              className={`p-1.5 rounded-lg transition-colors ${
                isDark ? 'text-zinc-600 hover:text-red-400 hover:bg-zinc-700/50' : 'text-neutral-300 hover:text-red-500 hover:bg-neutral-100'
              }`}
              title="Remove custom expert"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => onUpdate({ enabled: false })}
              className={`p-1.5 rounded-lg transition-colors ${
                isDark ? 'text-zinc-600 hover:text-red-400 hover:bg-zinc-700/50' : 'text-neutral-300 hover:text-red-500 hover:bg-neutral-100'
              }`}
              title="Disable expert"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="m4.93 4.93 14.14 14.14" />
              </svg>
            </button>
          )}

          {/* Expand arrow */}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''} ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        {/* Expanded settings */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div
                className={`px-4 pb-5 pt-4 space-y-5 border-t ${
                  isDark ? 'border-zinc-700/50' : 'border-neutral-100'
                }`}
              >
                {/* Always triggered toggle */}
                <div className={`flex items-center justify-between px-3.5 py-3 rounded-lg ${
                  isDark ? 'bg-zinc-800/80' : 'bg-neutral-50'
                }`}>
                  <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
                    Always Triggered
                  </label>
                  <button
                    onClick={() => onUpdate({ alwaysTriggered: !expert.alwaysTriggered })}
                    className={`relative w-10 h-[22px] rounded-full transition-colors ${
                      expert.alwaysTriggered
                        ? 'bg-sky-500'
                        : isDark
                          ? 'bg-zinc-600'
                          : 'bg-neutral-300'
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                        expert.alwaysTriggered ? 'translate-x-[18px]' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Trigger criteria (hidden when alwaysTriggered) */}
                {!expert.alwaysTriggered && (
                  <div>
                    <label className={labelClass}>Trigger Criteria</label>
                    <textarea
                      value={expert.triggerCriteria}
                      onChange={(e) => onUpdate({ triggerCriteria: e.target.value })}
                      placeholder="When should the input gate select this expert?"
                      rows={3}
                      className={`${inputClass} resize-y`}
                      style={{ fontSize: '12px', lineHeight: '1.6' }}
                    />
                    <p className={`text-[11px] mt-1.5 ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`}>
                      Used by Input Gate to decide when to activate this expert
                    </p>
                  </div>
                )}

                {/* Model / Temp / MaxTokens — collapsible config grid */}
                <CollapsibleSettings isDark={isDark}>
                  <div>
                    <label className={labelClass}>Model</label>
                    <select
                      value={expert.model}
                      onChange={(e) => onUpdate({ model: e.target.value })}
                      className={inputClass}
                    >
                      {MODEL_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Temperature</label>
                    <input
                      type="number"
                      value={expert.temperature}
                      onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) || 0 })}
                      min={0}
                      max={1}
                      step={0.1}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Max Tokens</label>
                    <input
                      type="number"
                      value={expert.maxTokens}
                      onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value) || 200 })}
                      min={10}
                      max={2000}
                      className={inputClass}
                    />
                  </div>
                </CollapsibleSettings>

                {/* Prompt assembly view */}
                <PromptComposer
                  blocks={buildExpertBlocks(expert, onUpdate)}
                  isDark={isDark}
                  compact
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export const ExpertCard = memo(ExpertCardInner)
export default ExpertCard
