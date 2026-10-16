# Scrappack Survivor - Project Master Specification

## 1. Tech Stack
- Framework: Phaser 3 (Strictly Canvas/WebGL internal rendering)
- Language: TypeScript (Strictly typed)
- Build Tool: Vite
- Deployment Target: PC/Steam (Via Electron/Tauri in the future)

## 2. Core Game Architecture (Current State)
The game is an inventory-management roguelike where the backpack acts as an electrical circuit grid. There is a strict split between Data Models (`src/game/core/`) and Visuals (`src/game/ui/`, `src/game/scenes/`).

### Core Data Models (`src/game/core/`)
1. **`Inventory.ts`**:
   - Manages a 2D matrix grid `(string | null)[][]` (Default: 6x6).
   - Contains: `canPlaceItem()`, `placeItem()`, `removeItem(itemId)`.
   - **`updatePowerGrid()` (BFS Algorithm)**: Runs a wave-based Breadth-First Search from active batteries. Propagates power through wires and transformers based on strict directional vectors. Sets `item.isPowered = true` if the matching voltage reaches weapons or armor.

2. **`Item.ts`**:
   - Defines `ItemConfig` and `Item` class with structural fields: `id`, `name`, `type`, `width`, `height`, `color`, `gridX`, `gridY`, `isPowered`.
   - `type` supports: `'weapon' | 'armor' | 'battery' | 'wire' | 'transformer'`.
   - **Scalable Stats**: Weapons (`baseDamage`, `poweredDamage`), Armors (`baseArmor`, `poweredArmor`).
   - **Grid Specs**: Batteries (`capacity`, `maxCapacity`, `voltageType: 'low' | 'high'`), Wires (`connectionPorts` vectors), Transformers (`inputDir`, `outputDir`, `transformDirection`).
   - Contains **`rotate()`**: Rotates item shapes and flips direction vectors 90 degrees clockwise `(x, y) -> (-y, x)` on Key 'R'.

3. **`LootTable.ts`**:
   - Standalone constant file holding pre-defined base configs for 6 starter items (Weak Battery, Heavy Battery, Copper Wire, Step-up Transformer, Laser Pistol, Flak Jacket).

### Visual & UI Layer
1. **`src/game/ui/ItemVisual.ts`**:
   - Dedicated Phaser GameObject wrapper for items.
   - Encapsulates Phaser Rectangle, labels, drag events (`dragstart`, `drag`, `dragend`), Key 'R' rotation tracking, and neon color shift via `refreshVisuals()`.
2. **`src/game/scenes/GameScene.ts`**:
   - Orchestrates the game loop, draws the 6x6 Pip-Boy style green grid, renders the interactive "SCAVENGE SCRAP" button, and handles random item spawning with offset positioning.

## 3. Implemented Features (Changelog)
- Strict 2D grid placement with bounding check.
- Interactive drag-and-drop mechanics with snapping.
- Directional physics: Transformers require exact input-to-output path alignment. Wires require matching connection ports. Parallel connection bug fixed.
- Complete visual power network mapping (wires and transformers glow cyan/yellow under power, weapons/armors outline in neon green).
