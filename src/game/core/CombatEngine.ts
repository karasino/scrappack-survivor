import type { Inventory } from './Inventory';
import type { Item } from './Item';
import { prepareEnergyPlan } from './EnergyPlan';
import type { EnergyPlan } from './EnergyPlan';
import { BRUTE_TACTICS, RAT_TACTICS, nextEnemyTactics, nextOrdinaryIntent, ordinarySpecial, strikeIntent } from './EnemyIntent';
import type { EnemyBehavior, EnemyIntent, EnemyTactics } from './EnemyIntent';
import { POISON_TURNS, tickPoison } from './PlayerStatus';

export const UNARMED_DAMAGE = 2;
export const BRACE_MULTIPLIER = 2;

export interface CombatTurnLog {
    actionType: 'attack' | 'heal' | 'brace';
    healingRestored: number; consumableUsedName: string | null;
    damageDealt: number; shieldGenerated: number; damageTaken: number;
    weaponUsedName: string | null; armorUsedName: string | null;
    vampiricHealing: number; recoilDamage: number;
    isEnemyDead: boolean; isPlayerDead: boolean;
    isUnarmed: boolean;
    enemyAction: EnemyIntent;
    enemyHealingRestored: number;
    poisonDamage: number; poisonApplied: boolean; poisonCured: boolean;
    batteryDrainedId: string | null; batteryDrainedName: string | null; batteryChargeDrained: number;
}
export type CombatAction = { type: 'attack'; weaponId: string | null; armorId: string | null } |
    { type: 'heal'; consumableId: string; armorId: string | null } |
    { type: 'brace'; armorId: string | null };
