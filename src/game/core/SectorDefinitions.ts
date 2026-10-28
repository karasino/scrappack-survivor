export interface WorldPosition {
    x: number;
    y: number;
}

export type EnemyKind = 'rat' | 'scorpion';

export interface EnemyDefinition {
    name: string;
    maxHp: number;
    damage: number;
    detectionRadius: number;
    idlePeriod: number;
    rewardDefinitionId: string;
    rewardCharge: number;
}

export interface SectorDefinition {
    rows: readonly string[];
    loot: Readonly<Record<string, readonly string[]>>;
}

export const ENEMY_DEFINITIONS: Readonly<Record<EnemyKind, EnemyDefinition>> = {
    rat: {
        name: 'Scrap Rat', maxHp: 12, damage: 5, detectionRadius: 3, idlePeriod: 2,
        rewardDefinitionId: 'weak_battery', rewardCharge: 2
    },
    scorpion: {
        name: 'Rad-Scorpion', maxHp: 24, damage: 8, detectionRadius: 4, idlePeriod: 3,
        rewardDefinitionId: 'heavy_battery', rewardCharge: 4
    }
};

export const SECTOR_DEFINITIONS: readonly SectorDefinition[] = [
    {
        rows: [
            '.......X',
            '..##r...',
            '.....#2.',
            '.##..#..',
            '......c.',
            '.1r.##..',
            '..#.....',
            'S.......'
        ],
        loot: {
            '1': ['weak_battery', 'copper_wire'],
            '2': ['heavy_battery', 'step_up_transformer']
        }
    },
    {
        rows: [
            '..#....X',
            '..#c.#..',
            '.....#..',
            '.##...c.',
            '.1..##..',
            '..#r....',
            '..#..#2.',
            'S.......'
        ],
        loot: {
            '1': ['weak_battery', 'makeshift_vest'],
            '2': ['heavy_battery', 'copper_wire']
        }
    }
];

export const WORLD_DIRECTIONS: readonly WorldPosition[] = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }
];

export function worldKey(position: WorldPosition): string {
    return `${position.x},${position.y}`;
}
