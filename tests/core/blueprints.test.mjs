import test from 'node:test';
import assert from 'node:assert/strict';
import { RunState } from '../../src/game/core/RunState.ts';
import { ExplorationEngine } from '../../src/game/core/ExplorationEngine.ts';
import { generateBlueprintCaches } from '../../src/game/core/BlueprintGenerator.ts';
import { validVariant, variantPools, describeRecipe } from '../../src/game/core/ItemVariants.ts';
import { LootTable } from '../../src/game/core/LootTable.ts';
import { RECIPES } from '../../src/game/core/Crafting.ts';
import { Inventory } from '../../src/game/core/Inventory.ts';
import { Item } from '../../src/game/core/Item.ts';
import { CombatEngine } from '../../src/game/core/CombatEngine.ts';
import { prepareEnergyPlan } from '../../src/game/core/EnergyPlan.ts';
const variant=(base,positive,negative,quality='standard')=>({baseDefinitionId:base,positive,negative,quality});
const item=(base,v,id=base)=>new Item({...LootTable.find(i=>i.definitionId===base),id,...(v?{variant:v}:{})});
const place=(pack,gear,x,y)=>{assert.ok(pack.placeItem(gear,x,y));return gear};
const open=(run,index=0)=>{
    const cache=run.blueprintCaches[index];run.hero={x:cache.x,y:cache.y};
    assert.ok(new ExplorationEngine(run).applyAction({type:'blueprint-cache'}).accepted);return cache;
};
const snapshot=run=>JSON.stringify([run.playerHp,run.worldTurn,run.rngState,run.materials,run.knownRecipes,run.blueprintCaches]);

test('joint seeded offers preserve pools, grades, prices, sizes and exact uniqueness across 1000 seeds',()=>{
    const bases=new Set();let fine=0;
    for(let seed=0;seed<1000;seed++){
        const caches=generateBlueprintCaches(seed,0), [a,b]=caches;
        assert.deepEqual(caches,generateBlueprintCaches(seed,0));
        assert.deepEqual(caches.map(c=>[c.x,c.y]),[[1,6],[6,3]]);
        assert.ok(['battle_axe','arc_baton'].includes(a.offers[0].outputDefinitionId));
        assert.equal(b.offers[2].outputDefinitionId,'weak_battery');
        if(a.offers[2].outputDefinitionId==='heavy_battery')assert.equal(b.offers[0].outputDefinitionId,'laser_pistol');
        else assert.ok(['dagger','battle_axe','arc_baton'].includes(b.offers[0].outputDefinitionId));
        assert.equal(new Set(caches.flatMap(c=>c.offers.map(r=>JSON.stringify(r.outputVariant)))).size,6);
        for(const cache of caches){
            assert.equal(new Set(cache.offers.map(r=>r.outputVariant.quality)).size,1);
            if(cache.offers[0].outputVariant.quality==='fine')fine++;
            for(const r of cache.offers){
                bases.add(r.outputDefinitionId);assert.ok(validVariant(r.outputVariant));
                assert.deepEqual(r.materials,RECIPES.find(b=>b.id===r.outputDefinitionId).materials);
                assert.deepEqual(r.components,RECIPES.find(b=>b.id===r.outputDefinitionId).components);
                const instance=item(r.outputDefinitionId,r.outputVariant),base=LootTable.find(i=>i.definitionId===r.outputDefinitionId);
                assert.deepEqual([instance.width,instance.height],[base.width,base.height]);
                assert.ok(Object.isFrozen(r.outputVariant));assert.ok(describeRecipe(r).length>=6);
            }
        }
    }
    assert.ok(fine>500&&fine<700,'fine grade roughly 30%');
    assert.deepEqual([...bases].sort(),['arc_baton','battle_axe','combat_bra','dagger','heavy_battery','laser_pistol','makeshift_vest','steel_armor','weak_battery']);
});

test('every compatible equipment/battery pair validates; opposite channels and physical energy trait reject',()=>{
    for(const base of LootTable){
        const pools=variantPools(base);
        for(const positive of pools.positive)for(const negative of pools.negative){
            const v=variant(base.definitionId,positive,negative);
            if(validVariant(v))assert.doesNotThrow(()=>item(base.definitionId,v));
            else assert.throws(()=>item(base.definitionId,v));
        }
    }
    for(const [positive,negative] of [['sharp','blunt'],['guarded','reckless'],['vampiric','painful']])assert.ok(!validVariant(variant('dagger',positive,negative)));
    assert.ok(!validVariant(variant('dagger','sharp','power-hungry')));
    assert.ok(!validVariant(variant('heavy_battery','armor-tuned','low-capacity')));
});

