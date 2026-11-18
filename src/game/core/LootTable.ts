import type { ItemConfig } from './Item';

export const LootTable: Omit<ItemConfig, 'id'>[] = [
    { definitionId: 'dagger', name: 'Dagger', type: 'weapon', width: 1, height: 1, color: 0xc9c3ad, baseDamage: 6, powerMode: 'none' },
    { definitionId: 'battle_axe', name: 'Battle Axe', type: 'weapon', width: 2, height: 3, color: 0x998c7a, baseDamage: 14, powerMode: 'none' },
    { definitionId: 'combat_bra', name: 'Combat Bra', type: 'armor', width: 2, height: 1, color: 0x91816b, baseArmor: 3, powerMode: 'none' },
    { definitionId: 'steel_armor', name: 'Steel Armor', type: 'armor', width: 2, height: 3, color: 0x8e9d9e, baseArmor: 6, powerMode: 'none' },
    { definitionId: 'arc_baton', name: 'Arc Baton', type: 'weapon', width: 1, height: 2, color: 0x72b7cb, baseDamage: 3, poweredDamage: 12, requiredVoltage: 'low', energyCost: 1 },
    {
        definitionId: 'weak_battery', name: 'Weak Battery', type: 'battery', width: 1, height: 1,
        color: 0xffd700, capacity: 5, maxCapacity: 5, charge: 5, maxCharge: 5, voltageType: 'low'
    },
    {
        definitionId: 'heavy_battery', name: 'Heavy Battery', type: 'battery', width: 2, height: 1,
        color: 0x00ff00, capacity: 12, maxCapacity: 12, charge: 12, maxCharge: 12, voltageType: 'high'
    },
    {
        definitionId: 'copper_wire', name: 'Copper Wire', type: 'wire', width: 2, height: 1,
        color: 0xd27d2d,
        connectionPorts: [{ x: -1, y: 0 }, { x: 1, y: 0 }]
    },
    {
        definitionId: 'step_up_transformer', name: 'Step-up Transformer', type: 'transformer', width: 1, height: 1,
        color: 0x4682b4, transformDirection: 'low-to-high'
    },
    {
        definitionId: 'laser_pistol', name: 'Laser Pistol', type: 'weapon', width: 2, height: 1,
        color: 0xff4500, requiredVoltage: 'high', baseDamage: 4, poweredDamage: 22,
        energyCost: 2
    },
    {
        definitionId: 'makeshift_vest', name: 'Makeshift Vest', type: 'armor', width: 2, height: 2,
        color: 0x008080, requiredVoltage: 'low', baseArmor: 2, poweredArmor: 8,
        energyCost: 1
    },
    {
        definitionId: 'power_core', name: 'Power Core', type: 'component', width: 1, height: 1,
        color: 0x80b4a2
    },
    {
        definitionId: 'precision_mechanism', name: 'Precision Mechanism', type: 'component', width: 1, height: 1,
        color: 0xc9aa72
    },
    {
        definitionId: 'medkit', name: 'Medkit', type: 'consumable', width: 1, height: 1,
        color: 0xb9827c, healingAmount: 25
    }
];
