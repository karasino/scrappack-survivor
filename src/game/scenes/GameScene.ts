import Phaser from 'phaser';
import { Inventory } from '../core/Inventory';
import { Item } from '../core/Item';
import { LootTable } from '../core/LootTable';
import { ItemVisual } from '../ui/ItemVisual';

export class GameScene extends Phaser.Scene {
    private inventory!: Inventory;
    private readonly visualItemsMap = new Map<string, ItemVisual>();

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
    }

    create(): void {
        this.drawGrid();

        const battery = new Item({
            id: 'scrap_battery_01',
            name: 'Ржавая батарейка',
            type: 'battery',
            width: 2,
            height: 1,
            capacity: 5,
            maxCapacity: 5,
            voltageType: 'low',
            color: 0x00ff00
        });

        this.addItemVisual(battery);

        this.add.text(this.gridStartX, this.gridStartY - 40, 'SCRAPPACK INVENTORY', {
            fontSize: '20px',
            color: '#00ff00',
            fontFamily: 'monospace'
        });

        this.add.text(550, 450, 'SCAVENGE SCRAP', {
            fontSize: '20px',
            color: '#00ff00',
            fontFamily: 'monospace'
        }).setInteractive().on('pointerdown', () => this.spawnRandomItem());
    }

    private spawnRandomItem(): void {
        const config = Phaser.Utils.Array.GetRandom(LootTable);
        const itemModel = new Item({
            ...config,
            id: `item_${Phaser.Utils.String.UUID()}`
        });

        this.addItemVisual(itemModel);
    }

    private addItemVisual(itemModel: Item): void {
        const visual = new ItemVisual(this, itemModel, this.cellSize, {
            onDragStart: () => {
                if (this.inventory.removeItem(itemModel.id)) {
                    this.refreshPowerGrid();
                }
            },
            onDragEnd: draggedVisual => this.placeDraggedItem(draggedVisual),
            onDestroy: () => this.visualItemsMap.delete(itemModel.id)
        });

        this.visualItemsMap.set(itemModel.id, visual);
    }

    private placeDraggedItem(visual: ItemVisual): void {
        const { itemModel, rect } = visual;
        const gridX = Math.round((rect.x - this.gridStartX) / this.cellSize);
        const gridY = Math.round((rect.y - this.gridStartY) / this.cellSize);

        if (this.inventory.placeItem(itemModel, gridX, gridY)) {
            visual.setPosition(
                this.gridStartX + gridX * this.cellSize,
                this.gridStartY + gridY * this.cellSize
            );
        } else {
            visual.resetPosition();
        }

        this.refreshPowerGrid();

        console.log('Текущее состояние сетки:', this.inventory.grid);
        console.log('Характеристики предмета:', { ...itemModel });
        console.table(this.inventory.items.map(item => ({ ...item })));
    }

    private refreshPowerGrid(): void {
        this.inventory.updatePowerGrid();
        for (const visual of this.visualItemsMap.values()) {
            visual.refresh();
        }
    }

    private drawGrid(): void {
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0x334433, 1);

        for (let row = 0; row < this.inventory.height; row++) {
            for (let col = 0; col < this.inventory.width; col++) {
                const x = this.gridStartX + col * this.cellSize;
                const y = this.gridStartY + row * this.cellSize;
                graphics.strokeRect(x, y, this.cellSize, this.cellSize);
            }
        }
    }
}
