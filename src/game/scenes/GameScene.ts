import Phaser from 'phaser';
import { Inventory } from '../core/Inventory';
import { Item } from '../core/Item';
import { RunState } from '../core/RunState';
import { ExplorationEngine } from '../core/ExplorationEngine';
import type { ExplorationAction } from '../core/ExplorationEngine';
import { ExplorationMapView } from '../ui/ExplorationMapView';
import { ItemVisual } from '../ui/ItemVisual';
import { CombatEngine } from '../core/CombatEngine';
import type { CombatTurnLog } from '../core/CombatEngine';
import { ItemTooltip } from '../ui/ItemTooltip';
import { buildItemTooltipContent } from '../ui/ItemTooltipContent';
import { canUsePoweredEffect, previewPoweredEffect } from '../core/EnergyPlan';
import { UITheme, cssColor } from '../ui/UITheme';
import { ITEM_PRESENTATIONS } from '../ui/ItemPresentation';
import { LootTable } from '../core/LootTable';
import { MATERIAL_CAPACITY, MATERIAL_NAMES, RECIPES } from '../core/Crafting';
import { ViewButton } from '../ui/ViewButton';
import { WorkshopView } from '../ui/WorkshopView';
import { RunOverlayView } from '../ui/RunOverlayView';
import { buildGroundPanelContent } from '../ui/GroundPanelContent';

type BattleState = 'active' | 'victory' | 'defeat';

const UI_DEPTH = UITheme.layers.hud;
type HudObject = Phaser.GameObjects.Text | Phaser.GameObjects.Graphics | Phaser.GameObjects.Rectangle;
interface DragOrigin { placed: boolean; x: number; y: number; orientation: number; }

export class GameScene extends Phaser.Scene {
    public run!: RunState;
    public exploration!: ExplorationEngine;
    public get inventory(): Inventory { return this.run.inventory; }
    public get combatEngine(): CombatEngine | null { return this.run.combatEngine; }
    public set combatEngine(engine: CombatEngine | null) { this.run.combatEngine = engine; }
    public compact = false;
    public backpackView = false;
    public mapView!: ExplorationMapView;
    public workshopView!: WorkshopView;
    public runOverlay!: RunOverlayView;
    public healButton!: ViewButton;
    public materialPanel!: Phaser.GameObjects.Rectangle;
    public takeMaterialButton!: ViewButton;
    public groundMaterialText!: Phaser.GameObjects.Text;
    private materialText!: Phaser.GameObjects.Text;
    private healHint!: Phaser.GameObjects.Text;
    private gridGraphics!: Phaser.GameObjects.Graphics;
    private groundTitle!: Phaser.GameObjects.Text;
    private groundStatus!: Phaser.GameObjects.Text;
    private readonly backpackObjects: HudObject[] = [];
    private uiSection: 'common' | 'backpack' = 'backpack';
    private dragOrigin: DragOrigin | null = null;
    private groundPage = 0;
    private groundPageKey = '';
    private hoveredEnemyId: string | null = null;
    private materialPointerId: number | null = null;
    private groundCounter!: Phaser.GameObjects.Text;
    private groundEmptyText!: Phaser.GameObjects.Text;
    private previousGround!: Phaser.GameObjects.Text;
    private nextGround!: Phaser.GameObjects.Text;
    private toggleButton!: Phaser.GameObjects.Text;
    private compactSummary!: Phaser.GameObjects.Text;
    private enemyNameText!: Phaser.GameObjects.Text;
    private enemyAttackText!: Phaser.GameObjects.Text;
    private readonly resizeHandler = () => this.applyLayout();
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
        const seed = new Uint32Array(1);
        globalThis.crypto.getRandomValues(seed);
        this.run = new RunState(seed[0]);
        this.exploration = new ExplorationEngine(this.run);
        this.backpackObjects.length = 0;
        this.uiSection = 'backpack';
        this.groundPage = 0;
        this.groundPageKey = '';
        this.dragOrigin = null;
        this.hoveredEnemyId = null;
        this.materialPointerId = null;
        this.compact = false;
        this.backpackView = false;
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
        this.input.keyboard?.on('keydown', this.handleWorldKey, this);
        window.addEventListener('resize', this.resizeHandler);

