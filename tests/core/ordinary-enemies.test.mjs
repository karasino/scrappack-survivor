import test from 'node:test';
import assert from 'node:assert/strict';
import { RunState } from '../../src/game/core/RunState.ts';
import { CombatEngine } from '../../src/game/core/CombatEngine.ts';
import { Inventory } from '../../src/game/core/Inventory.ts';
import { ExplorationEngine } from '../../src/game/core/ExplorationEngine.ts';

function fixture(behavior='scrap-rat', {hp=1000, enemyHp=1000, damage=0, poison=0}={}) {
    const run=new RunState(123),inventory=new Inventory(6,6);
    const put=(id,x,y,charge)=>{const item=run.createItem(id,charge);assert.ok(inventory.placeItem(item,x,y));inventory.updatePowerGrid();return item;};
    const armor=put('combat_bra',4,0);
    const engine=new CombatEngine(inventory,1000,enemyHp,damage,'Renamed enemy',hp,behavior,poison);
    return {run,inventory,engine,put,brace:{type:'brace',armorId:armor.id},attack:{type:'attack',weaponId:null,armorId:null}};
}
const snapshot=f=>JSON.stringify([f.engine,f.inventory.items]);
function act(f,action=f.brace) {
    const before=snapshot(f),preview=f.engine.previewAction(action);
    assert.equal(snapshot(f),before,'pure preview');
    const {playerHpAfter,enemyHpAfter,poisonTurnsAfter,plan,...expected}=preview;
    const actual=f.engine.processAction(action);
    assert.deepEqual(actual,expected);
    assert.deepEqual([f.engine.playerHp,f.engine.enemyHp,f.engine.playerPoisonTurns],[playerHpAfter,enemyHpAfter,poisonTurnsAfter]);
    return actual;
}
for(const [profile,special] of [['scrap-rat','gnaw'],['rad-scorpion','venom-sting']]) {
    test(profile+' opens STRIKE and uses ability exactly on 2/6/10, independent of name',()=>{
        const f=fixture(profile),turns=[],cd=[];
        for(let turn=1;turn<=10;turn++) {const log=act(f);if(log.enemyAction.type===special)turns.push(turn);cd.push(f.engine.abilityCooldown);}
        assert.deepEqual(turns,[2,6,10]);assert.deepEqual(cd,[0,3,2,1,0,3,2,1,0,3]);
        assert.equal(fixture(profile).engine.enemyIntent.type,'strike');
    });
}
test('GNAW without batteries starts cooldown; attacks, UNARMED, BRACE and healing advance it',()=>{
    const f=fixture('scrap-rat',{hp:800}),dagger=f.put('dagger',4,2),kit=f.put('medkit',4,3);
    act(f);const gnaw=act(f);assert.equal(gnaw.batteryDrainedId,null);assert.equal(f.engine.abilityCooldown,3);
    act(f,{type:'attack',weaponId:dagger.id,armorId:null});assert.equal(f.engine.abilityCooldown,2);
    act(f,{type:'heal',consumableId:kit.id,armorId:null});assert.equal(f.engine.abilityCooldown,1);
    act(f,f.attack);assert.equal(f.engine.abilityCooldown,0);
});
test('GNAW chooses largest post-payment battery including disconnected reserves',()=>{
    const f=fixture(),source=f.put('weak_battery',0,0,1.5),baton=f.put('arc_baton',1,0),reserve=f.put('weak_battery',5,5,1);
    act(f);const log=act(f,{type:'attack',weaponId:baton.id,armorId:null});
    assert.equal(log.damageDealt,12);assert.equal(log.batteryDrainedId,reserve.id);assert.equal(source.charge,0.5);
    assert.ok(!f.inventory.items.includes(reserve));
});
test('shared payment and GNAW preserve current power and shield, consume only remaining fractional charge',()=>{
    const f=fixture('scrap-rat',{damage:5}),battery=f.put('weak_battery',0,1,2.5),baton=f.put('arc_baton',1,0),vest=f.put('makeshift_vest',0,2);
    act(f);const log=act(f,{type:'attack',weaponId:baton.id,armorId:vest.id});
    assert.deepEqual([log.damageDealt,log.shieldGenerated,log.damageTaken,log.batteryChargeDrained],[12,8,0,0.5]);
    assert.ok(!f.inventory.items.includes(battery));
});
test('GNAW tie is stable by ID, full block does not protect charge, tiny positive residue is preserved',()=>{
    const f=fixture('scrap-rat',{damage:5});
    const first=f.run.createItem('weak_battery',1.25),second=f.run.createItem('weak_battery',1.25);
    f.inventory.placeItem(second,5,5);f.inventory.placeItem(first,4,5);f.inventory.updatePowerGrid();
    act(f);const log=act(f);
    assert.deepEqual([log.damageTaken,log.batteryDrainedId,first.charge],[0,first.id,0.25]);assert.equal(second.charge,1.25);
    const tiny=fixture();const battery=tiny.put('weak_battery',5,5,1e-12);act(tiny);assert.equal(act(tiny).batteryChargeDrained,1e-12);
    assert.ok(!tiny.inventory.items.includes(battery));
});
test('GNAW ignores fully paid sources, drains the last reserve and refreshes the grid once',()=>{
    const f=fixture(),source=f.put('weak_battery',0,0,1),baton=f.put('arc_baton',1,0),reserve=f.put('weak_battery',5,5,0.25);
    act(f);let updates=0;const update=f.inventory.updatePowerGrid.bind(f.inventory);f.inventory.updatePowerGrid=()=>{updates++;return update();};
    const log=act(f,{type:'attack',weaponId:baton.id,armorId:null});
    assert.deepEqual([log.damageDealt,log.batteryDrainedId,log.batteryChargeDrained,updates],[12,reserve.id,0.25,1]);
    assert.ok(!f.inventory.items.includes(source)&&!f.inventory.items.includes(reserve));
});
test('poison passes full shield, starts next turn, ticks three times and refreshes without stacking',()=>{
    const f=fixture('rad-scorpion',{damage:8}),vest=f.put('makeshift_vest',0,0);f.put('weak_battery',2,0,5);
    act(f);const log=act(f,{type:'brace',armorId:vest.id});
    assert.deepEqual([log.damageTaken,log.poisonDamage,log.poisonApplied,f.engine.playerPoisonTurns],[0,0,true,3]);
    for(const remaining of [2,1,0]) {assert.equal(act(f).poisonDamage,2);assert.equal(f.engine.playerPoisonTurns,remaining);}
    assert.equal(act(f).poisonDamage,0);assert.equal(f.engine.playerPoisonTurns,3);
    const old=fixture('rad-scorpion',{poison:3});act(old);const refresh=act(old);
    assert.deepEqual([refresh.poisonDamage,old.engine.playerPoisonTurns],[2,3]);
});
test('Medkit cures at full HP; response can reapply fresh poison without an old tick',()=>{
    const f=fixture('basic',{poison:3}),kit=f.put('medkit',0,0);
    const log=act(f,{type:'heal',consumableId:kit.id,armorId:null});
    assert.deepEqual([log.healingRestored,log.poisonCured,log.poisonDamage,f.engine.playerPoisonTurns],[0,true,0,0]);
    assert.ok(!f.inventory.items.includes(kit));
    const sting=fixture('rad-scorpion',{poison:3}),second=sting.put('medkit',0,0);act(sting);
    const reinfect=act(sting,{type:'heal',consumableId:second.id,armorId:null});
    assert.deepEqual([reinfect.poisonCured,reinfect.poisonApplied,reinfect.poisonDamage,sting.engine.playerPoisonTurns],[true,true,0,3]);
});
test('availability, rejected IDs and zero-shield BRACE preserve cooldown, poison and inventory',()=>{
    const f=fixture('scrap-rat',{poison:3});f.put('weak_battery',5,5);act(f);
    const before=snapshot(f);
    for(const action of [{type:'brace',armorId:null},{type:'attack',weaponId:'missing',armorId:null},{type:'heal',consumableId:'missing',armorId:null}]) {
        assert.equal(f.engine.actionAvailability(action).available,false);assert.throws(()=>f.engine.processAction(action));assert.equal(snapshot(f),before);
    }
    f.engine.actionAvailability(f.brace);f.engine.previewAction(f.brace);assert.equal(snapshot(f),before);
});
test('lethal hits keep both special responses; old poison can make the result simultaneous death',()=>{
    for(const profile of ['scrap-rat','rad-scorpion']) {
        const f=fixture(profile,{enemyHp:1});const battery=f.put('weak_battery',5,5,1);act(f);const log=act(f,f.attack);
        assert.ok(log.isEnemyDead);assert.equal(log.poisonApplied,profile==='rad-scorpion');
        if(profile==='scrap-rat')assert.ok(!f.inventory.items.includes(battery));
    }
    const f=fixture('basic',{hp:2,enemyHp:1,poison:1});const log=act(f,f.attack);assert.ok(log.isPlayerDead&&log.isEnemyDead);
});