test('close/reopen is free, pending blocks commands, stale learning is atomic, world RNG never rerolls',()=>{
    const run=new RunState(13);run.enemies=[];run.playerHp=70;run.materials.metal=1;
    const offers=JSON.stringify(run.blueprintCaches),rng=run.rngState,cache=open(run);
    assert.equal(run.worldTurn,1);const before=snapshot(run);
    for(const action of [{type:'wait'},{type:'move',dx:1,dy:0},{type:'search'},{type:'heal',itemId:run.findMedkit().id}])assert.equal(new ExplorationEngine(run).applyAction(action).accepted,false);
    assert.equal(run.useMedkit(),0);assert.equal(run.dropMaterial('metal'),false);assert.equal(run.enterWorkshop(),false);
    assert.equal(run.chooseBlueprint(cache.id,'stale'),false);assert.equal(snapshot(run),before);
    assert.ok(run.closeBlueprintChoice());assert.equal(run.activeBlueprintChoice,null);
    open(run);assert.equal(run.worldTurn,1);assert.equal(run.rngState,rng);
    assert.equal(JSON.stringify(run.blueprintCaches.map(c=>c.offers)),JSON.stringify(JSON.parse(offers).map(c=>c.offers)));
    const r=cache.offers[0],count=run.inventory.items.length;
    assert.ok(run.chooseBlueprint(cache.id,r.id));assert.equal(run.inventory.items.length,count);
    assert.ok(run.knownRecipes.some(k=>k.id===r.id));assert.ok(!run.knownRecipes.some(k=>k.id===r.outputDefinitionId));
    const learned=snapshot(run);assert.equal(run.chooseBlueprint(cache.id,r.id),false);assert.equal(snapshot(run),learned);
    assert.equal(new ExplorationEngine(run).applyAction({type:'blueprint-cache'}).accepted,false);
});

test('visiting in either order gives the same offers; choice delayed until victory and cleared by defeat',()=>{
    const a=new RunState(13),b=new RunState(13);a.enemies=[];b.enemies=[];
    open(a,0);a.chooseBlueprint(a.activeBlueprintChoice.id,a.activeBlueprintChoice.offers[0].id);open(a,1);
    open(b,1);b.closeBlueprintChoice();for(let n=0;n<10;n++)new ExplorationEngine(b).applyAction({type:'wait'});open(b,0);
    assert.deepEqual(a.blueprintCaches.map(c=>c.offers),b.blueprintCaches.map(c=>c.offers));
    for(const defeat of [false,true]){
        const run=new RunState(4),rat=run.enemies.find(e=>e.kind==='rat');run.enemies=[rat];
        Object.assign(rat,{x:1,y:5});run.hero={x:1,y:6};
        assert.ok(new ExplorationEngine(run).applyAction({type:'blueprint-cache'}).accepted);
        assert.equal(run.mode,'combat');assert.equal(run.activeBlueprintChoice,null);assert.ok(run.pendingBlueprintCacheId);
        if(defeat)run.combatEngine.playerHp=1;
        while(run.mode==='combat')run.processCombatTurn(run.inventory.items.find(i=>i.type==='weapon').id,null);
        assert.equal(run.mode,defeat?'defeat':'exploration');assert.equal(!!run.activeBlueprintChoice,!defeat);
        if(defeat)assert.equal(run.pendingBlueprintCacheId,null);
    }
});

test('utility searches retain loot, learned knowledge survives sector, new runs reset; crafting copies independent',()=>{
    const run=new RunState(7);run.enemies=[];
    for(const point of run.lootPoints){run.hero={x:point.x,y:point.y};assert.ok(new ExplorationEngine(run).applyAction({type:'search'}).accepted);assert.ok(run.looseLoot().length>0)}
    assert.ok(run.knownRecipes.some(r=>r.id==='copper_wire'));assert.ok(run.knownRecipes.some(r=>r.id==='step_up_transformer'));
    const cache=open(run),r=cache.offers[2];run.chooseBlueprint(cache.id,r.id);
    run.hero={...run.map.exit};assert.ok(new ExplorationEngine(run).applyAction({type:'exit'}).accepted);
    assert.equal(run.craftRecipe('heavy_battery'),null,'unknown ordinary base stays locked');
    Object.assign(run.materials,{metal:20,electronics:20,fabric:20});
    if(r.components.power_core)place(run.inventory,run.createItem('power_core'),3,3);
    const a=run.craftRecipe(r.id);assert.ok(a);
    if(r.components.power_core)place(run.inventory,run.createItem('power_core'),3,3);
    const b=run.craftRecipe(r.id);assert.ok(b);assert.notEqual(a.id,b.id);assert.deepEqual(a.variant,b.variant);
    a.charge-=1;assert.notEqual(a.charge,b.charge);assert.notEqual(a.connectedBatteries,b.connectedBatteries);
    assert.ok(run.continueFromWorkshop());assert.deepEqual(run.blueprintCaches,[]);assert.ok(run.knownRecipes.some(k=>k.id===r.id));
    assert.deepEqual(new RunState(7).knownRecipes.map(r=>r.id),['dagger','combat_bra','weak_battery','medkit']);
});

