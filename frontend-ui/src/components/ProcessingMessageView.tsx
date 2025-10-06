import type { ProcessingMessage, DecisionStreamData, PromptExecutionData, ExpertStatusData, SafetyCheckData } from '../lib/types'

interface ProcessingMessageViewProps {
  message: ProcessingMessage
}

export default function ProcessingMessageView({ message }: ProcessingMessageViewProps) {
  const getIcon = () => {
    switch (message.type) {
      case 'decision': return '🧠'
      case 'prompt_execution': return '🤖'
      case 'expert_status': return '👨‍💼'
      case 'safety_check': return '🛡️'
      default: return '⚙️'
    }
  }

  const getColor = () => {
    switch (message.type) {
      case 'decision': return 'bg-blue-50/90 border-blue-200/50 backdrop-blur-sm shadow-sm'
      case 'prompt_execution': return 'bg-emerald-50/90 border-emerald-200/50 backdrop-blur-sm shadow-sm'
      case 'expert_status': return 'bg-amber-50/90 border-amber-200/50 backdrop-blur-sm shadow-sm'
      case 'safety_check': return 'bg-red-50/90 border-red-200/50 backdrop-blur-sm shadow-sm'
      default: return 'bg-neutral-50/90 border-neutral-200/50 backdrop-blur-sm shadow-sm'
    }
  }

  const renderContent = () => {
    switch (message.type) {
      case 'decision':
        return <DecisionContent data={message.data as DecisionStreamData} />
      case 'prompt_execution':
        return <PromptExecutionContent data={message.data as PromptExecutionData} />
      case 'expert_status':
        return <ExpertStatusContent data={message.data as ExpertStatusData} />
      case 'safety_check':
        return <SafetyCheckContent data={message.data as SafetyCheckData} />
      default:
        return <div>Unknown processing message type</div>
    }
  }

  const getParticipantName = () => {
    // Try to get participant_id from the data
    const data = message.data as any
    return data.participant_id || 'System'
  }

  return (
    <div className={`max-w-[80%] max-h-[70vh] overflow-y-auto px-3 py-2 rounded-xl border ${getColor()} text-sm`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm opacity-80">{getIcon()}</span>
        <span className="font-light text-neutral-600 text-xs">
          {getParticipantName()} • {message.type?.replace?.('_', ' ') || 'unknown'}
        </span>
        <span className="text-xs text-neutral-500 ml-auto font-light">
          {new Date(message.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {renderContent()}
    </div>
  )
}

function DecisionContent({ data }: { data: DecisionStreamData }) {
  const isInputGateComplete = data.step === 'input_gate_complete'

  return (
    <div className="space-y-1">
      <div className="font-light text-blue-800 text-xs">
        {data.step.replace(/_/g, ' ')}
      </div>

      {!isInputGateComplete &&
        <div className="text-blue-700 text-xs font-light leading-relaxed">
          {data.decision}
        </div>
      }

      {isInputGateComplete && data.metadata && (
        <div className="border-t border-neutral-200/60 pt-1 space-y-1">
          <div className="text-xs font-light text-neutral-600">Analysis:</div>

          {data.metadata.verdict && (
            <div className="text-xs text-neutral-600 bg-neutral-100/60 p-1.5 rounded">
              <span className="font-light text-neutral-500">Verdict:</span>
              <span className={`ml-1 px-1.5 py-0.5 rounded text-xs font-light ${data.metadata.verdict === 'safe' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                {data.metadata.verdict}
              </span>
            </div>
          )}

          {data.metadata.route && (
            <div className="text-xs text-neutral-600 bg-neutral-100/60 p-1.5 rounded">
              <span className="font-light text-neutral-500">Route:</span>
              <div className="mt-0.5 font-light">{data.metadata.route}</div>
            </div>
          )}

          {data.metadata.intent && (
            <div className="text-xs text-neutral-600 bg-neutral-100/60 p-1.5 rounded">
              <span className="font-light text-neutral-500">Intent:</span>
              <div className="mt-0.5 font-light">{data.metadata.intent}</div>
            </div>
          )}

          {data.metadata.risk_score !== undefined && (
            <div className="text-xs text-neutral-600 bg-neutral-100/60 p-1.5 rounded">
              <span className="font-light text-neutral-500">Risk:</span>
              <div className="mt-0.5 font-light">{data.metadata.risk_score.toFixed(2)}</div>
            </div>
          )}

          {data.metadata.expert_configuration?.experts && (
            <div className="text-xs text-neutral-600 bg-neutral-100/60 p-1.5 rounded">
              <span className="font-light text-neutral-500">Experts:</span>
              <div className="mt-0.5 font-light">{data.metadata.expert_configuration.experts.join(', ')}</div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-blue-500 font-light">
        <span>{data.timing_ms}ms</span>
      </div>

      {!isInputGateComplete && Object.keys(data.metadata).length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-neutral-400 font-light hover:text-neutral-600 transition-colors">
            Details
          </summary>
          <div className="max-h-64 overflow-y-auto mt-1 border-t border-neutral-200/40 pt-1">
            <pre className="text-xs text-neutral-500 font-light whitespace-pre-wrap break-words">
              {JSON.stringify(data.metadata, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </div>
  )
}


function PromptExecutionContent({ data }: { data: PromptExecutionData }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-light text-emerald-800 text-xs">
          {data.agent_name}
        </span>
        <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-light">
          {data.prompt_type}
        </span>
      </div>
      <div className="text-emerald-700 text-xs font-light leading-relaxed">
        {data.prompt_preview}
      </div>
      <div className="flex items-center gap-3 text-xs text-emerald-500 font-light">
        <span>{data.model}</span>
        <span>•</span>
        <span>{data.temperature}</span>
        <span>•</span>
        <span>{Math.round(data.estimated_duration_ms / 1000)}s</span>
      </div>
    </div>
  )
}

function ExpertStatusContent({ data }: { data: ExpertStatusData }) {
  const getStatusColor = () => {
    switch (data.status) {
      case 'started': return 'bg-blue-100 text-blue-700'
      case 'progress': return 'bg-yellow-100 text-yellow-700'
      case 'completed': return 'bg-green-100 text-green-700'
      case 'timeout': return 'bg-orange-100 text-orange-700'
      case 'error': return 'bg-red-100 text-red-700'
      default: return 'bg-neutral-100 text-neutral-700'
    }
  }

  const hasCompletionData = data.status === 'completed' && data.metadata?.result
  const hasErrorData = data.status === 'error' && data.metadata?.error_message

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-light text-amber-800 text-xs">
          {data.expert_name}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-light ${getStatusColor()}`}>
          {data.status}
        </span>
      </div>

      {data.progress_percent !== undefined && (
        <div className="w-full bg-amber-200/40 rounded-full h-1">
          <div
            className="bg-gradient-to-r from-amber-400 to-amber-500 h-1 rounded-full transition-all duration-300"
            style={{ width: `${data.progress_percent}%` }}
          />
        </div>
      )}

      {data.intermediate_finding && (
        <div className="text-amber-700 text-xs font-light leading-relaxed">
          {data.intermediate_finding}
        </div>
      )}

      {hasCompletionData && data.metadata?.result?.findings && (
        <div className="border-t border-neutral-200/60 pt-1">
          <details>
            <summary className="cursor-pointer text-xs font-light text-neutral-600 hover:text-neutral-800">
              Analysis ({data.metadata?.success ? '✓' : '✗'})
            </summary>
            <div className="mt-1 text-xs text-neutral-600 bg-neutral-100/60 p-1.5 rounded whitespace-pre-wrap font-light leading-relaxed">
              {data.metadata.result.findings}
            </div>
          </details>
        </div>
      )}

      {hasErrorData && (
        <div className="border-t border-red-200/60 pt-1">
          <div className="text-xs text-red-600 font-light">
            <span className="font-medium">Error:</span> {data.metadata?.error_message}
          </div>
          {data.metadata?.error_type && (
            <div className="text-xs text-red-500 mt-0.5 font-light">
              Type: {data.metadata.error_type}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SafetyCheckContent({ data }: { data: SafetyCheckData }) {
  const getStatusColor = () => {
    switch (data.status) {
      case 'checking': return 'bg-blue-100 text-blue-700'
      case 'passed': return 'bg-green-100 text-green-700'
      case 'warning': return 'bg-yellow-100 text-yellow-700'
      case 'blocked': return 'bg-red-100 text-red-700'
      default: return 'bg-neutral-100 text-neutral-700'
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-light text-red-800 text-xs">
          {data.check_type.replace(/_/g, ' ')}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-light ${getStatusColor()}`}>
          {data.status}
        </span>
      </div>
      <div className="text-red-700 text-xs font-light leading-relaxed">
        {data.details}
      </div>
    </div>
  )
}