import type { Inventory } from './Inventory';
import type { Item } from './Item';
import { prepareEnergyPlan } from './EnergyPlan';
import type { EnergyPlan } from './EnergyPlan';

export interface CombatTurnLog {
    actionType: 'attack' | 'heal';
    healingRestored: number; consumableUsedName: string | null;
    damageDealt: number; shieldGenerated: number; damageTaken: number;
    weaponUsedName: string | null; armorUsedName: string | null;
    vampiricHealing: number; recoilDamage: number;
    isEnemyDead: boolean; isPlayerDead: boolean;
}
export type CombatAction = { type: 'attack'; weaponId: string; armorId: string | null } |
    { type: 'heal'; consumableId: string; armorId: string | null };
export interface CombatActionPreview extends CombatTurnLog {
    playerHpAfter: number; enemyHpAfter: number; plan: EnergyPlan;
}
/** Pure turn calculator, shared by the UI preview and the committed action. */
export function previewCombatAction(inventory: Inventory, action: CombatAction, playerHp: number,
    playerMaxHp: number, enemyHp: number, enemyDamage: number): CombatActionPreview {
    const owned = (id: string, type: Item['type']): Item => {
        const item = inventory.items.find(candidate => candidate.id === id && candidate.type === type);
        if (!item) throw new Error(`Cannot use ${type} '${id}': item was not found.`);
        return item;
    };
    if (playerHp <= 0 || enemyHp <= 0) throw new Error('The encounter has already ended.');
    const weapon = action.type === 'attack' ? owned(action.weaponId, 'weapon') : null;
    const armor = action.armorId === null ? null : owned(action.armorId, 'armor');
    const consumable = action.type === 'heal' ? owned(action.consumableId, 'consumable') : null;
    if (consumable && (consumable.healingAmount <= 0 || playerHp >= playerMaxHp)) {
        throw new Error('Cannot use a medkit: select an owned medkit while health is below maximum.');
    }
    const plan = prepareEnergyPlan(inventory, weapon, armor);
    const selected = [weapon, armor].filter((item): item is Item => item !== null);
    const sum = (key: 'damage' | 'shield' | 'lifeOnHit' | 'recoil') => selected.reduce((n, item) => n + item.traits[key], 0);
    const damageDealt = weapon ? Math.min(enemyHp, Math.max(1,
        (plan.weaponPowered ? weapon.poweredDamage : weapon.baseDamage) + sum('damage'))) : 0;
    const enemyHpAfter = Math.max(0, enemyHp - damageDealt);
    const healingRestored = consumable ? Math.min(consumable.healingAmount, playerMaxHp - playerHp) : 0;
    const vampiricHealing = weapon ? Math.min(sum('lifeOnHit'), damageDealt, playerMaxHp - playerHp) : 0;
    const beforeRecoil = playerHp + healingRestored + vampiricHealing;
    const recoilDamage = weapon ? Math.min(beforeRecoil, sum('recoil')) : 0;
    const beforeRetaliation = Math.max(0, beforeRecoil - recoilDamage);
    const shieldGenerated = Math.max(0, (armor ? plan.armorPowered ? armor.poweredArmor : armor.baseArmor : 0) + sum('shield'));
    const damageTaken = Math.min(beforeRetaliation, Math.max(0, enemyDamage - shieldGenerated));
    const playerHpAfter = Math.max(0, beforeRetaliation - damageTaken);
    return { actionType: action.type, healingRestored, consumableUsedName: consumable?.name ?? null,
        damageDealt, shieldGenerated, damageTaken, weaponUsedName: weapon?.name ?? null, armorUsedName: armor?.name ?? null,
        vampiricHealing, recoilDamage, playerHpAfter, enemyHpAfter, isPlayerDead: playerHpAfter <= 0,
        isEnemyDead: enemyHpAfter <= 0, plan };
}
export class CombatEngine {
    public readonly inventory: Inventory;
    public readonly playerMaxHp: number;
    public readonly enemyMaxHp: number;
    public readonly enemyBaseDamage: number;
    public readonly enemyName: string;
    public playerHp: number;
    public enemyHp: number;
    constructor(inventory: Inventory, playerMaxHp: number, enemyMaxHp: number, enemyBaseDamage: number,
        enemyName: string, initialPlayerHp: number = playerMaxHp) {
        this.inventory = inventory; this.playerMaxHp = Math.max(0, playerMaxHp);
        this.enemyMaxHp = Math.max(0, enemyMaxHp); this.enemyBaseDamage = Math.max(0, enemyBaseDamage);
        this.enemyName = enemyName; this.playerHp = Math.min(this.playerMaxHp, Math.max(0, initialPlayerHp)); this.enemyHp = this.enemyMaxHp;
    }
    public previewAction(action: CombatAction): CombatActionPreview {
        return previewCombatAction(this.inventory, action, this.playerHp, this.playerMaxHp, this.enemyHp, this.enemyBaseDamage);
    }
    public processTurn(weaponId: string, armorId: string | null): CombatTurnLog {
        return this.processAction({ type: 'attack', weaponId, armorId });
    }
    public processAction(action: CombatAction): CombatTurnLog {
        const { playerHpAfter, enemyHpAfter, plan, ...log } = this.previewAction(action);
        this.enemyHp = enemyHpAfter; this.playerHp = playerHpAfter;
        if (action.type === 'heal') this.inventory.removeItem(action.consumableId);
        let gridChanged = false;
        for (const battery of [...this.inventory.items]) {
            const cost = plan.batteryCosts.get(battery.id);
            if (cost === undefined) continue;
            battery.charge -= cost;
            if (battery.charge <= 0) { battery.charge = 0; gridChanged = this.inventory.removeItem(battery.id) || gridChanged; }
        }
        if (gridChanged) this.inventory.updatePowerGrid();
        return log;
    }
}
