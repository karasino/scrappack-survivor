import { reachableDistances } from './GridTraversal';
import { ENEMY_DEFINITIONS, SECTOR_PROFILES, worldKey } from './SectorDefinitions';
import type { SectorDefinition, WorldPosition } from './SectorDefinitions';

const SIZE = 8;
const START: WorldPosition = { x: 0, y: 7 };
const EXIT: WorldPosition = { x: 7, y: 0 };

/** Geometry and placement have their own RNG domain, separate from AI and offers. */
export function generateSector(seed: number, sectorIndex: number): SectorDefinition {
    const profile = SECTOR_PROFILES[sectorIndex];
    if (!Number.isInteger(sectorIndex) || !profile) throw new RangeError(`Unknown sector index '${sectorIndex}'.`);
    let state = (seed ^ 0x53ec70a1 ^ Math.imul(sectorIndex + 1, 0x9e3779b9)) >>> 0;
    const random = () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    const shuffle = <T>(values: T[]): T[] => {
        for (let i = values.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [values[i], values[j]] = [values[j], values[i]];
        }
        return values;
    };
    const cells = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'));
    cells[START.y][START.x] = 'S';
    cells[EXIT.y][EXIT.x] = 'X';
    const positions = Array.from({ length: SIZE * SIZE }, (_, i) => ({ x: i % SIZE, y: Math.floor(i / SIZE) }));
    const isWalkable = (p: WorldPosition) => p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE && cells[p.y][p.x] !== '#';
    const protectedFloor = new Set([worldKey(START), worldKey(EXIT), '0,6', '1,7']);
    const wallCandidates = shuffle(positions.filter(p => !protectedFloor.has(worldKey(p))));
    let wallCount = 0;
    for (const p of wallCandidates) {
        if (wallCount === profile.wallCount) break;
        cells[p.y][p.x] = '#';
        if (reachableDistances(START, SIZE * SIZE, isWalkable).size === SIZE * SIZE - wallCount - 1) wallCount++;
        else cells[p.y][p.x] = '.';
    }
    if (wallCount !== profile.wallCount) throw new Error(`Cannot place connected walls in sector '${sectorIndex}'.`);

    const distances = reachableDistances(START, SIZE * SIZE, isWalkable);
    const available = shuffle(positions.filter(p => cells[p.y][p.x] === '.'));
    const take = (label: string, matches: (p: WorldPosition) => boolean = () => true): WorldPosition => {
        const index = available.findIndex(matches);
        if (index < 0) throw new Error(`Cannot place '${label}' in sector '${sectorIndex}'.`);
        return available.splice(index, 1)[0];
    };
    for (const kind of profile.enemyKinds) {
        const p = take(kind, candidate => distances.get(worldKey(candidate))! > ENEMY_DEFINITIONS[kind].detectionRadius);
        cells[p.y][p.x] = kind === 'rat' ? 'r' : 'c';
    }
    for (const marker of Object.keys(profile.loot).sort()) {
        const p = take(`loot ${marker}`);
        cells[p.y][p.x] = marker;
    }
    return {
        rows: cells.map(row => row.join('')), loot: profile.loot, boss: profile.boss,
        blueprintCaches: Array.from({ length: profile.blueprintCacheCount }, () => take('Blueprint Cache')),
        aidStations: Array.from({ length: profile.aidStationCount }, () => take('First Aid Station'))
    };
}
