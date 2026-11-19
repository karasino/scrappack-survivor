export const POISON_DAMAGE = 2;
export const POISON_TURNS = 3;

export interface MedkitUseResult {
    accepted: boolean;
    healingRestored: number;
    poisonCured: boolean;
}

/** A turn's existing poison resolves once; newly applied poison is handled afterwards. */
export function tickPoison(hp: number, turns: number): { hpAfter: number; turnsAfter: number; damage: number } {
    const damage = turns > 0 ? Math.min(Math.max(0, hp), POISON_DAMAGE) : 0;
    return { hpAfter: Math.max(0, hp - damage), turnsAfter: Math.max(0, turns - 1), damage };
}
