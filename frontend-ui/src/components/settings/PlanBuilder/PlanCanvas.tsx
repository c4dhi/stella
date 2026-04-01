import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  applyNodeChanges,
  MarkerType,
  type Node,
  type NodeChange,
  type Edge,
  type EdgeProps,
  type EdgeChange,
  type Connection,
  type NodeProps,
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
  initialStateId: string | null
  endStateIds: string[]
  selectedStateId: string | null
  selectedTransition: { sourceStateId: string; transitionIndex: number } | null
  statePositions: Record<string, CanvasPosition>
  endNodePosition?: CanvasPosition
  showEndNode: boolean
  autoFitKey: number
  isDark: boolean
  onSelectState: (stateId: string) => void
  onSelectTransition: (sourceStateId: string, transitionIndex: number) => void
  onCreateTransition: (sourceStateId: string, targetStateId: string) => void
  onSetInitialState: (stateId: string) => void
  onConnectEndState: (sourceStateId: string) => void
  onDeleteStartConnection: () => void
  onDeleteEndConnection: (sourceStateId: string) => void
  onDeleteTransitions: (transitionRefs: Array<{ sourceStateId: string; transitionIndex: number }>) => void
  onDeleteState: (stateId: string) => void
  onStatePositionChange: (stateId: string, position: CanvasPosition) => void
  onEndNodePositionChange: (position: CanvasPosition) => void
  onCanvasClick: () => void
}

const START_NODE_ID = '__start__'
const END_NODE_ID = '__end__'

interface TerminalNodeData {
  label: string
  isDark: boolean
  kind: 'start' | 'end'
}

interface TransitionEdgeData {
  label: string
  isDark: boolean
  isSelected: boolean
  edgeOffset: number
  control?: CanvasPosition
  onSelect?: () => void
  onLabelPointerDown?: (edgeId: string, x: number, y: number, control: CanvasPosition) => void
}

function TransitionEdgeComponent(props: EdgeProps) {
  const data = (props.data || {}) as unknown as TransitionEdgeData
  const edgeOffset = data.edgeOffset || 0
  const center = {
    x: (props.sourceX + props.targetX) / 2,
    y: (props.sourceY + props.targetY) / 2,
  }
  const normal = {
    x: props.targetY - props.sourceY,
    y: -(props.targetX - props.sourceX),
  }
  const normalLength = Math.hypot(normal.x, normal.y) || 1
  const defaultControl = {
    x: center.x + (normal.x / normalLength) * edgeOffset,
    y: center.y + (normal.y / normalLength) * edgeOffset,
  }
  const control = data.control || defaultControl
  const path = `M ${props.sourceX},${props.sourceY} Q ${control.x},${control.y} ${props.targetX},${props.targetY}`
  const labelX = 0.25 * props.sourceX + 0.5 * control.x + 0.25 * props.targetX
  const labelY = 0.25 * props.sourceY + 0.5 * control.y + 0.25 * props.targetY

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={props.interactionWidth}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute cursor-grab active:cursor-grabbing"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            fontSize: 10,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: data.isSelected ? (data.isDark ? '#d8b4fe' : '#5b21b6') : data.isDark ? '#a1a1aa' : '#6b7280',
            background: data.isDark ? 'rgba(24,24,27,0.88)' : 'rgba(255,255,255,0.95)',
            border: `1px solid ${data.isSelected ? (data.isDark ? '#a78bfa' : '#6d28d9') : data.isDark ? '#3f3f46' : '#e5e7eb'}`,
            borderRadius: 8,
            padding: '3px 6px',
          }}
          onClick={(event) => {
            event.stopPropagation()
            data.onSelect?.()
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            data.onLabelPointerDown?.(props.id, event.clientX, event.clientY, control)
          }}
        >
          {data.label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

function TerminalNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as TerminalNodeData

  return (
    <div
      className="relative w-[96px] rounded-xl px-3 py-2 text-center"
      style={{
        border: `1px solid ${nodeData.isDark ? '#3f3f46' : '#e5e5e5'}`,
        color: nodeData.isDark ? '#71717a' : '#a3a3a3',
        background: nodeData.isDark ? 'rgba(39,39,42,0.55)' : '#ffffff',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {nodeData.kind === 'start' && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="!w-4 !h-4 !rounded-full !border-2 !border-white dark:!border-zinc-900 !bg-zinc-400 dark:!bg-zinc-500"
        />
      )}
      {nodeData.kind === 'end' && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="!w-4 !h-4 !rounded-full !border-2 !border-white dark:!border-zinc-900 !bg-zinc-400 dark:!bg-zinc-500"
        />
      )}
      {nodeData.label}
    </div>
  )
}

