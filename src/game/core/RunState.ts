import { CombatEngine } from './CombatEngine';
import type { CombatTurnLog } from './CombatEngine';
import { Inventory } from './Inventory';
import { Item } from './Item';
import { LootTable } from './LootTable';
import { reachableDistances } from './GridTraversal';
import { ENEMY_DEFINITIONS, SECTOR_DEFINITIONS, worldKey } from './SectorDefinitions';
import type { EnemyKind, WorldPosition } from './SectorDefinitions';

export type RunMode = 'exploration' | 'combat' | 'defeat' | 'complete';
export type EncounterInitiator = 'player' | 'enemy';

export interface WorldEnemy extends WorldPosition {
    id: string;
    kind: EnemyKind;
    name: string;
    maxHp: number;
    damage: number;
    detectionRadius: number;
    idlePeriod: number;
    isChasing: boolean;
}

export interface WorldLootPoint extends WorldPosition {
    id: string;
    name: string;
    searched: boolean;
    definitionIds: readonly string[];
}

export interface WorldMap {
    rows: string[];
    width: number;
    height: number;
    exit: WorldPosition;
}

/** Состояние одного забега. Добыча принадлежит модели, а не визуальным объектам. */
export class RunState {
    public readonly inventory = new Inventory(6, 6);
    public readonly playerMaxHp = 100;
    public playerHp = 100;
    public readonly seed: number;
    public rngState: number;
    public sectorIndex = 0;
    public worldTurn = 0;
    public mode: RunMode = 'exploration';
    public hero: WorldPosition = { x: 0, y: 0 };
    public map: WorldMap = { rows: [], width: 0, height: 0, exit: { x: 0, y: 0 } };
    public enemies: WorldEnemy[] = [];
    public lootPoints: WorldLootPoint[] = [];
    public readonly groundItems = new Map<string, Item[]>();
    public combatEngine: CombatEngine | null = null;
    public activeEnemyId: string | null = null;
    public draggedItem: Item | null = null;
    private itemCounter = 0;
    private victoryPosition: WorldPosition | null = null;

    constructor(seed: number) {
        this.seed = seed >>> 0;
        this.rngState = this.seed;
        const startingItems: Array<[string, number, number]> = [
            ['heavy_battery', 0, 0], ['laser_pistol', 2, 0],
            ['weak_battery', 0, 2], ['makeshift_vest', 1, 2]
        ];
        for (const [definitionId, x, y] of startingItems) {
            const item = this.createItem(definitionId);
            item.isSelectedForTurn = item.type === 'weapon' || item.type === 'armor';
            if (!this.inventory.placeItem(item, x, y)) {
                throw new Error(`Invalid starting position for '${definitionId}'.`);
            }
        }
        this.inventory.updatePowerGrid();
        this.loadSector(0);
    }

    /** Единственный источник случайности мира; ID предметов его не расходуют. */
    public nextRandom(): number {
        this.rngState = (Math.imul(1664525, this.rngState) + 1013904223) >>> 0;
        return this.rngState / 0x100000000;
    }

    public createItem(definitionId: string, charge?: number): Item {
        const definition = LootTable.find(candidate => candidate.definitionId === definitionId);
        if (!definition) {
            throw new Error(`Unknown item definition '${definitionId}'.`);
        }
        const item = new Item({
            ...definition,
            id: `run-${this.seed}-item-${++this.itemCounter}`,
            ...(charge === undefined ? {} : { charge, capacity: charge })
        });
        return item;
    }

    public itemsAtHero(): Item[] {
        return this.groundItems.get(worldKey(this.hero)) ?? [];
    }

    public allGroundItems(): Item[] {
        return Array.from(this.groundItems.values()).flat();
    }

    public putOnGround(item: Item, x = this.hero.x, y = this.hero.y): void {
        if (!this.isWalkable({ x, y })) {
            throw new Error(`Cannot place ground loot at (${x}, ${y}).`);
        }
        // Одно перемещение не должно оставлять тот же экземпляр у двух владельцев.
        if (this.inventory.removeItem(item.id)) {
            this.inventory.updatePowerGrid();
        }
        this.removeFromGround(item.id);
        if (this.draggedItem?.id === item.id) {
            this.draggedItem = null;
        }
        item.gridX = -1;
        item.gridY = -1;
        item.isSelectedForTurn = false;
        item.isPowered = false;
        item.connectedBatteries = [];
        item.energyCostMultiplier = 1;
        const key = worldKey({ x, y });
        const items = this.groundItems.get(key) ?? [];
        items.push(item);
        this.groundItems.set(key, items);
    }

    public removeFromGround(id: string): Item | null {
        for (const [key, items] of this.groundItems) {
            const index = items.findIndex(item => item.id === id);
            if (index < 0) continue;
            const [item] = items.splice(index, 1);
            if (items.length === 0) this.groundItems.delete(key);
            return item;
        }
        return null;
    }

