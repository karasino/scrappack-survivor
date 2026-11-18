import type { Item, ItemConfig } from './Item';
import type { Recipe } from './Crafting';
import { LootTable } from './LootTable';

export type BlueprintQuality = 'standard' | 'fine';
export type TraitId = 'sharp' | 'guarded' | 'vampiric' | 'blunt' | 'reckless' | 'painful' | 'power-hungry' |
    'high-capacity' | 'weapon-tuned' | 'armor-tuned' | 'low-capacity' | 'weapon-loss' | 'armor-loss';
export interface ItemVariant {
    readonly baseDefinitionId: string;
    readonly quality: BlueprintQuality;
    readonly positive: TraitId;
    readonly negative: TraitId;
}
export interface ItemTraits {
    readonly damage: number; readonly shield: number; readonly lifeOnHit: number; readonly recoil: number;
    readonly energyCost: number; readonly weaponCostMultiplier: number; readonly armorCostMultiplier: number;
}
export const emptyTraits = (): ItemTraits => ({ damage: 0, shield: 0, lifeOnHit: 0, recoil: 0,
    energyCost: 0, weaponCostMultiplier: 1, armorCostMultiplier: 1 });
const channels: Record<TraitId, string> = { sharp: 'damage', blunt: 'damage', guarded: 'shield', reckless: 'shield',
    vampiric: 'life', painful: 'life', 'power-hungry': 'energy', 'high-capacity': 'capacity', 'low-capacity': 'capacity',
    'weapon-tuned': 'weapon', 'weapon-loss': 'weapon', 'armor-tuned': 'armor', 'armor-loss': 'armor' };
