import { useMemo, useState, useEffect, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import PlanCanvasNode from './PlanCanvasNode'
import type { PlanState } from '../../../lib/api-types'
import { getDefaultStatePosition } from './planCanvasLayout'

interface CanvasPosition {
  x: number
  y: number
}

interface PlanCanvasProps {
  states: PlanState[]
  selectedStateId: string | null
  statePositions: Record<string, CanvasPosition>
  showEndNode: boolean
  autoFitKey: number
  isDark: boolean
  onSelectState: (stateId: string) => void
  onDeleteState: (stateId: string) => void
  onStatePositionChange: (stateId: string, position: CanvasPosition) => void
}

const START_NODE_ID = '__start__'
const END_NODE_ID = '__end__'

const nodeTypes = {
  planState: PlanCanvasNode,
}

export default function PlanCanvas({
  states,
  selectedStateId,
  statePositions,
  showEndNode,
  autoFitKey,
  isDark,
  onSelectState,
  onDeleteState,
  onStatePositionChange,
}: PlanCanvasProps) {
  const [flowInstance, setFlowInstance] = useState<{
    fitView: (options?: { padding?: number; minZoom?: number; maxZoom?: number; duration?: number }) => void
  } | null>(null)

  const builtNodes = useMemo<Node[]>(() => {
    const startNode: Node = {
      id: START_NODE_ID,
      position: { x: 48, y: 220 },
      draggable: false,
      selectable: false,
      data: { label: 'Start' },
      style: {
        width: 96,
        borderRadius: 12,
        textAlign: 'center',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        border: `1px solid ${isDark ? '#3f3f46' : '#e5e5e5'}`,
        color: isDark ? '#71717a' : '#a3a3a3',
        background: isDark ? 'rgba(39,39,42,0.55)' : '#ffffff',
        padding: '8px 10px',
      },
    }

    const stateNodes: Node[] = states.map((state, index) => {
      const position = statePositions[state.id] || getDefaultStatePosition(index)
      return {
        id: state.id,
        type: 'planState',
        position,
        draggable: true,
        selectable: true,
        data: {
          stateId: state.id,
          title: state.title,
          stateNumber: index + 1,
          taskCount: state.tasks.length,
          isSelected: selectedStateId === state.id,
          isDark,
          onDelete: onDeleteState,
        },
      }
    })

    const nodes: Node[] = [startNode, ...stateNodes]

    if (showEndNode) {
      const positionedStates = states.map((state, index) => ({
        id: state.id,
        position: statePositions[state.id] || getDefaultStatePosition(index),
      }))
      const rightmost = positionedStates.reduce(
        (acc, item) => (item.position.x > acc.position.x ? item : acc),
        positionedStates[0] || { id: '', position: { x: 220, y: 220 } },
      )
      const endNodePosition = {
        x: rightmost.position.x + 340,
        y: rightmost.position.y,
      }

      nodes.push({
        id: END_NODE_ID,
        position: endNodePosition,
        draggable: false,
        selectable: false,
        data: { label: 'End' },
        style: {
          width: 96,
          borderRadius: 12,
          textAlign: 'center',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          border: `1px solid ${isDark ? '#3f3f46' : '#e5e5e5'}`,
          color: isDark ? '#71717a' : '#a3a3a3',
          background: isDark ? 'rgba(39,39,42,0.55)' : '#ffffff',
          padding: '8px 10px',
        },
      })
    }

    return nodes
  }, [states, statePositions, selectedStateId, isDark, onDeleteState, showEndNode])

  const [nodes, setNodes] = useState<Node[]>(builtNodes)

  useEffect(() => {
    setNodes(builtNodes)
  }, [builtNodes])

  useEffect(() => {
    if (!flowInstance) return
    const timer = window.setTimeout(() => {
      flowInstance.fitView({ padding: 0.25, minZoom: 0.5, maxZoom: 1.2, duration: 260 })
    }, 30)
    return () => window.clearTimeout(timer)
  }, [autoFitKey, flowInstance])

  const handleNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
  }, [])

  return (
    <div className={`w-full h-full ${isDark ? 'bg-surface-dark' : 'bg-surface'}`}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeClick={(_, node) => {
          if (node.id === START_NODE_ID || node.id === END_NODE_ID) return
          onSelectState(node.id)
        }}
        onNodeDragStop={(_, node) => {
          if (node.id === START_NODE_ID || node.id === END_NODE_ID) return
          onStatePositionChange(node.id, { x: node.position.x, y: node.position.y })
        }}
        onInit={(instance) => setFlowInstance(instance)}
        fitView
        fitViewOptions={{ padding: 0.25, minZoom: 0.5, maxZoom: 1.2 }}
        zoomOnScroll={false}
        zoomOnPinch={true}
        panOnDrag={true}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          color={isDark ? 'rgba(168,85,247,0.06)' : 'rgba(0,0,0,0.04)'}
          gap={24}
          lineWidth={0.5}
        />
        <Background
          id="coarse"
          variant={BackgroundVariant.Lines}
          color={isDark ? 'rgba(168,85,247,0.10)' : 'rgba(0,0,0,0.07)'}
          gap={120}
          lineWidth={1}
        />
      </ReactFlow>
    </div>
  )
}
