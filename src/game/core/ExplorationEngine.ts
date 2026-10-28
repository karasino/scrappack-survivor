import type { EncounterInitiator, RunState, WorldEnemy } from './RunState';
import { reachableDistances } from './GridTraversal';
import { WORLD_DIRECTIONS, worldKey } from './SectorDefinitions';
import type { WorldPosition } from './SectorDefinitions';

export type ExplorationAction =
    { type: 'move'; dx: number; dy: number } |
    { type: 'wait' } | { type: 'search' } | { type: 'exit' } |
    { type: 'heal'; itemId: string } | { type: 'heal-station' };

export interface ExplorationEvent {
    type: 'hero-moved' | 'enemy-moved' | 'waited' | 'loot-opened' |
        'combat-started' | 'sector-entered' | 'run-completed' | 'workshop-entered' | 'healed' | 'station-used';
    message?: string;
    enemyId?: string;
    pointId?: string;
    itemIds?: string[];
    from?: WorldPosition;
    to?: WorldPosition;
    sectorIndex?: number;
    healingRestored?: number;
}

export interface ExplorationActionResult {
    accepted: boolean;
    events: ExplorationEvent[];
}

/** Пошаговое исследование, не зависящее от Phaser и кадрового времени. */
export class ExplorationEngine {
    public readonly state: RunState;

    constructor(state: RunState) {
        this.state = state;
    }

    public contextualAction(): 'search' | 'exit' | 'heal-station' | null {
        const state = this.state;
        if (state.mode !== 'exploration' || state.draggedItem) return null;
        if (this.sameCell(state.hero, state.map.exit)) return state.exitLocked ? null : 'exit';
        if (state.playerHp < state.playerMaxHp && state.aidStations.some(station => !station.used &&
            this.sameCell(station, state.hero))) return 'heal-station';
        return state.lootPoints.some(point => !point.searched && this.sameCell(point, state.hero))
            ? 'search' : null;
    }

    public applyAction(action: ExplorationAction): ExplorationActionResult {
        const state = this.state;
        const events: ExplorationEvent[] = [];
        const rejected = { accepted: false, events };
        if (state.mode !== 'exploration' || state.draggedItem) return rejected;

        if (action.type === 'exit') {
            if (this.contextualAction() !== 'exit') return rejected;
            if (!state.enterWorkshop()) return rejected;
            events.push({ type: 'workshop-entered', message: state.workshopFinal ? 'Final workshop.' : 'Entered workshop.' });
            return { accepted: true, events };
        }

        if (action.type === 'move') {
            if (!Number.isInteger(action.dx) || !Number.isInteger(action.dy) ||
                Math.abs(action.dx) + Math.abs(action.dy) !== 1) return rejected;
            const target = { x: state.hero.x + action.dx, y: state.hero.y + action.dy };
            if (!state.isWalkable(target)) return rejected;
            state.worldTurn++;
            const enemy = state.enemies.find(candidate => this.sameCell(candidate, target));
            if (enemy) {
                this.refreshChasing();
                this.startEncounter(enemy, events, 'player');
                return { accepted: true, events };
            }
            const from = { ...state.hero };
            state.hero = target;
            events.push({ type: 'hero-moved', from, to: { ...target } });
        } else if (action.type === 'search') {
            const point = state.lootPoints.find(candidate =>
                !candidate.searched && this.sameCell(candidate, state.hero));
            if (!point) return rejected;
            const itemIds = state.addLoot(point.loot);
            point.searched = true;
            state.worldTurn++;
            events.push({
                type: 'loot-opened', pointId: point.id, itemIds,
                message: `Searched ${point.name}: ${itemIds.length} supplies found.`
            });
        } else if (action.type === 'heal') {
            const healingRestored = state.consumeMedkit(action.itemId);
            if (healingRestored === 0) return rejected;
            state.worldTurn++;
            events.push({ type: 'healed', healingRestored, message: `Medkit restored ${healingRestored} HP.` });
        } else if (action.type === 'heal-station') {
            const station = state.aidStations.find(candidate => !candidate.used && this.sameCell(candidate, state.hero));
            if (!station || state.playerHp <= 0 || state.playerHp >= state.playerMaxHp) return rejected;
            const healingRestored = Math.min(station.healingAmount, state.playerMaxHp - state.playerHp);
            station.used = true;
            state.playerHp += healingRestored;
            state.worldTurn++;
            events.push({ type: 'station-used', healingRestored, pointId: station.id,
                message: `${station.name} restored ${healingRestored} HP.` });
        } else if (action.type === 'wait') {
            state.worldTurn++;
            events.push({ type: 'waited', message: 'You wait.' });
        } else {
            return rejected;
        }

        this.moveEnemies(events);
        this.refreshChasing();
        return { accepted: true, events };
    }