const fight=(wv,av,{hp=50,enemyHp=50,enemyDamage=10,base='dagger',armor='combat_bra'}={})=>{
    const pack=new Inventory(),weapon=place(pack,item(base,wv),0,0),vest=av?place(pack,item(armor,av),2,0):null;
    const engine=new CombatEngine(pack,100,enemyHp,enemyDamage,'Target',hp);
    const action={type:'attack',weaponId:weapon.id,armorId:vest?.id??null};
    const before=JSON.stringify([pack.items,engine.playerHp,engine.enemyHp]);const preview=engine.previewAction(action);
    assert.equal(JSON.stringify([pack.items,engine.playerHp,engine.enemyHp]),before,'pure combat preview');
    const log=engine.processAction(action);
    const {plan,playerHpAfter,enemyHpAfter,...expected}=preview;assert.deepEqual(log,expected);
    assert.deepEqual([engine.playerHp,engine.enemyHp],[playerHpAfter,enemyHpAfter]);return {log,engine,pack};
};
test('flat traits combine once, Guarded works without armor, floors and cross-item cancellation',()=>{
    assert.deepEqual([fight(variant('dagger','sharp','reckless')).log.damageDealt,fight(variant('dagger','guarded','blunt')).log.shieldGenerated],[8,1]);
    const f=fight(variant('dagger','sharp','reckless','fine'),variant('combat_bra','guarded','blunt','fine'));
    assert.deepEqual([f.log.damageDealt,f.log.shieldGenerated],[7,4]);
    const armorOnly=fight(null,variant('combat_bra','sharp','reckless'));assert.equal(armorOnly.log.damageDealt,8);
    const minimum=fight(variant('arc_baton','guarded','blunt'),variant('combat_bra','guarded','blunt'),{base:'arc_baton'});
    assert.equal(minimum.log.damageDealt,1);assert.equal(minimum.log.shieldGenerated,5);
    assert.equal(fight(variant('dagger','sharp','reckless'),null).log.shieldGenerated,0);
});
test('vampirism caps by actual damage and max HP; recoil bypasses shield; lethal hit still retaliates',()=>{
    const a=fight(variant('dagger','vampiric','reckless','fine'),null,{hp:99,enemyHp:1});
    assert.deepEqual([a.log.damageDealt,a.log.vampiricHealing,a.log.damageTaken,a.engine.playerHp],[1,1,10,90]);
    const b=fight(variant('dagger','guarded','painful'),variant('combat_bra','guarded','painful'),{hp:2,enemyHp:1,enemyDamage:1});
    assert.deepEqual([b.log.recoilDamage,b.log.shieldGenerated,b.log.isEnemyDead,b.log.isPlayerDead],[2,5,true,true]);
    const c=fight(variant('dagger','vampiric','reckless'),variant('combat_bra','sharp','painful'),{hp:50});
    assert.deepEqual([c.log.vampiricHealing,c.log.recoilDamage],[1,1]);
});
test('HEAL ignores weapon traits, armor vampirism/recoil/damage and never hurts enemy',()=>{
    for(const positive of ['sharp','guarded','vampiric'])for(const negative of ['blunt','reckless','painful']){
        const v=variant('combat_bra',positive,negative);if(!validVariant(v))continue;
        const pack=new Inventory(),armor=place(pack,item('combat_bra',v),0,0),kit=place(pack,item('medkit'),0,1);
        place(pack,item('dagger',variant('dagger','vampiric','reckless')),3,0).isSelectedForTurn=true;
        const engine=new CombatEngine(pack,100,50,8,'Target',90),preview=engine.previewAction({type:'heal',consumableId:kit.id,armorId:armor.id});
        const log=engine.processAction({type:'heal',consumableId:kit.id,armorId:armor.id});
        assert.equal(log.damageDealt,0);assert.equal(log.vampiricHealing,0);assert.equal(log.recoilDamage,0);assert.equal(log.healingRestored,10);
        assert.equal(engine.playerHp,preview.playerHpAfter);assert.equal(engine.enemyHp,50);assert.ok(!pack.items.includes(kit));
    }
});

