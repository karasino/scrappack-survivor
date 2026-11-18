import type { ItemVariant } from './ItemVariants';
import type { Item } from './Item';

export type MaterialType = 'metal' | 'electronics' | 'fabric';
export type MaterialAmounts = Record<MaterialType, number>;

export const MATERIAL_CAPACITY = 24;
export const MATERIAL_NAMES: Readonly<Record<MaterialType, string>> = {
    metal: 'Scrap Metal', electronics: 'Electronics', fabric: 'Fabric'
};
export const MATERIAL_TYPES: readonly MaterialType[] = ['metal', 'electronics', 'fabric'];

export interface GroundMaterialLoot {
    kind: 'material';
    id: string;
    material: MaterialType;
    amount: number;
}

export interface GroundItemLoot {
    kind: 'item';
    id: string;
    item: Item;
}

export type GroundLoot = GroundMaterialLoot | GroundItemLoot;

export type LootSpec =
    { kind: 'material'; material: MaterialType; amount: number } |
    { kind: 'item'; definitionId: string; quantity?: number };

export interface Recipe {
    id: string;
    outputDefinitionId: string;
    outputVariant?: ItemVariant;
    name: string;
    materials: Readonly<MaterialAmounts>;
    components: Readonly<Record<string, number>>;
}

export interface RecipePreview {
    recipe: Recipe | null;
    canCraft: boolean;
    reason: string | null;
    missingMaterials: MaterialAmounts;
    missingComponents: Record<string, number>;
}

const recipe = (id: string, name: string, metal: number, electronics: number, fabric: number,
    components: Readonly<Record<string, number>> = {}): Recipe => ({
    id, outputDefinitionId: id, name, materials: { metal, electronics, fabric }, components
});

export const BASE_RECIPE_IDS = ['dagger', 'combat_bra', 'weak_battery', 'medkit'] as const;
export const RECIPES: readonly Recipe[] = [
    recipe('dagger', 'Dagger', 2, 0, 1),
    recipe('battle_axe', 'Battle Axe', 4, 0, 1),
    recipe('combat_bra', 'Combat Bra', 1, 0, 2),
    recipe('steel_armor', 'Steel Armor', 4, 0, 3),
    recipe('arc_baton', 'Arc Baton', 3, 2, 0),
    recipe('weak_battery', 'Weak Battery', 2, 1, 0),
    recipe('heavy_battery', 'Heavy Battery', 3, 3, 0, { power_core: 1 }),
    recipe('copper_wire', 'Copper Wire', 1, 1, 0),
    recipe('step_up_transformer', 'Step-up Transformer', 2, 3, 0, { precision_mechanism: 1 }),
    recipe('laser_pistol', 'Laser Pistol', 5, 4, 0, { precision_mechanism: 1 }),
    recipe('makeshift_vest', 'Makeshift Vest', 3, 0, 4),
    recipe('medkit', 'Medkit', 0, 1, 2)
];

export const emptyMaterials = (): MaterialAmounts => ({ metal: 0, electronics: 0, fabric: 0 });
