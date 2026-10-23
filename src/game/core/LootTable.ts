import type { ItemConfig } from './Item';

export const LootTable: Omit<ItemConfig, 'id'>[] = [
    {
        name: 'Weak Battery', type: 'battery', width: 1, height: 1,
        color: 0xffd700, capacity: 5, maxCapacity: 5, charge: 5, maxCharge: 5, voltageType: 'low'
    },
    {
        name: 'Heavy Battery', type: 'battery', width: 2, height: 1,
        color: 0x00ff00, capacity: 12, maxCapacity: 12, charge: 12, maxCharge: 12, voltageType: 'high'
    },
    {
        name: 'Copper Wire', type: 'wire', width: 2, height: 1,
        color: 0xd27d2d,
        connectionPorts: [{ x: -1, y: 0 }, { x: 1, y: 0 }]
    },
    {
        name: 'Step-up Transformer', type: 'transformer', width: 1, height: 1,
        color: 0x4682b4, transformDirection: 'low-to-high'
    },
    {
        name: 'Laser Pistol', type: 'weapon', width: 2, height: 1,
        color: 0xff4500, requiredVoltage: 'high', baseDamage: 4, poweredDamage: 22,
        energyCost: 2
    },
    {
        name: 'Makeshift Vest', type: 'armor', width: 2, height: 2,
        color: 0x008080, requiredVoltage: 'low', baseArmor: 2, poweredArmor: 8,
        energyCost: 1
    }
];
