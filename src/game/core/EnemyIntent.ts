export type EnemyBehavior = 'basic' | 'scrap-brute';
export interface EnemyIntent {
    readonly type: 'strike' | 'repair' | 'wind-up' | 'slam';
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
