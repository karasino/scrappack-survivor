// Ordinary core commands only: no teleports or injected resources.
import assert from 'node:assert/strict';
import { RunState } from '../../../src/game/core/RunState.ts';
import { ExplorationEngine } from '../../../src/game/core/ExplorationEngine.ts';
import { installAuthoredSectors } from '../../sector-fixtures.mjs';

export function runFullCraftingRun({ generated = false } = {}) {
    const run = new RunState(123);
    if (!generated) installAuthoredSectors(run);
    const engine = new ExplorationEngine(run);
    const directions = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    const key = position => position.x + ',' + position.y;

    let fights = 0;
    let steps = 0;
    let healingActions = 0;
    let braceActions = 0;
    let sectorOneBudget;
    const firstStep = target => {
        const queue = [{ position: run.hero, first: null }];
        const visited = new Set([key(run.hero)]);
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            if (key(current.position) === key(target)) return current.first;
            for (const direction of directions) {
                const next = { x: current.position.x + direction.x, y: current.position.y + direction.y };
                if (!run.isWalkable(next) || visited.has(key(next))) continue;
                visited.add(key(next));
                queue.push({ position: next, first: current.first ?? direction });
            }
        }
        throw Error('Full crafting run: unreachable destination ' + key(target));
    };
    const freePosition = item => {
        // Keep the only two-cell free strip for a second high-voltage battery;
        // a crafted low-voltage source belongs next to the vest, not diagonally.
        if (item.type === 'battery' && item.voltageType === 'low' && run.inventory.canPlaceItem(item,3,2))
            return { x:3,y:2 };
        if (item.type === 'component') {
            for(let y=run.inventory.height-1;y>=0;y--)for(let x=run.inventory.width-1;x>=0;x--)
                if(run.inventory.canPlaceItem(item,x,y))return {x,y};
        }
        for (let y = 0; y < run.inventory.height; y++) for (let x = 0; x < run.inventory.width; x++)
            if (run.inventory.canPlaceItem(item, x, y)) return { x, y };
        return null;
    };
    const pickup = item => {
        const position = freePosition(item);
        if (!position) return false;
        const removed = run.removeFromGround(item.id);
        assert.ok(removed === item, 'physical item has one loose owner before pickup');
        run.draggedItem = item;
        assert.ok(run.inventory.placeItem(item, position.x, position.y), 'place discovered item');
        run.draggedItem = null;
        run.inventory.updatePowerGrid();
        return true;
    };
    const collect = () => {
        for (const loot of [...run.looseLoot()]) {
            if (loot.kind === 'material') run.collectMaterials(loot.id);
            else if (loot.item.type === 'component') assert.ok(pickup(loot.item), 'component fits original backpack');
        }
    };
    const resolveBattle = () => {
        if (run.mode !== 'combat') return;
        fights++;
        for (let turn = 0; run.mode === 'combat' && turn < 100; turn++) {
            const enemy = run.getEnemy(run.activeEnemyId);
            const weapon = run.inventory.items.find(item => item.type === 'weapon' && item.isSelectedForTurn);
            const armor = run.inventory.items.find(item => item.type === 'armor');
            const medkit = run.inventory.items.find(item => item.definitionId === 'medkit');
            if (enemy.isBoss && run.combatEngine.enemyIntent?.type === 'slam') {
                const log = run.processCombatAction({ type: 'brace', armorId: armor?.id ?? null });
                assert.ok(log.actionType === 'brace' && log.damageDealt === 0, 'brace answers an announced boss slam');
                braceActions++;
            } else if (enemy.isBoss && run.playerHp <= 35 && medkit) {
                const log = run.processCombatAction({ type: 'heal', consumableId: medkit.id, armorId: armor?.id ?? null });
                assert.ok(log.healingRestored > 0 && log.damageDealt === 0, 'real battle medkit replaces attack');
                healingActions++;
            } else run.processCombatTurn(weapon.id, armor?.id ?? null);
        }
        assert.ok(run.mode === 'exploration' || run.mode === 'boss-reward', 'hero survives each real battle');
        if (run.mode === 'boss-reward') {
            assert.deepEqual([run.inventory.width, run.inventory.height], [5, 4], 'first actual boss expands backpack');
            assert.ok(run.pendingBossReward.components.some(component => component.definitionId === 'power_core' && component.quantity === 2),
                'actual boss gives two power cores');
            assert.ok(run.acknowledgeBossReward(), 'acknowledge applied actual boss reward');
        }
        collect();
    };
    const travel = target => {
        for (let action = 0; key(run.hero) !== key(target) && action < 300; action++) {
            const direction = firstStep(target);
            assert.ok(direction, 'nonzero route step');
            assert.ok(engine.applyAction({ type: 'move', dx: direction.x, dy: direction.y }).accepted, 'real move accepted');
            steps++;
            resolveBattle();
            collect();
        }
        assert.deepEqual(key(run.hero), key(target), 'arrive by ordinary cardinal movement');
    };
    const clearSector = () => {
        for (const point of [...run.lootPoints]) {
            travel(point);
            if (!point.searched) {
                assert.ok(engine.applyAction({ type: 'search' }).accepted, 'real search accepted');
                resolveBattle();
                collect();
            }
        }
        for (let action = 0; run.enemies.length && action < 400; action++) {
            const target = [...run.enemies].sort((a, b) =>
                Math.abs(a.x - run.hero.x) + Math.abs(a.y - run.hero.y) -
                Math.abs(b.x - run.hero.x) - Math.abs(b.y - run.hero.y))[0];
            const direction = firstStep(target);
            assert.ok(direction, 'route to remaining live enemy');
            assert.ok(engine.applyAction({ type: 'move', dx: direction.x, dy: direction.y }).accepted, 'approach remaining enemy');
            steps++;
            resolveBattle();
            collect();
        }
        assert.ok(run.enemies.length === 0, 'all actual sector enemies defeated');
    };
    // Visit both authored caches through cardinal movement and learn actual variants.
    let arcRecipe;
    for (const cache of run.blueprintCaches) {
        travel(cache);
        assert.ok(engine.applyAction({type:'blueprint-cache'}).accepted, 'open actual blueprint cache');
        resolveBattle();
        assert.ok(run.activeBlueprintChoice, 'choice available after any encounter');
        const recipe = cache.offers[cache === run.blueprintCaches[0] ? 0 : 1];
        assert.ok(run.chooseBlueprint(cache.id, recipe.id), 'learn one offered variant');
        if (cache === run.blueprintCaches[0]) arcRecipe = recipe;
    }
    clearSector();
    sectorOneBudget = { ...run.materials };
    assert.deepEqual(sectorOneBudget, { metal: 8, electronics: 7, fabric: 4 }, 'complete sector one material budget');
    travel(run.map.exit);
    assert.ok(engine.applyAction({ type: 'exit' }).accepted && run.mode === 'workshop', 'first exit enters real workshop');
    const workshopRng = run.rngState;
    const craft = recipeId => {
        assert.ok(run.previewRecipe(recipeId).canCraft, 'earned resources afford ' + recipeId);
        const item = run.craftRecipe(recipeId);
        assert.ok(item && run.workshopItems.includes(item), 'craft onto real bench');
        return item;
    };
    assert.ok(run.useMedkit().healingRestored > 0, 'use starting medkit in workshop'); healingActions++;
    const arc = craft(arcRecipe.id);
    assert.equal(arc.definitionId, 'arc_baton');
    const batteries = [run.inventory.items.find(i=>i.type==='battery'), craft('weak_battery'), craft('weak_battery')];
    const armor = run.inventory.items.find(i=>i.type==='armor');
    const dagger = run.inventory.items.find(i=>i.definitionId==='dagger');
    const components = run.inventory.items.filter(i=>i.type==='component');
    const medicines = [craft('medkit'),craft('medkit')];
    // Ordinary inventory ownership transfer, rearrangement and selection; no new resources.
    for (const item of [...run.inventory.items]) run.putOnGround(item);
    const arrange = (item,x,y) => {
        assert.equal(run.removeFromGround(item.id),item);
        assert.ok(run.inventory.placeItem(item,x,y), 'planned 4x4 build fits');
    };
    arrange(arc,1,1); arrange(armor,2,0); arrange(dagger,0,0);
    [[0,1],[0,2],[2,1]].forEach(([x,y],i)=>arrange(batteries[i],x,y));
    components.forEach((item,i)=>arrange(item,3,2+i));
    medicines.forEach((item,i)=>arrange(item,i,3));
    arc.isSelectedForTurn=true; armor.isSelectedForTurn=true;
    run.inventory.updatePowerGrid();
    assert.deepEqual(run.rngState, workshopRng, 'craft and rearrangement preserve world randomness');
    assert.ok(run.continueFromWorkshop() && run.sectorIndex === 1, 'continue loads second actual sector');
    clearSector();
    assert.ok(healingActions > 0, 'route uses actual limited healing');
    assert.deepEqual(run.bossVictoryCount, 1, 'exactly one actual boss reward');
    assert.ok(braceActions > 0, 'earned loadout uses brace against the tactical boss');
    travel(run.map.exit);
    assert.ok(engine.applyAction({ type: 'exit' }).accepted && run.mode === 'workshop' && run.workshopFinal,
        'second exit enters final real workshop');
    const finalItem = craft(arcRecipe.id);
    assert.ok(pickup(finalItem), 'final crafted variant fits expanded backpack');
    assert.deepEqual(finalItem.variant, arc.variant, 'repeated craft preserves learned properties');
    assert.notEqual(finalItem.id, arc.id);
    assert.ok(run.inventory.items.includes(finalItem), 'boss components produce a usable final item');
    assert.ok(run.continueFromWorkshop() && run.mode === 'complete', 'finish demo after final crafting');
    return { seed: run.seed, hp: run.playerHp, fights, steps, healingActions, braceActions, sectorOneBudget,
        size: [run.inventory.width, run.inventory.height], finalItem: finalItem.definitionId };
}
