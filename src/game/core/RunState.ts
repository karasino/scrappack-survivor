import { generateBlueprintCaches } from './BlueprintGenerator';
import type { BlueprintCache } from './BlueprintGenerator';
import type { ItemVariant } from './ItemVariants';
import { describeRecipe } from './ItemVariants';
import { CombatEngine } from './CombatEngine';
import type { CombatAction, CombatTurnLog } from './CombatEngine';
import { tickPoison } from './PlayerStatus';
import type { MedkitUseResult } from './PlayerStatus';
import { Inventory } from './Inventory';
import { Item } from './Item';
import { LootTable } from './LootTable';
import { reachableDistances } from './GridTraversal';
import { ExplorationEngine } from './ExplorationEngine';
import { ENEMY_DEFINITIONS, SECTOR_PROFILES, worldKey } from './SectorDefinitions';
import { generateSector } from './SectorGenerator';
import type { EnemyKind, WorldPosition } from './SectorDefinitions';
import { emptyMaterials, MATERIAL_CAPACITY, MATERIAL_NAMES, MATERIAL_TYPES, RECIPES, BASE_RECIPE_IDS } from './Crafting';
import type { GroundLoot, GroundMaterialLoot, LootSpec, MaterialAmounts, MaterialType, RecipePreview, Recipe } from './Crafting';

export type RunMode = 'exploration' | 'combat' | 'workshop' | 'boss-reward' | 'defeat' | 'complete';
export type EncounterInitiator = 'player' | 'enemy';

export interface WorldEnemy extends WorldPosition {
    id: string;
    kind: EnemyKind;
    name: string;
    maxHp: number;
    damage: number;
    detectionRadius: number;
    idlePeriod: number;
    isChasing: boolean;
    isBoss: boolean;
}

export interface WorldLootPoint extends WorldPosition {
    id: string;
    name: string;
    searched: boolean;
    loot: readonly LootSpec[];
}

export interface AidStation extends WorldPosition {
    id: string;
    name: string;
    used: boolean;
    healingAmount: number;
}

export interface WorldMap {
    rows: string[];
    width: number;
    height: number;
    exit: WorldPosition;
}

export interface BossRewardReceipt {
    encounterId: string;
    bossName: string;
    components: Array<{ definitionId: string; name: string; quantity: number }>;
    oldSize: { width: number; height: number };
    newSize: { width: number; height: number };
    expansionApplied: boolean;
    bossVictoryCount: number;
}

const BACKPACK_STAGES: readonly (readonly [number, number])[] = [
    [4, 4], [5, 4], [5, 5], [6, 5], [6, 6]
];
const compareIds = (first: Item, second: Item): number => first.id < second.id ? -1 : first.id > second.id ? 1 : 0;

/** Состояние одного забега. Добыча принадлежит модели, а не визуальным объектам. */
export class RunState {
    public readonly inventory = new Inventory(4, 4);
    public readonly playerMaxHp = 100;
    public playerHp = 100;
    public playerPoisonTurns = 0;
    public readonly seed: number;
    public rngState: number;
    public sectorIndex = 0;
    public worldTurn = 0;
    public mode: RunMode = 'exploration';
    public hero: WorldPosition = { x: 0, y: 0 };
    public map: WorldMap = { rows: [], width: 0, height: 0, exit: { x: 0, y: 0 } };
    public enemies: WorldEnemy[] = [];
    public lootPoints: WorldLootPoint[] = [];
    public aidStations: AidStation[] = [];
    public blueprintCaches: BlueprintCache[] = [];
    public pendingBlueprintCacheId: string | null = null;
    private readonly learnedRecipes = new Map<string, Recipe>(RECIPES.filter(recipe =>
        (BASE_RECIPE_IDS as readonly string[]).includes(recipe.id)).map(recipe => [recipe.id, recipe]));

