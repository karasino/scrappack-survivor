# Scrappack Survivor - Project Instructions

## Tech Stack
- Framework: Phaser 3 (Strictly Canvas/WebGL internal rendering, no HTML DOM for game objects)
- Language: TypeScript (Strictly typed)
- Build Tool: Vite
- Deployment Target: Desktop app (via Tauri/Electron integration in the future)

## Architecture Rules
1. **Data Model vs Visuals Split**: Keep a strict separation between core game logic (Data Models in `src/game/core/`) and rendering (Phaser Scenes in `src/game/scenes/`). Phaser scenes must only mirror the state of the data models.
2. **Modular Code**: Code must be split logically into separate classes and files. Do not dump everything into single files.
3. **Animations & UI**: Use Phaser's built-in Tweens system for animations. UI must be drawn using Phaser GameObjects (Containers, Rectangles, Text).

## Project Roadmap & Tasks

### Completed Tasks (Done)
- **Base Inventory Grid System**: Built 2D grid matrix verification.
- **Drag-and-Drop & Snapping**: Integrated Phaser 3 mouse events.
- **Item Rotation (Key 'R')**: Implemented 90-degree item rotation.
- **Loot Generator**: Added random item spawning with 5 distinct types.
- **Wave-Based Power Grid (BFS)**: Implemented advanced electricity transmission via wires and transformers.

### Current Task: Visual Power Feedback (Neon Glow & Wire States)
We need to update the visual representation of items in Phaser based on their electrical state after `updatePowerGrid()`.
1. `src/game/scenes/GameScene.ts`: Create a way to track and refresh visual items. 
2. When an item has `isPowered === true` (Weapons/Armor): Add a neon stroke/glow or change its border style to show it is active.
3. When a wire or transformer is transmitting energy: Change its color dynamically (e.g., normal copper wire becomes bright glowing cyan/yellow when active).
4. Implement a refresh method `refreshVisuals()` that runs right after `updatePowerGrid()` in the `dragend` event to update all items on the screen.

