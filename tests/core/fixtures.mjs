import { generateBlueprintCaches } from '../../src/game/core/BlueprintGenerator.ts';
import { ExplorationEngine } from '../../src/game/core/ExplorationEngine.ts';
import { RunState } from '../../src/game/core/RunState.ts';
import { installAuthoredSectors, authoredCachePositions } from '../sector-fixtures.mjs';
export const authoredRun = seed => installAuthoredSectors(new RunState(seed));
export function electricLoadout(run) {
    for(const item of [...run.inventory.items])run.inventory.removeItem(item.id);
    for(const [id,x,y] of [['heavy_battery',0,0],['laser_pistol',2,0],['weak_battery',0,2],['makeshift_vest',1,2],['medkit',0,1]]) {
        const item=run.createItem(id);item.isSelectedForTurn=item.type==='weapon'||item.type==='armor';
        if(!run.inventory.placeItem(item,x,y))throw Error('Invalid electric fixture');
    }
    run.inventory.updatePowerGrid();return run;
}
// Isolated knowledge fixture uses the same opening/learning commands as the game.
export function learnBase(run, base) {
    const previous={hero:run.hero,mode:run.mode,enemies:run.enemies,caches:run.blueprintCaches};
    let caches;
    for(let seed=0;seed<1000;seed++) {
        const candidate=generateBlueprintCaches(seed,0,authoredCachePositions);
        if(candidate.some(c=>c.offers.some(r=>r.outputDefinitionId===base))){caches=candidate;break}
    }
    if(!caches)throw Error('No fixture recipe '+base);
    const cache=caches.find(c=>c.offers.some(r=>r.outputDefinitionId===base));
    const recipe=cache.offers.find(r=>r.outputDefinitionId===base);
    run.mode='exploration';run.enemies=[];run.blueprintCaches=caches;run.hero={x:cache.x,y:cache.y};
    if(!new ExplorationEngine(run).applyAction({type:'blueprint-cache'}).accepted||!run.chooseBlueprint(cache.id,recipe.id))throw Error('Cannot learn fixture recipe');
    run.mode=previous.mode;run.enemies=previous.enemies;run.blueprintCaches=previous.caches;run.hero=previous.hero;
    return recipe.id;
}
