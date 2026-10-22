import type { Inventory } from './Inventory';
import type { Item } from './Item';

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

        const isWeaponPowered = weapon.isPowered;
        const rawDamage = isWeaponPowered ? weapon.poweredDamage : weapon.baseDamage;
        const damageDealt = Math.min(this.enemyHp, Math.max(0, rawDamage));
        this.enemyHp = Math.max(0, this.enemyHp - damageDealt);

        if (isWeaponPowered) {
            this.drainWeaponEnergy(weapon);
        }

        const shieldGenerated = armor === null
            ? 0
            : Math.max(0, armor.isPowered ? armor.poweredArmor : armor.baseArmor);
        const incomingDamage = Math.max(0, this.enemyBaseDamage - shieldGenerated);
        const damageTaken = Math.min(this.playerHp, incomingDamage);
        this.playerHp = Math.max(0, this.playerHp - damageTaken);

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

    private drainWeaponEnergy(weapon: Item): void {
        const totalCost = Math.max(0, weapon.energyCost);
        if (totalCost === 0 || weapon.connectedBatteries.length === 0) {
            return;
        }

        const costPerBattery = totalCost / weapon.connectedBatteries.length;
        for (const batteryLink of weapon.connectedBatteries) {
            const battery = this.inventory.items.find(item => (
                item.id === batteryLink.batteryId && item.type === 'battery'
            ));
            if (!battery) {
                continue;
            }

            const costMultiplier = Math.max(0, batteryLink.costMultiplier);
            battery.charge -= costPerBattery * costMultiplier;
        }
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
