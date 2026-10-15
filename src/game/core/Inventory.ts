import type { Item } from './Item';

export class Inventory {
    public width: number;
    public height: number;
    public grid: (string | null)[][]; // Хранит ID предметов или null
    public items: Item[] = [];

    constructor(width: number = 6, height: number = 6) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
            throw new RangeError('Inventory dimensions must be positive integers.');
        }

        this.width = width;
        this.height = height;
        this.grid = Array(this.height).fill(null).map(() => Array(this.width).fill(null));
    }

    public canPlaceItem(item: Item, x: number, y: number): boolean {
        if (
            !Number.isInteger(x) || !Number.isInteger(y) ||
            !Number.isInteger(item.width) || !Number.isInteger(item.height) ||
            item.width <= 0 || item.height <= 0 ||
            x < 0 || y < 0 ||
            x + item.width > this.width || y + item.height > this.height ||
            this.items.some(existingItem => existingItem.id === item.id)
        ) {
            return false;
        }

        for (let row = y; row < y + item.height; row++) {
            for (let col = x; col < x + item.width; col++) {
                if (this.grid[row]?.[col] !== null) {
                    return false;
                }
            }
        }

        return true;
    }

    public placeItem(item: Item, x: number, y: number): boolean {
        if (!this.canPlaceItem(item, x, y)) {
            return false;
        }

        for (let row = y; row < y + item.height; row++) {
            for (let col = x; col < x + item.width; col++) {
                this.grid[row][col] = item.id;
            }
        }

        this.items.push(item);
        return true;
    }

    public removeItem(itemId: string): boolean {
        const itemIndex = this.items.findIndex(item => item.id === itemId);
        if (itemIndex === -1) {
            return false;
        }

        for (const row of this.grid) {
            for (let col = 0; col < row.length; col++) {
                if (row[col] === itemId) {
                    row[col] = null;
                }
            }
        }

        this.items.splice(itemIndex, 1);
        return true;
    }
}