export function variantPools(base: Omit<ItemConfig, 'id'>): { positive: TraitId[]; negative: TraitId[] } {
    if (base.type === 'battery') return {
        positive: ['high-capacity', 'weapon-tuned', ...(base.definitionId === 'weak_battery' ? ['armor-tuned' as const] : [])],
        negative: ['low-capacity', 'weapon-loss', ...(base.definitionId === 'weak_battery' ? ['armor-loss' as const] : [])]
    };
    if (base.type !== 'weapon' && base.type !== 'armor') return { positive: [], negative: [] };
    return { positive: ['sharp', 'guarded', 'vampiric'], negative: ['blunt', 'reckless', 'painful',
        ...(base.powerMode !== 'none' ? ['power-hungry' as const] : [])] };
}
export function validVariant(variant: ItemVariant): boolean {
    const base = LootTable.find(item => item.definitionId === variant.baseDefinitionId);
    if (!base || !['standard', 'fine'].includes(variant.quality)) return false;
    const pools = variantPools(base);
    return pools.positive.includes(variant.positive) && pools.negative.includes(variant.negative)
        && channels[variant.positive] !== channels[variant.negative];
}
export function traitsFor(variant: ItemVariant | null): ItemTraits {
    const result = { ...emptyTraits() };
    if (!variant) return result;
    const fine = variant.quality === 'fine';
    if (variant.positive === 'sharp') result.damage += fine ? 3 : 2;
    if (variant.positive === 'guarded') result.shield += fine ? 2 : 1;
    if (variant.positive === 'vampiric') result.lifeOnHit += fine ? 2 : 1;
    if (variant.negative === 'blunt') result.damage -= 2;
    if (variant.negative === 'reckless') result.shield -= 1;
    if (variant.negative === 'painful') result.recoil += 1;
    if (variant.negative === 'power-hungry') result.energyCost += 0.5;
    if (variant.positive === 'weapon-tuned') result.weaponCostMultiplier *= fine ? 0.65 : 0.75;
    if (variant.positive === 'armor-tuned') result.armorCostMultiplier *= fine ? 0.65 : 0.75;
    if (variant.negative === 'weapon-loss') result.weaponCostMultiplier *= 1.25;
    if (variant.negative === 'armor-loss') result.armorCostMultiplier *= 1.25;
    return Object.freeze(result);
}
export function capacityDelta(variant: ItemVariant | null): number {
    if (!variant) return 0;
    const heavy = variant.baseDefinitionId === 'heavy_battery';
    return variant.positive === 'high-capacity' ? (variant.quality === 'fine' ? 3 : 2) * (heavy ? 2 : 1)
        : variant.negative === 'low-capacity' ? -(heavy ? 2 : 1) : 0;
}
export function traitName(id: TraitId, armor = false): string {
    const names: Record<TraitId, string> = { sharp: armor ? 'Aggressive' : 'Sharp', guarded: 'Guarded', vampiric: 'Vampiric',
        blunt: armor ? 'Restrictive' : 'Blunt', reckless: armor ? 'Brittle' : 'Reckless', painful: 'Painful',
        'power-hungry': 'Power-Hungry', 'high-capacity': 'High Capacity', 'low-capacity': 'Low Capacity',
        'weapon-tuned': 'Weapon-Tuned', 'armor-tuned': 'Armor-Tuned', 'weapon-loss': 'Weapon Loss', 'armor-loss': 'Armor Loss' };
    return names[id];
}
export function variantName(baseName: string, variant: ItemVariant, armor = false): string {
    return `${baseName} · ${variant.quality === 'fine' ? 'Fine' : 'Standard'} · ${traitName(variant.positive, armor)} / ${traitName(variant.negative, armor)}`;
}
export function traitLines(variant: ItemVariant | null): string[] {
    if (!variant) return [];
    const base = LootTable.find(item => item.definitionId === variant.baseDefinitionId)!;
    const fine = variant.quality === 'fine';
    const effect = (id: TraitId): string => {
        switch (id) {
            case 'sharp': return `Damage +${fine ? 3 : 2}`;
            case 'guarded': return `Shield +${fine ? 2 : 1}`;
            case 'vampiric': return `Heal ${fine ? 2 : 1} HP on attack`;
            case 'blunt': return 'Damage -2';
            case 'reckless': return 'Shield -1';
            case 'painful': return 'Lose 1 HP on attack';
            case 'power-hungry': return 'Energy cost +0.5';
            case 'high-capacity': return `Charge +${(fine ? 3 : 2) * (base.definitionId === 'heavy_battery' ? 2 : 1)}`;
            case 'low-capacity': return `Charge -${base.definitionId === 'heavy_battery' ? 2 : 1}`;
            case 'weapon-tuned': return `Weapon energy -${fine ? 35 : 25}%`;
            case 'armor-tuned': return `Armor energy -${fine ? 35 : 25}%`;
            case 'weapon-loss': return 'Weapon energy +25%';
            case 'armor-loss': return 'Armor energy +25%';
        }
    };
    return [variant.positive, variant.negative].map(id => `${traitName(id, base.type === 'armor')}: ${effect(id)}`);
}
export function ownItemStats(item: Item): { baseDamage: number; poweredDamage: number; baseArmor: number; poweredArmor: number; energyCost: number } {
    return { baseDamage: Math.max(1, item.baseDamage + item.traits.damage), poweredDamage: Math.max(1, item.poweredDamage + item.traits.damage),
        baseArmor: Math.max(0, item.baseArmor + item.traits.shield), poweredArmor: Math.max(0, item.poweredArmor + item.traits.shield),
        energyCost: Math.max(0, item.energyCost + item.traits.energyCost) };
}
export function describeItem(item: Item): string[] {
    const t = item.traits;
    const lines = [`${item.width} x ${item.height}`];
    if (item.type === 'weapon') lines.push(`Damage ${Math.max(1, item.baseDamage + t.damage)}${item.powerMode === 'none' ? '' : ` / ${Math.max(1, item.poweredDamage + t.damage)} powered`}`);
    if (item.type === 'armor') lines.push(`Shield ${Math.max(0, item.baseArmor + t.shield)}${item.powerMode === 'none' ? '' : ` / ${Math.max(0, item.poweredArmor + t.shield)} powered`}`);
    if (item.type === 'weapon' || item.type === 'armor') lines.push(item.powerMode === 'none' ? 'Physical · No power connection' : `${item.requiredVoltage === 'low' ? 'Low' : 'High'} · Energy ${item.energyCost + t.energyCost}`);
    if (item.type === 'battery') lines.push(`${item.voltageType === 'low' ? 'Low' : 'High'} · Charge ${item.charge} / ${item.maxCharge}`);
    if (item.type === 'wire') lines.push('Conducts power · Energy cost -20% per path');
    if (item.type === 'transformer') lines.push('Low → High · Energy cost x2');
    if (item.type === 'consumable') lines.push(`Restore up to ${item.healingAmount} HP`);
    return [...lines, ...traitLines(item.variant)];
}
export function describeRecipe(recipe: Recipe): string[] {
    const base = LootTable.find(item => item.definitionId === recipe.outputDefinitionId)!;
    const v = recipe.outputVariant;
    const t = traitsFor(v ?? null);
    const stats = base.type === 'weapon' ? `Damage ${Math.max(1, (base.baseDamage ?? 0) + t.damage)}${base.powerMode === 'none' ? '' : ` / ${Math.max(1, (base.poweredDamage ?? 0) + t.damage)} powered`}`
        : base.type === 'armor' ? `Shield ${Math.max(0, (base.baseArmor ?? 0) + t.shield)}${base.powerMode === 'none' ? '' : ` / ${Math.max(0, (base.poweredArmor ?? 0) + t.shield)} powered`}`
        : base.type === 'battery' ? `Charge ${(base.maxCharge ?? 0) + capacityDelta(v ?? null)}`
        : base.type === 'consumable' ? `Restore up to ${base.healingAmount} HP` : base.type === 'wire' ? 'Energy cost -20% per path' : 'Low → High · Energy cost x2';
    const power = base.type === 'weapon' || base.type === 'armor' ? base.powerMode === 'none' ? 'Physical · No power connection' : `${base.requiredVoltage === 'high' ? 'High' : 'Low'} · Energy ${(base.energyCost ?? 0) + t.energyCost}` : base.type === 'battery' ? `${base.voltageType === 'high' ? 'High' : 'Low'} voltage` : '';
    const costs = [`Scrap Metal ${recipe.materials.metal} / Electronics ${recipe.materials.electronics} / Fabric ${recipe.materials.fabric}`,
        ...Object.entries(recipe.components).map(([id, n]) => `${LootTable.find(b => b.definitionId === id)?.name ?? id} x${n}`)];
    return [`${base.width} x ${base.height} · ${v ? v.quality === 'fine' ? 'Fine' : 'Standard' : 'Base'}`, stats, power, ...traitLines(v ?? null), ...costs].filter(Boolean);
}
