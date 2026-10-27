import Phaser from 'phaser';
import { Inventory } from '../core/Inventory';
import { Item } from '../core/Item';
import { LootTable } from '../core/LootTable';
import { ItemVisual } from '../ui/ItemVisual';
import { CombatEngine } from '../core/CombatEngine';
import type { CombatTurnLog } from '../core/CombatEngine';
import { ItemTooltip } from '../ui/ItemTooltip';
import { buildItemTooltipContent } from '../ui/ItemTooltipContent';
import { canUsePoweredEffect, previewPoweredEffect } from '../core/EnergyPlan';
import { UITheme, cssColor } from '../ui/UITheme';
import { ITEM_PRESENTATIONS } from '../ui/ItemPresentation';

type BattleState = 'active' | 'victory' | 'defeat';

const UI_DEPTH = UITheme.layers.hud;

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
    private itemTooltip!: ItemTooltip;
    private hoveredItem: ItemVisual | null = null;
    private tooltipTimer: Phaser.Time.TimerEvent | null = null;
    private pointerInside = false;
    private tooltipFocused = true;

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
    private buttonTween: Phaser.Tweens.Tween | null = null;
    private buttonTargetColor: number | null = null;

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
        this.buttonTween = null;
        this.buttonTargetColor = null;
        this.hoveredItem = null;
        this.tooltipTimer = null;
        this.pointerInside = false;
        this.tooltipFocused = this.game.loop.inFocus;
    }

    preload(): void {
        for (const presentation of Object.values(ITEM_PRESENTATIONS)) {
            if (!this.textures.exists(presentation.textureKey)) {
                // Phaser continues after a file error. ItemVisual checks the cache
                // before creating an Image, so missing/invalid art stays a label.
                this.load.image(presentation.textureKey, presentation.path);
            }
        }
    }

    create(): void {
        this.combatEngine = new CombatEngine(this.inventory, 100, 50, 12, 'Rad-Scorpion');
        this.itemTooltip = new ItemTooltip(this);
        this.input.dragDistanceThreshold = 6;
        this.input.dragTimeThreshold = 0;
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
        this.input.on('pointerup', this.releaseButton, this);
        this.input.on('pointerupoutside', this.handlePointerOutside, this);
        this.input.on('gameout', this.handlePointerOutside, this);
        this.input.on('gameover', this.handlePointerEnter, this);
        this.input.on('pointermove', this.handlePointerMove, this);
        this.game.events.on(Phaser.Core.Events.BLUR, this.handleBlur, this);
        this.game.events.on(Phaser.Core.Events.FOCUS, this.handleFocus, this);

        this.drawGrid();
        const battery = new Item({
            id: 'scrap_battery_01', definitionId: 'rusty_battery', name: 'Rusty Battery', type: 'battery',
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
        this.refreshConsumerPowerVisuals();
        this.updateTooltipHover();
    }

    private refreshConsumerPowerVisuals(): void {
        for (const visual of this.visualItemsMap.values()) {
            if (visual.itemModel.type === 'weapon' || visual.itemModel.type === 'armor') {
                visual.refresh();
            }
        }
    }

    private handleShutdown(): void {
        this.buttonTween?.remove();
        this.buttonTween = null;
        this.input.off('pointerup', this.releaseButton, this);
        this.input.off('pointerupoutside', this.handlePointerOutside, this);
        this.input.off('gameout', this.handlePointerOutside, this);
        this.input.off('gameover', this.handlePointerEnter, this);
        this.input.off('pointermove', this.handlePointerMove, this);
        this.game.events.off(Phaser.Core.Events.BLUR, this.handleBlur, this);
        this.game.events.off(Phaser.Core.Events.FOCUS, this.handleFocus, this);
        this.hideTooltip();
        for (const visual of this.visualItemsMap.values()) {
            visual.destroy();
        }
        this.visualItemsMap.clear();
        this.activeDrag = null;
        this.buttonPointerId = null;
        this.logText.clearMask(true);
        this.logMaskGraphics.destroy();
        this.itemTooltip.destroy();
    }

    private hideTooltip(): void {
        this.tooltipTimer?.remove(false);
        this.tooltipTimer = null;
        this.hoveredItem = null;
        this.itemTooltip?.hide();
    }

    private handlePointerMove(pointer: Phaser.Input.Pointer): void {
        this.pointerInside = pointer.x >= 0 && pointer.y >= 0
            && pointer.x < this.scale.width && pointer.y < this.scale.height;
    }

    private handlePointerEnter(): void {
        this.pointerInside = true;
    }

    private handlePointerOutside(): void {
        this.pointerInside = false;
        this.buttonHovered = false;
        this.hideTooltip();
        this.cancelGestures();
        this.finishButtonTransition();
    }

    private handleBlur(): void {
        this.tooltipFocused = false;
        this.buttonHovered = false;
        this.hideTooltip();
        this.cancelGestures();
        this.finishButtonTransition();
    }

    private handleFocus(): void {
        this.tooltipFocused = true;
        this.pointerInside = this.input.manager.isOver;
    }

    private itemUnderPointer(): ItemVisual | null {
        const pointer = this.input.activePointer;
        const hits = this.input.sortGameObjects(this.input.hitTestPointer(pointer), pointer);
        const top = hits[0];
        for (const visual of this.visualItemsMap.values()) {
            if (visual.rect === top) {
                return visual;
            }
        }
        return null;
    }

    private updateTooltipHover(): void {
        if (!this.pointerInside || !this.tooltipFocused || this.isProcessingTurn || this.activeDrag) {
            this.hideTooltip();
            return;
        }
        const visual = this.itemUnderPointer();
        if (visual !== this.hoveredItem) {
            this.hideTooltip();
            if (visual) {
                this.hoveredItem = visual;
                this.tooltipTimer = this.time.delayedCall(UITheme.durations.tooltipDelay, () => {
                    this.tooltipTimer = null;
                    if (this.hoveredItem === visual && this.itemUnderPointer() === visual
                        && this.pointerInside && this.tooltipFocused && !this.activeDrag && !this.isProcessingTurn) {
                        const pointer = this.input.activePointer;
                        this.itemTooltip.show(buildItemTooltipContent(visual.itemModel,
                            previewPoweredEffect(this.inventory, visual.itemModel)), pointer.x, pointer.y);
                    }
                });
            }
        }
        if (visual && this.itemTooltip.visible) {
            const pointer = this.input.activePointer;
            this.itemTooltip.show(buildItemTooltipContent(visual.itemModel,
                previewPoweredEffect(this.inventory, visual.itemModel)), pointer.x, pointer.y);
        }
    }

    private createCombatUI(): void {
        this.drawPanel(24, 150, 152, 150);
        this.drawPanel(550, 56, 226, 126);
        // Scrap items are interactive above their panel background.
        this.drawPanel(550, 218, 226, 202, 1);
        this.drawPanel(24, 476, 476, 100);
        this.addLabel(200, 110, 'SCRAPPACK INVENTORY', UITheme.fonts.heading);
        this.addLabel(36, 164, 'PLAYER HP', UITheme.fonts.panelHeading);
        this.playerHpFill = this.createHealthBar(36, 190, 128);
        this.playerHpText = this.addLabel(36, 212, '', UITheme.fonts.body);
        this.shieldText = this.addLabel(36, 240, '', UITheme.fonts.body);
        this.hitText = this.addLabel(36, 262, '', UITheme.fonts.body);
        this.addLabel(562, 70, this.combatEngine.enemyName, UITheme.fonts.panelHeading);
        this.enemyHpFill = this.createHealthBar(562, 104, 202);
        this.enemyHpText = this.addLabel(562, 126, '', UITheme.fonts.body);
        this.addLabel(562, 150, `ATK: ${this.combatEngine.enemyBaseDamage}`, UITheme.fonts.body);
        this.statusText = this.addLabel(550, 190, '', UITheme.fonts.panelHeading);
        this.addLabel(562, 228, 'SCRAP', UITheme.fonts.body);
        this.scavengeButton = this.addLabel(550, 450, 'SCAVENGE SCRAP', UITheme.fonts.heading)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                if (pointer.leftButtonDown()) {
                    this.spawnRandomItem();
                }
            });
        this.hintText = this.addLabel(550, 482, '', UITheme.fonts.body)
            .setColor(cssColor(UITheme.colors.secondaryText)).setWordWrapWidth(226, true).setMaxLines(2)
            .setLineSpacing(UITheme.fonts.hintLine - UITheme.fonts.body);
        this.addLabel(36, 486, 'TURN LOG', UITheme.fonts.log);
        this.logText = this.addLabel(36, 506, '', UITheme.fonts.log)
            .setColor(cssColor(UITheme.colors.secondaryText)).setWordWrapWidth(452, true)
            .setLineSpacing(UITheme.fonts.logLine - UITheme.fonts.log);
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

        this.endTurnButton = this.add.rectangle(550, 520, 226, 48, UITheme.colors.button)
            .setOrigin(0).setDepth(UI_DEPTH + 1).setStrokeStyle(UITheme.borders.panel, UITheme.colors.border)
            .setInteractive();
        this.endTurnLabel = this.addLabel(663, 544, 'END TURN', UITheme.fonts.heading).setOrigin(0.5);
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
            fontSize: `${size}px`, color: cssColor(UITheme.colors.text), fontFamily: UITheme.fonts.family,
            metrics: { ascent: size - 3, descent: 3, fontSize: size }
        }).setOrigin(0).setDepth(UI_DEPTH + 2);
    }

    private drawPanel(x: number, y: number, width: number, height: number, depth: number = UI_DEPTH): void {
        const graphics = this.add.graphics().setDepth(depth);
        graphics.fillStyle(UITheme.colors.panel).fillRect(x, y, width, height);
        graphics.lineStyle(UITheme.borders.panel, UITheme.colors.border).strokeRect(x, y, width, height);
    }

    private createHealthBar(x: number, y: number, width: number): Phaser.GameObjects.Rectangle {
        this.add.rectangle(x, y, width, 14, UITheme.colors.barBackground).setOrigin(0).setDepth(UI_DEPTH + 1);
        return this.add.rectangle(x, y, width, 14, UITheme.colors.health).setOrigin(0).setDepth(UI_DEPTH + 1);
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
        this.scavengeButton.setColor(cssColor(canChange && !this.activeDrag
            ? UITheme.colors.text : UITheme.colors.disabledText));

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
        this.refreshConsumerPowerVisuals();
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
        const target = !enabled ? UITheme.colors.buttonDisabled : pressed ? UITheme.colors.buttonPressed
            : this.buttonHovered ? UITheme.colors.buttonHover : UITheme.colors.button;
        if (target !== this.buttonTargetColor) {
            this.buttonTween?.remove();
            this.buttonTween = null;
            this.buttonTargetColor = target;
            if (enabled && !pressed) {
                const from = Phaser.Display.Color.ValueToColor(this.endTurnButton.fillColor);
                const to = Phaser.Display.Color.ValueToColor(target);
                const progress = { value: 0 };
                this.buttonTween = this.tweens.add({
                    targets: progress, value: 1, duration: UITheme.durations.buttonHover,
                    onUpdate: () => {
                        const color = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, 1, progress.value);
                        this.endTurnButton.setFillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                    },
                    onComplete: () => {
                        this.endTurnButton.setFillStyle(target);
                        this.buttonTween = null;
                    }
                });
            } else {
                this.endTurnButton.setFillStyle(target);
            }
        }
        this.endTurnButton.setAlpha(1);
        this.endTurnButton.input!.cursor = enabled ? 'pointer' : 'default';
        if (this.buttonHovered) {
            this.input.setCursor(this.endTurnButton.input!);
        }
        this.endTurnLabel.setAlpha(1).setColor(cssColor(enabled ? UITheme.colors.text : UITheme.colors.disabledText));
    }

    private releaseButton(): void {
        this.buttonPointerId = null;
        this.refreshButton();
    }

    private finishButtonTransition(): void {
        this.buttonTween?.remove();
        this.buttonTween = null;
        if (this.buttonTargetColor !== null) {
            this.endTurnButton.setFillStyle(this.buttonTargetColor);
        }
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
        this.hideTooltip();
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
            this.updateTooltipHover();
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
            isPoweredEffectAvailable: item => canUsePoweredEffect(this.inventory, item),
            onClick: clickedVisual => this.selectItem(clickedVisual),
            onHover: (_visual, pointer) => {
                this.handlePointerMove(pointer);
                this.updateTooltipHover();
            },
            onHoverEnd: departingVisual => {
                if (this.hoveredItem === departingVisual) {
                    this.hideTooltip();
                }
            },
            onDragStart: draggedVisual => {
                this.hideTooltip();
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
                this.updateTooltipHover();
            },
            onDestroy: destroyedVisual => {
                if (this.hoveredItem === destroyedVisual) {
                    this.hideTooltip();
                }
                this.visualItemsMap.delete(itemModel.id);
            }
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
        graphics.lineStyle(UITheme.borders.grid, UITheme.colors.border);
        for (let row = 0; row < this.inventory.height; row++) {
            for (let col = 0; col < this.inventory.width; col++) {
                graphics.strokeRect(this.gridStartX + col * this.cellSize,
                    this.gridStartY + row * this.cellSize, this.cellSize, this.cellSize);
            }
        }
    }
}
