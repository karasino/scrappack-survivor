import type { RunState } from '../core/RunState';

export interface GroundPanelContent {
    title: string;
    status: string;
}

/** Describes the current place independently of the origin of its loose supplies. */
export function buildGroundPanelContent(run: RunState): GroundPanelContent {
    if (run.mode === 'workshop') return { title: 'BENCH', status: 'Crafted and dropped items' };

    const cache = run.blueprintCaches.find(place => place.x === run.hero.x && place.y === run.hero.y);
    const station = run.aidStations.find(place => place.x === run.hero.x && place.y === run.hero.y);
    const point = run.lootPoints.find(place => place.x === run.hero.x && place.y === run.hero.y);
    const title = (cache ? 'Blueprint Cache' : station?.name ?? point?.name ?? 'GROUND').toUpperCase();
    let status: string;
    if (run.mode === 'combat' || run.mode === 'boss-reward') {
        status = 'Unavailable during combat';
    } else if (run.mode === 'defeat' || run.mode === 'complete') {
        status = 'Run ended · Viewing only';
    } else if (cache) {
        status = cache.selectedRecipeId ? 'Blueprint learned · Empty' : cache.opened ? 'Choose one recipe · Reopen for free' : 'Unsearched · Open takes 1 turn';
    } else if (station) {
        status = station.used ? 'Used · No healing remaining'
            : run.playerHp >= run.playerMaxHp ? 'Unused · Health is full'
                : `Heals up to ${station.healingAmount} HP · Takes 1 turn`;
    } else if (point) {
        status = !point.searched ? 'Unsearched · Search takes 1 turn'
            : run.looseLoot().length > 0 ? 'Searched · Supplies remaining' : 'Searched · Empty';
    } else {
        status = 'Items on your current tile';
    }
    return { title, status };
}