function world() {const run=new RunState(123);run.enemies=[];return {run,engine:new ExplorationEngine(run)};}
test('world poison ticks only paid actions, contact ticks once and death prevents contact/AI/RNG',()=>{
    const {run,engine}=world();run.playerPoisonTurns=3;
    const rng=run.rngState;assert.equal(engine.applyAction({type:'move',dx:-1,dy:0}).accepted,false);
    assert.deepEqual([run.playerHp,run.playerPoisonTurns,run.worldTurn,run.rngState],[100,3,0,rng]);
    assert.ok(engine.applyAction({type:'wait'}).accepted);assert.deepEqual([run.playerHp,run.playerPoisonTurns],[98,2]);
    const target={x:1,y:7};run.hero={x:0,y:7};run.map.rows=Array.from({length:8},()=> '........');
    const enemy={id:'contact',kind:'rat',name:'Renamed',maxHp:12,damage:5,detectionRadius:3,idlePeriod:2,isChasing:false,isBoss:false,...target};run.enemies=[enemy];
    engine.applyAction({type:'move',dx:1,dy:0});assert.deepEqual([run.mode,run.playerHp,run.playerPoisonTurns,run.combatEngine.playerPoisonTurns],['combat',96,1,1]);
    const dead=world();dead.run.hero={x:0,y:7};dead.run.map.rows=run.map.rows;dead.run.enemies=[{...enemy}];dead.run.playerHp=2;dead.run.playerPoisonTurns=3;
    const oldRng=dead.run.rngState;dead.engine.applyAction({type:'move',dx:1,dy:0});
    assert.deepEqual([dead.run.mode,dead.run.combatEngine,dead.run.rngState],['defeat',null,oldRng]);
});
test('world full-HP cleansing is accepted, workshop freezes poison and transitions preserve it',()=>{
    const {run,engine}=world();run.playerPoisonTurns=3;const kit=run.findMedkit();
    assert.deepEqual(run.useMedkit(kit.id),{accepted:true,healingRestored:0,poisonCured:true});assert.equal(run.worldTurn,1);
    run.playerPoisonTurns=3;run.hero={...run.map.exit};assert.ok(engine.applyAction({type:'exit'}).accepted);
    assert.equal(run.playerPoisonTurns,3);assert.equal(engine.applyAction({type:'wait'}).accepted,false);
    assert.ok(run.continueFromWorkshop());assert.equal(run.playerPoisonTurns,3);assert.equal(new RunState(123).playerPoisonTurns,0);
});
test('aid station heals before poison, does not cure it; poisoned mutual death gives no reward',()=>{
    const {run,engine}=world();run.loadSector(1);run.enemies=[];const station=run.aidStations[0];run.hero={x:station.x,y:station.y};run.playerHp=80;run.playerPoisonTurns=3;
    engine.applyAction({type:'heal-station'});assert.deepEqual([run.playerHp,run.playerPoisonTurns,station.used],[98,2,true]);
    const loss=new RunState(123),rat=loss.enemies.find(e=>e.kind==='rat');loss.playerHp=2;loss.playerPoisonTurns=1;loss.beginEncounter(rat.id);loss.combatEngine.enemyHp=1;
    const armor=loss.inventory.items.find(i=>i.type==='armor');loss.processCombatTurn(null,armor.id);
    assert.deepEqual([loss.mode,loss.playerHp,loss.materialUsed,loss.looseLoot().length],['defeat',0,0,0]);assert.ok(loss.enemies.some(e=>e.id===rat.id));
});
test('poison death on WAIT prevents monster movement and RNG; reopening a cache stays free',()=>{
    const run=new RunState(123),engine=new ExplorationEngine(run);run.playerHp=2;run.playerPoisonTurns=3;
    const before=JSON.stringify([run.enemies,run.rngState]);engine.applyAction({type:'wait'});
    assert.equal(run.mode,'defeat');assert.equal(JSON.stringify([run.enemies,run.rngState]),before);
    const safe=world(),cache=safe.run.blueprintCaches[0];safe.run.hero={x:cache.x,y:cache.y};safe.run.playerPoisonTurns=3;
    safe.engine.applyAction({type:'blueprint-cache'});assert.deepEqual([safe.run.playerHp,safe.run.playerPoisonTurns],[98,2]);
    safe.run.closeBlueprintChoice();const turn=safe.run.worldTurn;safe.engine.applyAction({type:'blueprint-cache'});
    assert.deepEqual([safe.run.playerHp,safe.run.playerPoisonTurns,safe.run.worldTurn],[98,2,turn]);
});
test('RunState synchronizes both HP and poison after a partial combat exception',()=>{
    const run=new RunState(123);run.beginEncounter(run.enemies[0].id);
    run.combatEngine.processAction=function(){this.playerHp=45;this.playerPoisonTurns=2;throw Error('partial fixture');};
    assert.throws(()=>run.processCombatTurn(null,null),/partial fixture/);assert.deepEqual([run.playerHp,run.playerPoisonTurns],[45,2]);
});
