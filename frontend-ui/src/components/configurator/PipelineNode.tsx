import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'

interface PipelineNodeData {
  label: string
  icon?: string
  description?: string
  isModified?: boolean
  isSelected?: boolean
  isDark?: boolean
  isAnnotation?: boolean
  annotationType?: 'input' | 'output'
  [key: string]: unknown
}

function PipelineNodeComponent({ data }: NodeProps) {
  const { label, icon, description, isModified, isSelected, isDark, isAnnotation, annotationType } = data as PipelineNodeData

  // Annotation nodes (input/output flow labels)
  if (isAnnotation) {
    const isInput = annotationType === 'input'
    return (
      <div className="flex items-center gap-2">
        {!isInput && (
          <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
        )}
        <div className={`
          flex items-center gap-2.5 px-4 py-2.5 rounded-xl
          ${isDark
            ? 'bg-zinc-800/60 border border-zinc-700/50'
            : 'bg-neutral-50 border border-neutral-200/60'
          }
        `}>
          <div className={`text-[11px] font-medium tracking-wide uppercase ${
            isDark ? 'text-zinc-500' : 'text-neutral-400'
          }`}>
            {label}
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isDark ? 'text-zinc-600' : 'text-neutral-300'}
          >
            {isInput ? (
              <path d="M5 12h14m-7-7 7 7-7 7" />
            ) : (
              <path d="M5 12h14m-7-7 7 7-7 7" />
            )}
          </svg>
        </div>
        {isInput && (
          <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
        )}
      </div>
    )
  }

  // Pipeline stage nodes
  return (
    <>
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-3 !h-3" />
      <div
        className={`
          px-5 py-4 rounded-2xl border-2 transition-all duration-200 cursor-pointer
          min-w-[170px] max-w-[190px] relative
          ${isSelected
            ? isDark
              ? 'border-primary-400 bg-primary-500/10 shadow-[0_0_24px_rgba(139,92,246,0.15)]'
              : 'border-primary-500 bg-primary-50 shadow-[0_0_24px_rgba(139,92,246,0.1)]'
            : isDark
              ? 'border-zinc-600/80 bg-zinc-800 hover:border-zinc-500 hover:shadow-[0_2px_16px_rgba(0,0,0,0.3)]'
              : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-[0_2px_16px_rgba(0,0,0,0.06)]'
          }
        `}
      >
        {/* Modified indicator */}
        {isModified && (
          <div className="absolute -top-1.5 -right-1.5 flex items-center justify-center">
            <div className="w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white dark:border-zinc-900 shadow-sm" />
          </div>
        )}

        {/* Icon */}
        <div className="text-xl mb-2">{icon || '⚙️'}</div>

        {/* Label */}
        <div className={`text-[13px] font-semibold leading-tight ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
          {label}
        </div>

        {/* Description */}
        {description && (
          <div className={`text-[10px] font-light leading-snug mt-1.5 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
            {description}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-3 !h-3" />
      {/* Extra handles for vertical connections (bridge_generator) */}
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-3 !h-3" />
      <Handle type="source" position={Position.Top} id="top-source" className="!bg-transparent !border-0 !w-3 !h-3" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-3 !h-3" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className="!bg-transparent !border-0 !w-3 !h-3" />
    </>
  )
}

export default memo(PipelineNodeComponent)
