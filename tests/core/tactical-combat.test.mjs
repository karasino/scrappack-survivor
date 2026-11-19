import test from 'node:test';
import assert from 'node:assert/strict';
import { Item } from '../../src/game/core/Item.ts';
import { Inventory } from '../../src/game/core/Inventory.ts';
import { LootTable } from '../../src/game/core/LootTable.ts';
import { CombatEngine } from '../../src/game/core/CombatEngine.ts';

const attack = {type:'attack',weaponId:'w',armorId:'a'};
const unarmed = {type:'attack',weaponId:null,armorId:'a'};
const brace = {type:'brace',armorId:'a'};
function fixture({damage=12,shield=3,behavior='scrap-brute',variant}={}) {
    const inventory=new Inventory();
    const weapon=new Item({id:'w',name:'Test weapon',type:'weapon',width:1,height:1,color:0,baseDamage:damage,powerMode:'none'});
    const armor=new Item({id:'a',definitionId:'combat_bra',name:'Test armor',type:'armor',width:1,height:1,color:0,baseArmor:shield,powerMode:'none',variant});
    assert.ok(inventory.placeItem(weapon,0,0));assert.ok(inventory.placeItem(armor,1,1));
    inventory.updatePowerGrid();
    const engine=new CombatEngine(inventory,1000,66,14,'Scrap Brute',1000,behavior);
    return {inventory,weapon,armor,engine};
}
const state=f=>JSON.stringify({hp:[f.engine.playerHp,f.engine.enemyHp],intent:f.engine.enemyIntent,
    tactics:f.engine.enemyTactics,items:f.inventory.items,grid:f.inventory.grid});
function reachSlam(engine) {
    engine.processAction(attack);assert.equal(engine.enemyIntent.type,'wind-up');
    engine.processAction(brace);assert.equal(engine.enemyIntent.type,'slam');
}