    public isWalkable(position: WorldPosition): boolean {
        return Number.isInteger(position.x) && Number.isInteger(position.y) &&
            position.x >= 0 && position.y >= 0 &&
            position.x < this.map.width && position.y < this.map.height &&
            this.map.rows[position.y]?.[position.x] !== '#';
    }

    public getEnemy(id: string): WorldEnemy | undefined {
        return this.enemies.find(enemy => enemy.id === id);
    }

    public loadSector(index: number): void {
        const definition = SECTOR_DEFINITIONS[index];
        if (!definition) throw new RangeError(`Unknown sector index '${index}'.`);
        this.sectorIndex = index;
        this.worldTurn = 0;
        this.mode = 'exploration';
        this.activeEnemyId = null;
        this.victoryPosition = null;
        this.groundItems.clear();
        this.enemies = [];
        this.lootPoints = [];
        this.map = {
            rows: [...definition.rows], width: definition.rows[0].length,
            height: definition.rows.length, exit: { x: 0, y: 0 }
        };
        let enemyIndex = 0;
        for (let y = 0; y < this.map.height; y++) {
            for (let x = 0; x < this.map.width; x++) {
                const symbol = this.map.rows[y][x];
                if (symbol === 'S') this.hero = { x, y };
                if (symbol === 'X') this.map.exit = { x, y };
                if (symbol === 'r' || symbol === 'c') {
                    const kind: EnemyKind = symbol === 'r' ? 'rat' : 'scorpion';
                    const enemy = ENEMY_DEFINITIONS[kind];
                    this.enemies.push({
                        id: `sector-${index + 1}-enemy-${String(++enemyIndex).padStart(2, '0')}`,
                        kind, name: enemy.name, maxHp: enemy.maxHp, damage: enemy.damage,
                        detectionRadius: enemy.detectionRadius, idlePeriod: enemy.idlePeriod,
                        isChasing: false, x, y
                    });
                }
                if (symbol === '1' || symbol === '2') {
                    this.lootPoints.push({
                        id: `sector-${index + 1}-loot-${symbol}`, x, y,
                        name: symbol === '1' ? 'Scrap Heap' : 'Abandoned Kiosk',
                        searched: false, definitionIds: [...definition.loot[symbol]]
                    });
                }
            }
        }
    }

    public beginEncounter(enemyId: string, initiator: EncounterInitiator = 'enemy'): void {
        if (this.mode !== 'exploration' || this.draggedItem !== null) {
            throw new Error('An encounter can only begin during exploration without a dragged item.');
        }
        const enemy = this.getEnemy(enemyId);
        if (!enemy) throw new Error(`Unknown enemy '${enemyId}'.`);
        this.activeEnemyId = enemy.id;
        this.victoryPosition = initiator === 'player' ? { x: enemy.x, y: enemy.y } : null;
        this.combatEngine = new CombatEngine(
            this.inventory, this.playerMaxHp, enemy.maxHp, enemy.damage, enemy.name, this.playerHp
        );
        this.mode = 'combat';
    }

    public processCombatTurn(weaponId: string, armorId: string | null): CombatTurnLog {
        if (this.mode !== 'combat' || !this.combatEngine || !this.activeEnemyId || this.draggedItem) {
            throw new Error('Cannot process a combat turn outside an active encounter.');
        }
        const enemy = this.getEnemy(this.activeEnemyId);
        if (!enemy) throw new Error('The active encounter enemy no longer exists.');
        const log = this.combatEngine.processTurn(weaponId, armorId);
        this.playerHp = this.combatEngine.playerHp;
        if (log.isPlayerDead) {
            this.mode = 'defeat';
            this.activeEnemyId = null;
            this.victoryPosition = null;
        } else if (log.isEnemyDead) {
            this.enemies = this.enemies.filter(candidate => candidate.id !== enemy.id);
            if (this.victoryPosition) {
                this.hero = this.victoryPosition;
                // Refresh indicators without moving enemies or consuming a world turn/RNG.
                const radius = Math.max(0, ...this.enemies.map(candidate => candidate.detectionRadius));
                const distances = reachableDistances(this.hero, radius, position => this.isWalkable(position));
                for (const candidate of this.enemies) {
                    candidate.isChasing = (distances.get(worldKey(candidate)) ?? Infinity) <= candidate.detectionRadius;
                }
            }
            const definition = ENEMY_DEFINITIONS[enemy.kind];
            this.putOnGround(this.createItem(definition.rewardDefinitionId, definition.rewardCharge));
            this.activeEnemyId = null;
            this.victoryPosition = null;
            this.mode = 'exploration';
        }
        return log;
    }
}