test('wire applies once before battery tuning and Power-Hungry; fractional preview matches debit',()=>{
    const pack=new Inventory(6,6),battery=place(pack,item('weak_battery',variant('weak_battery','weapon-tuned','armor-loss','fine')),0,0);
    const wire=place(pack,item('copper_wire'),1,0);const baton=place(pack,item('arc_baton',variant('arc_baton','guarded','power-hungry')),3,0);
    pack.updatePowerGrid();assert.equal(baton.connectedBatteries[0].costMultiplier,0.8);
    const plan=prepareEnergyPlan(pack,baton,null),cost=1.5*0.8*0.65;
    assert.ok(Math.abs(plan.batteryCosts.get(battery.id)-cost)<1e-12);
    const engine=new CombatEngine(pack,100,50,0,'Target');engine.processTurn(baton.id,null);
    assert.ok(Math.abs(battery.charge-(5-cost))<1e-12);
    // Two contiguous wires still give only a single discount.
    pack.removeItem(baton.id);place(pack,item('copper_wire',null,'wire-2'),3,0);place(pack,baton,5,0);pack.updatePowerGrid();
    assert.equal(baton.connectedBatteries[0].costMultiplier,0.8);assert.equal(wire.width,2);
});
test('transformer plus wire cost 1.6, direct competing path wins where appropriate, directional ports retained',()=>{
    const pack=new Inventory(6,6),battery=place(pack,item('weak_battery'),0,0);
    place(pack,item('step_up_transformer'),1,0);place(pack,item('copper_wire'),2,0);const gun=place(pack,item('laser_pistol'),4,0);
    pack.updatePowerGrid();assert.deepEqual(gun.connectedBatteries,[{batteryId:battery.id,costMultiplier:1.6}]);
    assert.equal(prepareEnergyPlan(pack,gun,null).batteryCosts.get(battery.id),3.2);
    const wire=pack.items.find(i=>i.type==='wire');pack.removeItem(wire.id);wire.rotate();place(pack,wire,2,0);pack.updatePowerGrid();assert.equal(gun.isPowered,false);
});
test('battery capacity and per-consumer tuning use different factors; true shortage preserves tiny remainder',()=>{
    const pack=new Inventory(),battery=place(pack,item('weak_battery',variant('weak_battery','high-capacity','weapon-loss','fine')),0,0);
    assert.equal(battery.maxCharge,8);assert.equal(battery.charge,8);
    const baton=item('arc_baton');baton.rotate();
    const weapon=place(pack,baton,1,0),armor=place(pack,item('makeshift_vest'),0,1);pack.updatePowerGrid();
    assert.equal(prepareEnergyPlan(pack,weapon,armor).batteryCosts.get(battery.id),2.25);
    battery.charge=2.25-1e-8;let plan=prepareEnergyPlan(pack,weapon,armor);assert.equal(plan.weaponPowered,false);assert.equal(plan.armorPowered,false);
    battery.charge=2.25+Number.EPSILON*2;plan=prepareEnergyPlan(pack,weapon,armor);
    const engine=new CombatEngine(pack,100,100,0,'Target');engine.processTurn(weapon.id,armor.id);
    assert.ok(battery.charge>0&&battery.charge<1e-12);assert.ok(pack.items.includes(battery));
    assert.equal(battery.maxCharge,8);assert.ok(plan.weaponPowered&&plan.armorPowered);
});

