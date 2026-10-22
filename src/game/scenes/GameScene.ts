import Phaser from 'phaser';
import { Inventory } from '../core/Inventory';
import { Item } from '../core/Item';
import { LootTable } from '../core/LootTable';
import { ItemVisual } from '../ui/ItemVisual';
import { CombatEngine } from '../core/CombatEngine';
import type { CombatTurnLog } from '../core/CombatEngine';

type BattleState = 'active' | 'victory' | 'defeat';

const UI_DEPTH = 100;
const GREEN = 0x00ff66;

export class GameScene extends Phaser.Scene {
    private inventory!: Inventory;
    private combatEngine!: CombatEngine;
    private readonly visualItemsMap = new Map<string, ItemVisual>();
    private readonly messages: string[] = [];
    private completedTurns = 0;
    private battleState: BattleState = 'active';
    private isProcessingTurn = false;
    private hasCombatError = false;
    private activeDrag: ItemVisual | null = null;
    private nextAllowedTurnAt = 0;
    private lastTurnLog: CombatTurnLog | null = null;
    private selectionError: string | null = null;

    private playerHpFill!: Phaser.GameObjects.Rectangle;
    private enemyHpFill!: Phaser.GameObjects.Rectangle;
    private playerHpText!: Phaser.GameObjects.Text;
    private enemyHpText!: Phaser.GameObjects.Text;
    private shieldText!: Phaser.GameObjects.Text;
    private hitText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private hintText!: Phaser.GameObjects.Text;
    private logText!: Phaser.GameObjects.Text;
    private logMaskGraphics!: Phaser.GameObjects.Graphics;
    private scavengeButton!: Phaser.GameObjects.Text;
    private endTurnButton!: Phaser.GameObjects.Rectangle;
    private endTurnLabel!: Phaser.GameObjects.Text;
    private buttonHovered = false;
    private buttonPointerId: number | null = null;

    private readonly cellSize = 50;
    private readonly gridStartX = 200;
    private readonly gridStartY = 150;

    constructor() {
        super('GameScene');
    }

    init(): void {
        for (const visual of this.visualItemsMap.values()) {
            visual.destroy();
        }
        this.visualItemsMap.clear();
        this.inventory = new Inventory(6, 6);
        this.messages.length = 0;
        this.completedTurns = 0;
        this.battleState = 'active';
        this.isProcessingTurn = false;
        this.hasCombatError = false;
        this.activeDrag = null;
        this.nextAllowedTurnAt = 0;
        this.lastTurnLog = null;
        this.selectionError = null;
        this.buttonHovered = false;
        this.buttonPointerId = null;
    }

    create(): void {
        this.combatEngine = new CombatEngine(this.inventory, 100, 50, 12, 'Rad-Scorpion');
        this.input.dragDistanceThreshold = 6;
        this.input.dragTimeThreshold = 0;
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
        this.input.on('pointerup', this.releaseButton, this);
        this.input.on('pointerupoutside', this.cancelGestures, this);
        this.input.on('gameout', this.cancelGestures, this);
        this.game.events.on(Phaser.Core.Events.BLUR, this.cancelGestures, this);

        this.drawGrid();
        const battery = new Item({
            id: 'scrap_battery_01', name: 'Ржавая батарейка', type: 'battery',
            width: 2, height: 1, capacity: 5, maxCapacity: 5,
            charge: 5, maxCharge: 5, voltageType: 'low', color: 0x00ff00
        });
        this.addItemVisual(battery);
        this.createCombatUI();
        this.appendMessage('SCAVENGE SCRAP, move a weapon into the grid, then click to select it.');
        this.updateCombatUI();
    }

    update(): void {
        if (this.nextAllowedTurnAt > 0 && this.time.now >= this.nextAllowedTurnAt) {
            this.nextAllowedTurnAt = 0;
            this.updateCombatUI();
        }
    }

