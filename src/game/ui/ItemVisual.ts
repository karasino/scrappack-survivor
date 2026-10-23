import Phaser from 'phaser';
import type { DirectionVector, Item } from '../core/Item';

export interface ItemVisualCallbacks {
    isInteractionAllowed?: () => boolean;
    isPoweredEffectAvailable?: (item: Item) => boolean;
    onClick?: (visual: ItemVisual) => void;
    onHover?: (visual: ItemVisual, pointer: Phaser.Input.Pointer) => void;
    onHoverEnd?: (visual: ItemVisual) => void;
    onDragStart?: (visual: ItemVisual) => void;
    onDragEnd?: (visual: ItemVisual, cancelled: boolean) => void;
    onDestroy?: (visual: ItemVisual) => void;
}

interface ItemGesture {
    pointer: Phaser.Input.Pointer;
    startX: number;
    startY: number;
    moved: boolean;
    dragged: boolean;
    rotated: boolean;
}

const SCRAP = { x: 562, y: 246, width: 202, height: 162 };

export class ItemVisual {
    public readonly itemModel: Item;
    public readonly rect: Phaser.GameObjects.Rectangle;
    public readonly text: Phaser.GameObjects.Text;

    private readonly selectionGraphics: Phaser.GameObjects.Graphics;
    private readonly connectionGraphics: Phaser.GameObjects.Graphics;
    private readonly startX: number;
    private readonly startY: number;
    private readonly scene: Phaser.Scene;
    private readonly cellSize: number;
    private readonly callbacks: ItemVisualCallbacks;
    private gesture: ItemGesture | null = null;
    private isDragging = false;