test('competing direct/wire routes and a wire cycle terminate with one cheapest source',()=>{
    const pack=new Inventory(6,6),battery=place(pack,item('weak_battery'),0,2);
    const weapon=place(pack,item('arc_baton'),1,2);
    const ports=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    let n=0;
    // Junction fixture isolates cycle handling from authored two-port wire geometry.
    for(const [x,y]of [[0,1],[0,0],[1,0],[2,0],[2,1],[1,1]])place(pack,new Item({id:'junction-'+n++,name:'Junction',type:'wire',width:1,height:1,color:0,connectionPorts:ports}),x,y);
    pack.updatePowerGrid();
    assert.deepEqual(weapon.connectedBatteries,[{batteryId:battery.id,costMultiplier:0.8}]);
    for(const conductor of [...pack.items].filter(i=>i.type==='wire'))pack.removeItem(conductor.id);
    pack.updatePowerGrid();assert.deepEqual(weapon.connectedBatteries,[{batteryId:battery.id,costMultiplier:1}]);
});
test('two tuned sources retain their own weapon/armor costs and joint allocation',()=>{
    const pack=new Inventory(),a=place(pack,item('weak_battery',variant('weak_battery','weapon-tuned','armor-loss','fine'),'A'),0,0);
    const b=place(pack,item('weak_battery',variant('weak_battery','armor-tuned','weapon-loss'),'B'),0,1);
    const w=place(pack,item('arc_baton'),2,0),armor=place(pack,item('makeshift_vest'),3,2);
    // Explicit links exercise the allocation independently of network discovery.
    for(const gear of [w,armor]){gear.isPowered=true;gear.connectedBatteries=[{batteryId:a.id,costMultiplier:1},{batteryId:b.id,costMultiplier:0.8}]}
    let plan=prepareEnergyPlan(pack,w,armor);
    assert.ok(Math.abs(plan.batteryCosts.get(a.id)-0.95)<1e-12); // (0.65 + 1.25)/2
    assert.ok(Math.abs(plan.batteryCosts.get(b.id)-0.8)<1e-12); // (1.25 + .75)*.8/2
    a.charge=1.25;b.charge=1;
    armor.connectedBatteries=[{batteryId:a.id,costMultiplier:1}];
    plan=prepareEnergyPlan(pack,w,armor);assert.ok(plan.weaponPowered&&plan.armorPowered);
    assert.equal(plan.batteryCosts.get(a.id),1.25);assert.equal(plan.batteryCosts.get(b.id),1);
});
test('all capacity and tuning strengths are fixed by grade and base',()=>{
    for(const [base,quality,capacity]of [['weak_battery','standard',7],['weak_battery','fine',8],['heavy_battery','standard',16],['heavy_battery','fine',18]]) {
        const battery=item(base,variant(base,'high-capacity','weapon-loss',quality));
        assert.deepEqual([battery.charge,battery.maxCharge],[capacity,capacity]);assert.equal(battery.traits.weaponCostMultiplier,1.25);
    }
    for(const [base,quality,capacity,multiplier]of [['weak_battery','standard',4,.75],['weak_battery','fine',4,.65],['heavy_battery','standard',10,.75],['heavy_battery','fine',10,.65]]) {
        const battery=item(base,variant(base,'weapon-tuned','low-capacity',quality));
        assert.deepEqual([battery.charge,battery.maxCharge,battery.traits.weaponCostMultiplier],[capacity,capacity,multiplier]);
    }
});

test('lethal recoil resolves retaliation and defeat priority without reward',()=>{
    const run=new RunState(19);for(const gear of [...run.inventory.items])run.inventory.removeItem(gear.id);
    const weapon=run.createItem('dagger',undefined,variant('dagger','guarded','painful'));
    place(run.inventory,weapon,0,0);run.playerHp=1;const enemy=run.enemies[0];run.beginEncounter(enemy.id);run.combatEngine.enemyHp=1;
    const log=run.processCombatTurn(weapon.id,null);
    assert.ok(log.isEnemyDead&&log.isPlayerDead);assert.equal(log.recoilDamage,1);
    assert.equal(run.mode,'defeat');assert.equal(run.allGroundItems().length,0);assert.equal(run.looseLoot().length,0);
    assert.ok(run.enemies.some(e=>e.id===enemy.id),'no victory receipt on simultaneous death');
});
test('HEAL pays only selected Power-Hungry armor and does not reserve a hungry weapon',()=>{
    const pack=new Inventory(),battery=place(pack,item('weak_battery'),0,0);
    const weapon=item('arc_baton',variant('arc_baton','vampiric','power-hungry'));weapon.rotate();place(pack,weapon,1,0);
    const armor=place(pack,item('makeshift_vest',variant('makeshift_vest','vampiric','power-hungry')),0,1);
    const kit=place(pack,item('medkit'),3,3);pack.updatePowerGrid();
    const engine=new CombatEngine(pack,100,50,8,'Target',50),action={type:'heal',consumableId:kit.id,armorId:armor.id};
    const preview=engine.previewAction(action);assert.equal(preview.plan.batteryCosts.get(battery.id),1.5);
    const result=engine.processAction(action);assert.equal(battery.charge,3.5);assert.equal(result.shieldGenerated,8);
    assert.deepEqual([engine.playerHp,result.damageDealt,result.vampiricHealing,result.recoilDamage],[75,0,0,0]);
});
