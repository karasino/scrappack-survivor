import { electricLoadout, learnBase, authoredRun } from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExplorationEngine } from '../../src/game/core/ExplorationEngine.ts';
import { RECIPES, MATERIAL_CAPACITY } from '../../src/game/core/Crafting.ts';
import { ENEMY_DEFINITIONS, SECTOR_PROFILES } from '../../src/game/core/SectorDefinitions.ts';
import { prepareEnergyPlan } from '../../src/game/core/EnergyPlan.ts';

const materialSnapshot=run=>JSON.stringify([run.materials,run.worldTurn,run.rngState]);
const gear=run=>({weapon:run.inventory.items.find(i=>i.type==='weapon'),armor:run.inventory.items.find(i=>i.type==='armor')});
const kit=run=>run.inventory.items.find(i=>i.definitionId==='medkit');
const loose=run=>run.looseLoot();
const pack=(run,id,material,amount)=>{
    const entry={kind:'material',id,material,amount};
    const key=run.hero.x+','+run.hero.y;
    run.groundMaterials.set(key,[...(run.groundMaterials.get(key)||[]),entry]);return entry;
};
const fit=(run,item)=>{
    for(let y=0;y<run.inventory.height;y++)for(let x=0;x<run.inventory.width;x++)
        if(run.inventory.canPlaceItem(item,x,y))return{x,y};
    return null;
};
const put=(run,definitionId)=>{
    const item=run.createItem(definitionId),p=fit(run,item);
    assert.ok(p!==null,'fixture component fits '+definitionId);
    assert.ok(run.inventory.placeItem(item,p.x,p.y),'fixture place '+definitionId);return item;
};
const workshop=(run)=>{run.hero={...run.map.exit};const engine=new ExplorationEngine(run);
    assert.ok(engine.applyAction({type:'exit'}).accepted,'enter workshop via actual exit');return engine};

test('starting medkit, empty materials, recipe catalog and raw loot definitions', () => {
    const initial=authoredRun(123);

    assert.deepEqual([initial.inventory.width,initial.inventory.height,initial.inventory.items.length],[4,4,4],'restricted start plus medkit');
    assert.deepEqual([kit(initial).gridX,kit(initial).gridY,kit(initial).healingAmount],[1,1,25],'starting medkit');
    assert.deepEqual(initial.materials,{metal:0,electronics:0,fabric:0},'empty materials');
    assert.deepEqual(MATERIAL_CAPACITY,24,'shared material capacity');
    assert.deepEqual(RECIPES.length,12,'catalogue includes all bases');
    for(const [kind,definition]of Object.entries(ENEMY_DEFINITIONS))
        assert.ok(definition.reward.every(loot=>loot.kind==='material'||['power_core','precision_mechanism'].includes(loot.definitionId)),'enemies only drop raw loot '+kind);
    for(let sector=0;sector<SECTOR_PROFILES.length;sector++)
        assert.ok(Object.values(SECTOR_PROFILES[sector].loot).flat().every(loot=>loot.kind==='material'||['power_core','precision_mechanism'].includes(loot.definitionId)),'caches only drop raw loot '+sector);
});

test('partial material pickup retains remainder; limits and rejected combat transfers are atomic', () => {
    const run=authoredRun(321);run.materials.metal=23;const material=pack(run,'partial','electronics',5);
    const freeze=[run.worldTurn,run.rngState];
    assert.deepEqual(run.collectMaterials(material.id),1,'partial material pickup');
    assert.deepEqual([run.materialUsed,material.amount],[24,4],'partial remainder retained');
    assert.deepEqual(run.collectMaterials(material.id),0,'full reserve rejects pickup');
    assert.ok(run.dropMaterial('metal'),'drop one material');
    assert.deepEqual([run.materialUsed,run.materials.metal],[23,22],'drop exact one');
    const dropped=loose(run).find(l=>l.kind==='material'&&l.material==='metal');
    assert.deepEqual(run.collectMaterials(dropped.id),1,'pick dropped material back up');
    assert.deepEqual(run.collectMaterials(dropped.id),0,'pickup same exhausted packet does not duplicate');
    assert.deepEqual([run.worldTurn,run.rngState],freeze,'materials transfers are free');
    run.beginEncounter(run.enemies[0].id);
    const snapshot=materialSnapshot(run);
    assert.ok(!run.dropMaterial('metal'),'combat blocks material drop');
    assert.deepEqual(run.collectMaterials(material.id),0,'combat blocks material take');
    assert.deepEqual(materialSnapshot(run),snapshot,'rejected transfer is atomic');
});

