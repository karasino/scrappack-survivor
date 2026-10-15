import Phaser from 'phaser';
import { Inventory } from '../core/Inventory';
import { Item } from '../core/Item';

export class GameScene extends Phaser.Scene {
    private inventory!: Inventory;
    
    private cellSize = 50;
    private gridStartX = 200;
    private gridStartY = 150;

    constructor() {
        super('GameScene');
    }

    init() {
        // Создаем сетку 6х6
        this.inventory = new Inventory(6, 6);
    }

    create() {
        this.drawGrid();

        // Наш первый постапокалиптический лут: Батарейка (2 ячейки в ширину, 1 в высоту)
        const battery = new Item({
            id: 'scrap_battery_01',
            name: 'Ржавая батарейка',
            width: 2,
            height: 1,
            color: 0x00ff00 // Зеленый Pip-Boy цвет
        });

        this.createVisualItem(battery);

        this.add.text(this.gridStartX, this.gridStartY - 40, 'SCRAPPACK INVENTORY', {
            fontSize: '20px',
            color: '#00ff00',
            fontFamily: 'monospace'
        });
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

    private createVisualItem(itemModel: Item) {
        const startX = 550;
        const startY = 200;
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

        this.input.setDraggable(rect);

        let isDragging = false;

        rect.on('dragstart', () => {
            isDragging = true;
            // Во время переноса предмет не занимает ячейки инвентаря.
            this.inventory.removeItem(itemModel.id);
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
            
            console.log("Текущее состояние сетки:", this.inventory.grid);
        });
    }
}