    /** Дальность до проходимых клеток: стены учитываются, участники не перекрывают обзор. */
    public detectionCells(enemy: WorldEnemy): WorldPosition[] {
        const distances = this.distancesFrom(enemy, enemy.detectionRadius);
        return Array.from(distances.keys(), key => {
            const [x, y] = key.split(',').map(Number);
            return { x, y };
        });
    }

    private moveEnemies(events: ExplorationEvent[]): void {
        const state = this.state;
        const enemies = [...state.enemies].sort((first, second) => first.id.localeCompare(second.id));
        for (const enemy of enemies) {
            enemy.isChasing = this.detectsHero(enemy);
            let target: WorldPosition | null = null;
            if (enemy.isChasing) {
                target = this.chaseStep(enemy);
            } else if (state.worldTurn % enemy.idlePeriod === 0) {
                const direction = WORLD_DIRECTIONS[Math.floor(state.nextRandom() * WORLD_DIRECTIONS.length)];
                target = { x: enemy.x + direction.x, y: enemy.y + direction.y };
            }
            if (!target || !state.isWalkable(target) || this.occupiedByOtherEnemy(target, enemy.id)) continue;
            if (this.sameCell(target, state.hero)) {
                this.startEncounter(enemy, events, 'enemy');
                break;
            }
            const from = { x: enemy.x, y: enemy.y };
            enemy.x = target.x;
            enemy.y = target.y;
            events.push({ type: 'enemy-moved', enemyId: enemy.id, from, to: { ...target } });
        }
    }

    private startEncounter(enemy: WorldEnemy, events: ExplorationEvent[], initiator: EncounterInitiator): void {
        this.state.beginEncounter(enemy.id, initiator);
        events.push({
            type: 'combat-started', enemyId: enemy.id,
            message: `Encounter: ${enemy.name}.`
        });
    }

    private refreshChasing(): void {
        for (const enemy of this.state.enemies) enemy.isChasing = this.detectsHero(enemy);
    }

    private detectsHero(enemy: WorldEnemy): boolean {
        return this.distancesFrom(enemy, enemy.detectionRadius).has(worldKey(this.state.hero));
    }

    private distancesFrom(start: WorldPosition, maxDistance: number): Map<string, number> {
        return reachableDistances(start, maxDistance, position => this.state.isWalkable(position));
    }

    private chaseStep(enemy: WorldEnemy): WorldPosition | null {
        const queue: Array<{ position: WorldPosition; firstStep: WorldPosition | null }> = [
            { position: { x: enemy.x, y: enemy.y }, firstStep: null }
        ];
        const visited = new Set<string>([worldKey(enemy)]);
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            if (this.sameCell(current.position, this.state.hero)) return current.firstStep;
            for (const direction of WORLD_DIRECTIONS) {
                const next = { x: current.position.x + direction.x, y: current.position.y + direction.y };
                const key = worldKey(next);
                if (visited.has(key) || !this.state.isWalkable(next) || this.occupiedByOtherEnemy(next, enemy.id)) continue;
                visited.add(key);
                queue.push({ position: next, firstStep: current.firstStep ?? next });
            }
        }
        return null;
    }

    private occupiedByOtherEnemy(position: WorldPosition, enemyId: string): boolean {
        return this.state.enemies.some(enemy => enemy.id !== enemyId && this.sameCell(enemy, position));
    }

    private sameCell(first: WorldPosition, second: WorldPosition): boolean {
        return first.x === second.x && first.y === second.y;
    }
}
