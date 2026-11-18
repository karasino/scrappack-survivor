import type { Inventory } from './Inventory';
import type { Item } from './Item';

export type EnergyUnavailableReason = 'no-source' | 'insufficient-charge' | 'shared-charge-conflict';

export interface PoweredEffectPreview {
    available: boolean;
    reason: EnergyUnavailableReason | null;
}

export interface EnergyPlan {
    weaponPowered: boolean;
    armorPowered: boolean;
    weaponReason: EnergyUnavailableReason | null;
    armorReason: EnergyUnavailableReason | null;
    batteryCosts: ReadonlyMap<string, number>;
}

interface Source {
    id: string;
    multiplier: number;
}

interface EnergyUse {
    cost: number;
    sources: Source[];
}

const compareIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

// Relative tolerance only: even very small, positive resources retain their value.
function covers(available: number, required: number): boolean {
    return available >= required
        || required - available <= Number.EPSILON * 64 * Math.max(Math.abs(available), Math.abs(required));
}

function snapshotUse(inventory: Inventory, item: Item | null, charges: ReadonlyMap<string, number>): EnergyUse {
    const sources = new Map<string, number>();
    if (item && inventory.items.includes(item) && item.isPowered && item.powerMode !== 'none') {
        for (const connection of item.connectedBatteries) {
            if (charges.has(connection.batteryId)) {
                const source = inventory.items.find(candidate => candidate.id === connection.batteryId)!;
                const tuning = item.type === 'weapon' ? source.traits.weaponCostMultiplier : source.traits.armorCostMultiplier;
                const multiplier = Math.max(0, connection.costMultiplier * tuning);
                sources.set(connection.batteryId, Math.min(sources.get(connection.batteryId) ?? Infinity, multiplier));
            }
        }
    }
    return {
        cost: Math.max(0, (item?.energyCost ?? 0) + (item?.traits.energyCost ?? 0)),
        sources: Array.from(sources, ([id, multiplier]) => ({ id, multiplier }))
            .sort((a, b) => compareIds(a.id, b.id))
    };
}

function isAvailableAlone(use: EnergyUse, charges: ReadonlyMap<string, number>): boolean {
    if (use.sources.length === 0) {
        return false;
    }
    if (use.cost === 0 || use.sources.some(source => source.multiplier === 0)) {
        return true;
    }
    const available = use.sources.reduce((total, source) => total + charges.get(source.id)! / source.multiplier, 0);
    return covers(available, use.cost);
}

function equalCosts(uses: EnergyUse[], charges: ReadonlyMap<string, number>): Map<string, number> | null {
    const costs = new Map<string, number>();
    for (const use of uses) {
        for (const source of use.sources) {
            const cost = use.cost / use.sources.length * source.multiplier;
            costs.set(source.id, (costs.get(source.id) ?? 0) + cost);
        }
    }
    return Array.from(costs).every(([id, cost]) => covers(charges.get(id)!, cost)) ? costs : null;
}

function flexibleCosts(uses: EnergyUse[], charges: ReadonlyMap<string, number>): Map<string, number> | null {
    const remaining = new Map(charges);
    const costs = new Map<string, number>();
    const demand = (use: EnergyUse): number => use.sources.some(source => source.multiplier === 0) ? 0 : use.cost;
    const allocate = (use: EnergyUse, sources: Source[]): boolean => {
        const required = demand(use);
        let supplied = 0;
        for (const source of sources) {
            if (covers(supplied, required)) {
                break;
            }
            const charge = Math.min(remaining.get(source.id)!, (required - supplied) * source.multiplier);
            remaining.set(source.id, remaining.get(source.id)! - charge);
            costs.set(source.id, (costs.get(source.id) ?? 0) + charge);
            supplied += charge / source.multiplier;
        }
        return covers(supplied, required);
    };

    const first = uses[0];
    const second = uses[1];
    if (second) {
        const firstMultipliers = new Map(first.sources.map(source => [source.id, source.multiplier]));
        // For two consumers, maximizing the first's remaining supply is a fractional
        // knapsack problem: reserve the second's energy at the smallest opportunity
        // cost (mSecond / mFirst). Exclusive sources have zero opportunity cost.
        // This finds joint feasibility, rather than testing a sequential greedy spend.
        const opportunityCost = (source: Source): number => {
            const multiplier = firstMultipliers.get(source.id);
            return multiplier === undefined || demand(first) === 0 ? 0 : source.multiplier / multiplier;
        };
        const ordered = [...second.sources].sort((a, b) =>
            opportunityCost(a) - opportunityCost(b) || compareIds(a.id, b.id));
        if (!allocate(second, ordered)) {
            return null;
        }
    }
    return allocate(first, first.sources) ? costs : null;
}