    public get knownRecipes(): readonly Recipe[] { return [...this.learnedRecipes.values()]; }
    public get activeBlueprintChoice(): BlueprintCache | null {
        return this.mode === 'exploration' && this.playerHp > 0 ? this.blueprintCaches.find(cache =>
            cache.id === this.pendingBlueprintCacheId && !cache.selectedRecipeId) ?? null : null;
    }
    public chooseBlueprint(cacheId: string, recipeId: string): boolean {
        const cache = this.activeBlueprintChoice;
        const recipe = cache?.offers.find(offer => offer.id === recipeId);
        if (!cache || cache.id !== cacheId || !recipe) return false;
        this.learnedRecipes.set(recipe.id, recipe);
        cache.selectedRecipeId = recipe.id;
        this.pendingBlueprintCacheId = null;
        return true;
    }
    public closeBlueprintChoice(): boolean {
        if (!this.activeBlueprintChoice) return false;
        this.pendingBlueprintCacheId = null;
        return true;
    }
    public learnUtilityRecipe(id: string): void {
        if (id !== 'copper_wire' && id !== 'step_up_transformer') return;
        const recipe = RECIPES.find(candidate => candidate.id === id)!;
        this.learnedRecipes.set(id, recipe);
    }
    public describeRecipe(id: string): string[] {
        const recipe = this.learnedRecipes.get(id);
        return recipe ? describeRecipe(recipe) : [];
    }
    public readonly groundItems = new Map<string, Item[]>();
    public readonly groundMaterials = new Map<string, GroundMaterialLoot[]>();
    public readonly materials: MaterialAmounts = emptyMaterials();
    public readonly workshopItems: Item[] = [];
    public readonly workshopMaterials: GroundMaterialLoot[] = [];
    public workshopFinal = false;
    public nextSectorIndex: number | null = null;
    public requiredBossId: string | null = null;
    public bossVictoryCount = 0;
    public pendingBossReward: BossRewardReceipt | null = null;
    public combatEngine: CombatEngine | null = null;
    public activeEnemyId: string | null = null;
    public draggedItem: Item | null = null;
    private itemCounter = 0;
    private materialLootCounter = 0;
    private victoryPosition: WorldPosition | null = null;
    private readonly rewardedBossEncounters = new Map<string, BossRewardReceipt>();

    constructor(seed: number) {
        this.seed = seed >>> 0;
        this.rngState = this.seed;
        const startingItems: Array<[string, number, number]> = [
            ['dagger', 0, 0], ['combat_bra', 1, 0], ['weak_battery', 0, 1], ['medkit', 1, 1]
        ];
        for (const [definitionId, x, y] of startingItems) {
            const item = this.createItem(definitionId);
            item.isSelectedForTurn = item.type === 'weapon' || item.type === 'armor';
            if (!this.inventory.placeItem(item, x, y)) {
                throw new Error(`Invalid starting position for '${definitionId}'.`);
            }
        }
        this.inventory.updatePowerGrid();
        this.loadSector(0);
    }

    public get materialUsed(): number {
        return MATERIAL_TYPES.reduce((sum, material) => sum + this.materials[material], 0);
    }

    public get exitLocked(): boolean {
        return this.requiredBossId !== null && this.getEnemy(this.requiredBossId) !== undefined;
    }

    /** Единственный источник случайности мира; ID предметов его не расходуют. */
    public nextRandom(): number {
        this.rngState = (Math.imul(1664525, this.rngState) + 1013904223) >>> 0;
        return this.rngState / 0x100000000;
    }

    public createItem(definitionId: string, charge?: number, variant?: ItemVariant): Item {
        const definition = LootTable.find(candidate => candidate.definitionId === definitionId);
        if (!definition) throw new Error(`Unknown item definition '${definitionId}'.`);
        const item = new Item({
            ...definition, variant, id: `run-${this.seed}-item-${++this.itemCounter}`,
        });
        if (charge !== undefined) item.charge = item.capacity = Math.max(0, Math.min(item.maxCharge, charge));
        return item;
    }

