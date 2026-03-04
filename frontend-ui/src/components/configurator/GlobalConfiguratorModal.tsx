import { AnimatePresence } from 'framer-motion'
import { useConfiguratorStore } from '../../store/configuratorStore'
import AgentConfiguratorModal from './AgentConfiguratorModal'

/**
 * Root-level wrapper that renders AgentConfiguratorModal outside any parent modal,
 * following the same pattern as PlanBuilderModal in App.tsx.
 */
export default function GlobalConfiguratorModal() {
  const {
    isOpen,
    pipelineSchema,
    initialConfiguration,
    initialName,
    initialDescription,
    saveLabel,
    onSaveCallback,
    closeModal,
  } = useConfiguratorStore()

  if (!pipelineSchema) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <AgentConfiguratorModal
          isOpen={isOpen}
          onClose={closeModal}
          pipelineSchema={pipelineSchema}
          initialConfiguration={initialConfiguration}
          initialName={initialName}
          initialDescription={initialDescription}
          onSave={(name, description, config) => {
            onSaveCallback?.(name, description, config)
            closeModal()
          }}
          saveLabel={saveLabel}
        />
      )}
    </AnimatePresence>
  )
}