/** Pure, current-state plan. Electrical connectivity is never changed here. */
export function prepareEnergyPlan(inventory: Inventory, weapon: Item | null, armor: Item | null): EnergyPlan {
    const charges = new Map(inventory.items.filter(item => item.type === 'battery' && item.charge > 0)
        .sort((a, b) => compareIds(a.id, b.id)).map(item => [item.id, item.charge]));
    const weaponUse = snapshotUse(inventory, weapon, charges);
    const armorUse = snapshotUse(inventory, armor, charges);
    const weaponPowered = isAvailableAlone(weaponUse, charges);
    const armorPowered = isAvailableAlone(armorUse, charges);
    const uses = [weaponPowered ? weaponUse : null, armorPowered ? armorUse : null]
        .filter((use): use is EnergyUse => use !== null);
    const costs = uses.length ? equalCosts(uses, charges) ?? flexibleCosts(uses, charges) : new Map<string, number>();
    if (costs === null) {
        // Both work alone but cannot share the available charge: neither gets priority.
        return {
            weaponPowered: false, armorPowered: false,
            weaponReason: 'shared-charge-conflict', armorReason: 'shared-charge-conflict',
            batteryCosts: new Map()
        };
    }
    const batteryCosts = new Map(Array.from(costs).sort(([a], [b]) => compareIds(a, b))
        .filter(([, cost]) => cost > 0)
        // A machine-precision comparison may accept a few ULPs of discrepancy.
        // The actual debit never exceeds the available charge. Positive remainders
        // are not rounded down, even when smaller than the comparison tolerance.
        .map(([id, cost]) => [id, Math.min(cost, charges.get(id)!)]));
    const reason = (item: Item | null, use: EnergyUse, available: boolean): EnergyUnavailableReason | null =>
        item === null || item.powerMode === 'none' || available ? null : use.sources.length === 0 ? 'no-source' : 'insufficient-charge';
    return {
        weaponPowered, armorPowered, batteryCosts,
        weaponReason: reason(weapon, weaponUse, weaponPowered),
        armorReason: reason(armor, armorUse, armorPowered)
    };
}

/** Preview this item together with the selected item of the other consumer type. */
export function previewPoweredEffect(inventory: Inventory, item: Item): PoweredEffectPreview {
    if (item.powerMode === 'none' || (item.type !== 'weapon' && item.type !== 'armor')) {
        return { available: false, reason: null };
    }
    if (!inventory.items.includes(item)) {
        return { available: false, reason: 'no-source' };
    }
    const counterpart = inventory.items.filter(candidate => candidate.isSelectedForTurn
        && candidate.type === (item.type === 'weapon' ? 'armor' : 'weapon'))
        .sort((a, b) => compareIds(a.id, b.id))[0] ?? null;
    const plan = prepareEnergyPlan(inventory, item.type === 'weapon' ? item : counterpart,
        item.type === 'armor' ? item : counterpart);
    return item.type === 'weapon'
        ? { available: plan.weaponPowered, reason: plan.weaponReason }
        : { available: plan.armorPowered, reason: plan.armorReason };
}

export function canUsePoweredEffect(inventory: Inventory, item: Item): boolean {
    return previewPoweredEffect(inventory, item).available;
}