test('all recipes debit exact costs and inventory components in stable ID order', () => {
    const expected={dagger:[2,0,1],battle_axe:[4,0,1],combat_bra:[1,0,2],steel_armor:[4,0,3],arc_baton:[3,2,0],weak_battery:[2,1,0],heavy_battery:[3,3,0],copper_wire:[1,1,0],
        step_up_transformer:[2,3,0],laser_pistol:[5,4,0],makeshift_vest:[3,0,4],medkit:[0,1,2]};
    for(const recipe of RECIPES){
        assert.deepEqual([recipe.materials.metal,recipe.materials.electronics,recipe.materials.fabric],expected[recipe.id],'recipe costs '+recipe.id);
        const run=authoredRun(13);
        let recipeId=recipe.id;
        if(['copper_wire','step_up_transformer'].includes(recipeId))run.learnUtilityRecipe(recipeId);
        else if(!run.knownRecipes.some(r=>r.id===recipeId))recipeId=learnBase(run,recipeId);
        workshop(run);
        Object.assign(run.materials,recipe.materials);
        for(const [definitionId,count]of Object.entries(recipe.components))for(let n=0;n<count;n++)put(run,definitionId);
        const before=[run.worldTurn,run.rngState,run.playerHp],inventory=run.inventory.items.slice();
        assert.ok(run.previewRecipe(recipeId).canCraft,'available recipe '+recipe.id);
        const result=run.craftRecipe(recipeId);
        assert.ok(result&&result.definitionId===recipe.outputDefinitionId,'craft output '+recipe.id);
        assert.deepEqual(run.materials,{metal:0,electronics:0,fabric:0},'exact material debit '+recipe.id);
        assert.ok(run.workshopItems.includes(result)&&!run.inventory.items.includes(result),'bench owns crafted item '+recipe.id);
        assert.ok(inventory.filter(i=>i.type!=='component').every(i=>run.inventory.items.includes(i)),'craft retains equipment '+recipe.id);
        assert.deepEqual([run.worldTurn,run.rngState,run.playerHp],before,'craft freezes world '+recipe.id);
        const snapshot=JSON.stringify([run.materials,run.inventory.items.map(i=>i.id),run.workshopItems.map(i=>i.id)]);
        assert.deepEqual(run.craftRecipe(recipeId),null,'insufficient repeated craft rejected '+recipe.id);
        assert.deepEqual(JSON.stringify([run.materials,run.inventory.items.map(i=>i.id),run.workshopItems.map(i=>i.id)]),snapshot,'rejected craft is atomic '+recipe.id);
    }
    const run=authoredRun(99);const heavyId=learnBase(run,'heavy_battery');Object.assign(run.materials,{metal:3,electronics:3});
    assert.ok(!run.previewRecipe(heavyId).canCraft,'craft unavailable outside workshop');
    workshop(run);const before=materialSnapshot(run);
    assert.ok(!run.previewRecipe(heavyId).canCraft,'missing core explained');
    assert.deepEqual(run.craftRecipe(heavyId),null,'missing component rejects');
    assert.deepEqual(materialSnapshot(run),before,'missing component does not debit material');
    const first=put(run,'power_core'),second=put(run,'power_core');first.id='z-core';second.id='a-core';
    // Rebuild only this isolated fixture's occupancy after choosing explicit IDs.
    for(const row of run.inventory.grid)row.fill(null);
    for(const item of run.inventory.items)for(let y=item.gridY;y<item.gridY+item.height;y++)for(let x=item.gridX;x<item.gridX+item.width;x++)run.inventory.grid[y][x]=item.id;
    assert.ok(run.craftRecipe(heavyId)!==null,'craft with two possible cores');
    assert.ok(run.inventory.items.includes(first)&&!run.inventory.items.includes(second),'components consumed in stable ID order');
});