    /** Physical loot currently accessible to the hero; the bench is a separate owner. */
    public itemsAtHero(): Item[] {
        return this.mode === 'workshop' ? this.workshopItems : this.groundItems.get(worldKey(this.hero)) ?? [];
    }

    public allGroundItems(): Item[] {
        return [...Array.from(this.groundItems.values()).flat(), ...this.workshopItems];
    }

    public looseLoot(): GroundLoot[] {
        const materials = this.mode === 'workshop' ? this.workshopMaterials
            : this.groundMaterials.get(worldKey(this.hero)) ?? [];
        return [...materials, ...this.itemsAtHero().map(item => ({ kind: 'item' as const, id: item.id, item }))];
    }

    public putOnGround(item: Item, x = this.hero.x, y = this.hero.y): void {
        if (this.mode !== 'workshop' && !this.isWalkable({ x, y })) {
            throw new Error(`Cannot place ground loot at (${x}, ${y}).`);
        }
        if (this.inventory.removeItem(item.id)) this.inventory.updatePowerGrid();
        this.removeFromGround(item.id);
        if (this.draggedItem?.id === item.id) this.draggedItem = null;
        item.gridX = -1;
        item.gridY = -1;
        item.isSelectedForTurn = false;
        item.isPowered = false;
        item.connectedBatteries = [];
        item.energyCostMultiplier = 1;
        if (this.mode === 'workshop') {
            this.workshopItems.push(item);
        } else {
            const key = worldKey({ x, y });
            const items = this.groundItems.get(key) ?? [];
            items.push(item);
            this.groundItems.set(key, items);
        }
    }

    public removeFromGround(id: string): Item | null {
        const benchIndex = this.workshopItems.findIndex(item => item.id === id);
        if (benchIndex >= 0) return this.workshopItems.splice(benchIndex, 1)[0];
        for (const [key, items] of this.groundItems) {
            const index = items.findIndex(item => item.id === id);
            if (index < 0) continue;
            const [item] = items.splice(index, 1);
            if (items.length === 0) this.groundItems.delete(key);
            return item;
        }
        return null;
    }

    public putMaterialOnGround(material: MaterialType, amount: number,
        x = this.hero.x, y = this.hero.y): GroundMaterialLoot {
        if (!MATERIAL_TYPES.includes(material) || !Number.isInteger(amount) || amount <= 0 ||
            (this.mode !== 'workshop' && !this.isWalkable({ x, y }))) {
            throw new Error('Invalid material loot.');
        }
        const loot: GroundMaterialLoot = {
            kind: 'material', id: `run-${this.seed}-material-${++this.materialLootCounter}`, material, amount
        };
        if (this.mode === 'workshop') this.workshopMaterials.push(loot);
        else {
            const key = worldKey({ x, y });
            const materials = this.groundMaterials.get(key) ?? [];
            materials.push(loot);
            this.groundMaterials.set(key, materials);
        }
        return loot;
    }

    public addLoot(definitions: readonly LootSpec[]): string[] {
        const ids: string[] = [];
        for (const definition of definitions) {
            if (definition.kind === 'material') {
                ids.push(this.putMaterialOnGround(definition.material, definition.amount).id);
            } else {
                for (let count = 0; count < (definition.quantity ?? 1); count++) {
                    const item = this.createItem(definition.definitionId);
                    this.putOnGround(item);
                    ids.push(item.id);
                }
            }
        }
        return ids;
    }

    public collectMaterials(lootId: string): number {
        if (!this.canTransferLooseLoot()) return 0;
        const materials = this.mode === 'workshop' ? this.workshopMaterials
            : this.groundMaterials.get(worldKey(this.hero)) ?? [];
        const index = materials.findIndex(loot => loot.id === lootId);
        if (index < 0) return 0;
        const loot = materials[index];
        const amount = Math.min(loot.amount, Math.max(0, MATERIAL_CAPACITY - this.materialUsed));
        if (amount <= 0) return 0;
        this.materials[loot.material] += amount;
        loot.amount -= amount;
        if (loot.amount === 0) materials.splice(index, 1);
        if (this.mode !== 'workshop' && materials.length === 0) this.groundMaterials.delete(worldKey(this.hero));
        return amount;
    }

