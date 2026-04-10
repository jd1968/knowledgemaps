// Fine-grained snap used for resizing / dimensions.
export const GRID_SIZE = 10
// Map placement grid: 6 columns across the 1470px client area.
export const MAP_CLIENT_WIDTH = 1470
/** Vertical gap (screen px) from the header’s bottom edge to where the map grid / L1 placement begins. */
export const MAP_GRID_TOP_MARGIN_SCREEN_PX = 20
export const MAP_GRID_COLUMNS = 6
export const MAP_GRID_SIZE = MAP_CLIENT_WIDTH / MAP_GRID_COLUMNS
export const MAP_GRID_Y_SIZE = MAP_GRID_SIZE / 2
export const CARD_GAP = 30
export const GRID = [MAP_GRID_SIZE, MAP_GRID_SIZE]

export const NEST_PAD_LEFT = 20
export const NEST_PAD_RIGHT = 20
export const NEST_PAD_TOP = 60
export const NEST_PAD_BOTTOM = 20
export const NEST_V_SPACING = 10

export const snapValue = (value, gridSize = GRID_SIZE) => (
  Math.round(value / gridSize) * gridSize
)

export const snapPoint = (point, gridSize = MAP_GRID_SIZE) => ({
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

// Snap card dimensions to column spans while keeping a fixed gutter between cards.
// 1 col: 245 - 30 = 215, 2 cols: 460, 3 cols: 705, etc.
export const snapCardSpanSize = (value, { min = 60, cellSize = MAP_GRID_SIZE, gap = CARD_GAP } = {}) => {
  const span = Math.max(1, Math.round((value + gap) / cellSize))
  return Math.max(min, span * cellSize - gap)
}
