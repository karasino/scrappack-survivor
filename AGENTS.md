# Scrappack Survivor - Project Master Specification

## 1. Tech Stack
- Framework: Phaser 3 (Strictly Canvas/WebGL internal rendering)
- Language: TypeScript (Strictly typed)
- Build Tool: Vite
- Deployment Target: PC/Steam (Via Electron/Tauri in the future)

## 2. Core Game Architecture
The game is an inventory-management roguelike where the backpack acts as an electrical circuit grid. There is a strict split between Data Models (`src/game/core/`) and Visuals (`src/game/ui/`, `src/game/scenes/`).

### Core Data Models (`src/game/core/`)
1. **`Item.ts`**:
   - Defines `ItemConfig` and `Item` class with structural fields: `id`, `name`, `type`, `width`, `height`, `color`, `gridX`, `gridY`, `isPowered`.
   - `type` supports: `'weapon' | 'armor' | 'battery' | 'wire' | 'transformer'`.
   - **Scalable Stats**: Weapons (`baseDamage`, `poweredDamage`), Armors (`baseArmor`, `poweredArmor`).
   - **Grid Specs**: Batteries (`charge`, `maxCharge`, `voltageType: 'low' | 'high'`), Wires (`connectionPorts`), Transformers (`inputDir`, `outputDir`, `transformDirection`).
   - Contains `connectedBatteries: Array<{ batteryId: string, costMultiplier: number }>` for items receiving power.
   - Contains `isSelectedForTurn: boolean` for strategic turn selection.
   - Contains `rotate()`: Rotates item shapes and flips direction vectors 90 degrees clockwise `(x, y) -> (-y, x)` on Key 'R'.

2. **`Inventory.ts`**:
   - Manages a 2D matrix grid `(string | null)[][]` (Default: 6x6).
   - Contains: `canPlaceItem()`, `placeItem()`, `removeItem(itemId)`.
   - **`updatePowerGrid()` (BFS Algorithm)**: Runs a wave-based Breadth-First Search from active batteries. Propagates power through wires and transformers based on strict directional vectors. Clears `connectedBatteries` initially, then populates it with `{ batteryId, costMultiplier }` when a valid power wave reaches a weapon/armor. Sets `isPowered = true` if `connectedBatteries.length > 0`.

3. **`LootTable.ts`**:
   - Standalone constant file holding pre-defined base configs for 6 starter items (Weak Battery, Heavy Battery, Copper Wire, Step-up Transformer, Laser Pistol, Flak Jacket).

4. **`CombatEngine.ts` (New Class)**:
   - Pure TypeScript turn-based combat calculator. Tracks Player HP, Player Shield (temporary armor built each turn), and Enemy stats.
   - **`processTurn(selectedWeaponId, selectedArmorId)`**: Resolves damage dealt to enemy, generates temporary shield from powered armor, calculates incoming enemy damage after shield mitigation, and drains battery `charge` values evenly across connected sources based on weapon/armor consumption and multipliers. Triggers `inventory.updatePowerGrid()` if a battery runs dry.

### Visual & UI Layer
1. **`src/game/ui/ItemVisual.ts`**: Handles Phaser graphics, drag events, Key 'R' rotation tracking, and neon color shift via `refreshVisuals()`.
2. **`src/game/scenes/GameScene.ts`**: Orchestrates the main loop, draws the Pip-Boy green grid, and handles random item spawning.

### Completed Tasks (Done)
- **Base Inventory Grid System**: Built 2D grid matrix verification.
- **Drag-and-Drop & Snapping**: Integrated Phaser 3 mouse events.
- **Item Rotation (Key 'R')**: Implemented 90-degree item rotation.
- **Loot Generator**: Added random item spawning with 5 distinct types.
- **Wave-Based Power Grid (BFS)**: Implemented advanced electricity transmission.
- **Visual Feedback**: Added neon glow and dynamic wire color changes.
- **Combat Core Model (Task #1 & #2)**: Created `CombatEngine.ts` with strict energy cost splitting and battery deletion logic.

### Current Task: Phaser Combat UI Integration (Task #3)
Integrating the `CombatEngine` with Phaser 3 rendering layer.
1. `src/game/scenes/GameScene.ts`:
   - Instantiate `CombatEngine` in `create()` with initial stats (e.g., Player HP: 100, Enemy: "Rad-Scorpion", HP: 50, DMG: 12).
   - Draw UI text elements: Enemy Name, Enemy HP Bar, Player HP Bar, and a Turn Log box.
   - Add an "END TURN" interactive text/rectangle button (X: 550, Y: 520).
2. `src/game/ui/ItemVisual.ts` & `src/game/scenes/GameScene.ts`:
   - Implement selection logic: Clicking an item in the inventory toggles `itemModel.isSelectedForTurn`. 
   - Visually highlight selected items (e.g., change alpha, add a white/yellow border, or change overlay). Ensure only ONE weapon and ONE armor can be selected at a time.
3. Turn Execution:
   - Clicking "END TURN" reads the IDs of the currently selected weapon and armor, triggers `combatEngine.processTurn(weaponId, armorId)`, and runs `refreshVisuals()`.
   - Update HP bars using the returned `CombatTurnLog`, print logs into the text box, and check win/loss conditions.