        this.drawGrid();
        this.createCombatUI();
        this.mapView = new ExplorationMapView(this, {
            onMove: (dx, dy) => this.performWorldAction({ type: 'move', dx, dy }),
            onWait: () => this.performWorldAction({ type: 'wait' }),
            onAction: () => this.performContextAction(),
            onHover: id => {
                if (this.hoveredEnemyId !== id) {
                    this.hoveredEnemyId = id;
                    this.updateCombatUI();
                }
            },
            onNewRun: () => { if (!this.hasOverlay()) this.startNewRun(); }
        });
        this.createRunUI();
        this.uiSection = 'common';
        this.toggleButton = this.addLabel(650, 12, 'BACKPACK', UITheme.fonts.panelHeading)
            .setFixedSize(126, 32).setPadding(10, 6).setBackgroundColor(cssColor(UITheme.colors.button))
            .setInteractive({ useHandCursor: true })
            .on('pointerup', (pointer: Phaser.Input.Pointer) => { if (pointer.button === 0) this.toggleBackpack(); });
        this.compactSummary = this.addLabel(24, 390, '', UITheme.fonts.body)
            .setWordWrapWidth(152, true).setLineSpacing(3);
        this.appendMessage('Explore with WASD or arrows. Search scrap, manage your pack, and reach the exit.');
        this.appendMessage(`RUN SEED: ${this.run.seed}`);
        this.applyLayout();
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
        this.input.keyboard?.off('keydown', this.handleWorldKey, this);
        window.removeEventListener('resize', this.resizeHandler);
        this.mapView?.destroy();
        this.workshopView?.destroy();
        this.runOverlay?.destroy();
        this.healButton?.destroy();
        this.takeMaterialButton?.destroy();
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
        if (!this.pointerInside || !this.tooltipFocused || this.isProcessingTurn || this.activeDrag || this.hasOverlay()) {
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
        this.uiSection = 'common';
        this.drawPanel(24, 150, 152, 150);
        this.addLabel(36, 164, 'PLAYER HP', UITheme.fonts.panelHeading);
        this.playerHpFill = this.createHealthBar(36, 190, 128);
        this.playerHpText = this.addLabel(36, 212, '', UITheme.fonts.body);
        this.shieldText = this.addLabel(36, 240, '', UITheme.fonts.body);
        this.hitText = this.addLabel(36, 262, '', UITheme.fonts.body);
        this.uiSection = 'backpack';
        this.drawPanel(550, 56, 226, 126);
        // Scrap items are interactive above their panel background.
        this.drawPanel(550, 218, 226, 202, 1);
        this.drawPanel(24, 476, 476, 100);
        this.addLabel(200, 110, 'SCRAPPACK INVENTORY', UITheme.fonts.heading);
        this.enemyNameText = this.addLabel(562, 70, '', UITheme.fonts.panelHeading);
        this.enemyHpFill = this.createHealthBar(562, 104, 202);
        this.enemyHpText = this.addLabel(562, 126, '', UITheme.fonts.body);
        this.enemyAttackText = this.addLabel(562, 150, '', UITheme.fonts.body);
        this.statusText = this.addLabel(550, 190, '', UITheme.fonts.panelHeading);
        this.groundTitle = this.addLabel(UITheme.ground.x, 228, 'GROUND', UITheme.fonts.body)
            .setWordWrapWidth(UITheme.ground.width, true).setMaxLines(1);
        this.groundStatus = this.addLabel(UITheme.ground.x, 248, '', 12)
            .setWordWrapWidth(UITheme.ground.width, true).setMaxLines(1)
            .setColor(cssColor(UITheme.colors.secondaryText));
        this.groundEmptyText = this.addLabel(UITheme.ground.x, UITheme.ground.y + 20, 'NOTHING HERE', UITheme.fonts.body)
            .setWordWrapWidth(UITheme.ground.width, true).setColor(cssColor(UITheme.colors.secondaryText));
        this.previousGround = this.addLabel(550, 450, 'PREV', UITheme.fonts.body)
            .setInteractive({ useHandCursor: true })
            .on('pointerup', (p: Phaser.Input.Pointer) => { if (p.button === 0) this.changeGroundPage(-1); });
        this.groundCounter = this.addLabel(650, 450, '0 / 0', UITheme.fonts.body).setOrigin(0.5, 0);
        this.nextGround = this.addLabel(724, 450, 'NEXT', UITheme.fonts.body)
            .setInteractive({ useHandCursor: true })
            .on('pointerup', (p: Phaser.Input.Pointer) => { if (p.button === 0) this.changeGroundPage(1); });
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
        this.backpackObjects.push(this.endTurnButton);
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
            if (pointer.leftButtonDown() && this.canUsePrimaryButton()) {
                this.buttonPointerId = pointer.id;
                this.refreshButton();
            }
        });
        this.endTurnButton.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            const shouldResolve = pointer.button === 0 && this.buttonPointerId === pointer.id;
            this.buttonPointerId = null;
            if (shouldResolve && this.canUsePrimaryButton()) {
                if (this.isRunFinished() || this.hasCombatError) this.startNewRun();
                else this.resolveTurn();
            }
            this.refreshButton();
        });
    }

    private createRunUI(): void {
        this.uiSection = 'common';
        this.materialPanel = this.add.rectangle(24, 24, 476, 56, UITheme.colors.panel).setOrigin(0)
            .setDepth(UI_DEPTH).setStrokeStyle(1, UITheme.colors.border).setInteractive({ useHandCursor: true })
            .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                this.materialPointerId = pointer.leftButtonDown() ? pointer.id : null;
            })
            .on('pointerout', () => { this.materialPointerId = null; })
            .on('pointerup', (pointer: Phaser.Input.Pointer) => {
                const accepted = pointer.button === 0 && this.materialPointerId === pointer.id;
                this.materialPointerId = null;
                if (accepted) this.openMaterials();
            });
        this.materialText = this.addLabel(36, 32, '', 14).setLineSpacing(5);
        this.healButton = new ViewButton(this, 'HEAL +25 (1)', () => this.performHeal()).place(24, 312, 152, 36);
        this.healHint = this.addLabel(24, 352, '', 13).setWordWrapWidth(152, true).setMaxLines(2).setLineSpacing(3)
            .setColor(cssColor(UITheme.colors.secondaryText));
        this.uiSection = 'backpack';
        this.groundMaterialText = this.addLabel(UITheme.ground.x + 12, UITheme.ground.y + 10, '', 16)
            .setWordWrapWidth(UITheme.ground.width - 24, true).setLineSpacing(8);
        this.takeMaterialButton = new ViewButton(this, 'TAKE', () => this.collectGroundMaterial())
            .place(UITheme.ground.x + 32, UITheme.ground.y + 88, 138, 36);
        this.workshopView = new WorkshopView(this, RECIPES, () => this.updateCombatUI(),
            () => this.craftSelectedRecipe(), () => this.continueWorkshop());
        this.runOverlay = new RunOverlayView(this, () => {
            this.runOverlay.setKind(null);
            this.updateCombatUI();
        }, material => {
            if (this.run.dropMaterial(material)) this.updateCombatUI();
        }, () => this.acknowledgeReward());
    }

    private hasOverlay(): boolean { return this.run.mode === 'boss-reward' || (this.runOverlay?.kind ?? null) !== null; }

    public openMaterials(): void {
        if (this.activeDrag || this.isProcessingTurn || this.hasOverlay()) return;
        this.cancelGestures();
        this.hideTooltip();
        this.runOverlay.setKind('materials');
        this.updateCombatUI();
    }

    public collectGroundMaterial(): void {
        if (this.hasOverlay() || this.activeDrag || this.isProcessingTurn ||
            (this.run.mode !== 'exploration' && this.run.mode !== 'workshop')) return;
        const loot = this.run.looseLoot()[this.groundPage];
        if (loot?.kind === 'material') {
            const amount = this.run.collectMaterials(loot.id);
            if (amount > 0) this.appendMessage(`TAKEN: ${MATERIAL_NAMES[loot.material]} ×${amount}`);
        }
        this.updateCombatUI();
    }

    public craftSelectedRecipe(): void {
        if (this.hasOverlay() || this.activeDrag || this.isProcessingTurn || this.run.mode !== 'workshop') return;
        this.hideTooltip();
        const item = this.run.craftRecipe(this.workshopView.selectedRecipe);
        if (item) {
            this.appendMessage(`CRAFTED: ${item.name}. Move it from the bench into your backpack.`);
            this.groundPage = this.run.looseLoot().findIndex(loot => loot.kind === 'item' && loot.item === item);
        }
        this.updateCombatUI();
    }

    public continueWorkshop(): void {
        if (this.hasOverlay() || this.activeDrag || this.isProcessingTurn || this.run.mode !== 'workshop') return;
        this.hideTooltip();
        if (this.run.continueFromWorkshop()) {
            this.backpackView = false;
            this.completedTurns = 0;
            this.lastTurnLog = null;
            this.selectionError = null;
            this.appendMessage(this.isRunFinished() ? 'DEMO COMPLETE' : 'Prepared for the next sector.');
            this.updateCombatUI();
        }
    }

    public acknowledgeReward(): void {
        if (this.run.mode !== 'boss-reward' || !this.run.acknowledgeBossReward()) return;
        this.runOverlay.setKind(null);
        if (this.compact) this.backpackView = false;
        this.hideTooltip();
        this.updateCombatUI();
    }

    private medkits(): Item[] {
        return this.inventory.items.filter(item => item.type === 'consumable' && item.healingAmount > 0)
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }

    private canHeal(): boolean {
        const armors = this.getSelection().armors;
        return !this.hasOverlay() && !this.activeDrag && !this.isProcessingTurn && !this.hasCombatError
            && this.run.playerHp < this.run.playerMaxHp && this.medkits().length > 0
            && (this.run.mode === 'exploration' || this.run.mode === 'workshop' ||
                this.run.mode === 'combat' && armors.length <= 1 && this.time.now >= this.nextAllowedTurnAt);
    }

    public performHeal(): void {
        if (!this.canHeal()) return;
        const kit = this.medkits()[0];
        this.hideTooltip();
        if (this.run.mode === 'combat') this.resolveCombatAction(kit.id);
        else if (this.run.mode === 'exploration') this.performWorldAction({ type: 'heal', itemId: kit.id }, true);
        else {
            const restored = this.run.useMedkit(kit.id);
            if (restored > 0) this.appendMessage(`MEDKIT: restored ${restored} HP.`);
            this.updateCombatUI();
        }
    }

    private refreshWorkshop(): void {
        if (this.run.mode !== 'workshop') return;
        const preview = this.run.previewRecipe(this.workshopView.selectedRecipe);
        const recipe = preview.recipe;
        const componentName = (id: string): string => LootTable.find(item => item.definitionId === id)?.name ?? id;
        const output = LootTable.find(item => item.definitionId === recipe?.outputDefinitionId);
        const description = output?.type === 'battery' ? `Charge: ${output.charge} / ${output.maxCharge} — ${output.voltageType === 'low' ? 'Low' : 'High'} voltage`
            : output?.type === 'weapon' ? `Damage: ${output.baseDamage} / ${output.poweredDamage} powered`
                : output?.type === 'armor' ? `Shield: ${output.baseArmor} / ${output.poweredArmor} powered`
                    : output?.type === 'consumable' ? `Restores up to ${output.healingAmount} HP. Field/combat: one turn.`
                        : output?.type === 'wire' ? 'Carries power between connected items.' : 'Low → High; +1 to energy cost multiplier.';
        const cost = recipe ? [
            ...(['metal', 'electronics', 'fabric'] as const).filter(type => recipe.materials[type] > 0)
                .map(type => `${MATERIAL_NAMES[type]} ${recipe.materials[type]} (${this.run.materials[type]})`),
            ...Object.entries(recipe.components).map(([id, amount]) => `${componentName(id)} ×${amount} (${this.inventory.items.filter(item => item.definitionId === id).length})`)
        ].join('\n') : '';
        const missingIngredients = Object.values(preview.missingMaterials).some(amount => amount > 0)
            || Object.keys(preview.missingComponents).length > 0;
        // Keep the footer to two lines at 800 × 600; the complete costs are listed above.
        const reason = recipe && !this.activeDrag && missingIngredients
            ? 'Missing ingredients. Costs show required (owned).' : preview.reason;
        this.workshopView.refresh({ recipes: RECIPES, selectedId: this.workshopView.selectedRecipe,
            details: `${recipe?.name ?? 'Select a recipe'}\n${description}\n${cost}`,
            reason, canCraft: preview.canCraft, final: this.run.workshopFinal,
            enabled: !this.hasOverlay() && !this.activeDrag && !this.isProcessingTurn && !this.hasCombatError });
    }

    private addLabel(x: number, y: number, text: string, size: number): Phaser.GameObjects.Text {
        const label = this.add.text(x, y, text, {
            fontSize: `${size}px`, color: cssColor(UITheme.colors.text), fontFamily: UITheme.fonts.family,
            metrics: { ascent: size - 3, descent: 3, fontSize: size }
        }).setOrigin(0).setDepth(UI_DEPTH + 2);
        if (this.uiSection === 'backpack') this.backpackObjects.push(label);
        return label;
    }

    private drawPanel(x: number, y: number, width: number, height: number, depth: number = UI_DEPTH): void {
        const graphics = this.add.graphics().setDepth(depth);
        if (this.uiSection === 'backpack') this.backpackObjects.push(graphics);
        graphics.fillStyle(UITheme.colors.panel).fillRect(x, y, width, height);
        graphics.lineStyle(UITheme.borders.panel, UITheme.colors.border).strokeRect(x, y, width, height);
    }

    private createHealthBar(x: number, y: number, width: number): Phaser.GameObjects.Rectangle {
        const background = this.add.rectangle(x, y, width, 14, UITheme.colors.barBackground).setOrigin(0).setDepth(UI_DEPTH + 1);
        const fill = this.add.rectangle(x, y, width, 14, UITheme.colors.health).setOrigin(0).setDepth(UI_DEPTH + 1);
        if (this.uiSection === 'backpack') this.backpackObjects.push(background, fill);
        return fill;
    }

    private updateCombatUI(): void {
        if (!this.playerHpFill) return;
        if (this.run.mode === 'boss-reward' && this.runOverlay?.kind !== 'reward') {
            this.hideTooltip();
            this.runOverlay?.setKind('reward');
            if (this.compact) this.backpackView = true;
        }
        const showPack = !this.compact || this.backpackView;
        for (const object of this.backpackObjects) object.setVisible(showPack);
        const engine = this.combatEngine;
        // RunState synchronizes health after every attack and healing action.
        const updateBar = (bar: Phaser.GameObjects.Rectangle, hp: number, max: number, width: number, visible = true): void => {
            const ratio = max > 0 ? Phaser.Math.Clamp(hp / max, 0, 1) : 0;
            bar.setDisplaySize(width * ratio, 14).setVisible(visible && ratio > 0);
        };
        updateBar(this.playerHpFill, this.run.playerHp, this.run.playerMaxHp, 128);
        this.playerHpText.setText(`${this.run.playerHp} / ${this.run.playerMaxHp}`);
        const hovered = this.run.getEnemy(this.hoveredEnemyId ?? '');
        const fighting = this.run.mode === 'combat' || this.run.mode === 'defeat' || this.run.mode === 'boss-reward';
        if (fighting && engine) {
            this.enemyNameText.setText(engine.enemyName);
            updateBar(this.enemyHpFill, engine.enemyHp, engine.enemyMaxHp, 202, showPack);
            this.enemyHpText.setText(`${engine.enemyHp} / ${engine.enemyMaxHp}`);
            this.enemyAttackText.setText(`ATK: ${engine.enemyBaseDamage}`);
        } else if (hovered) {
            this.enemyNameText.setText(hovered.name);
            updateBar(this.enemyHpFill, hovered.maxHp, hovered.maxHp, 202, showPack);
            this.enemyHpText.setText(`HP: ${hovered.maxHp}   ATK: ${hovered.damage}`);
            this.enemyAttackText.setText(`DETECTION: ${hovered.detectionRadius}`);
        } else {
            this.enemyNameText.setText(this.run.mode === 'workshop' ? 'SAFE WORKSHOP' : 'EXPLORE THE SECTOR');
            this.enemyHpFill.setVisible(false);
            this.enemyHpText.setText(this.run.mode === 'workshop' ? 'Craft and prepare your backpack.' : 'Find scrap. Choose your battles.');
            this.enemyAttackText.setText(this.run.mode === 'workshop' ? 'No automatic healing or recharge.' : 'Reach X to leave the sector.');
        }
        this.shieldText.setText(`SHIELD LAST: ${this.lastTurnLog?.shieldGenerated ?? '—'}`);
        this.hitText.setText(`HIT LAST: ${this.lastTurnLog?.damageTaken ?? '—'}`);
        const status = this.run.mode === 'combat' ? `TURN ${String(this.completedTurns + 1).padStart(2, '0')}`
            : this.run.mode === 'complete' ? 'DEMO COMPLETE' : this.run.mode === 'defeat' ? 'DEFEAT'
                : this.run.mode === 'workshop' ? 'WORKSHOP' : this.run.mode === 'boss-reward' ? 'BOSS DEFEATED' : 'EXPLORING';
        this.statusText.setText(status);
        const lines = this.messages.flatMap(message => this.logText.getWrappedText(message));
        this.logText.setText(lines.slice(-4).join('\n'));
        this.compactSummary?.setVisible(this.compact && !this.backpackView).setText(this.run.mode === 'workshop'
            ? 'WORKSHOP\n\nChoose a recipe.\nCollect crafted items\nfrom the bench.\nB: backpack\nWorld paused.'
            : hovered ? `${hovered.name}\nHP: ${hovered.maxHp}\nATK: ${hovered.damage}\nDETECTION: ${hovered.detectionRadius}`
                : `${status}\n\nWASD / arrows: move\nSpace: wait\nE: interact\nB: backpack`);
        const toggleEnabled = this.compact && this.run.mode !== 'combat' && !this.hasOverlay() && !this.activeDrag;
        this.toggleButton?.setVisible(this.compact).setText(this.backpackView
            ? this.run.mode === 'workshop' ? 'WORKSHOP' : 'MAP' : 'BACKPACK')
            .setColor(cssColor(toggleEnabled ? UITheme.colors.text : UITheme.colors.disabledText));
        if (this.toggleButton?.input) this.toggleButton.input.enabled = toggleEnabled;
        this.materialText?.setText(`MATERIALS ${this.run.materialUsed} / ${MATERIAL_CAPACITY}\nScrap Metal: ${this.run.materials.metal}    Electronics: ${this.run.materials.electronics}    Fabric: ${this.run.materials.fabric}`);
        if (this.materialPanel?.input) this.materialPanel.input.enabled = !this.hasOverlay() && !this.activeDrag;
        this.healButton?.setText(`HEAL +25 (${this.medkits().length})`).setEnabled(this.canHeal());
        this.healHint?.setText(this.run.playerHp >= this.run.playerMaxHp ? 'Health is full.' : !this.medkits().length ? 'Craft a Medkit.'
            : this.run.mode === 'combat' ? 'Uses a combat turn.\nEnemy attacks.' : this.run.mode === 'workshop' ? 'Safe use. No turn.' : 'Uses one world turn.');

        this.syncVisualItems();
        const { weapons, armors, valid } = this.getSelection();
        let hint: string;
        if (this.hasCombatError) hint = 'ERROR: START A NEW RUN';
        else if (this.isRunFinished()) hint = status;
        else if (this.isProcessingTurn) hint = 'RESOLVING...';
        else if (this.activeDrag) hint = 'FINISH MOVING ITEM';
        else if (this.run.mode !== 'combat') hint = this.run.mode === 'workshop' ? 'PREPARE YOUR BACKPACK' : status;
        else if (this.selectionError) hint = this.selectionError;
        else if (!valid || weapons.length > 1 || armors.length > 1) hint = 'INVALID SELECTION';
        else if (!weapons.length) hint = 'SELECT A WEAPON';
        else hint = armors.length ? 'WEAPON + ARMOR READY' : 'WEAPON READY';
        this.hintText.setText(hint);
        this.endTurnLabel.setText(this.isRunFinished() || this.hasCombatError ? 'NEW RUN' : 'END TURN');
        this.refreshConsumerPowerVisuals();
        this.refreshButton();
        this.drawGrid();
        const groundContext = buildGroundPanelContent(this.run);
        this.groundTitle?.setText(groundContext.title);
        this.groundStatus?.setText(groundContext.status);
        this.mapView?.setVisible(this.run.mode !== 'workshop' && (!this.compact || !this.backpackView));
        this.mapView?.refresh(this.run, this.exploration, this.hoveredEnemyId,
            !this.activeDrag && !this.isProcessingTurn && !this.hasCombatError && !this.hasOverlay());
        this.workshopView?.setVisible(this.run.mode === 'workshop' && (!this.compact || !this.backpackView));
        this.refreshWorkshop();
        this.runOverlay?.refresh(this.run);
    }

    private appendMessage(message: string): void {
        this.messages.push(message);
        if (this.messages.length > 64) {
            this.messages.splice(0, this.messages.length - 64);
        }
    }

    private canChangeInventory(): boolean {
        return !this.isRunFinished() && !this.isProcessingTurn && !this.hasCombatError && !this.hasOverlay()
            && (this.run.mode === 'exploration' || this.run.mode === 'combat' || this.run.mode === 'workshop');
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
        if (this.run.mode !== 'combat' || !this.canChangeInventory() || this.activeDrag || this.time.now < this.nextAllowedTurnAt) {
            return false;
        }
        const { weapons, armors, valid } = this.getSelection();
        return valid && weapons.length === 1 && armors.length <= 1;
    }

    private refreshButton(): void {
        const enabled = this.canUsePrimaryButton();
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
        this.materialPointerId = null;
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
        this.resolveCombatAction();
    }

    private resolveCombatAction(consumableId?: string): void {
        if (this.run.mode !== 'combat' || !this.canChangeInventory() || this.activeDrag || this.time.now < this.nextAllowedTurnAt) {
            return;
        }
        const { weapons, armors, valid } = this.getSelection();
        if (!valid || (!consumableId && weapons.length !== 1) || armors.length > 1) {
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
            const log = consumableId
                ? this.run.processCombatAction({ type: 'heal', consumableId, armorId: armors[0]?.id ?? null })
                : this.run.processCombatTurn(weapons[0].id, armors[0]?.id ?? null);
            this.lastTurnLog = log;
            this.completedTurns++;
            this.nextAllowedTurnAt = this.time.now + 250;
            const removedNames = this.synchronizeTurnVisuals(batteryIds);
            this.appendMessage(log.actionType === 'heal'
                ? `TURN ${String(this.completedTurns).padStart(2, '0')}: ${log.consumableUsedName} — HEALED ${log.healingRestored} HP`
                : `TURN ${String(this.completedTurns).padStart(2, '0')}: ${log.weaponUsedName} — DAMAGE ${log.damageDealt}`);
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
            if (log.isEnemyDead && !log.isPlayerDead) {
                this.appendMessage('Victory. Loot is on your current tile.');
                if (this.compact && !this.hasOverlay()) this.backpackView = false;
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

    private isRunFinished(): boolean {
        return this.run.mode === 'defeat' || this.run.mode === 'complete';
    }

    private canUsePrimaryButton(): boolean {
        return !this.activeDrag && !this.isProcessingTurn && !this.hasOverlay() &&
            (this.isRunFinished() || this.hasCombatError || this.canEndTurn());
    }

    public startNewRun(seed?: number): void {
        if (this.hasOverlay()) return;
        this.cancelGestures();
        this.hideTooltip();
        this.runOverlay?.setKind(null);
        if (this.workshopView) this.workshopView.selectedRecipe = RECIPES[0].id;
        for (const visual of this.visualItemsMap.values()) visual.destroy();
        const values = new Uint32Array(1);
        if (seed === undefined) globalThis.crypto.getRandomValues(values);
        this.run = new RunState(seed ?? values[0]);
        this.exploration = new ExplorationEngine(this.run);
        this.completedTurns = 0;
        this.battleState = 'active';
        this.lastTurnLog = null;
        this.messages.length = 0;
        this.hasCombatError = false;
        this.selectionError = null;
        this.activeDrag = null;
        this.dragOrigin = null;
        this.nextAllowedTurnAt = 0;
        this.groundPage = 0;
        this.groundPageKey = '';
        this.hoveredEnemyId = null;
        this.backpackView = false;
        this.appendMessage('New run. Reach X, search scrap, and choose your battles.');
        this.appendMessage(`RUN SEED: ${this.run.seed}`);
        this.updateCombatUI();
    }

    public applyLayout(): void {
        if (!this.mapView) return;
        const compact = Math.min(window.innerWidth / 1248, window.innerHeight / 640) < 0.9;
        this.cancelGestures();
        this.hideTooltip();
        if (compact !== this.compact) this.backpackView = this.run.mode === 'combat' || this.run.mode === 'boss-reward';
        this.compact = compact;
        const width = compact ? 800 : 1248, height = compact ? 600 : 640;
        if (this.scale.width !== width || this.scale.height !== height) this.scale.setGameSize(width, height);
        this.mapView.setLayout(compact);
        this.workshopView?.setLayout(compact);
        this.updateCombatUI();
    }

    public toggleBackpack(): void {
        if (!this.compact || this.run.mode === 'combat' || this.activeDrag || this.isProcessingTurn || this.hasOverlay()) return;
        this.hideTooltip();
        this.backpackView = !this.backpackView;
        this.updateCombatUI();
    }

    private handleWorldKey(event: KeyboardEvent): void {
        if (this.hasOverlay()) {
            if (event.key === 'Escape' && this.runOverlay.kind === 'materials') {
                event.preventDefault();
                this.runOverlay.setKind(null);
                this.updateCombatUI();
            }
            return;
        }
        if (event.repeat || !this.tooltipFocused || this.activeDrag || this.isProcessingTurn) return;
        const key = event.key.toLowerCase();
        if (key === 'b') { event.preventDefault(); this.toggleBackpack(); return; }
        if (this.compact && this.backpackView) return;
        const directions: Record<string, [number, number]> = {
            w: [0, -1], arrowup: [0, -1], d: [1, 0], arrowright: [1, 0],
            s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0]
        };
        if (directions[key]) {
            event.preventDefault();
            const [dx, dy] = directions[key];
            this.performWorldAction({ type: 'move', dx, dy });
        } else if (key === ' ') {
            event.preventDefault();
            this.performWorldAction({ type: 'wait' });
        } else if (key === 'e') {
            event.preventDefault();
            this.performContextAction();
        }
    }

    private performContextAction(): void {
        const type = this.exploration.contextualAction();
        if (type) this.performWorldAction({ type });
    }

    public performWorldAction(action: ExplorationAction, fromCommonHud = false): void {
        if (this.activeDrag || this.isProcessingTurn || this.hasCombatError || !this.tooltipFocused || this.hasOverlay()
            || (this.compact && this.backpackView && !fromCommonHud)) return;
        this.isProcessingTurn = true;
        this.hideTooltip();
        try {
            const result = this.exploration.applyAction(action);
            for (const event of result.events) {
                if (event.message) this.appendMessage(event.message);
                if (event.type === 'combat-started') {
                    this.battleState = 'active';
                    this.completedTurns = 0;
                    this.lastTurnLog = null;
                    this.selectionError = null;
                    this.nextAllowedTurnAt = 0;
                    if (this.compact) this.backpackView = true;
                }
            }
            if (result.accepted) this.hoveredEnemyId = null;
        } catch (error) {
            this.hasCombatError = true;
            this.appendMessage(`EXPLORATION ERROR: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.isProcessingTurn = false;
            this.updateCombatUI();
        }
    }

    private changeGroundPage(delta: number): void {
        if (this.activeDrag || this.hasOverlay() || this.run.mode === 'combat') return;
        const items = this.run.looseLoot();
        if (!items.length) return;
        this.hideTooltip();
        this.groundPage = Phaser.Math.Clamp(this.groundPage + delta, 0, items.length - 1);
        this.updateCombatUI();
    }

    private syncVisualItems(): void {
        const models = [...this.inventory.items, ...this.run.allGroundItems()];
        if (this.run.draggedItem) models.push(this.run.draggedItem);
        const ids = new Set(models.map(item => item.id));
        for (const [id, visual] of this.visualItemsMap) if (!ids.has(id)) visual.destroy();
        for (const model of models) if (!this.visualItemsMap.has(model.id)) this.addItemVisual(model);
        const key = `${this.run.mode === 'workshop' ? 'bench' : 'ground'}:${this.run.sectorIndex}:${this.run.hero.x},${this.run.hero.y}`;
        if (this.groundPageKey !== key) { this.groundPage = 0; this.groundPageKey = key; }
        const ground = this.run.looseLoot();
        this.groundPage = Phaser.Math.Clamp(this.groundPage, 0, Math.max(0, ground.length - 1));
        const entry = ground[this.groundPage];
        const groundItem = entry?.kind === 'item' ? entry.item : null;
        const showPack = !this.compact || this.backpackView;
        const showGround = showPack && this.run.mode !== 'combat' && this.run.mode !== 'boss-reward';
        for (const visual of this.visualItemsMap.values()) {
            const placed = this.inventory.items.includes(visual.itemModel);
            const visible = showPack && (placed || this.activeDrag === visual ||
                (showGround && visual.itemModel === groundItem));
            visual.setVisible(visible);
            visual.setInteractionEnabled(visible && this.canChangeInventory() &&
                (placed || this.run.mode === 'exploration' || this.run.mode === 'workshop' || this.activeDrag === visual)
                && (!this.activeDrag || this.activeDrag === visual));
        }
        this.groundCounter.setText(`${ground.length ? this.groundPage + 1 : 0} / ${ground.length}`);
        const locked = this.run.mode === 'combat' || this.run.mode === 'boss-reward';
        this.groundEmptyText.setText(locked ? 'GROUND LOCKED\nDURING COMBAT' : 'NOTHING HERE')
            .setVisible(showPack && (!ground.length || locked));
        const materialVisible = showGround && entry?.kind === 'material';
        this.groundMaterialText.setVisible(materialVisible);
        this.takeMaterialButton.setVisible(materialVisible);
        if (entry?.kind === 'material') {
            this.groundMaterialText.setText(`${MATERIAL_NAMES[entry.material]}\n×${entry.amount}\n${this.run.materialUsed} / ${MATERIAL_CAPACITY} carried`);
            this.takeMaterialButton.setEnabled(!this.hasOverlay() && !this.activeDrag && !this.isProcessingTurn &&
                this.run.materialUsed < MATERIAL_CAPACITY &&
                (this.run.mode === 'exploration' || this.run.mode === 'workshop'));
        }
        for (const [button, available] of [[this.previousGround, this.groundPage > 0],
            [this.nextGround, this.groundPage + 1 < ground.length]] as const) {
            const enabled = showGround && !this.hasOverlay() && !this.activeDrag && !this.isProcessingTurn && available;
            button.input!.enabled = enabled;
            button.setColor(cssColor(enabled ? UITheme.colors.text : UITheme.colors.disabledText));
        }
        if (this.endTurnButton.input) this.endTurnButton.input.enabled = showPack && !this.hasOverlay();
    }

    private addItemVisual(itemModel: Item): void {
        if (this.visualItemsMap.has(itemModel.id)) return;
        if (!this.inventory.items.includes(itemModel) && !this.run.allGroundItems().includes(itemModel)
            && this.run.draggedItem !== itemModel) this.run.putOnGround(itemModel);
        const visual = new ItemVisual(this, itemModel, this.cellSize, {
            isInteractionAllowed: () => this.canChangeInventory() && (!this.compact || this.backpackView)
                && (this.inventory.items.includes(itemModel) || this.run.mode === 'exploration' || this.run.mode === 'workshop'
                    || this.activeDrag?.itemModel === itemModel)
                && (!this.activeDrag || this.activeDrag.itemModel === itemModel),
            isPoweredEffectAvailable: item => canUsePoweredEffect(this.inventory, item),
            onClick: clickedVisual => this.selectItem(clickedVisual),
            onHover: (_visual, pointer) => { this.handlePointerMove(pointer); this.updateTooltipHover(); },
            onHoverEnd: departingVisual => { if (this.hoveredItem === departingVisual) this.hideTooltip(); },
            onDragStart: draggedVisual => {
                this.hideTooltip();
                const placed = this.inventory.items.includes(itemModel);
                this.dragOrigin = { placed, x: itemModel.gridX, y: itemModel.gridY,
                    orientation: draggedVisual.getOrientation() };
                this.activeDrag = draggedVisual;
                itemModel.isSelectedForTurn = false;
                this.selectionError = null;
                if (placed) this.inventory.removeItem(itemModel.id);
                else this.run.removeFromGround(itemModel.id);
                this.run.draggedItem = itemModel;
                itemModel.connectedBatteries = [];
                itemModel.isPowered = false;
                this.refreshPowerGrid();
                this.updateCombatUI();
            },
            onDragEnd: (draggedVisual, cancelled) => {
                this.finishItemTransfer(draggedVisual, cancelled);
                this.activeDrag = null;
                this.dragOrigin = null;
                this.updateCombatUI();
                this.updateTooltipHover();
            },
            onDestroy: destroyedVisual => {
                if (this.hoveredItem === destroyedVisual) this.hideTooltip();
                this.visualItemsMap.delete(itemModel.id);
            }
        });
        this.visualItemsMap.set(itemModel.id, visual);
        if (this.inventory.items.includes(itemModel)) visual.setPosition(
            this.gridStartX + itemModel.gridX * this.cellSize, this.gridStartY + itemModel.gridY * this.cellSize);
    }

    private finishItemTransfer(visual: ItemVisual, cancelled: boolean): void {
        const origin = this.dragOrigin;
        if (!origin) return;
        const item = visual.itemModel;
        const gridX = Math.round((visual.rect.x - this.gridStartX) / this.cellSize);
        const gridY = Math.round((visual.rect.y - this.gridStartY) / this.cellSize);
        const pointer = this.input.activePointer;
        if (!cancelled && this.inventory.placeItem(item, gridX, gridY)) {
            this.run.draggedItem = null;
            visual.setPosition(this.gridStartX + gridX * this.cellSize, this.gridStartY + gridY * this.cellSize);
        } else if (!cancelled && (this.run.mode === 'exploration' || this.run.mode === 'workshop') &&
            pointer.x >= UITheme.ground.x && pointer.x < UITheme.ground.x + UITheme.ground.width &&
            pointer.y >= UITheme.ground.y && pointer.y < UITheme.ground.y + UITheme.ground.height) {
            this.run.putOnGround(item);
            this.groundPage = this.run.looseLoot().findIndex(candidate => candidate.kind === 'item' && candidate.item === item);
            visual.resetPosition();
        } else {
            visual.restoreOrientation(origin.orientation);
            this.run.draggedItem = null;
            if (origin.placed) {
                if (!this.inventory.placeItem(item, origin.x, origin.y)) throw new Error('Cannot restore dragged item.');
                visual.setPosition(this.gridStartX + origin.x * this.cellSize, this.gridStartY + origin.y * this.cellSize);
            } else {
                this.run.putOnGround(item);
                this.groundPage = this.run.looseLoot().findIndex(candidate => candidate.kind === 'item' && candidate.item === item);
                visual.resetPosition();
            }
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
        if (!this.gridGraphics?.active) {
            this.gridGraphics = this.add.graphics().setDepth(0);
            this.backpackObjects.push(this.gridGraphics);
        }
        const graphics = this.gridGraphics.clear();
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                const x = this.gridStartX + col * this.cellSize, y = this.gridStartY + row * this.cellSize;
                const locked = col >= this.inventory.width || row >= this.inventory.height;
                if (locked) {
                    graphics.fillStyle(UITheme.colors.background).fillRect(x, y, 50, 50);
                    graphics.lineStyle(1, UITheme.colors.border, 0.45).lineBetween(x + 8, y + 8, x + 42, y + 42)
                        .lineBetween(x + 42, y + 8, x + 8, y + 42);
                }
                graphics.lineStyle(UITheme.borders.grid, UITheme.colors.border, locked ? 0.45 : 1);
                graphics.strokeRect(this.gridStartX + col * this.cellSize,
                    this.gridStartY + row * this.cellSize, this.cellSize, this.cellSize);
            }
        }
    }
}
