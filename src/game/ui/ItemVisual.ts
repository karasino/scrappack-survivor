import Phaser from 'phaser';
import type { DirectionVector, Item } from '../core/Item';
import { UITheme, cssColor } from './UITheme';
import { getItemPresentation } from './ItemPresentation';

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

const GROUND = UITheme.ground;

export class ItemVisual {
    public readonly itemModel: Item;
    public readonly rect: Phaser.GameObjects.Rectangle;
    public readonly text: Phaser.GameObjects.Text;
    public readonly image: Phaser.GameObjects.Image | null;
    public readonly powerGraphics: Phaser.GameObjects.Graphics;

    private readonly selectionGraphics: Phaser.GameObjects.Graphics;
    private readonly connectionGraphics: Phaser.GameObjects.Graphics;
    private readonly scene: Phaser.Scene;
    private readonly cellSize: number;
    private readonly callbacks: ItemVisualCallbacks;
    private gesture: ItemGesture | null = null;
    private isDragging = false;
    private isVisible = true;
    private interactionEnabled = true;
    private readonly artHover = { value: 1 };
    private hoverTween: Phaser.Tweens.Tween | null = null;
    private readonly imagePadding: number;

    constructor(scene: Phaser.Scene, itemModel: Item, cellSize: number, callbacks: ItemVisualCallbacks = {}) {
        this.scene = scene;
        this.cellSize = cellSize;
        this.callbacks = callbacks;
        this.itemModel = itemModel;
        const presentation = getItemPresentation(itemModel.definitionId);
        this.imagePadding = presentation?.padding ?? UITheme.item.padding;
        const startX = GROUND.x + Math.max(0, GROUND.width - itemModel.width * cellSize) / 2;
        const startY = GROUND.y + Math.max(0, GROUND.height - itemModel.height * cellSize) / 2;

        this.rect = scene.add.rectangle(
            startX, startY, itemModel.width * cellSize, itemModel.height * cellSize, UITheme.colors.itemBackground
        ).setOrigin(0).setInteractive({ draggable: true });
        this.selectionGraphics = scene.add.graphics();
        this.powerGraphics = scene.add.graphics();
        this.connectionGraphics = scene.add.graphics().setDepth(UITheme.layers.connections);
        this.image = presentation && scene.textures.exists(presentation.textureKey)
            ? scene.add.image(startX, startY, presentation.textureKey).setOrigin(0.5) : null;
        const label = itemModel.type === 'consumable' ? '+25 HP'
            : itemModel.type === 'component' ? itemModel.definitionId === 'power_core' ? 'CORE' : 'MECH' : itemModel.name;
        this.text = scene.add.text(startX + 5, startY + 5, label, {
            fontSize: `${UITheme.fonts.itemLabel}px`, color: cssColor(UITheme.colors.text),
            fontFamily: UITheme.fonts.family
        }).setVisible(this.image === null);
        scene.input.setDraggable(this.rect);
        this.updateSize();
        this.updateDepth();

        this.rect.on('pointerover', (pointer: Phaser.Input.Pointer) => {
            this.animateImageHover(!this.isDragging);
            callbacks.onHover?.(this, pointer);
        });
        this.rect.on('pointerout', () => {
            this.animateImageHover(false);
            callbacks.onHoverEnd?.(this);
        });

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
            this.resetImageHover();
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
            this.hoverTween?.remove();
            this.hoverTween = null;
            this.image?.destroy();
            this.selectionGraphics.destroy();
            this.powerGraphics.destroy();
            this.connectionGraphics.destroy();
            this.text.destroy();
            callbacks.onDestroy?.(this);
        });
        this.refresh();
    }

    private interactionAllowed(): boolean {
        return this.isVisible && this.interactionEnabled && (this.callbacks.isInteractionAllowed?.() ?? true);
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
        this.resetImageHover();
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
        const consumerPlaceholder = this.image === null && (this.itemModel.type === 'weapon' || this.itemModel.type === 'armor');
        const reserved = consumerPlaceholder ? UITheme.item.powerBadge.width + UITheme.item.powerBadge.margin : 0;
        this.text.setWordWrapWidth(Math.max(8, this.rect.width - 10 - reserved), true)
            .setMaxLines(Math.max(1, Math.floor((this.rect.height - 10) / (UITheme.fonts.itemLabel + 2))));
        this.updateImage();
    }

    private updateImage(): void {
        if (!this.image) return;
        const artAngle = this.itemModel.quarterTurns * 90;
        const quarterTurn = this.itemModel.quarterTurns % 2 !== 0;
        const width = quarterTurn ? this.image.height : this.image.width;
        const height = quarterTurn ? this.image.width : this.image.height;
        const scale = Math.min(Math.max(0, this.rect.width - this.imagePadding * 2) / width,
            Math.max(0, this.rect.height - this.imagePadding * 2) / height);
        this.image.setPosition(this.rect.x + this.rect.width / 2, this.rect.y + this.rect.height / 2)
            .setAngle(artAngle).setScale(scale * this.artHover.value);
    }

    private animateImageHover(hovered: boolean): void {
        if (!this.image) return;
        if (this.isDragging) {
            this.resetImageHover();
            return;
        }
        const target = hovered ? UITheme.item.hoverScale : 1;
        if (this.artHover.value === target && !this.hoverTween) return;
        this.hoverTween?.remove();
        this.hoverTween = this.scene.tweens.add({
            targets: this.artHover, value: target,
            duration: UITheme.durations.itemHover,
            onUpdate: () => this.updateImage(),
            onComplete: () => { this.hoverTween = null; }
        });
    }

    private resetImageHover(): void {
        this.hoverTween?.remove();
        this.hoverTween = null;
        this.artHover.value = 1;
        this.updateImage();
    }

    private updateDepth(): void {
        const depth = this.isDragging ? UITheme.layers.draggedItem : UITheme.layers.item;
        this.rect.setDepth(depth);
        this.image?.setDepth(depth + 1);
        this.selectionGraphics.setDepth(depth + 2);
        this.text.setDepth(depth + 3);
        this.powerGraphics.setDepth(depth + 4);
    }

    public setInteractionEnabled(enabled: boolean): void {
        this.interactionEnabled = enabled;
        if (this.rect.input) {
            // Keep hover hit testing available even when gameplay actions are locked.
            this.rect.input.enabled = this.isVisible;
            const draggable = enabled && this.isVisible;
            if (this.rect.input.draggable !== draggable) {
                this.scene.input.setDraggable(this.rect, draggable);
            }
        }
    }

    public setVisible(visible: boolean): void {
        if (!visible && this.isVisible) {
            this.cancelGesture();
            this.callbacks.onHoverEnd?.(this);
        }
        this.isVisible = visible;
        this.rect.setVisible(visible);
        this.image?.setVisible(visible);
        this.text.setVisible(visible && this.image === null);
        this.selectionGraphics.setVisible(visible);
        this.powerGraphics.setVisible(visible);
        this.connectionGraphics.setVisible(visible);
        this.setInteractionEnabled(this.interactionEnabled);
    }

    public getOrientation(): number {
        return this.itemModel.quarterTurns;
    }

    public restoreOrientation(turns: number): void {
        const target = ((Math.trunc(turns) % 4) + 4) % 4;
        const rotations = (target - this.getOrientation() + 4) % 4;
        for (let i = 0; i < rotations; i++) {
            this.itemModel.rotate();
        }
        this.updateSize();
        this.refresh();
    }

    public setPosition(x: number, y: number): void {
        this.rect.setPosition(x, y);
        this.text.setPosition(x + 5, y + 5);
        this.updateImage();
        this.refreshSelection();
        this.refreshPowerIndicator();
        this.refreshConnections();
    }

    public resetPosition(): void {
        this.setPosition(
            GROUND.x + Math.max(0, GROUND.width - this.rect.width) / 2,
            GROUND.y + Math.max(0, GROUND.height - this.rect.height) / 2
        );
    }

    private refreshSelection(): void {
        this.selectionGraphics.clear();
        if (this.itemModel.isSelectedForTurn && (this.itemModel.type === 'weapon' || this.itemModel.type === 'armor')) {
            const { x, y, width, height } = this.rect;
            const inset = UITheme.borders.selectionInset;
            this.selectionGraphics.lineStyle(UITheme.borders.selection, UITheme.colors.selected)
                .strokeRect(x + inset, y + inset, Math.max(0, width - inset * 2), Math.max(0, height - inset * 2));
        }
    }

    private refreshPowerIndicator(): void {
        const graphics = this.powerGraphics.clear();
        const consumer = this.itemModel.type === 'weapon' || this.itemModel.type === 'armor';
        if (!consumer || !this.callbacks.isPoweredEffectAvailable?.(this.itemModel)) return;
        const badge = UITheme.item.powerBadge;
        const x = this.rect.x + this.rect.width - badge.margin - badge.width;
        const y = this.rect.y + badge.margin;
        graphics.fillStyle(UITheme.colors.background).fillRect(x, y, badge.width, badge.height);
        const left = x + (badge.width - badge.boltWidth) / 2;
        const top = y + (badge.height - badge.boltHeight) / 2;
        graphics.fillStyle(UITheme.colors.powered).beginPath()
            .moveTo(left + 5, top).lineTo(left, top + 7).lineTo(left + 4, top + 7)
            .lineTo(left + 3, top + 12).lineTo(left + 8, top + 5).lineTo(left + 4, top + 5)
            .closePath().fillPath();
    }

    private refreshConnections(): void {
        const graphics = this.connectionGraphics;
        graphics.clear();
        if (!this.isDragging) {
            return;
        }
        graphics.lineStyle(UITheme.borders.arrow, UITheme.colors.selected);
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
        if (this.rect.width !== this.itemModel.width * this.cellSize || this.rect.height !== this.itemModel.height * this.cellSize)
            this.updateSize();
        else this.updateImage();
        const isConductor = this.itemModel.type === 'wire' || this.itemModel.type === 'transformer';
        const fillAlpha = this.isDragging ? UITheme.opacity.draggedItem
            : this.itemModel.isSelectedForTurn ? UITheme.opacity.selectedItem : UITheme.opacity.item;
        this.rect.setFillStyle(isConductor && this.itemModel.isPowered
            ? UITheme.colors.poweredConductor : UITheme.colors.itemBackground, fillAlpha);
        this.rect.setStrokeStyle();
        this.refreshSelection();
        this.refreshPowerIndicator();
        this.refreshConnections();
    }

    public destroy(): void {
        this.rect.destroy();
    }
}