test('tactical profile starts STRIKE; basic enemy with the same name always strikes',()=>{
    const e=fixture().engine;
    assert.equal(e.enemyIntent.type,'strike');assert.equal(e.enemyIntent.damage,14);
    assert.deepEqual(e.enemyTactics,{repairUsesRemaining:2,repairCooldown:0,slamCooldown:0});
    const basic=fixture({behavior:'basic'}).engine;
    basic.processAction(attack);assert.equal(basic.enemyIntent.type,'strike');assert.equal(basic.enemyTactics,null);
});
test('one hit of twelve triggers WIND-UP, then a harmless response and SLAM',()=>{
    const weak=fixture({damage:11}).engine;weak.processAction(attack);weak.processAction(attack);assert.equal(weak.enemyIntent.type,'strike');
    const e=fixture().engine;e.processAction(attack);assert.equal(e.enemyIntent.type,'wind-up');
    const before=e.playerHp,wind=e.processAction(brace);
    assert.deepEqual([wind.damageTaken,e.playerHp,e.enemyIntent.type],[0,before,'slam']);
    const slam=e.processAction(brace);
    assert.deepEqual([slam.enemyAction.type,slam.damageTaken,slam.shieldGenerated,e.enemyTactics.slamCooldown],['slam',16,6,4]);
});
test('REPAIR threshold is 26 rather than 27 and beats a new WIND-UP; prepared SLAM beats REPAIR',()=>{
    const e=fixture().engine;e.enemyHp=27;e.processAction(brace);assert.equal(e.enemyIntent.type,'strike');
    e.enemyHp=26;e.processAction(brace);assert.equal(e.enemyIntent.type,'repair');
    const competing=fixture().engine;competing.enemyHp=38;competing.processAction(attack);
    assert.deepEqual([competing.enemyHp,competing.enemyIntent.type],[26,'repair']);
    const prepared=fixture().engine;prepared.processAction(attack);prepared.enemyHp=26;prepared.processAction(brace);
    assert.equal(prepared.enemyIntent.type,'slam');prepared.processAction(brace);assert.equal(prepared.enemyIntent.type,'repair');
});
test('REPAIR cooldown excludes use turn, lasts four full responses, and permits only two heals',()=>{
    const e=fixture().engine;e.enemyHp=26;e.processAction(brace);
    const first=e.processAction(brace);
    assert.deepEqual([first.enemyHealingRestored,e.enemyHp,e.enemyTactics.repairUsesRemaining,e.enemyTactics.repairCooldown],[12,38,1,4]);
    for(let turn=1;turn<=4;turn++) {
        e.enemyHp=26;const log=e.processAction(brace);
        assert.equal(log.enemyAction.type,'strike');assert.equal(e.enemyTactics.repairCooldown,4-turn);
        assert.equal(e.enemyIntent.type,turn===4?'repair':'strike');
    }
    assert.equal(e.processAction(brace).enemyHealingRestored,12);assert.equal(e.enemyTactics.repairUsesRemaining,0);
    for(let turn=0;turn<8;turn++){e.enemyHp=26;e.processAction(brace);assert.notEqual(e.enemyIntent.type,'repair');}
});
test('SLAM cooldown drops hits during all four subsequent turns and does not store triggers',()=>{
    const e=fixture().engine;reachSlam(e);e.processAction(brace);
    for(let turn=1;turn<=4;turn++){
        e.enemyHp=66;e.processAction(attack);
        assert.equal(e.enemyTactics.slamCooldown,4-turn);assert.equal(e.enemyIntent.type,'strike');
    }
    e.processAction(unarmed);assert.equal(e.enemyIntent.type,'strike');
    e.enemyHp=66;e.processAction(attack);assert.equal(e.enemyIntent.type,'wind-up');
});
test('preview and availability are pure; failed BRACE and invalid IDs preserve all state',()=>{
    const f=fixture();reachSlam(f.engine);const before=state(f),preview=f.engine.previewAction(brace);
    for(let i=0;i<20;i++){assert.deepEqual(f.engine.previewAction(brace),preview);assert.ok(f.engine.actionAvailability(brace).available);}
    for(const action of [{type:'brace',armorId:null},{type:'brace',armorId:'w'},
        {type:'attack',weaponId:'missing',armorId:'a'},{type:'attack',weaponId:null,armorId:'missing'}]) {
        assert.equal(f.engine.actionAvailability(action).available,false);
        assert.throws(()=>f.engine.processAction(action));assert.equal(state(f),before);
    }
    const {playerHpAfter,enemyHpAfter,plan,...expected}=preview;
    assert.deepEqual(f.engine.processAction(brace),expected);
    assert.deepEqual([f.engine.playerHp,f.engine.enemyHp],[playerHpAfter,enemyHpAfter]);
    const zero=fixture({shield:0});assert.equal(zero.engine.actionAvailability(brace).available,false);
});
test('UNARMED deals two, uses armor hit traits, and BRACE excludes offensive traits',()=>{
    const plain=fixture().engine,log=plain.processTurn(null,'a');
    assert.deepEqual([log.damageDealt,log.isUnarmed,log.weaponUsedName,log.shieldGenerated],[2,true,null,3]);
    const variant={baseDefinitionId:'combat_bra',quality:'standard',positive:'vampiric',negative:'reckless'};
    const e=fixture({variant}).engine;e.playerHp=500;
    const punch=e.processAction(unarmed);
    assert.deepEqual([punch.damageDealt,punch.vampiricHealing,punch.recoilDamage],[2,1,0]);
    const guarded=e.processAction(brace);
    assert.deepEqual([guarded.damageDealt,guarded.vampiricHealing,guarded.recoilDamage,guarded.shieldGenerated],[0,0,0,4]);
    const painful=fixture({variant:{...variant,positive:'guarded',negative:'painful'}}).engine;
    assert.equal(painful.processAction(unarmed).recoilDamage,1);
    assert.equal(painful.processAction(brace).recoilDamage,0);
});
test('UNARMED damage floors at one and BRACE rounds shield down once after multiplying',()=>{
    const e=fixture({variant:{baseDefinitionId:'combat_bra',quality:'standard',positive:'guarded',negative:'blunt'}}).engine;
    assert.equal(e.processAction(unarmed).damageDealt,1);
    const fractional=fixture({shield:3.75}).engine;assert.equal(fractional.processAction(brace).shieldGenerated,7);
});
test('announced REPAIR remains fixed, caps healing, and cannot resurrect a killed boss',()=>{
    const e=fixture().engine;e.enemyHp=26;e.processAction(brace);e.enemyHp=65;
    assert.equal(e.processAction(brace).enemyHealingRestored,1);assert.equal(e.enemyHp,66);
    const dead=fixture().engine;dead.enemyHp=26;dead.processAction(brace);dead.enemyHp=2;
    const result=dead.processAction(unarmed);
    assert.deepEqual([result.enemyAction.type,result.enemyHealingRestored,result.isEnemyDead,dead.enemyIntent],['repair',0,true,null]);
});
test('lethal SLAM still retaliates and clears future intent after simultaneous death',()=>{
    const e=fixture().engine;reachSlam(e);e.enemyHp=2;e.playerHp=22;
    const log=e.processAction({type:'attack',weaponId:null,armorId:null});
    assert.deepEqual([log.enemyAction.type,log.isEnemyDead,log.isPlayerDead,e.enemyIntent],['slam',true,true,null]);
});

