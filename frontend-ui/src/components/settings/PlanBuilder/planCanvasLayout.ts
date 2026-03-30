import type { PlanCanvasPosition } from '../../../lib/api-types'

export const getDefaultStatePosition = (index: number): PlanCanvasPosition => ({
  x: 220 + index * 260,
  y: 190 + (index % 2) * 150,
})
