import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useThemeStore } from '../../store/themeStore'
import type { PipelineSchema, AgentConfigurationPayload } from '../../lib/api-types'
import PipelineNodeComponent from './PipelineNode'

// Horizontal layout spacing
const COL_SPACING = 260
const ROW_SPACING = 140
const X_OFFSET = 60
const Y_OFFSET = 60

// Annotation node offsets
const INPUT_ANNOTATION_X = X_OFFSET - 180
const OUTPUT_ANNOTATION_X_PAD = 50 // added after last column

interface PipelineViewProps {
  schema: PipelineSchema
  configuration: AgentConfigurationPayload
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
  onPaneClick?: () => void
}

const nodeTypes = {
  pipeline: PipelineNodeComponent,
}

export default function PipelineView({ schema, configuration, selectedNodeId, onNodeClick, onPaneClick }: PipelineViewProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Find the max column for output annotation placement
  const maxCol = useMemo(() => Math.max(...schema.nodes.map((n) => n.position.col)), [schema.nodes])

  const nodes: Node[] = useMemo(() => {
    const pipelineNodes: Node[] = schema.nodes.map((n) => {
      const nodeConfig = configuration.nodes?.[n.id]
      const isModified = nodeConfig && Object.keys(nodeConfig).length > 0

      return {
        id: n.id,
        type: 'pipeline',
        position: {
          x: X_OFFSET + n.position.col * COL_SPACING,
          y: Y_OFFSET + n.position.row * ROW_SPACING,
        },
        data: {
          label: n.label,
          icon: n.icon,
          description: n.description,
          isModified,
          isSelected: selectedNodeId === n.id,
          isDark,
        },
        draggable: false,
        selectable: true,
      }
    })

    // Add input annotation node (before first column)
    pipelineNodes.push({
      id: '__input__',
      type: 'pipeline',
      position: { x: INPUT_ANNOTATION_X, y: Y_OFFSET + 12 },
      data: {
        label: 'User Message',
        isAnnotation: true,
        annotationType: 'input',
        isDark,
      },
      draggable: false,
      selectable: false,
      focusable: false,
    })

    // Add output annotation node (after last column)
    pipelineNodes.push({
      id: '__output__',
      type: 'pipeline',
      position: { x: X_OFFSET + maxCol * COL_SPACING + 190 + OUTPUT_ANNOTATION_X_PAD, y: Y_OFFSET + 12 },
      data: {
        label: 'Voice Stream',
        isAnnotation: true,
        annotationType: 'output',
        isDark,
      },
      draggable: false,
      selectable: false,
      focusable: false,
    })

    return pipelineNodes
  }, [schema.nodes, configuration, selectedNodeId, isDark, maxCol])

  // Find the first node (col=0, row=0) and last node (max col, row=0)
  const firstNodeId = useMemo(
    () => schema.nodes.find((n) => n.position.col === 0 && n.position.row === 0)?.id || schema.nodes[0]?.id,
    [schema.nodes],
  )
  const lastNodeId = useMemo(
    () => schema.nodes.find((n) => n.position.col === maxCol && n.position.row === 0)?.id || schema.nodes[schema.nodes.length - 1]?.id,
    [schema.nodes, maxCol],
  )

  const edgeColor = isDark ? '#52525b' : '#d4d4d8'
  const edgeColorActive = isDark ? '#71717a' : '#a1a1aa'
  const annotationEdgeColor = isDark ? '#3f3f46' : '#e5e5e5'

  const edges: Edge[] = useMemo(() => {
    const pipelineEdges: Edge[] = schema.edges.map((e, i) => {
      const isDashed = e.style === 'dashed'

      // Determine source/target handles for bridge_generator → response_generator
      const sourceNode = schema.nodes.find((n) => n.id === e.source)
      const targetNode = schema.nodes.find((n) => n.id === e.target)
      const isVerticalConnection = sourceNode && targetNode && sourceNode.position.row !== targetNode.position.row

      return {
        id: `edge-${i}`,
        source: e.source,
        target: e.target,
        sourceHandle: isVerticalConnection ? 'top-source' : 'right',
        targetHandle: isVerticalConnection ? 'bottom' : 'left',
        label: e.label,
        type: 'default',
        animated: isDashed,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: isDashed ? (isDark ? '#6366f1' : '#818cf8') : edgeColor,
        },
        style: {
          stroke: isDashed ? (isDark ? '#6366f1' : '#818cf8') : edgeColor,
          strokeWidth: isDashed ? 1.5 : 2,
          strokeDasharray: isDashed ? '8 4' : undefined,
        },
        labelStyle: {
          fontSize: 10,
          fill: isDashed ? (isDark ? '#818cf8' : '#6366f1') : edgeColorActive,
          fontWeight: 500,
          fontFamily: 'ui-monospace, monospace',
          letterSpacing: '0.02em',
        },
        labelBgStyle: {
          fill: isDark ? '#18181b' : '#ffffff',
          fillOpacity: 0.9,
        },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
      }
    })

    // Input annotation → first pipeline node
    pipelineEdges.push({
      id: 'edge-input',
      source: '__input__',
      target: firstNodeId,
      targetHandle: 'left',
      type: 'default',
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: annotationEdgeColor,
      },
      style: {
        stroke: annotationEdgeColor,
        strokeWidth: 1.5,
        strokeDasharray: '4 3',
      },
    })

    // Input annotation → bridge_generator (parallel fork)
    const bridgeNode = schema.nodes.find((n) => n.id === 'bridge_generator')
    if (bridgeNode) {
      pipelineEdges.push({
        id: 'edge-input-bridge',
        source: '__input__',
        target: 'bridge_generator',
        targetHandle: 'left',
        type: 'default',
        animated: false,
        label: 'parallel',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: annotationEdgeColor,
        },
        style: {
          stroke: annotationEdgeColor,
          strokeWidth: 1.5,
          strokeDasharray: '4 3',
        },
        labelStyle: {
          fontSize: 9,
          fill: isDark ? '#52525b' : '#a1a1aa',
          fontWeight: 400,
          fontStyle: 'italic',
        },
        labelBgStyle: {
          fill: isDark ? '#18181b' : '#ffffff',
          fillOpacity: 0.9,
        },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 3,
      })
    }

    // Last pipeline node → output annotation
    pipelineEdges.push({
      id: 'edge-output',
      source: lastNodeId,
      sourceHandle: 'right',
      target: '__output__',
      type: 'default',
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: annotationEdgeColor,
      },
      style: {
        stroke: annotationEdgeColor,
        strokeWidth: 1.5,
        strokeDasharray: '4 3',
      },
    })

    // Bridge generator → output annotation (bridge also produces early TTS output)
    if (bridgeNode) {
      pipelineEdges.push({
        id: 'edge-bridge-output',
        source: 'bridge_generator',
        sourceHandle: 'right',
        target: '__output__',
        type: 'default',
        animated: false,
        label: 'early TTS',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: isDark ? '#6366f1' : '#818cf8',
        },
        style: {
          stroke: isDark ? '#6366f1' : '#818cf8',
          strokeWidth: 1.5,
          strokeDasharray: '8 4',
        },
        labelStyle: {
          fontSize: 9,
          fill: isDark ? '#818cf8' : '#6366f1',
          fontWeight: 500,
          fontStyle: 'italic',
        },
        labelBgStyle: {
          fill: isDark ? '#18181b' : '#ffffff',
          fillOpacity: 0.9,
        },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 3,
      })
    }

    return pipelineEdges
  }, [schema.edges, schema.nodes, isDark, edgeColor, edgeColorActive, annotationEdgeColor, firstNodeId, lastNodeId])

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Don't handle clicks on annotation nodes
      if (node.id.startsWith('__')) return
      onNodeClick(node.id)
    },
    [onNodeClick],
  )

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.25, minZoom: 0.5, maxZoom: 1.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag={true}
        zoomOnScroll={false}
        zoomOnPinch={true}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color={isDark ? '#27272a' : '#e5e5e5'}
          gap={20}
          size={1}
        />
      </ReactFlow>
    </div>
  )
}