export interface CombatActionPreview extends CombatTurnLog {
    playerHpAfter: number; enemyHpAfter: number; poisonTurnsAfter: number; plan: EnergyPlan;
}
/** Pure turn calculator, shared by the UI preview and the committed action. */
export function previewCombatAction(inventory: Inventory, action: CombatAction, playerHp: number,
    playerMaxHp: number, enemyHp: number, enemyDamage: number,
    enemyAction: EnemyIntent = strikeIntent(enemyDamage), enemyMaxHp: number = enemyHp,
    poisonTurns: number = 0): CombatActionPreview {
    const owned = (id: string, type: Item['type']): Item => {
        const item = inventory.items.find(candidate => candidate.id === id && candidate.type === type);
        if (!item) throw new Error(`Cannot use ${type} '${id}': item was not found.`);
        return item;
    };
    if (playerHp <= 0 || enemyHp <= 0) throw new Error('The encounter has already ended.');
    if (!['attack', 'heal', 'brace'].includes(action.type)) throw new Error('Unknown combat action.');
    const attacking = action.type === 'attack';
    const weapon = action.type === 'attack' && action.weaponId !== null ? owned(action.weaponId, 'weapon') : null;
    const armor = action.armorId === null ? null : owned(action.armorId, 'armor');
    const consumable = action.type === 'heal' ? owned(action.consumableId, 'consumable') : null;
    if (consumable && (consumable.healingAmount <= 0 || playerHp >= playerMaxHp && poisonTurns === 0)) {
        throw new Error('Medkit requires missing health or poison.');
    }
    const plan = prepareEnergyPlan(inventory, weapon, armor);
    const selected = [weapon, armor].filter((item): item is Item => item !== null);
    const sum = (key: 'damage' | 'shield' | 'lifeOnHit' | 'recoil') => selected.reduce((n, item) => n + item.traits[key], 0);
    const damageDealt = attacking ? Math.min(enemyHp, Math.max(1,
        (weapon ? plan.weaponPowered ? weapon.poweredDamage : weapon.baseDamage : UNARMED_DAMAGE) + sum('damage'))) : 0;
    const afterHit = Math.max(0, enemyHp - damageDealt);
    const enemyHealingRestored = enemyAction.type === 'repair' && afterHit > 0
        ? Math.min(enemyAction.healing, Math.max(0, enemyMaxHp - afterHit)) : 0;
    const enemyHpAfter = afterHit + enemyHealingRestored;
    const healingRestored = consumable ? Math.min(consumable.healingAmount, playerMaxHp - playerHp) : 0;
    const vampiricHealing = attacking ? Math.min(sum('lifeOnHit'), damageDealt, playerMaxHp - playerHp) : 0;
    const beforeRecoil = playerHp + healingRestored + vampiricHealing;
    const recoilDamage = attacking ? Math.min(beforeRecoil, sum('recoil')) : 0;
    const beforeRetaliation = Math.max(0, beforeRecoil - recoilDamage);
    const shield = Math.max(0, (armor ? plan.armorPowered ? armor.poweredArmor : armor.baseArmor : 0) + sum('shield'));
    const shieldGenerated = action.type === 'brace' ? Math.floor(shield * BRACE_MULTIPLIER) : shield;
    if (action.type === 'brace' && shieldGenerated <= 0) throw new Error('Select armor with a positive shield.');
    const damageTaken = Math.min(beforeRetaliation, Math.max(0, enemyAction.damage - shieldGenerated));
    const poisonCured = !!consumable && poisonTurns > 0;
    const poison = tickPoison(beforeRetaliation - damageTaken, poisonCured ? 0 : poisonTurns);
    const poisonApplied = enemyAction.type === 'venom-sting';
    const poisonTurnsAfter = poisonApplied ? POISON_TURNS : poison.turnsAfter;
    const playerHpAfter = poison.hpAfter;
    const sources = enemyAction.type === 'gnaw' ? inventory.items.filter(item => item.type === 'battery')
        .map(item => ({ item, remaining: item.charge - (plan.batteryCosts.get(item.id) ?? 0) }))
        .filter(source => source.remaining > 0)
        .sort((a, b) => b.remaining - a.remaining || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0)) : [];
    const drained = sources[0];
    return { actionType: action.type, healingRestored, consumableUsedName: consumable?.name ?? null,
        damageDealt, shieldGenerated, damageTaken, weaponUsedName: weapon?.name ?? null, armorUsedName: armor?.name ?? null,
        vampiricHealing, recoilDamage, playerHpAfter, enemyHpAfter, isPlayerDead: playerHpAfter <= 0,
        isEnemyDead: enemyHpAfter <= 0, isUnarmed: attacking && weapon === null,
        enemyAction, enemyHealingRestored, plan, poisonTurnsAfter, poisonDamage: poison.damage, poisonApplied, poisonCured,
        batteryDrainedId: drained?.item.id ?? null, batteryDrainedName: drained?.item.name ?? null,
        batteryChargeDrained: drained ? Math.min(RAT_TACTICS.chargeDrain, drained.remaining) : 0 };
}
export class CombatEngine {
    public readonly inventory: Inventory;
    public readonly playerMaxHp: number;
    public readonly enemyMaxHp: number;
    public readonly enemyBaseDamage: number;
    public readonly enemyName: string;
    public playerHp: number;
    public enemyHp: number;
    public playerPoisonTurns: number;
    private readonly behavior: EnemyBehavior;
    private cooldown: number | null;
    private intent: EnemyIntent | null;
    private tactics: EnemyTactics | null;
    public get enemyIntent(): EnemyIntent | null { return this.intent; }
    public get enemyTactics(): EnemyTactics | null { return this.tactics; }
    public get abilityCooldown(): number | null { return this.cooldown; }
    constructor(inventory: Inventory, playerMaxHp: number, enemyMaxHp: number, enemyBaseDamage: number,
        enemyName: string, initialPlayerHp: number = playerMaxHp, enemyBehavior: EnemyBehavior = 'basic', initialPoisonTurns = 0) {
        this.inventory = inventory; this.playerMaxHp = Math.max(0, playerMaxHp);
        this.enemyMaxHp = Math.max(0, enemyMaxHp); this.enemyBaseDamage = Math.max(0, enemyBaseDamage);
        this.enemyName = enemyName; this.playerHp = Math.min(this.playerMaxHp, Math.max(0, initialPlayerHp)); this.enemyHp = this.enemyMaxHp;
        this.playerPoisonTurns = initialPoisonTurns;
        this.behavior = enemyBehavior;
        this.cooldown = ordinarySpecial(enemyBehavior) ? 0 : null;
        this.intent = this.playerHp > 0 && this.enemyHp > 0
            ? strikeIntent(this.enemyBaseDamage, enemyBehavior !== 'basic' ? 'Opening strike' : 'Always attacks') : null;
        this.tactics = enemyBehavior === 'scrap-brute' ? Object.freeze({
            repairUsesRemaining: BRUTE_TACTICS.repairUses, repairCooldown: 0, slamCooldown: 0
        }) : null;
    }
    public previewAction(action: CombatAction): CombatActionPreview {
        if (!this.intent) throw new Error('The encounter has already ended.');
        return previewCombatAction(this.inventory, action, this.playerHp, this.playerMaxHp, this.enemyHp,
            this.enemyBaseDamage, this.intent, this.enemyMaxHp, this.playerPoisonTurns);
    }
    public actionAvailability(action: CombatAction): { available: boolean; reason: string | null } {
        try { this.previewAction(action); return { available: true, reason: null }; }
        catch (error) { return { available: false, reason: error instanceof Error ? error.message : String(error) }; }
    }
    public processTurn(weaponId: string | null, armorId: string | null): CombatTurnLog {
        return this.processAction({ type: 'attack', weaponId, armorId });
    }
    public processAction(action: CombatAction): CombatTurnLog {
        const { playerHpAfter, enemyHpAfter, poisonTurnsAfter, plan, ...log } = this.previewAction(action);
        this.enemyHp = enemyHpAfter; this.playerHp = playerHpAfter;
        this.playerPoisonTurns = poisonTurnsAfter;
        if (action.type === 'heal') this.inventory.removeItem(action.consumableId);
        let gridChanged = false;
        for (const battery of [...this.inventory.items]) {
            const cost = (plan.batteryCosts.get(battery.id) ?? 0) + (battery.id === log.batteryDrainedId ? log.batteryChargeDrained : 0);
            if (cost === 0) continue;
            battery.charge -= cost;
            if (battery.charge <= 0) { battery.charge = 0; gridChanged = this.inventory.removeItem(battery.id) || gridChanged; }
        }
        if (gridChanged) this.inventory.updatePowerGrid();
        if (log.isEnemyDead || log.isPlayerDead) this.intent = null;
        else if (this.cooldown !== null) {
            const next = nextOrdinaryIntent(this.behavior, log.enemyAction, this.cooldown, this.enemyBaseDamage);
            this.cooldown = next.cooldown;
            this.intent = next.intent;
        }
        else if (this.tactics) {
            const next = nextEnemyTactics(this.tactics, log.enemyAction, this.enemyHp, this.enemyMaxHp,
                log.damageDealt, this.enemyBaseDamage);
            this.tactics = next.tactics;
            this.intent = next.intent;
        }
        return log;
    }
}
