export type EnemyBehavior = 'basic' | 'scrap-brute' | 'scrap-rat' | 'rad-scorpion';
export interface EnemyIntent {
    readonly type: 'strike' | 'repair' | 'wind-up' | 'slam' | 'gnaw' | 'venom-sting';
    readonly damage: number;
    readonly healing: number;
    readonly reason: string;
}
export interface EnemyTactics {
    readonly repairUsesRemaining: number;
    readonly repairCooldown: number;
    readonly slamCooldown: number;
}
export const BRUTE_TACTICS = Object.freeze({
    repairThreshold: 0.4, repairHealing: 12, repairUses: 2,
    heavyHit: 12, slamDamage: 22, cooldown: 4
});
export const RAT_TACTICS = Object.freeze({ cooldown: 3, chargeDrain: 1 });
export const SCORPION_TACTICS = Object.freeze({ cooldown: 3 });

export function ordinarySpecial(behavior: EnemyBehavior): 'gnaw' | 'venom-sting' | null {
    return behavior === 'scrap-rat' ? 'gnaw' : behavior === 'rad-scorpion' ? 'venom-sting' : null;
}

export function nextOrdinaryIntent(behavior: EnemyBehavior, executed: EnemyIntent, cooldown: number, damage: number):
    { intent: EnemyIntent; cooldown: number } {
    const special = ordinarySpecial(behavior)!;
    const nextCooldown = executed.type === special
        ? (behavior === 'scrap-rat' ? RAT_TACTICS.cooldown : SCORPION_TACTICS.cooldown)
        : Math.max(0, cooldown - 1);
    return { cooldown: nextCooldown, intent: nextCooldown > 0
        ? strikeIntent(damage, 'Ability cooling down')
        : Object.freeze({ type: special, damage, healing: 0, reason: 'Ability ready' }) };
}
export const strikeIntent = (damage: number, reason = 'Always attacks'): EnemyIntent => Object.freeze({
    type: 'strike', damage, healing: 0, reason
});

/** Only completed responses advance tactics; the current response is already committed. */
export function nextEnemyTactics(current: EnemyTactics, executed: EnemyIntent,
    hp: number, maxHp: number, damageDealt: number, baseDamage: number):
    { tactics: EnemyTactics; intent: EnemyIntent } {
    const tactics: EnemyTactics = Object.freeze({
        repairUsesRemaining: current.repairUsesRemaining - (executed.type === 'repair' ? 1 : 0),
        repairCooldown: executed.type === 'repair' ? BRUTE_TACTICS.cooldown : Math.max(0, current.repairCooldown - 1),
        slamCooldown: executed.type === 'slam' ? BRUTE_TACTICS.cooldown : Math.max(0, current.slamCooldown - 1)
    });
    let intent: EnemyIntent;
    if (executed.type === 'wind-up') {
        intent = { type: 'slam', damage: BRUTE_TACTICS.slamDamage, healing: 0, reason: 'Attack charged' };
    } else if (hp <= maxHp * BRUTE_TACTICS.repairThreshold && tactics.repairUsesRemaining > 0 && tactics.repairCooldown === 0) {
        intent = { type: 'repair', damage: 0, healing: BRUTE_TACTICS.repairHealing, reason: 'Low health' };
    } else if (current.slamCooldown === 0 && tactics.slamCooldown === 0 && damageDealt >= BRUTE_TACTICS.heavyHit) {
        intent = { type: 'wind-up', damage: 0, healing: 0, reason: 'Heavy hit' };
    } else intent = strikeIntent(baseDamage, 'No special ready');
    return { tactics, intent: Object.freeze(intent) };
}