    public dropMaterial(material: MaterialType): boolean {
        if (!this.canTransferLooseLoot() || !MATERIAL_TYPES.includes(material) || this.materials[material] < 1) return false;
        this.putMaterialOnGround(material, 1);
        this.materials[material]--;
        return true;
    }

    private canTransferLooseLoot(): boolean {
        return (this.mode === 'exploration' || this.mode === 'workshop') && !this.draggedItem && !this.activeBlueprintChoice;
    }

    public previewRecipe(recipeId: string): RecipePreview {
        const recipe = this.learnedRecipes.get(recipeId) ?? null;
        const missingMaterials = emptyMaterials();
        const missingComponents: Record<string, number> = {};
        if (recipe) {
            for (const material of MATERIAL_TYPES) {
                missingMaterials[material] = Math.max(0, recipe.materials[material] - this.materials[material]);
            }
            for (const [definitionId, quantity] of Object.entries(recipe.components)) {
                const owned = this.inventory.items.filter(item => item.type === 'component' && item.definitionId === definitionId).length;
                if (owned < quantity) missingComponents[definitionId] = quantity - owned;
            }
        }
        let reason: string | null = null;
        if (!recipe) reason = 'Unknown recipe.';
        else if (this.mode !== 'workshop') reason = 'Crafting is available only in a workshop.';
        else if (this.activeBlueprintChoice) reason = 'Choose or close the blueprint first.';
        else if (this.draggedItem) reason = 'Finish moving the item first.';
        else {
            const missing = MATERIAL_TYPES.filter(material => missingMaterials[material] > 0)
                .map(material => `${MATERIAL_NAMES[material]} x${missingMaterials[material]}`);
            for (const [definitionId, quantity] of Object.entries(missingComponents)) {
                const name = LootTable.find(item => item.definitionId === definitionId)?.name ?? definitionId;
                missing.push(`${name} x${quantity}`);
            }
            if (missing.length) reason = `Missing: ${missing.join(', ')}.`;
        }
        return { recipe, canCraft: recipe !== null && reason === null, reason, missingMaterials, missingComponents };
    }

    public craftRecipe(recipeId: string): Item | null {
        const preview = this.previewRecipe(recipeId);
        if (!preview.canCraft || !preview.recipe) return null;
        const recipe = preview.recipe;
        const ingredients: Item[] = [];
        for (const [definitionId, quantity] of Object.entries(recipe.components)) {
            const owned = this.inventory.items.filter(item => item.type === 'component' && item.definitionId === definitionId)
                .sort(compareIds).slice(0, quantity);
            if (owned.length !== quantity) return null;
            ingredients.push(...owned);
        }
        // Prepare the result before committing any resource/owner change.
        const output = this.createItem(recipe.outputDefinitionId, undefined, recipe.outputVariant);
        for (const material of MATERIAL_TYPES) this.materials[material] -= recipe.materials[material];
        for (const ingredient of ingredients) this.inventory.removeItem(ingredient.id);
        if (ingredients.length) this.inventory.updatePowerGrid();
        this.workshopItems.push(output);
        return output;
    }

    public enterWorkshop(): boolean {
        if (this.mode !== 'exploration' || this.activeBlueprintChoice || this.draggedItem || this.exitLocked ||
            this.hero.x !== this.map.exit.x || this.hero.y !== this.map.exit.y) return false;
        this.nextSectorIndex = this.sectorIndex + 1 < SECTOR_PROFILES.length ? this.sectorIndex + 1 : null;
        this.workshopFinal = this.nextSectorIndex === null;
        this.mode = 'workshop';
        return true;
    }

    public continueFromWorkshop(): boolean {
        if (this.mode !== 'workshop' || this.draggedItem) return false;
        this.workshopItems.length = 0;
        this.workshopMaterials.length = 0;
        this.groundItems.clear();
        this.groundMaterials.clear();
        const next = this.nextSectorIndex;
        this.nextSectorIndex = null;
        if (next === null) this.mode = 'complete';
        else this.loadSector(next);
        return true;
    }