const nodeTypes = {
  planState: PlanCanvasNode,
  terminal: memo(TerminalNodeComponent),
}

const edgeTypes = {
  planTransition: memo(TransitionEdgeComponent),
}

const getStateOrder = (states: PlanState[], initialStateId: string | null): string[] => {
  if (states.length === 0) return []

  const stateIds = new Set(states.map((state) => state.id))
  const adjacency = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()

  for (const state of states) {
    incomingCount.set(state.id, 0)
  }

  for (const state of states) {
    const targets = (state.transitions || [])
      .map((transition) => transition.target_state_id)
      .filter((targetId) => stateIds.has(targetId))

    adjacency.set(state.id, targets)

    for (const targetId of targets) {
      incomingCount.set(targetId, (incomingCount.get(targetId) || 0) + 1)
    }
  }

  const ordered: string[] = []
  const visited = new Set<string>()
  const queue: string[] = []

  const validInitial = initialStateId && stateIds.has(initialStateId) ? initialStateId : null
  if (validInitial) {
    queue.push(validInitial)
  } else {
    const noIncoming = states
      .filter((state) => (incomingCount.get(state.id) || 0) === 0)
      .map((state) => state.id)

    if (noIncoming.length > 0) {
      queue.push(noIncoming[0])
    } else {
      queue.push(states[0].id)
    }
  }

  while (queue.length > 0) {
    const stateId = queue.shift()
    if (!stateId || visited.has(stateId)) continue

    visited.add(stateId)
    ordered.push(stateId)

    for (const targetId of adjacency.get(stateId) || []) {
      if (!visited.has(targetId)) {
        queue.push(targetId)
      }
    }
  }

  for (const state of states) {
    if (!visited.has(state.id)) {
      ordered.push(state.id)
      visited.add(state.id)
    }
  }

  return ordered
}

