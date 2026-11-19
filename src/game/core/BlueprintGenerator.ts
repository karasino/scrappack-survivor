import { RECIPES } from './Crafting';
import type { Recipe } from './Crafting';
import { LootTable } from './LootTable';
import { variantName, variantPools, validVariant } from './ItemVariants';
import type { ItemVariant, TraitId } from './ItemVariants';
import type { WorldPosition } from './SectorDefinitions';

export interface BlueprintCache {
    readonly id: string; readonly x: number; readonly y: number;
    opened: boolean;
    readonly offers: readonly Recipe[];
    selectedRecipeId: string | null;
}
/** A separate RNG domain: never consumes the world's enemy movement stream. */
export function generateBlueprintCaches(seed: number, sector: number, positions: readonly WorldPosition[]): BlueprintCache[] {
    if (sector !== 0) return [];
    if (positions.length !== 2) throw new RangeError('The first sector requires two blueprint cache positions.');
    let state = (seed ^ 0xb17e9a4d ^ Math.imul(sector + 1, 0x9e3779b9)) >>> 0;
    const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; };
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
    const seen = new Set<string>();
    const make = (baseId: string, quality: ItemVariant['quality'], id: string): Recipe => {
        const base = LootTable.find(item => item.definitionId === baseId)!;
        const pools = variantPools(base);
        // Keep the positive uniform among compatible choices, then the negative uniform
        // among that positive's remaining choices. Exact repeats are rejection sampled.
        let variant: ItemVariant;
        let signature: string;
        do {
            const positive = pick(pools.positive);
            const negatives = pools.negative.filter((negative: TraitId) => validVariant({ baseDefinitionId: baseId, quality, positive, negative }));
            variant = Object.freeze({ baseDefinitionId: baseId, quality, positive, negative: pick(negatives) });
            signature = JSON.stringify(variant);
        } while (seen.has(signature));
        seen.add(signature);
        const recipe = RECIPES.find(candidate => candidate.id === baseId)!;
        return Object.freeze({ ...recipe, id, name: variantName(base.name, variant, base.type === 'armor'),
            materials: Object.freeze({ ...recipe.materials }), components: Object.freeze({ ...recipe.components }), outputVariant: variant });
    };
    const armor = ['combat_bra', 'steel_armor', 'makeshift_vest'];
    const firstBattery = pick(['weak_battery', 'heavy_battery']);
    const bases = [[pick(['battle_axe', 'arc_baton']), pick(armor), firstBattery],
        [firstBattery === 'heavy_battery' ? 'laser_pistol' : pick(['dagger', 'battle_axe', 'arc_baton']), pick(armor), 'weak_battery']];
    return bases.map((group, index) => {
        const quality = random() < 0.7 ? 'standard' : 'fine';
        return { id: `sector-${sector + 1}-blueprint-${index + 1}`, x: positions[index].x, y: positions[index].y,
            opened: false, selectedRecipeId: null,
            offers: Object.freeze(group.map((baseId, slot) => make(baseId, quality, `blueprint-${seed}-${sector}-${index}-${slot}`))) };
    });
}
