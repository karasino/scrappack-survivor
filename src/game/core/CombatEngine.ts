import type { Inventory } from './Inventory';
import type { Item } from './Item';
import { prepareEnergyPlan } from './EnergyPlan';

export interface CombatTurnLog {
    damageDealt: number;
    shieldGenerated: number;
    damageTaken: number;
    weaponUsedName: string;
    armorUsedName: string | null;
    isEnemyDead: boolean;
    isPlayerDead: boolean;
}

export class CombatEngine {
    public readonly inventory: Inventory;
    public readonly playerMaxHp: number;
    public readonly enemyMaxHp: number;
    public readonly enemyBaseDamage: number;
    public readonly enemyName: string;
    public playerHp: number;
    public enemyHp: number;

    constructor(
        inventory: Inventory,
        playerMaxHp: number,
        enemyMaxHp: number,
        enemyBaseDamage: number,
        enemyName: string
    ) {
        this.inventory = inventory;
        this.playerMaxHp = Math.max(0, playerMaxHp);
        this.enemyMaxHp = Math.max(0, enemyMaxHp);
        this.enemyBaseDamage = Math.max(0, enemyBaseDamage);
        this.enemyName = enemyName;
        this.playerHp = this.playerMaxHp;
        this.enemyHp = this.enemyMaxHp;
    }

    public processTurn(selectedWeaponId: string, selectedArmorId: string | null): CombatTurnLog {
        const weapon = this.findItem(selectedWeaponId, 'weapon');
        const armor = selectedArmorId === null
            ? null
            : this.findItem(selectedArmorId, 'armor');

        const plan = prepareEnergyPlan(this.inventory, weapon, armor);
        const rawDamage = plan.weaponPowered ? weapon.poweredDamage : weapon.baseDamage;
        const damageDealt = Math.min(this.enemyHp, Math.max(0, rawDamage));
        this.enemyHp = Math.max(0, this.enemyHp - damageDealt);

        const shieldGenerated = armor === null
            ? 0
            : Math.max(0, plan.armorPowered ? armor.poweredArmor : armor.baseArmor);
        const incomingDamage = Math.max(0, this.enemyBaseDamage - shieldGenerated);
        const damageTaken = Math.min(this.playerHp, incomingDamage);
        this.playerHp = Math.max(0, this.playerHp - damageTaken);

        for (const battery of this.inventory.items) {
            const cost = plan.batteryCosts.get(battery.id);
            if (battery.type === 'battery' && cost !== undefined) {
                battery.charge -= cost;
            }
        }
        this.removeDepletedBatteries();

        return {
            damageDealt,
            shieldGenerated,
            damageTaken,
            weaponUsedName: weapon.name,
            armorUsedName: armor?.name ?? null,
            isEnemyDead: this.enemyHp <= 0,
            isPlayerDead: this.playerHp <= 0
        };
    }

    private findItem(itemId: string, expectedType: 'weapon' | 'armor'): Item {
        const item = this.inventory.items.find(candidate => candidate.id === itemId);
        if (!item || item.type !== expectedType) {
            throw new Error(`Cannot use ${expectedType} '${itemId}': item was not found.`);
        }

        return item;
    }

    private removeDepletedBatteries(): void {
        const depletedBatteryIds = this.inventory.items
            .filter(item => item.type === 'battery' && item.charge <= 0)
            .map(item => item.id);

        let gridChanged = false;
        for (const batteryId of depletedBatteryIds) {
            const battery = this.inventory.items.find(item => item.id === batteryId);
            if (!battery) {
                continue;
            }

            battery.charge = 0;
            gridChanged = this.inventory.removeItem(batteryId) || gridChanged;
        }

        if (gridChanged) {
            this.inventory.updatePowerGrid();
        }
    }
}