export default function PlanCanvas({
  states,
  initialStateId,
  endStateIds,
  selectedStateId,
  selectedTransition,
  statePositions,
  endNodePosition,
  showEndNode,
  autoFitKey,
  isDark,
  onSelectState,
  onSelectTransition,
  onCreateTransition,
  onSetInitialState,
  onConnectEndState,
  onDeleteStartConnection,
  onDeleteEndConnection,
  onDeleteTransitions,
  onDeleteState,
  onStatePositionChange,
  onEndNodePositionChange,
  onCanvasClick,
}: PlanCanvasProps) {
  const [flowInstance, setFlowInstance] = useState<{
    fitView: (options?: { padding?: number; minZoom?: number; maxZoom?: number; duration?: number }) => void
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number }
  } | null>(null)
  const [edgeControls, setEdgeControls] = useState<Record<string, CanvasPosition>>({})
  const [draggingEdge, setDraggingEdge] = useState<{
    edgeId: string
    startPointer: CanvasPosition
    startControl: CanvasPosition
  } | null>(null)

  const orderedStateIds = useMemo(() => getStateOrder(states, initialStateId), [states, initialStateId])
  const stateOrderMap = useMemo(
    () => new Map(orderedStateIds.map((stateId, index) => [stateId, index + 1])),
    [orderedStateIds]
  )

  const builtNodes = useMemo<Node[]>(() => {
    const startNode: Node = {
      id: START_NODE_ID,
      type: 'terminal',
      position: { x: 48, y: 220 },
      draggable: false,
      selectable: false,
      data: { label: 'Start', isDark, kind: 'start' },
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
          stateNumber: stateOrderMap.get(state.id) || index + 1,
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
      const autoEndNodePosition = {
        x: rightmost.position.x + 340,
        y: rightmost.position.y,
      }

      nodes.push({
        id: END_NODE_ID,
        type: 'terminal',
        position: endNodePosition || autoEndNodePosition,
        draggable: true,
        selectable: false,
        data: { label: 'End', isDark, kind: 'end' },
      })
    }

    return nodes
  }, [states, statePositions, selectedStateId, stateOrderMap, endNodePosition, isDark, onDeleteState, showEndNode])

  const [nodes, setNodes] = useState<Node[]>(builtNodes)
  const builtEdges = useMemo<Edge[]>(() => {
    const stateIds = new Set(states.map((state) => state.id))
    const parallelGroups = new Map<string, number[]>()
    for (const state of states) {
      for (let index = 0; index < (state.transitions || []).length; index += 1) {
        const transition = state.transitions![index]
        if (!stateIds.has(transition.target_state_id)) continue
        const key = `${state.id}__${transition.target_state_id}`
        const bucket = parallelGroups.get(key) || []
        bucket.push(index)
        parallelGroups.set(key, bucket)
      }
    }

    const transitionEdges = states.flatMap((state) =>
      (state.transitions || [])
        .map((transition, index): Edge | null => {
          const targetExists = stateIds.has(transition.target_state_id)
          if (!targetExists) return null

          const group = parallelGroups.get(`${state.id}__${transition.target_state_id}`) || [index]
          const groupIndex = Math.max(0, group.indexOf(index))
          const edgeOffset = (groupIndex - (group.length - 1) / 2) * 34
          const edgeId = `${state.id}__${index}`
          const isSelected =
            selectedTransition?.sourceStateId === state.id &&
            selectedTransition?.transitionIndex === index
          const conditionLabel = transition.condition_type.replace(/_/g, ' ')

          return {
            id: edgeId,
            type: 'planTransition',
            source: state.id,
            target: transition.target_state_id,
            interactionWidth: 36,
            data: {
              kind: 'transition',
              transitionIndex: index,
              sourceStateId: state.id,
              label: conditionLabel,
              isDark,
              isSelected,
              edgeOffset,
              control: edgeControls[edgeId],
              onSelect: () => onSelectTransition(state.id, index),
              onLabelPointerDown: (id: string, x: number, y: number, control: CanvasPosition) => {
                if (!flowInstance) return
                setDraggingEdge({
                  edgeId: id,
                  startPointer: flowInstance.screenToFlowPosition({ x, y }),
                  startControl: control,
                })
              },
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: isSelected ? (isDark ? '#a78bfa' : '#6d28d9') : isDark ? '#71717a' : '#9ca3af',
            },
            style: {
              stroke: isSelected ? (isDark ? '#a78bfa' : '#6d28d9') : isDark ? '#71717a' : '#9ca3af',
              strokeWidth: isSelected ? 2.5 : 1.8,
            },
          }
        })
        .filter((edge): edge is Edge => edge !== null)
    )

    const edges: Edge[] = [...transitionEdges]

    const validInitial = initialStateId && states.some((state) => state.id === initialStateId)
      ? initialStateId
      : null

    if (validInitial) {
      edges.push({
        id: '__start_edge__',
        source: START_NODE_ID,
        target: validInitial,
        interactionWidth: 36,
        data: { kind: 'start' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: isDark ? '#71717a' : '#9ca3af' },
        style: { stroke: isDark ? '#52525b' : '#9ca3af', strokeWidth: 1.8, strokeDasharray: '4 4' },
      })
    }

    if (showEndNode) {
      for (const endSourceStateId of endStateIds) {
        if (!stateIds.has(endSourceStateId)) continue
        edges.push({
          id: `__end_edge__${endSourceStateId}`,
          source: endSourceStateId,
          target: END_NODE_ID,
          interactionWidth: 36,
          data: { kind: 'end', sourceStateId: endSourceStateId },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: isDark ? '#71717a' : '#9ca3af' },
          style: { stroke: isDark ? '#52525b' : '#9ca3af', strokeWidth: 1.8, strokeDasharray: '4 4' },
        })
      }
    }

    return edges
  }, [states, initialStateId, showEndNode, selectedTransition, endStateIds, isDark, edgeControls, flowInstance, onSelectTransition])

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

  const handleConnect = useCallback((connection: Connection) => {
    const sourceId = connection.source
    const targetId = connection.target
    if (!sourceId || !targetId) return
    if (sourceId === targetId) return

    if (sourceId === START_NODE_ID) {
      if (targetId !== END_NODE_ID) {
        onSetInitialState(targetId)
      }
      return
    }

    if (sourceId === END_NODE_ID || targetId === START_NODE_ID) return
    if (targetId === END_NODE_ID) {
      onConnectEndState(sourceId)
      return
    }
    onCreateTransition(sourceId, targetId)
  }, [onCreateTransition, onSetInitialState, onConnectEndState])

  const handleEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    const transitionsToDelete: Array<{ sourceStateId: string; transitionIndex: number }> = []

    for (const edge of deletedEdges) {
      if (edge.data?.kind === 'start') {
        onDeleteStartConnection()
        continue
      }
      if (edge.data?.kind === 'end' && typeof edge.data?.sourceStateId === 'string') {
        onDeleteEndConnection(edge.data.sourceStateId)
        continue
      }
      if (edge.data?.kind === 'transition' && typeof edge.data?.sourceStateId === 'string' && typeof edge.data?.transitionIndex === 'number') {
        transitionsToDelete.push({
          sourceStateId: edge.data.sourceStateId,
          transitionIndex: edge.data.transitionIndex,
        })
      }
    }

    if (transitionsToDelete.length > 0) {
      onDeleteTransitions(transitionsToDelete)
    }
  }, [onDeleteEndConnection, onDeleteStartConnection, onDeleteTransitions])

  const handleEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const removedIds = changes
      .filter((change) => change.type === 'remove')
      .map((change) => change.id)

    if (removedIds.length === 0) return
    const removedEdges = builtEdges.filter((edge) => removedIds.includes(edge.id))
    if (removedEdges.length > 0) {
      handleEdgesDelete(removedEdges)
    }
  }, [builtEdges, handleEdgesDelete])

  useEffect(() => {
    if (!draggingEdge || !flowInstance) return

    const handlePointerMove = (event: PointerEvent) => {
      const point = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setEdgeControls((prev) => ({
        ...prev,
        [draggingEdge.edgeId]: {
          x: draggingEdge.startControl.x + point.x - draggingEdge.startPointer.x,
          y: draggingEdge.startControl.y + point.y - draggingEdge.startPointer.y,
        },
      }))
    }

    const handlePointerUp = () => setDraggingEdge(null)

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [draggingEdge, flowInstance])

  return (
    <div className={`relative w-full h-full ${isDark ? 'bg-surface-dark' : 'bg-surface'}`}>
      <button
        onClick={() => flowInstance?.fitView({ padding: 0.25, minZoom: 0.5, maxZoom: 1.2, duration: 260 })}
        className={`absolute right-3 top-3 z-10 h-8 w-8 rounded-lg border flex items-center justify-center transition-colors ${
          isDark
            ? 'border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800'
            : 'border-neutral-200 bg-white/95 text-neutral-600 hover:bg-neutral-50'
        }`}
        title="Recenter"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      </button>

      <ReactFlow
        nodes={nodes}
        edges={builtEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onNodeClick={(_, node) => {
          if (node.id === START_NODE_ID || node.id === END_NODE_ID) return
          onSelectState(node.id)
        }}
        onEdgeClick={(event, edge) => {
          event.stopPropagation()
          if (edge.data?.kind === 'start') {
            onDeleteStartConnection()
            return
          }
          if (edge.data?.kind === 'end' && typeof edge.data?.sourceStateId === 'string') {
            onDeleteEndConnection(edge.data.sourceStateId)
            return
          }
          if (edge.data?.kind !== 'transition') return
          const sourceStateId = typeof edge.data?.sourceStateId === 'string' ? edge.data.sourceStateId : edge.source
          const transitionIndex =
            typeof edge.data?.transitionIndex === 'number' ? edge.data.transitionIndex : Number.NaN
          if (!sourceStateId || Number.isNaN(transitionIndex)) return
          onSelectTransition(sourceStateId, transitionIndex)
        }}
        onEdgesChange={handleEdgesChange}
        onPaneClick={onCanvasClick}
        onNodeDragStop={(_, node) => {
          if (node.id === START_NODE_ID) return
          if (node.id === END_NODE_ID) {
            onEndNodePositionChange({ x: node.position.x, y: node.position.y })
            return
          }
          onStatePositionChange(node.id, { x: node.position.x, y: node.position.y })
        }}
        onInit={(instance) => setFlowInstance(instance)}
        fitView
        fitViewOptions={{ padding: 0.25, minZoom: 0.5, maxZoom: 1.2 }}
        zoomOnScroll={false}
        zoomOnPinch={true}
        panOnDrag={true}
        connectionRadius={42}
        nodesConnectable
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