    public findMedkit(itemId?: string): Item | null {
        return this.inventory.items.filter(item => (itemId === undefined || item.id === itemId) &&
            item.type === 'consumable' && item.healingAmount > 0).sort(compareIds)[0] ?? null;
    }

    public medkitAvailability(itemId?: string, armorId?: string | null): { available: boolean; reason: string | null } {
        const unavailable = (reason: string) => ({ available: false, reason });
        if (this.draggedItem || this.activeBlueprintChoice) return unavailable('Finish the current action.');
        if (!['exploration', 'workshop', 'combat'].includes(this.mode) || this.playerHp <= 0) return unavailable('Healing is unavailable.');
        const item = this.findMedkit(itemId);
        if (!item) return unavailable('Craft a Medkit.');
        if (this.mode === 'combat') {
            const armors = this.inventory.items.filter(candidate => candidate.type === 'armor' && candidate.isSelectedForTurn);
            if (armorId === undefined && armors.length > 1) return unavailable('Select at most one armor.');
            return this.combatEngine?.actionAvailability({ type: 'heal', consumableId: item.id,
                armorId: armorId === undefined ? armors[0]?.id ?? null : armorId }) ?? unavailable('No active encounter.');
        }
        return this.playerHp >= this.playerMaxHp && this.playerPoisonTurns === 0
            ? unavailable('Health is full.') : { available: true, reason: null };
    }

    /** Internal resolution step: ExplorationEngine supplies the world turn/AI phase. */
    public consumeMedkit(itemId: string): MedkitUseResult {
        if ((this.mode !== 'exploration' && this.mode !== 'workshop') || !this.medkitAvailability(itemId).available)
            return { accepted: false, healingRestored: 0, poisonCured: false };
        const item = this.findMedkit(itemId)!;
        const restored = Math.min(item.healingAmount, this.playerMaxHp - this.playerHp);
        const poisonCured = this.playerPoisonTurns > 0;
        this.inventory.removeItem(item.id);
        this.playerHp += restored;
        this.playerPoisonTurns = 0;
        return { accepted: true, healingRestored: restored, poisonCured };
    }

    /** Safe convenience command: exploration healing always includes the monster phase. */
    public useMedkit(itemId?: string, armorId?: string | null): MedkitUseResult {
        const rejected = { accepted: false, healingRestored: 0, poisonCured: false };
        if (!this.medkitAvailability(itemId, armorId).available) return rejected;
        const item = this.findMedkit(itemId);
        if (!item) return rejected;
        if (this.mode === 'exploration') {
            const result = new ExplorationEngine(this).applyAction({ type: 'heal', itemId: item.id });
            const healed = result.events.find(event => event.type === 'healed');
            return { accepted: result.accepted, healingRestored: healed?.healingRestored ?? 0, poisonCured: healed?.poisonCured ?? false };
        }
        if (this.mode === 'workshop') return this.consumeMedkit(item.id);
        const armor = armorId === undefined ? this.inventory.items.filter(candidate =>
            candidate.type === 'armor' && candidate.isSelectedForTurn).sort(compareIds)[0]?.id ?? null : armorId;
        const log = this.processCombatAction({ type: 'heal', consumableId: item.id, armorId: armor });
        return { accepted: true, healingRestored: log.healingRestored, poisonCured: log.poisonCured };
    }

    /** Called exactly once per accepted world turn, before contacts or monster AI. */
    public tickWorldPoison(): number {
        const poison = tickPoison(this.playerHp, this.playerPoisonTurns);
        this.playerHp = poison.hpAfter;
        this.playerPoisonTurns = poison.turnsAfter;
        if (this.playerHp <= 0) {
            this.mode = 'defeat';
            this.pendingBlueprintCacheId = null;
        }
        return poison.damage;
    }