    private handleShutdown(): void {
        this.input.off('pointerup', this.releaseButton, this);
        this.input.off('pointerupoutside', this.cancelGestures, this);
        this.input.off('gameout', this.cancelGestures, this);
        this.game.events.off(Phaser.Core.Events.BLUR, this.cancelGestures, this);
        for (const visual of this.visualItemsMap.values()) {
            visual.destroy();
        }
        this.visualItemsMap.clear();
        this.activeDrag = null;
        this.buttonPointerId = null;
        this.logText.clearMask(true);
        this.logMaskGraphics.destroy();
    }

    private createCombatUI(): void {
        this.drawPanel(24, 150, 152, 150);
        this.drawPanel(550, 56, 226, 126);
        // Scrap items are interactive above their panel background.
        this.drawPanel(550, 218, 226, 202, 1);
        this.drawPanel(24, 476, 476, 100);
        this.addLabel(200, 110, 'SCRAPPACK INVENTORY', 20);
        this.addLabel(36, 164, 'PLAYER HP', 16);
        this.playerHpFill = this.createHealthBar(36, 190, 128);
        this.playerHpText = this.addLabel(36, 212, '', 14);
        this.shieldText = this.addLabel(36, 240, '', 12);
        this.hitText = this.addLabel(36, 262, '', 12);
        this.addLabel(562, 70, this.combatEngine.enemyName, 18);
        this.enemyHpFill = this.createHealthBar(562, 104, 202);
        this.enemyHpText = this.addLabel(562, 126, '', 14);
        this.addLabel(562, 150, `ATK: ${this.combatEngine.enemyBaseDamage}`, 14);
        this.statusText = this.addLabel(550, 190, '', 18);
        this.addLabel(562, 228, 'SCRAP', 12);
        this.scavengeButton = this.addLabel(550, 450, 'SCAVENGE SCRAP', 20)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                if (pointer.leftButtonDown()) {
                    this.spawnRandomItem();
                }
            });
        this.hintText = this.addLabel(550, 482, '', 12)
            .setColor('#72b887').setWordWrapWidth(226, true).setMaxLines(2);
        this.addLabel(36, 486, 'TURN LOG', 12);
        this.logText = this.addLabel(36, 506, '', 12).setColor('#72b887')
            .setWordWrapWidth(452, true).setLineSpacing(2);
        // Fixed metrics give a 14px baseline step in both renderers.
        this.logText.setStyle({ metrics: { ascent: 10, descent: 2, fontSize: 12 } });
        this.logMaskGraphics = this.add.graphics();
        this.logMaskGraphics.fillStyle(0xffffff).fillRect(36, 506, 452, 60);
        this.children.remove(this.logMaskGraphics);
        // Phaser 4 uses different masking APIs for Canvas and WebGL.
        if (this.renderer.type === Phaser.WEBGL) {
            this.logText.enableFilters();
            this.logText.filters!.external.addMask(this.logMaskGraphics, false, this.cameras.main);
        } else {
            this.logText.setMask(this.logMaskGraphics.createGeometryMask());
        }

        this.endTurnButton = this.add.rectangle(550, 520, 226, 48, 0x0c2816)
            .setOrigin(0).setDepth(UI_DEPTH + 1).setStrokeStyle(1, GREEN)
            .setInteractive();
        this.endTurnLabel = this.addLabel(663, 544, 'END TURN', 20).setOrigin(0.5);
        this.endTurnButton.on('pointerover', () => {
            this.buttonHovered = true;
            this.refreshButton();
        });
        this.endTurnButton.on('pointerout', () => {
            this.buttonHovered = false;
            this.releaseButton();
        });
        this.endTurnButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (pointer.leftButtonDown() && this.canEndTurn()) {
                this.buttonPointerId = pointer.id;
                this.refreshButton();
            }
        });
        this.endTurnButton.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            const shouldResolve = pointer.button === 0 && this.buttonPointerId === pointer.id;
            this.buttonPointerId = null;
            if (shouldResolve && this.canEndTurn()) {
                this.resolveTurn();
            }
            this.refreshButton();
        });
    }

    private addLabel(x: number, y: number, text: string, size: number): Phaser.GameObjects.Text {
        return this.add.text(x, y, text, {
            fontSize: `${size}px`, color: '#00ff66', fontFamily: 'monospace'
        }).setOrigin(0).setDepth(UI_DEPTH + 2);
    }

    private drawPanel(x: number, y: number, width: number, height: number, depth = UI_DEPTH): void {
        const graphics = this.add.graphics().setDepth(depth);
        graphics.fillStyle(0x07140b).fillRect(x, y, width, height);
        graphics.lineStyle(5, GREEN, 0.12).strokeRect(x, y, width, height);
        graphics.lineStyle(1, GREEN).strokeRect(x, y, width, height);
    }

    private createHealthBar(x: number, y: number, width: number): Phaser.GameObjects.Rectangle {
        this.add.rectangle(x, y, width, 14, 0x102b18).setOrigin(0).setDepth(UI_DEPTH + 1);
        return this.add.rectangle(x, y, width, 14, 0x39ff14).setOrigin(0).setDepth(UI_DEPTH + 1);
    }

    private updateCombatUI(): void {
        const engine = this.combatEngine;
        const updateBar = (bar: Phaser.GameObjects.Rectangle, hp: number, max: number, width: number): void => {
            const ratio = max > 0 ? Phaser.Math.Clamp(hp / max, 0, 1) : 0;
            bar.setDisplaySize(width * ratio, 14).setVisible(ratio > 0);
        };
        updateBar(this.playerHpFill, engine.playerHp, engine.playerMaxHp, 128);
        updateBar(this.enemyHpFill, engine.enemyHp, engine.enemyMaxHp, 202);
        this.playerHpText.setText(`${engine.playerHp} / ${engine.playerMaxHp}`);
        this.enemyHpText.setText(`${engine.enemyHp} / ${engine.enemyMaxHp}`);
        this.shieldText.setText(`SHIELD LAST: ${this.lastTurnLog?.shieldGenerated ?? '—'}`);
        this.hitText.setText(`HIT LAST: ${this.lastTurnLog?.damageTaken ?? '—'}`);
        this.statusText.setText(this.battleState === 'active'
            ? `TURN ${String(this.completedTurns + 1).padStart(2, '0')}`
            : this.battleState.toUpperCase());
        const lines = this.messages.flatMap(message => this.logText.getWrappedText(message));
        this.logText.setText(lines.slice(-4).join('\n'));

        const canChange = this.canChangeInventory();
        for (const visual of this.visualItemsMap.values()) {
            visual.setInteractionEnabled(canChange && (!this.activeDrag || this.activeDrag === visual));
        }
        this.scavengeButton.input!.enabled = canChange && !this.activeDrag;
        this.scavengeButton.setAlpha(canChange && !this.activeDrag ? 1 : 0.35);

        const { weapons, armors, valid } = this.getSelection();
        let hint: string;
        if (this.hasCombatError) {
            hint = 'COMBAT ERROR\nRESTART REQUIRED';
        } else if (this.battleState !== 'active') {
            hint = this.battleState.toUpperCase();
        } else if (this.isProcessingTurn) {
            hint = 'RESOLVING...';
        } else if (this.activeDrag) {
            hint = 'FINISH MOVING ITEM';
        } else if (this.selectionError) {
            hint = this.selectionError;
        } else if (!valid || weapons.length > 1 || armors.length > 1) {
            hint = 'INVALID SELECTION';
        } else if (weapons.length === 0) {
            hint = 'SELECT A WEAPON';
        } else {
            hint = armors.length ? 'WEAPON + ARMOR READY' : 'WEAPON READY';
        }
        this.hintText.setText(hint);
        this.refreshButton();
    }

    private appendMessage(message: string): void {
        this.messages.push(message);
        if (this.messages.length > 64) {
            this.messages.splice(0, this.messages.length - 64);
        }
    }

    private canChangeInventory(): boolean {
        return this.battleState === 'active' && !this.isProcessingTurn && !this.hasCombatError;
    }

    private isPlacedItem(item: Item): boolean {
        if (!this.inventory.items.includes(item) || !Number.isInteger(item.gridX) || !Number.isInteger(item.gridY)
            || item.gridX < 0 || item.gridY < 0
            || item.gridX + item.width > this.inventory.width || item.gridY + item.height > this.inventory.height) {
            return false;
        }
        for (let y = item.gridY; y < item.gridY + item.height; y++) {
            for (let x = item.gridX; x < item.gridX + item.width; x++) {
                if (this.inventory.grid[y]?.[x] !== item.id) {
                    return false;
                }
            }
        }
        return true;
    }

    private getSelection(): { weapons: Item[]; armors: Item[]; valid: boolean } {
        const selected = this.inventory.items.filter(item => item.isSelectedForTurn);
        return {
            weapons: selected.filter(item => item.type === 'weapon'),
            armors: selected.filter(item => item.type === 'armor'),
            valid: selected.every(item => (item.type === 'weapon' || item.type === 'armor') && this.isPlacedItem(item))
        };
    }

    private canEndTurn(): boolean {
        if (!this.canChangeInventory() || this.activeDrag || this.time.now < this.nextAllowedTurnAt) {
            return false;
        }
        const { weapons, armors, valid } = this.getSelection();
        return valid && weapons.length === 1 && armors.length <= 1;
    }

    private refreshButton(): void {
        const enabled = this.canEndTurn();
        const pressed = enabled && this.buttonPointerId !== null;
        this.endTurnButton.setAlpha(enabled ? 1 : 0.35)
            .setFillStyle(pressed ? 0x39ff14 : enabled && this.buttonHovered ? 0x164429 : 0x0c2816);
        this.endTurnButton.input!.cursor = enabled ? 'pointer' : 'default';
        if (this.buttonHovered) {
            this.input.setCursor(this.endTurnButton.input!);
        }
        this.endTurnLabel.setAlpha(enabled ? 1 : 0.35).setColor(pressed ? '#07140b' : '#00ff66');
    }

    private releaseButton(): void {
        this.buttonPointerId = null;
        this.refreshButton();
    }

    private cancelGestures(): void {
        for (const visual of this.visualItemsMap.values()) {
            visual.cancelGesture();
        }
        this.releaseButton();
    }

    private selectItem(visual: ItemVisual): void {
        const item = visual.itemModel;
        if (!this.canChangeInventory() || this.activeDrag || !this.isPlacedItem(item)
            || (item.type !== 'weapon' && item.type !== 'armor')) {
            return;
        }
        const selected = !item.isSelectedForTurn;
        for (const candidate of this.inventory.items) {
            if (candidate.type === item.type) {
                candidate.isSelectedForTurn = candidate === item && selected;
                this.visualItemsMap.get(candidate.id)?.refresh();
            }
        }
        this.selectionError = null;
        this.updateCombatUI();
    }

    private synchronizeTurnVisuals(batteryIds: string[]): string[] {
        const remaining = new Set(this.inventory.items.map(item => item.id));
        const removedNames: string[] = [];
        for (const id of batteryIds) {
            const visual = this.visualItemsMap.get(id);
            if (!remaining.has(id) && visual) {
                removedNames.push(visual.itemModel.name);
                visual.destroy();
            }
        }
        for (const visual of this.visualItemsMap.values()) {
            visual.refresh();
        }
        return removedNames;
    }

    private resolveTurn(): void {
        if (!this.canChangeInventory() || this.activeDrag || this.time.now < this.nextAllowedTurnAt) {
            return;
        }
        const { weapons, armors, valid } = this.getSelection();
        if (!valid || weapons.length !== 1 || armors.length > 1) {
            this.selectionError = 'SELECT ONE WEAPON\nAND AT MOST ONE ARMOR';
            this.appendMessage('Turn cancelled: select exactly one placed weapon and at most one placed armor.');
            this.updateCombatUI();
            return;
        }

        this.isProcessingTurn = true;
        this.updateCombatUI();
        const batteryIds = this.inventory.items.filter(item => item.type === 'battery').map(item => item.id);
        try {
            const log = this.combatEngine.processTurn(weapons[0].id, armors[0]?.id ?? null);
            this.lastTurnLog = log;
            this.completedTurns++;
            this.nextAllowedTurnAt = this.time.now + 250;
            const removedNames = this.synchronizeTurnVisuals(batteryIds);
            this.appendMessage(`TURN ${String(this.completedTurns).padStart(2, '0')}: ${log.weaponUsedName} — DAMAGE ${log.damageDealt}`);
            this.appendMessage(`ARMOR: ${log.armorUsedName ?? 'NONE'} — SHIELD ${log.shieldGenerated}`);
            this.appendMessage(`HIT TAKEN: ${log.damageTaken}`);
            for (const name of removedNames) {
                this.appendMessage(`BATTERY DEPLETED: ${name}`);
            }
            this.battleState = log.isPlayerDead ? 'defeat' : log.isEnemyDead ? 'victory' : 'active';
            if (log.isPlayerDead && log.isEnemyDead) {
                this.appendMessage('DEFEAT: player and enemy both died.');
            } else if (this.battleState !== 'active') {
                this.appendMessage(this.battleState.toUpperCase());
            }
        } catch (error) {
            this.hasCombatError = true;
            const detail = error instanceof Error ? error.message : String(error);
            this.appendMessage(`COMBAT ERROR: ${detail}. Restart the scene to continue.`);
            for (const name of this.synchronizeTurnVisuals(batteryIds)) {
                this.appendMessage(`BATTERY DEPLETED: ${name}`);
            }
        } finally {
            this.isProcessingTurn = false;
            this.updateCombatUI();
        }
    }

    private spawnRandomItem(): void {
        if (!this.canChangeInventory() || this.activeDrag) {
            return;
        }
        const config = Phaser.Utils.Array.GetRandom(LootTable);
        const itemModel = new Item({ ...config, id: `item_${Phaser.Utils.String.UUID()}` });
        this.addItemVisual(itemModel);
    }

    private addItemVisual(itemModel: Item): void {
        const visual = new ItemVisual(this, itemModel, this.cellSize, {
            isInteractionAllowed: () => this.canChangeInventory()
                && (!this.activeDrag || this.activeDrag.itemModel === itemModel),
            onClick: clickedVisual => this.selectItem(clickedVisual),
            onDragStart: draggedVisual => {
                this.activeDrag = draggedVisual;
                itemModel.isSelectedForTurn = false;
                this.selectionError = null;
                if (this.inventory.removeItem(itemModel.id)) {
                    this.refreshPowerGrid();
                }
                draggedVisual.refresh();
                this.updateCombatUI();
            },
            onDragEnd: (draggedVisual, cancelled) => {
                if (cancelled) {
                    draggedVisual.resetPosition();
                    this.refreshPowerGrid();
                } else {
                    this.placeDraggedItem(draggedVisual);
                }
                this.activeDrag = null;
                this.updateCombatUI();
            },
            onDestroy: () => this.visualItemsMap.delete(itemModel.id)
        });
        this.visualItemsMap.set(itemModel.id, visual);
    }

    private placeDraggedItem(visual: ItemVisual): void {
        const { itemModel, rect } = visual;
        const gridX = Math.round((rect.x - this.gridStartX) / this.cellSize);
        const gridY = Math.round((rect.y - this.gridStartY) / this.cellSize);
        if (this.inventory.placeItem(itemModel, gridX, gridY)) {
            visual.setPosition(this.gridStartX + gridX * this.cellSize, this.gridStartY + gridY * this.cellSize);
        } else {
            visual.resetPosition();
        }
        this.refreshPowerGrid();
    }

    private refreshPowerGrid(): void {
        this.inventory.updatePowerGrid();
        for (const visual of this.visualItemsMap.values()) {
            visual.refresh();
        }
    }

    private drawGrid(): void {
        const graphics = this.add.graphics();
        graphics.lineStyle(1, GREEN, 0.5);
        for (let row = 0; row < this.inventory.height; row++) {
            for (let col = 0; col < this.inventory.width; col++) {
                graphics.strokeRect(this.gridStartX + col * this.cellSize,
                    this.gridStartY + row * this.cellSize, this.cellSize, this.cellSize);
            }
        }
    }
}
