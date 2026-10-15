import Phaser from 'phaser';
import { Inventory } from '../core/Inventory';
import { Item } from '../core/Item';
import type { ItemConfig } from '../core/Item';

export class GameScene extends Phaser.Scene {
    private inventory!: Inventory;
    private readonly visualItemsMap = new Map<string, {
        itemModel: Item;
        rect: Phaser.GameObjects.Rectangle;
        text: Phaser.GameObjects.Text;
    }>();

    private readonly lootTable: Omit<ItemConfig, 'id'>[] = [
        {
            name: 'Слабая батарейка', type: 'battery', width: 1, height: 1,
            color: 0xffd700, capacity: 5, maxCapacity: 5, voltageType: 'low'
        },
        {
            name: 'Мощный аккумулятор', type: 'battery', width: 2, height: 1,
            color: 0x00ff00, capacity: 12, maxCapacity: 12, voltageType: 'high'
        },
        {
            name: 'Медный провод', type: 'wire', width: 2, height: 1,
            color: 0xd27d2d
        },
        {
            name: 'Повышающий трансформатор', type: 'transformer', width: 1, height: 1,
            color: 0x4682b4, transformDirection: 'low-to-high'
        },
        {
            name: 'Лазерный пистолет', type: 'weapon', width: 2, height: 1,
            color: 0xff4500, requiredVoltage: 'high', baseDamage: 4, poweredDamage: 22,
            energyCost: 2
        },
        {
            name: 'Кустарный жилет', type: 'armor', width: 2, height: 2,
            color: 0x008080, requiredVoltage: 'low', baseArmor: 2, poweredArmor: 8,
            energyCost: 1
        }
    ];
    
    private cellSize = 50;
    private gridStartX = 200;
    private gridStartY = 150;

    constructor() {
        super('GameScene');
    }

    init() {
        // Создаем сетку 6х6
        this.inventory = new Inventory(6, 6);
        this.visualItemsMap.clear();
    }

    create() {
        this.drawGrid();

        // Наш первый постапокалиптический лут: Батарейка (2 ячейки в ширину, 1 в высоту)
        const battery = new Item({
            id: 'scrap_battery_01',
            name: 'Ржавая батарейка',
            type: 'battery',
            width: 2,
            height: 1,
            capacity: 5,
            maxCapacity: 5,
            voltageType: 'low',
            color: 0x00ff00 // Зеленый Pip-Boy цвет
        });

        this.createVisualItem(battery);

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
        const config = Phaser.Utils.Array.GetRandom(this.lootTable);
        const randomConfig: ItemConfig = {
            ...config,
            id: `item_${Phaser.Utils.String.UUID()}`
        };
        const itemModel = new Item(randomConfig);

        this.createVisualItem(itemModel);
    }

    private drawGrid() {
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0x334433, 1);

        for (let r = 0; r < this.inventory.height; r++) {
            for (let c = 0; c < this.inventory.width; c++) {
                const x = this.gridStartX + c * this.cellSize;
                const y = this.gridStartY + r * this.cellSize;
                graphics.strokeRect(x, y, this.cellSize, this.cellSize);
            }
        }
    }

    private refreshVisuals(): void {
        for (const { itemModel, rect } of this.visualItemsMap.values()) {
            const isConsumer = itemModel.type === 'weapon' || itemModel.type === 'armor';
            const isConductor = itemModel.type === 'wire' || itemModel.type === 'transformer';

            rect.setFillStyle(isConductor && itemModel.isPowered ? 0x00ffff : itemModel.color);

            if (isConsumer && itemModel.isPowered) {
                rect.setStrokeStyle(3, 0x00ff00);
            } else {
                rect.setStrokeStyle();
            }
        }
    }

    private createVisualItem(itemModel: Item) {
        const startX = 550 + Phaser.Math.Between(-20, 20);
        const startY = 250 + Phaser.Math.Between(-20, 20);
        const widthPx = itemModel.width * this.cellSize;
        const heightPx = itemModel.height * this.cellSize;
        
        const rect = this.add.rectangle(startX, startY, widthPx, heightPx, itemModel.color)
            .setOrigin(0, 0)
            .setInteractive({ draggable: true });

        const text = this.add.text(startX + 5, startY + 5, itemModel.name, {
            fontSize: '10px',
            color: '#000000',
            fontFamily: 'monospace'
        });

        this.visualItemsMap.set(itemModel.id, { itemModel, rect, text });
        this.input.setDraggable(rect);

        let isDragging = false;

        rect.on('dragstart', () => {
            isDragging = true;
            // Во время переноса предмет не занимает ячейки инвентаря.
            if (this.inventory.removeItem(itemModel.id)) {
                this.inventory.updatePowerGrid();
                this.refreshVisuals();
            }
        });

        const rotateWhileDragging = (): void => {
            if (!isDragging) {
                return;
            }

            itemModel.rotate();
            rect.setSize(itemModel.width * this.cellSize, itemModel.height * this.cellSize);
            rect.input?.hitArea.setSize(rect.width, rect.height);
        };

        this.input.keyboard?.on('keydown-R', rotateWhileDragging);
        rect.once('destroy', () => {
            this.input.keyboard?.off('keydown-R', rotateWhileDragging);
            this.visualItemsMap.delete(itemModel.id);
            text.destroy();
        });

        rect.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            rect.x = dragX;
            rect.y = dragY;
            text.x = dragX + 5;
            text.y = dragY + 5;
        });

        rect.on('dragend', () => {
            isDragging = false;

            const relativeX = rect.x - this.gridStartX;
            const relativeY = rect.y - this.gridStartY;

            const gridX = Math.round(relativeX / this.cellSize);
            const gridY = Math.round(relativeY / this.cellSize);

            if (this.inventory.placeItem(itemModel, gridX, gridY)) {
                // Идеально примагничиваем к сетке
                rect.x = this.gridStartX + gridX * this.cellSize;
                rect.y = this.gridStartY + gridY * this.cellSize;
            } else {
                // Если не влезло — отправляем на спавн
                rect.x = startX;
                rect.y = startY;
            }
            
            text.x = rect.x + 5;
            text.y = rect.y + 5;

            this.inventory.updatePowerGrid();
            this.refreshVisuals();
            
            console.log("Текущее состояние сетки:", this.inventory.grid);
            console.log('Характеристики предмета:', { ...itemModel });
            console.table(this.inventory.items.map(item => ({ ...item })));
        });

        this.refreshVisuals();
    }
}