test('Medkit resolves the announced response and advances cooldown exactly once',()=>{
    const {engine:e,inventory}=fixture();reachSlam(e);e.playerHp=500;
    const heal=id=>{
        const kit=new Item({...LootTable.find(i=>i.definitionId==='medkit'),id});
        assert.ok(inventory.placeItem(kit,2,2));
        return e.processAction({type:'heal',consumableId:id,armorId:'a'});
    };
    const first=heal('kit-one');
    assert.deepEqual([first.enemyAction.type,first.healingRestored,first.damageDealt,first.damageTaken,e.playerHp,e.enemyTactics.slamCooldown],
        ['slam',25,0,19,506,4]);
    assert.equal(first.weaponUsedName,null);assert.equal(e.enemyHp,54);
    const second=heal('kit-two');
    assert.deepEqual([second.enemyAction.type,e.playerHp,e.enemyTactics.slamCooldown],['strike',520,3]);
});

for(const type of ['brace','attack']) test(`${type} powers armor alone despite a selected weapon; last charge and fallback`,()=>{
    const inventory=new Inventory();
    const make=(definitionId,id)=>new Item({...LootTable.find(i=>i.definitionId===definitionId),id});
    const battery=make('weak_battery','b'),armor=make('makeshift_vest','a'),weapon=make('arc_baton','w');
    battery.charge=1;weapon.isSelectedForTurn=true;armor.isSelectedForTurn=true;
    assert.ok(inventory.placeItem(battery,0,0));assert.ok(inventory.placeItem(armor,1,0));assert.ok(inventory.placeItem(weapon,0,1));
    inventory.updatePowerGrid();const e=new CombatEngine(inventory,100,100,22,'Test');
    const action=type==='brace'?{type,armorId:'a'}:{type,weaponId:null,armorId:'a'};
    const preview=e.previewAction(action);
    assert.equal(preview.plan.weaponPowered,false);assert.equal(preview.plan.armorPowered,true);
    assert.equal(preview.plan.batteryCosts.get('b'),1);assert.equal(battery.charge,1);
    const first=e.processAction(action);
    assert.equal(first.shieldGenerated,type==='brace'?16:8);assert.equal(inventory.items.includes(battery),false);
    const second=e.processAction(action);assert.equal(second.shieldGenerated,type==='brace'?4:2);
    assert.equal(second.damageDealt,type==='brace'?0:2);
});
