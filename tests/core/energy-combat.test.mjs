import test from 'node:test';
import assert from 'node:assert/strict';
import { Item } from '../../src/game/core/Item.ts';
import { Inventory } from '../../src/game/core/Inventory.ts';
import { LootTable } from '../../src/game/core/LootTable.ts';
import { CombatEngine } from '../../src/game/core/CombatEngine.ts';
import { prepareEnergyPlan, canUsePoweredEffect, previewPoweredEffect } from '../../src/game/core/EnergyPlan.ts';

const planData = plan => ({weapon:plan.weaponPowered,armor:plan.armorPowered,
    costs:Object.fromEntries(plan.batteryCosts)});
const energyFixture = (options = {}) => {
    const inventory = new Inventory();
    const batteries = Object.entries(options.charges ?? {A:5}).map(([id,charge],i) => {
        const item = new Item({id,name:id,type:'battery',width:1,height:1,color:0,charge,maxCharge:10});
        if(!inventory.placeItem(item,0,i))throw Error('Invalid fixture');
        return item;
    });
    const weapon = new Item({...LootTable.find(i=>i.definitionId==='laser_pistol'),id:'gun',energyCost:options.weaponCost ?? 2});
    const armor = new Item({...LootTable.find(i=>i.definitionId==='makeshift_vest'),id:'vest',energyCost:options.armorCost ?? 1});
    inventory.placeItem(weapon,2,0);inventory.placeItem(armor,2,2);
    weapon.isPowered=options.weaponConnected ?? true;
    armor.isPowered=options.armorConnected ?? true;
    weapon.connectedBatteries=(options.weaponSources ?? [['A',1]]).map(([batteryId,costMultiplier])=>({batteryId,costMultiplier}));
    armor.connectedBatteries=(options.armorSources ?? [['A',1]]).map(([batteryId,costMultiplier])=>({batteryId,costMultiplier}));
    weapon.isSelectedForTurn=true;armor.isSelectedForTurn=options.useArmor ?? true;
    const engine=new CombatEngine(inventory,100,50,12,'Rad-Scorpion');
    let bfs=0;const update=inventory.updatePowerGrid.bind(inventory);
    inventory.updatePowerGrid=()=>{bfs++;update()};
    const state=()=>JSON.stringify({grid:inventory.grid,items:inventory.items,hp:[engine.playerHp,engine.enemyHp]});
    return {inventory,batteries,weapon,armor,engine,state,bfs:()=>bfs};
};
const inspectEnergy = options => {
    const f=energyFixture(options);
    const armor=options?.useArmor===false?null:f.armor;
    const before=f.state();
    const preview=planData(prepareEnergyPlan(f.inventory,f.weapon,armor));
    for(let i=0;i<20;i++) {
        prepareEnergyPlan(f.inventory,f.weapon,armor);
        canUsePoweredEffect(f.inventory,f.weapon);canUsePoweredEffect(f.inventory,f.armor);
    }
    const pure=before===f.state();
    const log=f.engine.processTurn(f.weapon.id,armor?.id??null);
    return {preview,pure,damage:log.damageDealt,shield:log.shieldGenerated,
        charges:Object.fromEntries(f.batteries.map(b=>[b.id,b.charge])),
        remaining:f.inventory.items.filter(i=>i.type==='battery').map(i=>i.id).sort(),bfs:f.bfs()};
};