    public isWalkable(position: WorldPosition): boolean {
        return Number.isInteger(position.x) && Number.isInteger(position.y) &&
            position.x >= 0 && position.y >= 0 && position.x < this.map.width && position.y < this.map.height &&
            this.map.rows[position.y]?.[position.x] !== '#';
    }

    public getEnemy(id: string): WorldEnemy | undefined {
        return this.enemies.find(enemy => enemy.id === id);
    }

    public loadSector(index: number): void {
        const definition = generateSector(this.seed, index);
        this.blueprintCaches = generateBlueprintCaches(this.seed, index, definition.blueprintCaches);
        this.pendingBlueprintCacheId = null;
        this.sectorIndex = index;
        this.worldTurn = 0;
        this.mode = 'exploration';
        this.activeEnemyId = null;
        this.victoryPosition = null;
        this.combatEngine = null;
        this.requiredBossId = null;
        this.pendingBossReward = null;
        this.nextSectorIndex = null;
        this.workshopFinal = false;
        this.workshopItems.length = 0;
        this.workshopMaterials.length = 0;
        this.groundItems.clear();
        this.groundMaterials.clear();
        this.enemies = [];
        this.lootPoints = [];
        this.aidStations = [];
        this.map = {
            rows: [...definition.rows], width: definition.rows[0].length,
            height: definition.rows.length, exit: { x: 0, y: 0 }
        };
        let enemyIndex = 0;
        const addEnemy = (kind: EnemyKind, x: number, y: number): WorldEnemy => {
            const enemy = ENEMY_DEFINITIONS[kind];
            const instance: WorldEnemy = {
                id: `sector-${index + 1}-enemy-${String(++enemyIndex).padStart(2, '0')}`,
                kind, name: enemy.name, maxHp: enemy.maxHp, damage: enemy.damage,
                detectionRadius: enemy.detectionRadius, idlePeriod: enemy.idlePeriod,
                isChasing: false, isBoss: enemy.isBoss === true, x, y
            };
            this.enemies.push(instance);
            return instance;
        };
        for (let y = 0; y < this.map.height; y++) {
            for (let x = 0; x < this.map.width; x++) {
                const symbol = this.map.rows[y][x];
                if (symbol === 'S') this.hero = { x, y };
                if (symbol === 'X') this.map.exit = { x, y };
                if (symbol === 'r' || symbol === 'c') addEnemy(symbol === 'r' ? 'rat' : 'scorpion', x, y);
                if (symbol === '1' || symbol === '2') {
                    this.lootPoints.push({
                        id: `sector-${index + 1}-loot-${symbol}`, x, y,
                        name: symbol === '1' ? 'Scrap Heap' : 'Abandoned Kiosk',
                        searched: false, loot: definition.loot[symbol]
                    });
                }
            }
        }
        if (definition.boss) {
            this.requiredBossId = addEnemy('brute', this.map.exit.x, this.map.exit.y).id;
        }
        this.aidStations = definition.aidStations.map(position => ({
            id: `sector-${index + 1}-first-aid`, name: 'First Aid Station', ...position, used: false, healingAmount: 30
        }));
    }

    public beginEncounter(enemyId: string, initiator: EncounterInitiator = 'enemy'): void {
        if (this.mode !== 'exploration' || this.playerHp <= 0 || this.draggedItem !== null || this.activeBlueprintChoice) {
            throw new Error('An encounter can only begin during exploration without a dragged item.');
        }
        const enemy = this.getEnemy(enemyId);
        if (!enemy) throw new Error(`Unknown enemy '${enemyId}'.`);
        this.activeEnemyId = enemy.id;
        this.victoryPosition = initiator === 'player' ? { x: enemy.x, y: enemy.y } : null;
        this.combatEngine = new CombatEngine(
            this.inventory, this.playerMaxHp, enemy.maxHp, enemy.damage, enemy.name, this.playerHp,
            ENEMY_DEFINITIONS[enemy.kind].behavior, this.playerPoisonTurns
        );
        this.mode = 'combat';
    }

