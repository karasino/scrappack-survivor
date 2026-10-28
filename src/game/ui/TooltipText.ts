import type { ItemType } from '../core/Item';

// Presentation copy is independent of combat calculations and input handling.
export const TOOLTIP_TEXT = {
    types: {
        weapon: 'Weapon', armor: 'Armor', battery: 'Battery', wire: 'Wire', transformer: 'Transformer',
        component: 'Crafting Component', consumable: 'Consumable'
    } satisfies Record<ItemType, string>,
    low: 'Low',
    high: 'High',
    baseDamage: 'Base damage',
    poweredDamage: 'Powered damage',
    baseShield: 'Base shield',
    poweredShield: 'Powered shield',
    requiredVoltage: 'Required voltage',
    baseEnergyCost: 'Base energy cost',
    perAttack: '/ attack',
    perTurnUsed: '/ turn used',
    connectedBatteries: 'Connected batteries',
    noPowerSource: '! No compatible power source.',
    insufficientWeaponCharge: '! Insufficient charge for powered damage.',
    insufficientArmorCharge: '! Insufficient charge for powered shield.',
    sharedChargeConflict: '! Insufficient charge to power both selected items.',
    charge: 'Charge',
    outputVoltage: 'Output voltage',
    conversion: 'Conversion',
    lowToHigh: 'Low → High',
    highToLow: 'High → Low',
    noConversion: 'No conversion',
    conversionCost: 'When converting: +1 to energy cost multiplier',
    activeMarker: '►'
} as const;