function inspectScenario(config, expected, label) {
    const actual = inspectEnergy(config);
    assert.equal(actual.pure, true, `${label}: preview is pure`);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${label}: ${key}`);
    return actual;
}
function scenario(config, expected, label) {
    test(`energy plan: ${label}`, () => inspectScenario(config, expected, label));
}

scenario({charges:{A:0.5,B:1.5},weaponSources:[['A',1],['B',1]],useArmor:false},
    {preview:{weapon:true,armor:false,costs:{A:0.5,B:1.5}},damage:22,charges:{A:0,B:0},bfs:1},'unequal direct sources');
scenario({charges:{A:0.5,B:1.5},weaponSources:[['A',2],['B',1]],useArmor:false},
    {preview:{weapon:false,armor:false,costs:{}},damage:4,charges:{A:0.5,B:1.5},bfs:0},'sum of charge is not weighted supply');
scenario({charges:{A:1,B:1.5},weaponSources:[['A',2],['B',1]],useArmor:false},
    {preview:{weapon:true,armor:false,costs:{A:1,B:1.5}},damage:22,charges:{A:0,B:0},bfs:1},'unequal weighted sources');
scenario({charges:{A:10,B:10},weaponSources:[['A',1],['B',2]],useArmor:false},
    {preview:{weapon:true,armor:false,costs:{A:1,B:2}},charges:{A:9,B:8}},'equal shares preserved when affordable');
scenario({charges:{A:5}},
    {preview:{weapon:true,armor:true,costs:{A:3}},damage:22,shield:8,charges:{A:2}},'joint payment');
scenario({charges:{A:2}},
    {preview:{weapon:false,armor:false,costs:{}},damage:4,shield:2,charges:{A:2},bfs:0},'both individually feasible but jointly unavailable');
scenario({charges:{A:1}},
    {preview:{weapon:false,armor:true,costs:{A:1}},damage:4,shield:8,charges:{A:0},bfs:1},'armor remains available when weapon cannot work alone');
scenario({charges:{A:2},armorCost:3},
    {preview:{weapon:true,armor:false,costs:{A:2}},damage:22,shield:2,charges:{A:0}},'weapon remains available when armor cannot work alone');
scenario({charges:{A:1,B:2},weaponSources:[['A',1],['B',1]],armorSources:[['A',1]]},
    {preview:{weapon:true,armor:true,costs:{A:1,B:2}},damage:22,shield:8,charges:{A:0,B:0},bfs:1},'A reserved for armor and B for weapon');
scenario({charges:{A:2,B:1},weaponSources:[['A',1],['B',2]],armorSources:[['A',2],['B',1]]},
    {preview:{weapon:true,armor:true,costs:{A:2,B:1}},damage:22,shield:8},'joint optimization with different multipliers');

test('energy plan is independent of inventory and source order', () => {
    const stable={charges:{C:1,B:1,A:1},weaponSources:[['C',1],['B',1],['A',1]],armorSources:[['A',1]]};
    const ordered=inspectScenario(stable,{preview:{weapon:true,armor:true,costs:{A:1,B:1,C:1}},bfs:1},'stable shared distribution');
    const reversed=inspectScenario({...stable,charges:{A:1,B:1,C:1},weaponSources:[['A',1],['B',1],['C',1]]},
        {preview:ordered.preview},'inventory and source order do not affect plan');
    assert.deepEqual(ordered.charges,reversed.charges);
});

test('energy plan retains positive ULP remainders', () => {
    const near = inspectScenario({charges:{A:0.5000000000000001,B:0.5000000000000001},weaponConnected:false,
        armorSources:[['A',1],['B',1]]},{preview:{weapon:false,armor:true,costs:{A:0.5,B:0.5}},bfs:0},'positive ULP remainders survive');
    assert.ok(Object.values(near.charges).every(charge=>charge>0&&charge<0.01));
});

scenario({charges:{A:0.3},weaponCost:0.1,armorCost:0.2},
    {preview:{weapon:true,armor:true,costs:{A:0.3}},charges:{A:0},bfs:1},'floating point addition cannot overspend');
scenario({charges:{A:0.3-1e-10},weaponCost:0.1,armorCost:0.2},
    {preview:{weapon:false,armor:false,costs:{}},charges:{A:0.3-1e-10},bfs:0},'real shortage is not machine error');
scenario({charges:{A:0.001},weaponCost:0,armorCost:0},
    {preview:{weapon:true,armor:true,costs:{}},charges:{A:0.001}},'connected zero-cost actions are free');
scenario({charges:{A:0.001},weaponCost:0,armorCost:0,weaponSources:[],armorSources:[]},
    {preview:{weapon:false,armor:false,costs:{}},damage:4,shield:2},'zero cost still requires a connection');

const chainCase = charge => {
    const f=energyFixture({charges:{A:charge},useArmor:false});
    f.inventory.removeItem(f.weapon.id);f.inventory.removeItem(f.armor.id);
    const transformer=new (f.weapon.constructor)({id:'transformer',name:'Step-up Transformer',
        type:'transformer',width:1,height:1,color:0,transformDirection:'low-to-high'});
    f.inventory.placeItem(transformer,1,0);f.inventory.placeItem(f.weapon,2,0);
    f.weapon.requiredVoltage='high';
    f.inventory.updatePowerGrid();
    const bfsBefore=f.bfs();
    const physical=f.weapon.isPowered,links=f.weapon.connectedBatteries.map(l=>({...l}));
    const before=f.state();const plan=planData(prepareEnergyPlan(f.inventory,f.weapon,null));
    for(let i=0;i<10;i++)prepareEnergyPlan(f.inventory,f.weapon,null);
    const pure=before===f.state();
    const log=f.engine.processTurn(f.weapon.id,null);
    return {physical,links,plan,pure,damage:log.damageDealt,charge:f.batteries[0].charge,
        remains:f.inventory.items.includes(f.batteries[0]),bfs:f.bfs()-bfsBefore};
};

for (const charge of [1, 3, 4, 5]) {
    test(`real transformer chain at charge ${charge}`, () => {
        const actual=chainCase(charge);
        assert.deepEqual(actual,{physical:true,links:[{batteryId:'A',costMultiplier:2}],
            plan:{weapon:charge>=4,armor:false,costs:charge>=4?{A:4}:{}},pure:true,
            damage:charge>=4?22:4,charge:charge>=4?charge-4:charge,remains:charge!==4,bfs:charge===4?1:0},
        `real transformer chain at charge ${charge}`);
    });
}

test('processTurn replans after a preview becomes stale', () => {
    const f=energyFixture({charges:{A:4},weaponSources:[['A',2]],useArmor:false});
    const before=prepareEnergyPlan(f.inventory,f.weapon,null).weaponPowered;
    f.batteries[0].charge=3;
    const log=f.engine.processTurn(f.weapon.id,null);
    assert.deepEqual([before,log.damageDealt,f.batteries[0].charge,f.bfs()],[true,4,3,0]);
});

const reasonCase = options => {
    const f=energyFixture(options);
    const before=f.state();
    const armor=options.useArmor===false?null:f.armor;
    const plan=prepareEnergyPlan(f.inventory,f.weapon,armor);
    for(let i=0;i<20;i++) {
        prepareEnergyPlan(f.inventory,f.weapon,armor);
        const preview=previewPoweredEffect(f.inventory,f.weapon);
        if(preview.available!==canUsePoweredEffect(f.inventory,f.weapon))throw Error('Boolean API mismatch');
        previewPoweredEffect(f.inventory,f.armor);
    }
    return {weapon:plan.weaponReason,armor:plan.armorReason,pure:before===f.state()};
};

for(const [options,weapon,armor] of [
    [{charges:{A:5}},null,null],
    [{charges:{A:5},weaponSources:[],armorSources:[]},'no-source','no-source'],
    [{charges:{A:0.5}},'insufficient-charge','insufficient-charge'],
    [{charges:{A:2}},'shared-charge-conflict','shared-charge-conflict'],
    [{charges:{A:1}},'insufficient-charge',null],
    [{charges:{A:2},armorCost:3},null,'insufficient-charge'],
    [{charges:{A:0.5,B:1.5},weaponSources:[['A',1],['B',1]],useArmor:false},null,null]
]) {
    test(`power reasons: ${JSON.stringify(options)}`, () => {
        assert.deepEqual(reasonCase(options),{weapon,armor,pure:true},
            'core reason and pure preview');
    });
}

const energyCase = (options = {}) => {
    const inventory = new Inventory();
    const charges = options.charges ?? [5];
    const batteries = charges.map((charge, i) => new Item({
        id: 'bat' + i, name: 'Battery', type:'battery', width:1,height:1,color:0,
        charge,maxCharge:5,voltageType:'low'
    }));
    batteries.forEach((item, i) => inventory.placeItem(item,0,i*2));
    const weapon = new Item({ ...LootTable.find(i=>i.definitionId==='laser_pistol'),
        id:'weapon',width:1,requiredVoltage:'low',energyCost:options.weaponCost ?? 2 });
    const armor = new Item({ ...LootTable.find(i=>i.definitionId==='makeshift_vest'),
        id:'armor',width:1,height:1,energyCost:options.armorCost ?? 1, poweredArmor: options.shield ?? 8 });
    inventory.placeItem(weapon,2,0);
    inventory.placeItem(armor,2,2);
    weapon.isPowered = options.weaponPowered ?? true;
    armor.isPowered = options.armorPowered ?? true;
    const defaultLinks = [{batteryId:'bat0',costMultiplier:1}];
    weapon.connectedBatteries = options.weaponLinks ?? defaultLinks.map(l=>({...l}));
    armor.connectedBatteries = options.armorLinks ?? defaultLinks.map(l=>({...l}));
    // A large item-global multiplier must never replace a path's multiplier.
    weapon.energyCostMultiplier = armor.energyCostMultiplier = 99;
    const engine = new CombatEngine(inventory,100,50,12,'Rad-Scorpion');
    let bfs=0;
    const update=inventory.updatePowerGrid.bind(inventory);
    inventory.updatePowerGrid=()=>{bfs++;update()};
    const linksBefore=JSON.stringify([weapon.connectedBatteries,armor.connectedBatteries]);
    const log=engine.processTurn(weapon.id,options.useArmor===false ? null : armor.id);
    return {charges:batteries.map(b=>b.charge),remaining:inventory.items.filter(i=>i.type==='battery').length,
        damage:log.damageDealt,shield:log.shieldGenerated,hp:engine.playerHp,bfs,
        linksUnchanged:linksBefore===JSON.stringify([weapon.connectedBatteries,armor.connectedBatteries])};
};

function energy(options, expected, label) {
    test(`combat payment: ${label}`, () => {
        const result = energyCase(structuredClone(options));
        for (const [key, value] of Object.entries(expected)) assert.deepEqual(result[key], value, `${label}: ${key}`);
    });
}
energy({}, {charges:[2],damage:22,shield:8,hp:96,bfs:0,linksUnchanged:true}, 'shared source sums weapon and armor');
energy({charges:[3]}, {charges:[0],remaining:0,damage:22,shield:8,hp:96,bfs:1}, 'shared source removed after full effects');
energy({charges:[0.1]}, {charges:[0.1],remaining:1,damage:4,shield:2,bfs:0}, 'insufficient charge keeps source and uses base effects');
energy({useArmor:false,weaponPowered:false}, {charges:[5],shield:0}, 'unselected powered armor is free');
energy({armorPowered:false,weaponPowered:false}, {charges:[5],shield:2}, 'unpowered armor is free');
energy({armorCost:0,weaponCost:0}, {charges:[5],shield:8,bfs:0}, 'zero-cost used items');
energy({armorCost:-1,weaponCost:-2}, {charges:[5],shield:8}, 'negative costs clamp to zero');
energy({weaponLinks:[],armorLinks:[]}, {charges:[5],shield:2,damage:4}, 'empty links cannot power effects');
energy({weaponPowered:false,shield:20}, {charges:[4],shield:20,hp:100}, 'fully blocking armor still costs energy');
const both = [{batteryId:'bat0',costMultiplier:1},{batteryId:'bat1',costMultiplier:1}];
energy({charges:[1,1],weaponPowered:false,armorLinks:both},
    {charges:[0.5,0.5],remaining:2,bfs:0,linksUnchanged:true},'fractional armor distribution retained');
const unequal = [{batteryId:'bat0',costMultiplier:1},{batteryId:'bat1',costMultiplier:2}];
energy({charges:[5,5],weaponPowered:false,armorLinks:unequal}, {charges:[4.5,4]}, 'per-path multipliers');
energy({charges:[5,5],armorLinks:unequal}, {charges:[2.5,4]}, 'shared source plus separate armor sources');
energy({charges:[1.5,1.5],weaponLinks:both,armorLinks:both}, {charges:[0,0],remaining:0,bfs:1},'multiple deletions recalculate once');
energy({weaponLinks:[{batteryId:'bat0',costMultiplier:-2}],armorLinks:[{batteryId:'bat0',costMultiplier:0}]},
    {charges:[5]}, 'negative path multiplier clamps to zero');

test('combat payment retains tiny positive battery charge', () => {
    const tiny = energyCase({charges:[0.505,0.505],weaponPowered:false,armorLinks:structuredClone(both)});
    assert.equal(tiny.remaining,2);
    assert.ok(tiny.charges.every(charge=>charge>0&&charge<0.01));
});