test('full backpack crafts onto bench and continuation discards leftover output', () => {
    const run=authoredRun(3);workshop(run);
    for(const item of [...run.inventory.items])run.inventory.removeItem(item.id);
    for(let y=0;y<4;y++)for(let x=0;x<4;x++)put(run,'power_core');
    assert.deepEqual(run.inventory.grid.flat().filter(Boolean).length,16,'full backpack fixture');
    Object.assign(run.materials,{metal:2,electronics:1});
    const item=run.craftRecipe('weak_battery');
    assert.ok(item&&run.workshopItems.includes(item),'full backpack still crafts onto bench');
    assert.deepEqual(run.inventory.items.length,16,'full backpack contents unchanged');
    assert.deepEqual(run.craftRecipe('unknown_recipe'),null,'unknown recipe rejected');
    const leftId=item.id,hp=run.playerHp,rng=run.rngState;
    assert.ok(run.continueFromWorkshop(),'continue workshop');
    assert.ok(!run.allGroundItems().some(i=>i.id===leftId),'left bench item discarded');
    assert.deepEqual([run.playerHp,run.rngState,run.worldTurn,run.sectorIndex],[hp,rng,0,1],'continue preserves resources and resets sector turn');
});

test('medkits enforce HP and ownership limits in exploration and workshop', () => {
    const run=authoredRun(7),engine=new ExplorationEngine(run),item=kit(run);
    const before=materialSnapshot(run);
    assert.deepEqual(run.useMedkit(item.id).accepted,false,'full HP healing rejected');
    assert.ok(run.inventory.items.includes(item),'full HP retains medkit');
    assert.deepEqual(materialSnapshot(run),before,'full HP refusal free');
    run.enemies=[];run.playerHp=92;
    assert.deepEqual(run.useMedkit(item.id).healingRestored,8,'healing capped at maximum');
    assert.deepEqual([run.playerHp,run.worldTurn,run.inventory.items.includes(item)],[100,1,false],'exploration heal spends item and one world turn');
    const second=put(run,'medkit');run.playerHp=40;run.putOnGround(second);
    assert.deepEqual(run.useMedkit(second.id).accepted,false,'ground medkit cannot be used');
    assert.deepEqual(run.playerHp,40,'wrong owner does not heal');
    workshop(run);
    assert.ok(!run.looseLoot().some(loot=>loot.id===second.id),'old sector medkit is not on workshop bench');
    const workshopMed=put(run,'medkit'),turn=run.worldTurn;
    assert.deepEqual(run.useMedkit(workshopMed.id).healingRestored,25,'workshop medkit heals');
    assert.deepEqual([run.playerHp,run.worldTurn],[65,turn],'workshop healing is free in world time');
    assert.ok(!engine.applyAction({type:'wait'}).accepted,'workshop freezes world actions');
});

