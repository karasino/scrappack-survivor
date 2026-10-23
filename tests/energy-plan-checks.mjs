import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function runEnergyPlanChecks({ evaluate, read, check, mouse, click, restart, renderer }) {
    await evaluate(`(async () => {
        const { Item } = await import('/src/game/core/Item.ts');
        const { Inventory } = await import('/src/game/core/Inventory.ts');
        const { LootTable } = await import('/src/game/core/LootTable.ts');
        const { CombatEngine } = await import('/src/game/core/CombatEngine.ts');
        const { prepareEnergyPlan, canUsePoweredEffect } = await import('/src/game/core/EnergyPlan.ts');
        globalThis.planEnergy = prepareEnergyPlan;
        globalThis.canBoost = canUsePoweredEffect;
        globalThis.planData = plan => ({weapon:plan.weaponPowered,armor:plan.armorPowered,
            costs:Object.fromEntries(plan.batteryCosts)});
        globalThis.energyFixture = (options = {}) => {
            const inventory = new Inventory();
            const batteries = Object.entries(options.charges ?? {A:5}).map(([id,charge],i) => {
                const item = new Item({id,name:id,type:'battery',width:1,height:1,color:0,charge,maxCharge:10});
                if(!inventory.placeItem(item,0,i))throw Error('Invalid fixture');
                return item;
            });
            const weapon = new Item({...LootTable.find(i=>i.type==='weapon'),id:'gun',energyCost:options.weaponCost ?? 2});
            const armor = new Item({...LootTable.find(i=>i.type==='armor'),id:'vest',energyCost:options.armorCost ?? 1});
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
        globalThis.inspectEnergy = options => {
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
    })()`);
    const scenario = async (config, expected, label) => {
        const actual=await evaluate(`inspectEnergy(${JSON.stringify(config)})`);
        assert.equal(actual.pure,true,`${renderer}: ${label}: preview is pure`);
        for(const [key,value] of Object.entries(expected)) assert.deepEqual(actual[key],value,`${renderer}: ${label}: ${key}`);
        return actual;
    };
    await scenario({charges:{A:0.5,B:1.5},weaponSources:[['A',1],['B',1]],useArmor:false},
        {preview:{weapon:true,armor:false,costs:{A:0.5,B:1.5}},damage:22,charges:{A:0,B:0},bfs:1},'unequal direct sources');
    await scenario({charges:{A:0.5,B:1.5},weaponSources:[['A',2],['B',1]],useArmor:false},
        {preview:{weapon:false,armor:false,costs:{}},damage:4,charges:{A:0.5,B:1.5},bfs:0},'sum of charge is not weighted supply');
    await scenario({charges:{A:1,B:1.5},weaponSources:[['A',2],['B',1]],useArmor:false},
        {preview:{weapon:true,armor:false,costs:{A:1,B:1.5}},damage:22,charges:{A:0,B:0},bfs:1},'unequal weighted sources');
    await scenario({charges:{A:10,B:10},weaponSources:[['A',1],['B',2]],useArmor:false},
        {preview:{weapon:true,armor:false,costs:{A:1,B:2}},charges:{A:9,B:8}},'equal shares preserved when affordable');
    await scenario({charges:{A:5}},
        {preview:{weapon:true,armor:true,costs:{A:3}},damage:22,shield:8,charges:{A:2}},'joint payment');
    await scenario({charges:{A:2}},
        {preview:{weapon:false,armor:false,costs:{}},damage:4,shield:2,charges:{A:2},bfs:0},'both individually feasible but jointly unavailable');
    await scenario({charges:{A:1}},
        {preview:{weapon:false,armor:true,costs:{A:1}},damage:4,shield:8,charges:{A:0},bfs:1},'armor remains available when weapon cannot work alone');
    await scenario({charges:{A:2},armorCost:3},
        {preview:{weapon:true,armor:false,costs:{A:2}},damage:22,shield:2,charges:{A:0}},'weapon remains available when armor cannot work alone');
    await scenario({charges:{A:1,B:2},weaponSources:[['A',1],['B',1]],armorSources:[['A',1]]},
        {preview:{weapon:true,armor:true,costs:{A:1,B:2}},damage:22,shield:8,charges:{A:0,B:0},bfs:1},'A reserved for armor and B for weapon');
    await scenario({charges:{A:2,B:1},weaponSources:[['A',1],['B',2]],armorSources:[['A',2],['B',1]]},
        {preview:{weapon:true,armor:true,costs:{A:2,B:1}},damage:22,shield:8},'joint optimization with different multipliers');
    const stable={charges:{C:1,B:1,A:1},weaponSources:[['C',1],['B',1],['A',1]],armorSources:[['A',1]]};
    const ordered=await scenario(stable,{preview:{weapon:true,armor:true,costs:{A:1,B:1,C:1}},bfs:1},'stable shared distribution');
    const reversed=await scenario({...stable,charges:{A:1,B:1,C:1},weaponSources:[['A',1],['B',1],['C',1]]},
        {preview:ordered.preview},'inventory and source order do not affect plan');
    assert.deepEqual(ordered.charges,reversed.charges);
    const near = await scenario({charges:{A:0.5000000000000001,B:0.5000000000000001},weaponConnected:false,
        armorSources:[['A',1],['B',1]]},{preview:{weapon:false,armor:true,costs:{A:0.5,B:0.5}},bfs:0},'positive ULP remainders survive');
    assert.ok(Object.values(near.charges).every(charge=>charge>0&&charge<0.01));
    await scenario({charges:{A:0.3},weaponCost:0.1,armorCost:0.2},
        {preview:{weapon:true,armor:true,costs:{A:0.3}},charges:{A:0},bfs:1},'floating point addition cannot overspend');
    await scenario({charges:{A:0.3-1e-10},weaponCost:0.1,armorCost:0.2},
        {preview:{weapon:false,armor:false,costs:{}},charges:{A:0.3-1e-10},bfs:0},'real shortage is not machine error');
    await scenario({charges:{A:0.001},weaponCost:0,armorCost:0},
        {preview:{weapon:true,armor:true,costs:{}},charges:{A:0.001}},'connected zero-cost actions are free');
    await scenario({charges:{A:0.001},weaponCost:0,armorCost:0,weaponSources:[],armorSources:[]},
        {preview:{weapon:false,armor:false,costs:{}},damage:4,shield:2},'zero cost still requires a connection');

    // True grid regression: no manual connections or powered flags.
    await evaluate(`globalThis.chainCase = charge => {
        const f=energyFixture({charges:{A:charge},useArmor:false});
        f.inventory.removeItem(f.weapon.id);f.inventory.removeItem(f.armor.id);
        const transformer=new (f.weapon.constructor)({id:'transformer',name:'Step-up Transformer',
            type:'transformer',width:1,height:1,color:0,transformDirection:'low-to-high'});
        f.inventory.placeItem(transformer,1,0);f.inventory.placeItem(f.weapon,2,0);
        f.weapon.requiredVoltage='high';
        f.inventory.updatePowerGrid();
        const bfsBefore=f.bfs();
        const physical=f.weapon.isPowered,links=f.weapon.connectedBatteries.map(l=>({...l}));
        const before=f.state();const plan=planData(planEnergy(f.inventory,f.weapon,null));
        for(let i=0;i<10;i++)planEnergy(f.inventory,f.weapon,null);
        const pure=before===f.state();
        const log=f.engine.processTurn(f.weapon.id,null);
        return {physical,links,plan,pure,damage:log.damageDealt,charge:f.batteries[0].charge,
            remains:f.inventory.items.includes(f.batteries[0]),bfs:f.bfs()-bfsBefore};
    }`);
    for(const charge of [1,3,4,5]) {
        const actual=await evaluate(`chainCase(${charge})`);
        assert.deepEqual(actual,{physical:true,links:[{batteryId:'A',costMultiplier:2}],
            plan:{weapon:charge>=4,armor:false,costs:charge>=4?{A:4}:{}},pure:true,
            damage:charge>=4?22:4,charge:charge>=4?charge-4:charge,remains:charge!==4,bfs:charge===4?1:0},
        `${renderer}: real transformer chain at charge ${charge}`);
    }
    await check(`(() => {
        const f=energyFixture({charges:{A:4},weaponSources:[['A',2]],useArmor:false});
        const before=planEnergy(f.inventory,f.weapon,null).weaponPowered;
        f.batteries[0].charge=3;
        const log=f.engine.processTurn(f.weapon.id,null);
        return [before,log.damageDealt,f.batteries[0].charge,f.bfs()];
    })()`,[true,4,3,0],'processTurn replans after a preview becomes stale');

    const waitFor = async (predicate,label) => {
        for(let i=0;i<100;i++) {if(await read(predicate))return;await delay(20);}
        throw Error(`${renderer}: timeout: ${label}`);
    };
    const hover = async (x,y) => {
        await mouse('mouseMoved',x,y);
        await waitFor('s.itemTooltip.visible','tooltip');
    };
    const activeLine = `s.itemTooltip.labels.filter(l=>l.visible).find(l=>l.text.startsWith('►')).text`;
    const seedChain = charge => evaluate(`seed([{type:'battery',id:'A',x:0,y:0,charge:${charge}},
        {type:'transformer',id:'transformer',x:1,y:0},{type:'weapon',id:'gun',x:2,y:0}])`);
    await restart();
    for(const charge of [1,3,4,5]) {
        await seedChain(charge);
        await click(325,175);
        await hover(325,175);
        await check("[s.visualItemsMap.get('gun').itemModel.isPowered,s.visualItemsMap.get('gun').rect.isStroked]",
            [true,charge>=4],'physical connection and affordable frame are distinct');
        await check(activeLine,charge>=4?'► Powered damage: 22':'► Base damage: 4','preview matches available energy');
        await click(663,544);
        await check('[s.lastTurnLog.damageDealt,s.combatEngine.playerHp]',[charge>=4?22:4,88],'preview matches actual turn');
        await check("s.visualItemsMap.get('A')?.itemModel.charge ?? null",charge===4?null:charge>=4?charge-4:charge,'source retained or removed as planned');
        await restart();
    }
    await seedChain(5);
    await hover(325,175);
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=3");
    await delay(50);
    await check(activeLine,'► Base damage: 4','stationary tooltip follows charge without BFS');
    await check("[s.visualItemsMap.get('gun').rect.isStroked,s.visualItemsMap.get('gun').itemModel.isPowered]",
        [false,true],'frame updates without changing physical power');
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=4");
    await delay(50);
    await check(activeLine,'► Powered damage: 22','stationary tooltip restores affordable effect');
    await check("s.visualItemsMap.get('gun').rect.isStroked",true,'frame restores with charge');
    await restart();

    // Both physical connections are direct. The unselected preview includes the other selected type.
    await evaluate(`seed([{type:'battery',id:'A',x:0,y:0,charge:2},
        {type:'weapon',id:'gun',x:1,y:0,requiredVoltage:'low'},{type:'armor',id:'vest',x:0,y:1}])`);
    await delay(35);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).rect.isStroked)",[true,true],'unselected solo previews');
    await click(275,175);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).rect.isStroked)",[true,false],'unselected armor preview includes selected weapon');
    await click(225,225);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).rect.isStroked)",[false,false],'shared conflict updates both selected frames');
    await hover(275,175);
    await check(activeLine,'► Base damage: 4','joint conflict weapon tooltip');
    await hover(225,225);
    await check(activeLine,'► Base shield: 2','joint conflict armor tooltip');
    await evaluate('s.resolveTurn()');
    await check('[s.lastTurnLog.damageDealt,s.lastTurnLog.shieldGenerated,s.visualItemsMap.get("A").itemModel.charge]',[4,2,2],'joint preview and actual base effects agree');
    await click(275,175);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).rect.isStroked)",[false,true],'unselected weapon preview includes selected armor');
    await click(225,225);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).rect.isStroked)",[true,true],'clearing selection restores solo previews');
    await restart();
    console.log(`PASS ${renderer}: affordable energy plans, real transformer chain, deterministic allocation and preview consistency`);
}
