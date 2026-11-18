import type { ConnectedBattery, DirectionVector, Item, VoltageType } from './Item';

interface PowerWave {
    x: number;
    y: number;
    voltage: VoltageType;
    sourceBattery: Item;
    entryPort: DirectionVector | null;
    energyCostMultiplier: number;
    hasWire: boolean;
}

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
        item.gridX = x;
        item.gridY = y;
        return true;
    }

    /** Opens cells to the right/bottom without replacing items or changing coordinates. */
    public expandTo(width: number, height: number): boolean {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < this.width ||
            height < this.height || width > 6 || height > 6) {
            return false;
        }
        for (const row of this.grid) {
            while (row.length < width) row.push(null);
        }
        while (this.grid.length < height) this.grid.push(Array(width).fill(null));
        this.width = width;
        this.height = height;
        return true;
    }

    public updatePowerGrid(): void {
        const itemsById = new Map<string, Item>();
        for (const item of this.items) {
            item.connectedBatteries = [];
            item.isPowered = false;
            item.energyCostMultiplier = 1.0;
            itemsById.set(item.id, item);
        }

        const queue: PowerWave[] = [];
        const visitedByBattery = new Map<Item, Map<string, number>>();
        const activeTransformersByBattery = new Map<Item, Set<Item>>();

        const sameDirection = (first: DirectionVector, second: DirectionVector): boolean => (
            first.x === second.x && first.y === second.y
        );

        const oppositeDirection = (direction: DirectionVector): DirectionVector => ({
            x: -direction.x,
            y: -direction.y
        });

        const hasPort = (item: Item, direction: DirectionVector): boolean => (
            item.connectionPorts.some(port => sameDirection(port, direction))
        );

        const enqueue = (wave: PowerWave): void => {
            let visited = visitedByBattery.get(wave.sourceBattery);
            if (!visited) {
                visited = new Map<string, number>();
                visitedByBattery.set(wave.sourceBattery, visited);
            }

            // Одна ячейка может проводить оба напряжения от разных батарей.
            const entry = wave.entryPort === null ? 'source' : `${wave.entryPort.x},${wave.entryPort.y}`;
            const key = `${wave.x},${wave.y},${wave.voltage},${entry},${wave.hasWire}`;
            const previousMultiplier = visited.get(key);
            if (previousMultiplier === undefined || wave.energyCostMultiplier < previousMultiplier) {
                visited.set(key, wave.energyCostMultiplier);
                queue.push(wave);
            }
        };

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const itemId = this.grid[y]?.[x];
                const battery = itemId == null ? undefined : itemsById.get(itemId);
                if (battery?.type === 'battery' && battery.charge > 0) {
                    enqueue({
                        x,
                        y,
                        voltage: battery.voltageType,
                        sourceBattery: battery,
                        entryPort: null,
                        energyCostMultiplier: 1.0, hasWire: false
                    });
                }
            }
        }

        const directions: readonly (readonly [number, number])[] = [
            [0, 1], [0, -1], [1, 0], [-1, 0]
        ];

        // Индекс головы сохраняет O(1) извлечение без сдвига массива очереди.
        for (let head = 0; head < queue.length; head++) {
            const wave = queue[head];
            const currentItemId = this.grid[wave.y]?.[wave.x];

            for (const [dx, dy] of directions) {
                const x = wave.x + dx;
                const y = wave.y + dy;
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
                    continue;
                }

                const neighborId = this.grid[y]?.[x];
                const neighbor = neighborId == null ? undefined : itemsById.get(neighborId);
                if (!neighbor) {
                    continue;
                }

                const currentItem = currentItemId == null ? undefined : itemsById.get(currentItemId);
                const movement: DirectionVector = { x: dx, y: dy };

                // Переходы между ячейками одного многоклеточного предмета не являются
                // подключением через внешний порт. Сохраняем исходный входной порт.
                if (neighborId === currentItemId) {
                    enqueue({ ...wave, x, y });
                    continue;
                }

                if (currentItem?.type === 'wire') {
                    if (!hasPort(currentItem, movement)) {
                        continue;
                    }

                    // Проводу нельзя выйти обратно через тот же порт, через который он вошёл.
                    if (wave.entryPort !== null && sameDirection(movement, wave.entryPort)) {
                        continue;
                    }
                } else if (currentItem?.type === 'transformer') {
                    if (wave.entryPort !== null && !sameDirection(movement, currentItem.outputDir)) {
                        continue;
                    }
                }

                if (neighbor.type === 'weapon' || neighbor.type === 'armor') {
                    if (neighbor.powerMode !== 'none' && wave.voltage === neighbor.requiredVoltage) {
                        const connection: ConnectedBattery = {
                            batteryId: wave.sourceBattery.id,
                            costMultiplier: wave.energyCostMultiplier * (wave.hasWire ? 0.8 : 1)
                        };
                        const existingConnection = neighbor.connectedBatteries.find(
                            battery => battery.batteryId === connection.batteryId
                        );
                        if (existingConnection) {
                            existingConnection.costMultiplier = Math.min(
                                existingConnection.costMultiplier,
                                connection.costMultiplier
                            );
                        } else {
                            neighbor.connectedBatteries.push(connection);
                        }
                        neighbor.isPowered = true;
                    }
                    continue;
                }

                if (neighbor.type !== 'wire' && neighbor.type !== 'transformer') {
                    continue;
                }

                const entryPort = oppositeDirection(movement);
                if (neighbor.type === 'wire') {
                    if (!hasPort(neighbor, entryPort)) {
                        continue;
                    }
                } else if (!sameDirection(entryPort, neighbor.inputDir)) {
                    continue;
                }

                neighbor.isPowered = true;

                let voltage = wave.voltage;
                let energyCostMultiplier = wave.energyCostMultiplier;
                // Внутри многоклеточного трансформатора напряжение повторно не меняется.
                if (neighbor.type === 'transformer' && neighborId !== currentItemId) {
                    if (neighbor.transformDirection === 'low-to-high' && voltage === 'low') {
                        voltage = 'high';
                    } else if (neighbor.transformDirection === 'high-to-low' && voltage === 'high') {
                        voltage = 'low';
                    }

                    if (voltage !== wave.voltage) {
                        energyCostMultiplier += 1.0;
                    }
                }

                if (voltage !== wave.voltage) {
                    let activeTransformers = activeTransformersByBattery.get(wave.sourceBattery);
                    if (!activeTransformers) {
                        activeTransformers = new Set<Item>();
                        activeTransformersByBattery.set(wave.sourceBattery, activeTransformers);
                    }

                    // Несколько путей и ячеек одного трансформатора учитываются один раз.
                    if (!activeTransformers.has(neighbor)) {
                        activeTransformers.add(neighbor);
                        wave.sourceBattery.energyCostMultiplier += 1.0;
                    }
                }

                enqueue({
                    x,
                    y,
                    voltage,
                    sourceBattery: wave.sourceBattery,
                    entryPort,
                    energyCostMultiplier, hasWire: wave.hasWire || neighbor.type === 'wire'
                });
            }
        }
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

        this.items[itemIndex].isPowered = false;
        this.items[itemIndex].energyCostMultiplier = 1.0;
        this.items[itemIndex].connectedBatteries = [];
        this.items[itemIndex].gridX = -1;
        this.items[itemIndex].gridY = -1;
        this.items.splice(itemIndex, 1);
        return true;
    }
}
