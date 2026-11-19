import type { LootSpec } from './Crafting';
import type { EnemyBehavior } from './EnemyIntent';

export interface WorldPosition {
    x: number;
    y: number;
}

export type EnemyKind = 'rat' | 'scorpion' | 'brute';

export interface EnemyDefinition {
    behavior: EnemyBehavior;
    name: string;
    maxHp: number;
    damage: number;
    detectionRadius: number;
    idlePeriod: number;
    reward: readonly LootSpec[];
    isBoss?: boolean;
}

export interface SectorDefinition {
    rows: readonly string[];
    loot: Readonly<Record<string, readonly LootSpec[]>>;
    boss?: boolean;
    blueprintCaches: readonly WorldPosition[];
    aidStations: readonly WorldPosition[];
}

export interface SectorProfile {
    wallCount: number;
    enemyKinds: readonly Exclude<EnemyKind, 'brute'>[];
    loot: SectorDefinition['loot'];
    boss?: boolean;
    blueprintCacheCount: number;
    aidStationCount: number;
}

export const ENEMY_DEFINITIONS: Readonly<Record<EnemyKind, EnemyDefinition>> = {
    rat: {
        behavior: 'scrap-rat',
        name: 'Scrap Rat', maxHp: 12, damage: 5, detectionRadius: 3, idlePeriod: 2,
        reward: [{ kind: 'material', material: 'metal', amount: 1 },
            { kind: 'material', material: 'electronics', amount: 1 }]
    },
    scorpion: {
        behavior: 'rad-scorpion',
        name: 'Rad-Scorpion', maxHp: 24, damage: 8, detectionRadius: 4, idlePeriod: 3,
        reward: [{ kind: 'material', material: 'metal', amount: 2 },
            { kind: 'material', material: 'electronics', amount: 1 }]
    },
    brute: {
        behavior: 'scrap-brute',
        name: 'Scrap Brute', maxHp: 66, damage: 14, detectionRadius: 4, idlePeriod: 3,
        isBoss: true,
        reward: [{ kind: 'item', definitionId: 'power_core', quantity: 2 },
            { kind: 'item', definitionId: 'precision_mechanism', quantity: 1 }]
    }
};

export const SECTOR_PROFILES: readonly SectorProfile[] = [
    {
        wallCount: 9,
        enemyKinds: ['rat', 'scorpion', 'rat'],
        blueprintCacheCount: 2,
        aidStationCount: 0,
        loot: {
            '1': [{ kind: 'material', material: 'metal', amount: 2 },
                { kind: 'material', material: 'fabric', amount: 2 }],
            '2': [{ kind: 'material', material: 'metal', amount: 2 },
                { kind: 'material', material: 'electronics', amount: 4 },
                { kind: 'material', material: 'fabric', amount: 2 },
                { kind: 'item', definitionId: 'power_core' },
                { kind: 'item', definitionId: 'precision_mechanism' }]
        }
    },
    {
        boss: true,
        wallCount: 11,
        enemyKinds: ['scorpion', 'scorpion', 'rat'],
        blueprintCacheCount: 0,
        aidStationCount: 1,
        loot: {
            '1': [{ kind: 'material', material: 'metal', amount: 2 },
                { kind: 'material', material: 'fabric', amount: 3 }],
            '2': [{ kind: 'material', material: 'metal', amount: 2 },
                { kind: 'material', material: 'electronics', amount: 5 },
                { kind: 'item', definitionId: 'power_core' },
                { kind: 'item', definitionId: 'precision_mechanism' }]
        }
    }
];

export const WORLD_DIRECTIONS: readonly WorldPosition[] = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }
];

export function worldKey(position: WorldPosition): string {
    return `${position.x},${position.y}`;
}