test('combat healing replaces attack, charges only armor and needs no weapon', () => {
    const run=electricLoadout(authoredRun(8));run.playerHp=50;const {weapon,armor}=gear(run),medkit=kit(run);
    run.beginEncounter(run.enemies.find(e=>e.kind==='scorpion').id);
    const before={hp:run.combatEngine.enemyHp,world:run.worldTurn,rng:run.rngState,
        high:run.inventory.items.find(i=>i.voltageType==='high'&&i.type==='battery').charge,
        low:run.inventory.items.find(i=>i.voltageType==='low'&&i.type==='battery').charge};
    const log=run.processCombatAction({type:'heal',consumableId:medkit.id,armorId:armor.id});
    assert.deepEqual([log.actionType,log.healingRestored,log.weaponUsedName],['heal',25,null],'healing log has distinct action');
    assert.deepEqual([run.combatEngine.enemyHp,log.damageDealt,log.shieldGenerated,log.damageTaken],[before.hp,0,8,0],'heal replaces attack and uses armor');
    assert.deepEqual(run.inventory.items.find(i=>i.voltageType==='high'&&i.type==='battery').charge,before.high,'selected weapon battery not debited');
    assert.deepEqual(run.inventory.items.find(i=>i.voltageType==='low'&&i.type==='battery').charge,before.low-1,'armor energy debited');
    assert.deepEqual([run.playerHp,run.combatEngine.playerHp,run.worldTurn,run.rngState],[75,75,before.world,before.rng],'combat healing syncs HP and freezes world');
    assert.ok(weapon.isSelectedForTurn,'selected weapon remains selected without attacking');
    const spare=put(run,'medkit');run.inventory.removeItem(weapon.id);run.combatEngine.playerHp=50;run.playerHp=50;
    const second=run.processCombatAction({type:'heal',consumableId:spare.id,armorId:null});
    assert.deepEqual([second.healingRestored,second.damageTaken,run.playerHp],[25,8,67],'healing needs no weapon and receives enemy response');
});

test('aid station caps healing, costs one turn and cannot be reused', () => {
    const run=authoredRun(11);run.loadSector(1);run.enemies=[];
    const engine=new ExplorationEngine(run),station=run.aidStations[0];run.hero={x:station.x,y:station.y};
    assert.ok(!engine.applyAction({type:'heal-station'}).accepted&&!station.used,'full HP does not consume aid station');
    run.playerHp=83;assert.ok(engine.applyAction({type:'heal-station'}).accepted,'aid station usable');
    assert.deepEqual([run.playerHp,run.worldTurn,station.used],[100,1,true],'station capped at 30 and costs one turn');
    run.playerHp=40;assert.ok(!engine.applyAction({type:'heal-station'}).accepted,'station one-use');
    assert.deepEqual([run.playerHp,run.worldTurn],[40,1],'used station refusal is free');
});

test('live boss blocks exit; simultaneous defeat gives no reward or expansion', () => {
    const run=authoredRun(20);run.loadSector(1);const boss=run.enemies.find(e=>e.isBoss);
    assert.deepEqual([boss.name,boss.maxHp,boss.damage,boss.detectionRadius,boss.idlePeriod],['Scrap Brute',66,14,4,3],'boss stats');
    boss.x=6;boss.y=1;run.hero={...run.map.exit};const engine=new ExplorationEngine(run),before=materialSnapshot(run);
    assert.ok(!engine.applyAction({type:'exit'}).accepted,'moved live boss still locks exit');
    assert.deepEqual(materialSnapshot(run),before,'blocked boss exit is free');
    run.playerHp=1;run.beginEncounter(boss.id,'player');run.combatEngine.enemyHp=1;
    const log=run.processCombatTurn(gear(run).weapon.id,null);
    assert.ok(log.isEnemyDead&&log.isPlayerDead,'boss simultaneous death fixture');
    assert.deepEqual([run.mode,run.bossVictoryCount,run.pendingBossReward,run.allGroundItems().length],['defeat',0,null,0],'boss defeat gives no reward or expansion');
    assert.deepEqual([run.inventory.width,run.inventory.height],[4,4],'defeat retains initial capacity');
});