    public processCombatTurn(weaponId: string | null, armorId: string | null): CombatTurnLog {
        return this.processCombatAction({ type: 'attack', weaponId, armorId });
    }

    public processCombatAction(action: CombatAction): CombatTurnLog {
        if (this.mode !== 'combat' || !this.combatEngine || !this.activeEnemyId || this.draggedItem) {
            throw new Error('Cannot process a combat turn outside an active encounter.');
        }
        const enemy = this.getEnemy(this.activeEnemyId);
        if (!enemy) throw new Error('The active encounter enemy no longer exists.');
        let log: CombatTurnLog;
        try {
            log = this.combatEngine.processAction(action);
        } finally {
            // A failed turn is not retried or rolled back; show the calculator's actual HP.
            this.playerHp = this.combatEngine.playerHp;
            this.playerPoisonTurns = this.combatEngine.playerPoisonTurns;
        }
        if (log.isPlayerDead) {
            this.pendingBlueprintCacheId = null;
            this.mode = 'defeat';
            this.activeEnemyId = null;
            this.victoryPosition = null;
        } else if (log.isEnemyDead) {
            this.enemies = this.enemies.filter(candidate => candidate.id !== enemy.id);
            if (this.victoryPosition) {
                this.hero = this.victoryPosition;
                const radius = Math.max(0, ...this.enemies.map(candidate => candidate.detectionRadius));
                const distances = reachableDistances(this.hero, radius, position => this.isWalkable(position));
                for (const candidate of this.enemies) {
                    candidate.isChasing = (distances.get(worldKey(candidate)) ?? Infinity) <= candidate.detectionRadius;
                }
            }
            this.activeEnemyId = null;
            this.victoryPosition = null;
            this.mode = 'exploration';
            if (enemy.isBoss || ENEMY_DEFINITIONS[enemy.kind]?.isBoss) this.applyBossReward(enemy.id, enemy.name);
            else this.addLoot(ENEMY_DEFINITIONS[enemy.kind].reward);
        }
        return log;
    }

    /** Registers one completed boss encounter. Repeated delivery has no side effects. */
    public applyBossReward(encounterId: string, bossName = 'Scrap Brute'): BossRewardReceipt | null {
        const existing = this.rewardedBossEncounters.get(encounterId);
        if (existing) return existing;
        if (this.mode !== 'exploration' || this.draggedItem || this.playerHp <= 0 || this.pendingBossReward) return null;
        const rewards = ENEMY_DEFINITIONS.brute.reward;
        this.addLoot(rewards);
        const oldSize = { width: this.inventory.width, height: this.inventory.height };
        this.bossVictoryCount++;
        const [width, height] = BACKPACK_STAGES[Math.min(this.bossVictoryCount, BACKPACK_STAGES.length - 1)];
        this.inventory.expandTo(Math.max(width, oldSize.width), Math.max(height, oldSize.height));
        const newSize = { width: this.inventory.width, height: this.inventory.height };
        const receipt: BossRewardReceipt = {
            encounterId, bossName,
            components: rewards.filter((reward): reward is Extract<LootSpec, { kind: 'item' }> => reward.kind === 'item')
                .map(reward => ({ definitionId: reward.definitionId,
                    name: LootTable.find(item => item.definitionId === reward.definitionId)?.name ?? reward.definitionId,
                    quantity: reward.quantity ?? 1 })),
            oldSize, newSize, expansionApplied: oldSize.width !== newSize.width || oldSize.height !== newSize.height,
            bossVictoryCount: this.bossVictoryCount
        };
        this.rewardedBossEncounters.set(encounterId, receipt);
        this.pendingBossReward = receipt;
        this.mode = 'boss-reward';
        return receipt;
    }

    public acknowledgeBossReward(): boolean {
        if (this.mode !== 'boss-reward' || !this.pendingBossReward) return false;
        this.pendingBossReward = null;
        this.mode = 'exploration';
        return true;
    }
}
