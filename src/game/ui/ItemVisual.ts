import Phaser from 'phaser';
import type { Item } from '../core/Item';

export interface ItemVisualCallbacks {
    onDragStart?: (visual: ItemVisual) => void;
    onDragEnd?: (visual: ItemVisual) => void;
    onDestroy?: (visual: ItemVisual) => void;
}

export class ItemVisual {
    public readonly itemModel: Item;
    public readonly rect: Phaser.GameObjects.Rectangle;
    public readonly text: Phaser.GameObjects.Text;

    private readonly startX: number;
    private readonly startY: number;

    constructor(scene: Phaser.Scene, itemModel: Item, cellSize: number, callbacks: ItemVisualCallbacks = {}) {
        this.itemModel = itemModel;
        this.startX = 550 + Phaser.Math.Between(-20, 20);
        this.startY = 250 + Phaser.Math.Between(-20, 20);

        this.rect = scene.add.rectangle(
            this.startX, this.startY, itemModel.width * cellSize, itemModel.height * cellSize, itemModel.color
        ).setOrigin(0, 0).setInteractive({ draggable: true });

        this.text = scene.add.text(this.startX + 5, this.startY + 5, itemModel.name, {
            fontSize: '10px',
            color: '#000000',
            fontFamily: 'monospace'
        });

        scene.input.setDraggable(this.rect);
        let isDragging = false;

        this.rect.on('dragstart', () => {
            isDragging = true;
            callbacks.onDragStart?.(this);
        });

        this.rect.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            this.setPosition(dragX, dragY);
        });

        this.rect.on('dragend', () => {
            isDragging = false;
            callbacks.onDragEnd?.(this);
        });

        const rotateWhileDragging = (): void => {
            if (!isDragging) {
                return;
            }

            itemModel.rotate();
            this.rect.setSize(itemModel.width * cellSize, itemModel.height * cellSize);
            this.rect.input?.hitArea.setSize(this.rect.width, this.rect.height);
        };

        const keyboard = scene.input.keyboard;
        keyboard?.on('keydown-R', rotateWhileDragging);

        this.rect.once('destroy', () => {
            keyboard?.off('keydown-R', rotateWhileDragging);
            this.text.destroy();
            callbacks.onDestroy?.(this);
        });

        this.refresh();
    }

    public setPosition(x: number, y: number): void {
        this.rect.setPosition(x, y);
        this.text.setPosition(x + 5, y + 5);
    }

    public resetPosition(): void {
        this.setPosition(this.startX, this.startY);
    }

    public refresh(): void {
        const isConsumer = this.itemModel.type === 'weapon' || this.itemModel.type === 'armor';
        const isConductor = this.itemModel.type === 'wire' || this.itemModel.type === 'transformer';

        this.rect.setFillStyle(isConductor && this.itemModel.isPowered ? 0x00ffff : this.itemModel.color);

        if (isConsumer && this.itemModel.isPowered) {
            this.rect.setStrokeStyle(3, 0x00ff00);
        } else {
            this.rect.setStrokeStyle();
        }
    }

    public destroy(): void {
        this.rect.destroy();
    }
}