    constructor(scene: Phaser.Scene, itemModel: Item, cellSize: number, callbacks: ItemVisualCallbacks = {}) {
        this.scene = scene;
        this.cellSize = cellSize;
        this.callbacks = callbacks;
        this.itemModel = itemModel;
        this.startX = SCRAP.x + Phaser.Math.Between(0, Math.max(0, SCRAP.width - itemModel.width * cellSize));
        this.startY = SCRAP.y + Phaser.Math.Between(0, Math.max(0, SCRAP.height - itemModel.height * cellSize));

        this.rect = scene.add.rectangle(
            this.startX, this.startY, itemModel.width * cellSize, itemModel.height * cellSize, itemModel.color
        ).setOrigin(0).setInteractive({ draggable: true });
        this.selectionGraphics = scene.add.graphics();
        this.connectionGraphics = scene.add.graphics().setDepth(35);
        this.text = scene.add.text(this.startX + 5, this.startY + 5, itemModel.name, {
            fontSize: '10px', color: '#000000', fontFamily: 'monospace'
        });
        scene.input.setDraggable(this.rect);
        this.updateSize();
        this.updateDepth();

        this.rect.on('pointerover', (pointer: Phaser.Input.Pointer) => callbacks.onHover?.(this, pointer));
        this.rect.on('pointerout', () => callbacks.onHoverEnd?.(this));

        this.rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (!pointer.leftButtonDown() || this.gesture || !this.interactionAllowed()) {
                return;
            }
            this.gesture = {
                pointer, startX: pointer.x, startY: pointer.y,
                moved: false, dragged: false, rotated: false
            };
        });
        this.rect.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            this.trackMovement(pointer);
            const gesture = this.gesture;
            if (gesture?.pointer.id === pointer.id && pointer.button === 0
                && !gesture.moved && !gesture.dragged && !gesture.rotated && this.interactionAllowed()) {
                callbacks.onClick?.(this);
            }
            this.gesture = null;
        });
        this.rect.on('dragstart', (pointer: Phaser.Input.Pointer) => {
            if (this.gesture?.pointer.id !== pointer.id || !this.interactionAllowed()) {
                scene.input.setDragState(pointer, 0);
                if (this.rect.input) {
                    this.rect.input.dragState = 0;
                }
                return;
            }
            this.gesture.dragged = true;
            this.isDragging = true;
            this.updateDepth();
            callbacks.onDragStart?.(this);
            this.refresh();
        });
        this.rect.on('drag', (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            if (this.isDragging && this.gesture?.pointer.id === pointer.id) {
                this.trackMovement(pointer);
                this.setPosition(dragX, dragY);
            }
        });
        this.rect.on('dragend', (pointer: Phaser.Input.Pointer) => {
            if (this.isDragging && this.gesture?.pointer.id === pointer.id) {
                this.finishDrag(false);
            }
        });

        scene.input.on('pointermove', this.trackMovement, this);
        scene.input.on('pointerup', this.releaseGesture, this);
        scene.input.on('pointerupoutside', this.releaseGesture, this);
        const keyboard = scene.input.keyboard;
        keyboard?.on('keydown-R', this.rotateWhileDragging, this);
        this.rect.once('destroy', () => {
            scene.input.off('pointermove', this.trackMovement, this);
            scene.input.off('pointerup', this.releaseGesture, this);
            scene.input.off('pointerupoutside', this.releaseGesture, this);
            keyboard?.off('keydown-R', this.rotateWhileDragging, this);
            this.gesture = null;
            this.selectionGraphics.destroy();
            this.connectionGraphics.destroy();
            this.text.destroy();
            callbacks.onDestroy?.(this);
        });
        this.refresh();
    }

    private interactionAllowed(): boolean {
        return this.callbacks.isInteractionAllowed?.() ?? true;
    }

    private trackMovement(pointer: Phaser.Input.Pointer): void {
        if (this.gesture?.pointer.id === pointer.id
            && Phaser.Math.Distance.Between(pointer.x, pointer.y, this.gesture.startX, this.gesture.startY) >= 6) {
            this.gesture.moved = true;
        }
    }

    private releaseGesture(pointer: Phaser.Input.Pointer): void {
        if (this.gesture?.pointer.id === pointer.id) {
            this.cancelGesture();
        }
    }

    public cancelGesture(): void {
        if (this.gesture) {
            this.scene.input.setDragState(this.gesture.pointer, 0);
            if (this.rect.input) {
                this.rect.input.dragState = 0;
            }
            this.gesture = null;
        }
        if (this.isDragging) {
            this.finishDrag(true);
        }
    }

    private finishDrag(cancelled: boolean): void {
        this.isDragging = false;
        this.updateDepth();
        this.callbacks.onDragEnd?.(this, cancelled);
        this.refresh();
    }

    private rotateWhileDragging(): void {
        if (!this.isDragging || !this.gesture || !this.interactionAllowed()) {
            return;
        }
        this.gesture.rotated = true;
        this.itemModel.rotate();
        this.updateSize();
        this.refresh();
    }

    private updateSize(): void {
        this.rect.setSize(this.itemModel.width * this.cellSize, this.itemModel.height * this.cellSize);
        if (this.rect.input?.hitArea instanceof Phaser.Geom.Rectangle) {
            this.rect.input.hitArea.setSize(this.rect.width, this.rect.height);
        }
        this.text.setWordWrapWidth(this.rect.width - 10, true)
            .setMaxLines(Math.max(1, Math.floor((this.rect.height - 10) / 12)));
    }

    private updateDepth(): void {
        const depth = this.isDragging ? 30 : 10;
        this.rect.setDepth(depth);
        this.selectionGraphics.setDepth(depth + 1);
        this.text.setDepth(depth + 2);
    }

    public setInteractionEnabled(enabled: boolean): void {
        if (this.rect.input) {
            // Keep hover hit testing available even when gameplay actions are locked.
            this.rect.input.enabled = true;
            if (this.rect.input.draggable !== enabled) {
                this.scene.input.setDraggable(this.rect, enabled);
            }
        }
    }

    public setPosition(x: number, y: number): void {
        this.rect.setPosition(x, y);
        this.text.setPosition(x + 5, y + 5);
        this.refreshSelection();
        this.refreshConnections();
    }

    public resetPosition(): void {
        this.setPosition(
            Phaser.Math.Clamp(this.startX, SCRAP.x, SCRAP.x + Math.max(0, SCRAP.width - this.rect.width)),
            Phaser.Math.Clamp(this.startY, SCRAP.y, SCRAP.y + Math.max(0, SCRAP.height - this.rect.height))
        );
    }

    private refreshSelection(): void {
        this.selectionGraphics.clear();
        if (this.itemModel.isSelectedForTurn) {
            const { x, y, width, height } = this.rect;
            this.selectionGraphics.lineStyle(6, 0xd8ff8a, 0.18).strokeRect(x - 3, y - 3, width + 6, height + 6);
            this.selectionGraphics.lineStyle(2, 0xd8ff8a).strokeRect(x - 3, y - 3, width + 6, height + 6);
        }
    }

    private refreshConnections(): void {
        const graphics = this.connectionGraphics;
        graphics.clear();
        if (!this.isDragging) {
            return;
        }
        graphics.lineStyle(2, 0xd8ff8a);
        const drawArrow = (side: DirectionVector, inward: boolean, bidirectional: boolean): void => {
            const { x, y, width, height } = this.rect;
            const cx = x + width / 2 + side.x * (width / 2 + 6);
            const cy = y + height / 2 + side.y * (height / 2 + 6);
            const dx = inward ? -side.x : side.x;
            const dy = inward ? -side.y : side.y;
            graphics.lineBetween(cx - dx * 8, cy - dy * 8, cx + dx * 8, cy + dy * 8);
            const head = (direction: number): void => {
                const tipX = cx + dx * 8 * direction;
                const tipY = cy + dy * 8 * direction;
                const baseX = tipX - dx * 8 * direction;
                const baseY = tipY - dy * 8 * direction;
                graphics.beginPath().moveTo(baseX - dy * 4, baseY + dx * 4)
                    .lineTo(tipX, tipY).lineTo(baseX + dy * 4, baseY - dx * 4).strokePath();
            };
            head(1);
            if (bidirectional) {
                head(-1);
            }
        };
        if (this.itemModel.type === 'wire') {
            for (const port of this.itemModel.connectionPorts) {
                drawArrow(port, false, true);
            }
        } else if (this.itemModel.type === 'transformer') {
            drawArrow(this.itemModel.inputDir, true, false);
            drawArrow(this.itemModel.outputDir, false, false);
        }
    }

    public refresh(): void {
        const isConsumer = this.itemModel.type === 'weapon' || this.itemModel.type === 'armor';
        const isConductor = this.itemModel.type === 'wire' || this.itemModel.type === 'transformer';
        const fillAlpha = this.isDragging ? 0.6 : this.itemModel.isSelectedForTurn ? 1 : 0.85;
        this.rect.setFillStyle(isConductor && this.itemModel.isPowered ? 0x00ffff : this.itemModel.color, fillAlpha);
        if (isConsumer && this.callbacks.isPoweredEffectAvailable?.(this.itemModel)) {
            this.rect.setStrokeStyle(3, 0x00ff00);
        } else {
            this.rect.setStrokeStyle();
        }
        this.refreshSelection();
        this.refreshConnections();
    }

    public destroy(): void {
        this.rect.destroy();
    }
}