test('healing plans armor alone and preserves charge when armor is unaffordable', () => {
    const run=authoredRun(21);run.inventory.expandTo(6,6);
    for(const item of [...run.inventory.items])run.inventory.removeItem(item.id);
    const battery=run.createItem('weak_battery',2),armor=run.createItem('makeshift_vest'),weapon=run.createItem('laser_pistol');
    weapon.requiredVoltage='low';weapon.isSelectedForTurn=true;armor.isSelectedForTurn=true;
    run.inventory.placeItem(battery,0,0);run.inventory.placeItem(armor,1,0);run.inventory.placeItem(weapon,0,1);
    run.inventory.updatePowerGrid();const med=put(run,'medkit');run.playerHp=50;
    const preview=prepareEnergyPlan(run.inventory,weapon,armor);
    assert.ok(!preview.weaponPowered||!preview.armorPowered,'attack fixture has shared-charge conflict');
    run.beginEncounter(run.enemies.find(e=>e.kind==='scorpion').id);
    const first=run.processCombatAction({type:'heal',consumableId:med.id,armorId:armor.id});
    assert.deepEqual([first.shieldGenerated,first.damageDealt,battery.charge],[8,0,1],'heal ignores selected weapon reservation and powers armor alone');
    armor.energyCost=2;const secondKit=put(run,'medkit');
    const second=run.processCombatAction({type:'heal',consumableId:secondKit.id,armorId:armor.id});
    assert.deepEqual([second.shieldGenerated,second.damageTaken,battery.charge],[2,6,1],'unaffordable armor uses base and does not debit partial charge during heal');
});

test('healing and aid station apply before monster contact', () => {
    const run=authoredRun(22),engine=new ExplorationEngine(run),rat=run.enemies.find(e=>e.kind==='rat');
    run.hero={x:0,y:7};Object.assign(rat,{x:0,y:6});run.enemies=[rat];run.playerHp=1;
    const med=kit(run);assert.ok(engine.applyAction({type:'heal',itemId:med.id}).accepted,'exploration healing accepted before contact');
    assert.deepEqual([run.playerHp,run.combatEngine.playerHp,run.worldTurn,run.mode],[26,26,1,'combat'],'heal occurs before AI contact creates encounter');
    const stationRun=authoredRun(23);stationRun.loadSector(1);const station=stationRun.aidStations[0];
    stationRun.hero={x:station.x,y:station.y};stationRun.playerHp=1;
    const attacker=stationRun.enemies.find(e=>e.kind==='rat');Object.assign(attacker,{x:station.x,y:station.y-1});stationRun.enemies=[attacker];
    assert.ok(new ExplorationEngine(stationRun).applyAction({type:'heal-station'}).accepted,'station resolves before AI');
    assert.deepEqual([stationRun.playerHp,stationRun.combatEngine.playerHp,station.used,stationRun.mode],[31,31,true,'combat'],'station marked used before resulting contact');
});

test('craft output construction failure is atomic; bench components are unavailable', () => {
    const run=authoredRun(24);const heavyId=learnBase(run,'heavy_battery');workshop(run);Object.assign(run.materials,{metal:2,electronics:1});
    const snapshot=materialSnapshot(run),items=run.workshopItems.length,create=run.createItem;
    run.createItem=()=>{throw Error('Injected output construction failure')};
    let failed=false;try{run.craftRecipe('weak_battery')}catch{failed=true}
    assert.ok(failed,'output failure fixture executed');assert.deepEqual([materialSnapshot(run),run.workshopItems.length],[snapshot,items],'output failure has no partial debit');
    run.createItem=create;Object.assign(run.materials,{metal:3,electronics:3});
    run.putOnGround(run.createItem('power_core'));
    assert.ok(!run.previewRecipe(heavyId).canCraft,'component left on bench cannot be consumed as inventory ingredient');
});

test('both boss encounter initiators preserve reward position and apply expansion once', () => {
    for(const initiator of ['player','enemy']){
        const run=authoredRun(25);run.loadSector(1);const boss=run.enemies.find(e=>e.isBoss);
        const source={x:6,y:0};run.hero={...source};const destination={x:boss.x,y:boss.y};
        run.beginEncounter(boss.id,initiator);run.combatEngine.enemyHp=1;
        const {weapon,armor}=gear(run);run.processCombatTurn(weapon.id,armor.id);
        assert.deepEqual(run.hero,initiator==='player'?destination:source,'boss reward honors '+initiator+' contact position');
        assert.deepEqual([run.mode,run.looseLoot().length,run.bossVictoryCount],['boss-reward',3,1],'boss creates component reward and one expansion '+initiator);
    }
});
