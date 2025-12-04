
import ConnectPanel from './components/ConnectPanel'
import ChatView from './components/ChatView'
import Composer from './components/Composer'
import PlaybackBar from './components/PlaybackBar'
import ConnectionStats from './components/ConnectionStats'
import TTSPauseButton from './components/TTSPauseButton'
import TaskPanel from './components/TaskPanel'
import { useStore } from './store'
import { useEffect } from 'react'

export default function App() {
  const transport = useStore(s => s.transport)
  const showTaskPanel = useStore(s => s.showTaskPanel)
  const setTodoList = useStore(s => s.setTodoList)
  const updateDeliverable = useStore(s => s.updateDeliverable)
  const setProgress = useStore(s => s.setProgress)
  const handleStateChange = useStore(s => s.handleStateChange)
  const setAllDeliverableStates = useStore(s => s.setAllDeliverableStates)
  const setProcessingMode = useStore(s => s.setProcessingMode)
  const addNotification = useStore(s => s.addNotification)

  // Connect transport callbacks for task updates
  useEffect(() => {
    if (!transport) return

    const handleTodoListUpdate = (data: any) => {
      try {
        // Validate required fields for state machine (as per documentation line 570-574)
        if (!data.todo_list || !data.conversation_id) {
          console.warn('Invalid state machine data received:', data)
          return
        }

        // Validate state machine structure (as per documentation line 576-580)
        if (!data.todo_list.states || !Array.isArray(data.todo_list.states)) {
          console.warn('Invalid states array in todo list data:', data)
          return
        }

        // Check for conversation mismatch (as per documentation line 582-587)
        const currentConversationId = useStore.getState().todoList?.conversation_age_minutes
        if (currentConversationId && data.conversation_id !== currentConversationId) {
          console.warn('Conversation ID mismatch - new conversation started')
          // Could call clearTasks() here if needed
        }

        // Check for architecture mismatch (as per documentation line 589-592)
        if (data.metadata?.architecture !== 'state_machine') {
          console.warn('Expected state machine architecture, got:', data.metadata?.architecture)
        }

        // Log for debugging (as per documentation line 362-367)
        console.log(`📋 [TASK] Todo list update received:`, {
          trigger: data.update_trigger,
          states: data.todo_list.states?.length || 0,
          current_state: data.todo_list.current_state?.title,
          processing_mode: data.context?.current_processing_mode
        })

        setTodoList(data.todo_list)

        // Set enhanced deliverable states if provided
        if (data.all_deliverable_states) {
          setAllDeliverableStates(data.all_deliverable_states)
        }

        // Extract and set processing mode from context
        if (data.context?.current_processing_mode) {
          setProcessingMode(data.context.current_processing_mode)
        }

      } catch (error) {
        console.error('Error handling state machine update:', error)
      }
    }

    const handlePlanProgress = (data: any) => {
      // Log progress update for debugging (as per documentation line 373-378)
      console.log(`📊 [TASK] Plan progress update:`, {
        percentage: data.progress.percentage,
        state: data.current_state?.title,
        mode: data.current_state?.type
      })

      setProgress(data.progress.percentage)
    }

    const handleDeliverableUpdate = (data: any) => {
      // Real-time deliverable updates (as per documentation line 386-389)
      console.log(`📦 [DELIVERABLE] ${data.deliverable_key}: ${data.deliverable_value}`)
      if (data.reasoning) {
        console.log(`   Reasoning: ${data.reasoning}`)
      }

      updateDeliverable(
        data.deliverable_key,
        data.deliverable_value,
        data.state_id,
        data.confidence,
        data.source_message,
        data.reasoning,
        data.acceptance_criteria
      )

      // Show enhanced notification with reasoning as documented
      const confidencePercent = data.confidence ? Math.round(data.confidence * 100) : 100
      addNotification({
        type: 'deliverable_collected',
        title: `Collected: ${data.deliverable_key.replace(/_/g, ' ').replace(/\b\w/g, (l: any) => l.toUpperCase())}`,
        message: `Value: ${data.deliverable_value} (${confidencePercent}% confidence)`,
        importance: 'medium',
        data: {
          key: data.deliverable_key,
          value: data.deliverable_value,
          confidence: data.confidence,
          reasoning: data.reasoning,
          stateId: data.state_id,
          acceptanceCriteria: data.acceptance_criteria
        }
      })
    }

    const handleStateMachineStateChange = (data: any) => {
      handleStateChange(data)
    }


    // Wire up the callbacks
    transport.onTodoListUpdate = handleTodoListUpdate
    transport.onPlanProgress = handlePlanProgress
    transport.onDeliverableUpdate = handleDeliverableUpdate
    transport.onStateChange = handleStateMachineStateChange

    return () => {
      // Cleanup callbacks
      transport.onTodoListUpdate = () => { }
      transport.onPlanProgress = () => { }
      transport.onDeliverableUpdate = () => { }
      transport.onStateChange = () => { }
    }
  }, [transport, setTodoList, updateDeliverable, setProgress, handleStateChange, setAllDeliverableStates, setProcessingMode, addNotification])

  return (
    <div className="w-full h-full bg-neutral-50">
      <div className={`h-screen flex gap-4 p-4 text-neutral-900 transition-all duration-300 ${showTaskPanel ? 'max-w-6xl' : 'max-w-3xl'
        } mx-auto`}>

        {/* Main Content Area */}
        <div className={`flex flex-col gap-3 transition-all duration-300 ${showTaskPanel ? 'flex-1' : 'w-full max-w-3xl mx-auto'
          }`}>
          <header className="pt-2 pb-1">
            <h1 className="text-xl font-light text-neutral-800 tracking-wide">STELLA</h1>
          </header>

          <ConnectPanel />

          <div className="flex-1 bg-white/90 backdrop-blur-xl rounded-xl shadow-sm border border-neutral-200/60 flex flex-col overflow-hidden">
            <ChatView />
          </div>

          <Composer />

        </div>

        {/* Task Panel */}
        {showTaskPanel && (
          <div className="flex-shrink-0 relative">
            <TaskPanel />
          </div>
        )}
      </div>
    </div>
  )
}
