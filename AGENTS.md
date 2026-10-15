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
- **Base Inventory Grid System**: Built 2D grid matrix verification (`src/game/core/Inventory.ts` and `src/game/core/Item.ts`) with strict validation.
- **Drag-and-Drop & Snapping**: Integrated Phaser 3 mouse events with core data models to snap items to cells.

### Current Task: Item Rotation (Key 'R')
We are implementing a 90-degree item rotation when the user presses the 'R' key WHILE dragging an item.
- `src/game/core/Item.ts`: Add a `rotate()` method that swaps `width` and `height`.
- `src/game/scenes/GameScene.ts`: Listen to the 'R' key during drag. When pressed, rotate the data model, and update the Phaser Rectangle's width and height visually using `rect.setSize()` and updating `hitArea`.

### Upcoming Tasks (Backlog)
- **Loot Generator**: Spawning random post-apocalyptic items (1x1 ammo, 2x2 scrap armor, 3x2 lasers) onto the ground area.
- **Energy Grid (Core Hook)**: Implementing item power connections inside the grid.
