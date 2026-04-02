export const GRID_SIZE = 10
export const GRID = [GRID_SIZE, GRID_SIZE]

export const NEST_PAD_LEFT = 20
export const NEST_PAD_RIGHT = 20
export const NEST_PAD_TOP = 60
export const NEST_PAD_BOTTOM = 20
export const NEST_V_SPACING = 10

export const snapValue = (value, gridSize = GRID_SIZE) => (
  Math.round(value / gridSize) * gridSize
)

export const snapPoint = (point, gridSize = GRID_SIZE) => ({
  x: snapValue(point.x, gridSize),
  y: snapValue(point.y, gridSize),
})

export const snapSize = (
  size,
  { minWidth = 60, minHeight = 30, gridSize = GRID_SIZE } = {}
) => ({
  width: Math.max(minWidth, snapValue(size.width, gridSize)),
  height: Math.max(minHeight, snapValue(size.height, gridSize)),
})
