import { electricLoadout } from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RunState } from '../../src/game/core/RunState.ts';
import { ExplorationEngine } from '../../src/game/core/ExplorationEngine.ts';

const fixture=(seed=123)=>{
    const run=electricLoadout(new RunState(seed));
    const templates=Object.fromEntries(run.enemies.map(e=>[e.kind,{...e}]));
    run.map={rows:Array(8).fill('........'),width:8,height:8,exit:{x:7,y:0}};
    run.hero={x:0,y:7};run.enemies=[];run.lootPoints=[];
    const add=(id,kind,x,y,config={})=>{
        const enemy={...templates[kind],id,x,y,isChasing:false,...config};run.enemies.push(enemy);return enemy;
    };
    return {run,engine:new ExplorationEngine(run),add};
};
const selected=run=>[run.inventory.items.find(i=>i.type==='weapon'),run.inventory.items.find(i=>i.type==='armor')];

test('both sectors have authored dimensions and reachable exits and loot', () => {
    for(let sector=0;sector<2;sector++){
        const run=new RunState(42);run.loadSector(sector);
        assert.deepEqual([run.map.width,run.map.height,run.enemies.length,run.lootPoints.length],[8,8,sector===0?3:4,2],'manual sector dimensions '+sector);
        const visited=new Set([run.hero.x+','+run.hero.y]),queue=[run.hero];
        for(let head=0;head<queue.length;head++)for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){
            const p={x:queue[head].x+dx,y:queue[head].y+dy},key=p.x+','+p.y;
            if(run.isWalkable(p)&&!visited.has(key)){visited.add(key);queue.push(p)}
        }
        assert.ok([run.map.exit,...run.lootPoints].every(p=>visited.has(p.x+','+p.y)),'exit and loot reachable '+sector);
    }
});

test('invalid actions and drag preserve world state; cardinal movement spends one turn', () => {
    const {run,engine}=fixture();const snapshot=JSON.stringify([run.hero,run.worldTurn,run.rngState]);
    for(const a of [{type:'move',dx:-1,dy:0},{type:'move',dx:1,dy:1},{type:'move',dx:0,dy:0},
        {type:'search'},{type:'exit'}])assert.ok(!engine.applyAction(a).accepted,'invalid action rejected '+JSON.stringify(a));
    assert.deepEqual(JSON.stringify([run.hero,run.worldTurn,run.rngState]),snapshot,'invalid actions are free');
    run.map.rows[6]='#.......';assert.ok(!engine.applyAction({type:'move',dx:0,dy:-1}).accepted,'wall is free');
    assert.ok(engine.applyAction({type:'move',dx:1,dy:0}).accepted,'cardinal movement accepted');
    assert.deepEqual([run.hero,run.worldTurn],[{x:1,y:7},1],'movement spends one turn');
    run.draggedItem=run.inventory.items[0];const freeze=JSON.stringify([run.hero,run.worldTurn,run.rngState]);
    assert.ok(!engine.applyAction({type:'wait'}).accepted,'drag blocks world action');
    assert.deepEqual(JSON.stringify([run.hero,run.worldTurn,run.rngState]),freeze,'drag rejection preserves world');
});

test('idle periods schedule seeded wandering', () => {
    const {run,engine,add}=fixture(1);const rat=add('a','rat',4,4,{detectionRadius:0});
    const scorpion=add('b','scorpion',6,6,{detectionRadius:0});const rng=run.rngState;
    engine.applyAction({type:'wait'});assert.deepEqual([rat.x,rat.y,scorpion.x,scorpion.y,run.rngState],[4,4,6,6,rng],'idle periods skip turn one');
    engine.applyAction({type:'wait'});assert.deepEqual([rat.x,rat.y,scorpion.x,scorpion.y],[4,3,6,6],'rat wanders on turn two');
    const secondRng=run.rngState;engine.applyAction({type:'wait'});
    assert.ok(run.rngState!==secondRng&&Math.abs(scorpion.x-6)+Math.abs(scorpion.y-6)===1,'scorpion wanders on turn three');
    assert.deepEqual(rat.detectionRadius,0,'fixture radius retained');
});

test('blocked idle attempt consumes RNG without movement', () => {
    const {run,engine,add}=fixture(1);add('a','rat',0,0,{detectionRadius:0,idlePeriod:1});
    const before=run.rngState;engine.applyAction({type:'wait'});
    assert.deepEqual([run.enemies[0].x,run.enemies[0].y],[0,0],'blocked random step waits');
    assert.ok(run.rngState!==before,'blocked idle attempt consumes exactly one draw');
});

test('chase routes around walls without RNG and ends outside radius', () => {
    const {run,engine,add}=fixture();run.hero={x:2,y:2};run.map.rows[0]='.#......';
    const enemy=add('a','rat',0,0,{detectionRadius:8});const rng=run.rngState;
    engine.applyAction({type:'wait'});assert.deepEqual([enemy.x,enemy.y,enemy.isChasing],[0,1,true],'BFS goes around wall');
    assert.deepEqual(run.rngState,rng,'chase uses no random draw');
    run.hero={x:7,y:7};engine.applyAction({type:'wait'});assert.ok(!enemy.isChasing,'chase ends outside radius');
});

test('equal chase paths prefer up before right', () => {
    const {run,engine,add}=fixture();run.hero={x:2,y:0};const enemy=add('a','rat',1,1);
    engine.applyAction({type:'wait'});assert.deepEqual([enemy.x,enemy.y],[1,0],'equal chase paths prefer up before right');
});

test('detection measures paths around walls and remains pure', () => {
    const {run,engine,add}=fixture();run.hero={x:2,y:0};
    run.map.rows[0]='.#......';run.map.rows[1]='.#......';run.map.rows[2]='.#......';
    const enemy=add('a','rat',0,0,{detectionRadius:3,idlePeriod:99});
    assert.ok(!engine.detectionCells(enemy).some(p=>p.x===2&&p.y===0),'walls lengthen detection path');
    const rng=run.rngState;for(let i=0;i<10;i++)engine.detectionCells(enemy);assert.deepEqual(run.rngState,rng,'hover detection is pure');
});

test('defensive contact starts one encounter and freezes the remaining phase', () => {
    const {run,engine,add}=fixture();run.hero={x:3,y:3};const first=add('a','rat',3,2);
    const other=add('b','scorpion',4,2);assert.ok(run.mode==='exploration','adjacency alone does not start combat');
    const result=engine.applyAction({type:'wait'});
    assert.deepEqual([run.mode,run.activeEnemyId,run.worldTurn],['combat','a',1],'monster contact starts one encounter');
    assert.deepEqual([first.x,first.y,other.x,other.y],[3,2,4,2],'contact leaves cells and stops remaining phase');
    assert.deepEqual(result.events.filter(e=>e.type==='combat-started').length,1,'one encounter event');
    const frozen=JSON.stringify([run.worldTurn,run.rngState,run.enemies.map(e=>[e.id,e.x,e.y])]);
    const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
    assert.deepEqual(run.hero,{x:3,y:3},'defensive victory after waiting keeps hero on their cell');
    assert.deepEqual([run.looseLoot().length,run.groundMaterials.has('3,2')],[2,false],'defensive reward stays with hero');
    assert.deepEqual(JSON.stringify([run.worldTurn,run.rngState,[['a',3,2],...run.enemies.map(e=>[e.id,e.x,e.y])]]),frozen,'defensive victory spends no world action or remaining enemy phase');
});

test('stable enemy ID chooses simultaneous contact', () => {
    const {run,engine,add}=fixture();run.hero={x:3,y:3};add('b','rat',3,2);add('a','scorpion',4,3);
    engine.applyAction({type:'wait'});assert.deepEqual(run.activeEnemyId,'a','stable ID order wins simultaneous contact');
});

test('offensive victory advances and rewards once without resuming world phase', () => {
    const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','rat',4,3);add('b','scorpion',7,7);
    const positions=run.enemies.map(e=>[e.x,e.y]);const result=engine.applyAction({type:'move',dx:1,dy:0});
    assert.deepEqual(run.hero,{x:3,y:3},'hero contact leaves hero on source cell');
    assert.deepEqual(run.enemies.map(e=>[e.x,e.y]),positions,'hero contact skips monster phase');
    assert.deepEqual([run.worldTurn,result.events.filter(e=>e.type==='combat-started').length],[1,1],'hero contact consumes one action');
    const freeze=JSON.stringify([run.worldTurn,run.hero,run.enemies,run.rngState]);
    for(const action of [{type:'wait'},{type:'move',dx:0,dy:1},{type:'search'},{type:'exit'}])assert.ok(!engine.applyAction(action).accepted,'combat rejects exploration '+action.type);
    assert.deepEqual(JSON.stringify([run.worldTurn,run.hero,run.enemies,run.rngState]),freeze,'combat freezes map and RNG');
    const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
    assert.deepEqual(run.hero,{x:4,y:3},'offensive victory completes the requested step onto enemy cell');
    assert.ok(run.groundMaterials.has('4,3')&&!run.groundMaterials.has('3,3'),'offensive reward appears on destination cell');
    assert.deepEqual([run.mode,run.enemies.length,...run.looseLoot().map(l=>[l.material,l.amount])],['exploration',1,['metal',1],['electronics',1]],'victory removes one monster and rewards once');
    assert.deepEqual([run.worldTurn,run.rngState],[1,123],'victory does not resume interrupted phase');
    let rejected=false;try{run.processCombatTurn(weapon.id,armor.id)}catch{rejected=true}assert.ok(rejected&&run.looseLoot().length===2,'terminal battle cannot reward twice');
});

test('multi-turn offensive victory preserves both cells loot and refreshes detection', () => {
    const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','scorpion',4,3);
    const observer=add('b','rat',7,3,{detectionRadius:3});
    const sourceLoot=run.createItem('weak_battery'),targetLoot=run.createItem('copper_wire');
    run.putOnGround(sourceLoot,3,3);run.putOnGround(targetLoot,4,3);
    run.lootPoints=[{id:'guarded-cache',name:'Scrap Heap',x:4,y:3,searched:false,loot:[{kind:'item',definitionId:'copper_wire'}]}];
    engine.applyAction({type:'move',dx:1,dy:0});
    const [weapon,armor]=selected(run);
    const first=run.processCombatTurn(weapon.id,armor.id);
    assert.ok(!first.isEnemyDead,'multi-turn offensive fixture requires another attack');
    assert.deepEqual(run.hero,{x:3,y:3},'offensive hero does not advance before victory');
    const frozen=[run.worldTurn,run.rngState,observer.x,observer.y];
    run.processCombatTurn(weapon.id,armor.id);
    assert.deepEqual(run.hero,{x:4,y:3},'multi-turn victory advances exactly one cell');
    assert.deepEqual(run.groundItems.get('3,3'),[sourceLoot],'loot previously on source cell stays behind');
    assert.ok(run.itemsAtHero().includes(targetLoot)&&run.looseLoot().length===3,'destination loot is preserved alongside reward');
    assert.deepEqual([run.worldTurn,run.rngState,observer.x,observer.y],frozen,'victory movement spends no turn RNG or enemy movement');
    assert.ok(observer.isChasing,'detection indicator updates for the new hero position');
    assert.deepEqual([engine.contextualAction(),run.lootPoints[0].searched],['search',false],'victory does not automatically search guarded cache');
    engine.applyAction({type:'wait'});
    assert.deepEqual([observer.x,observer.y],[6,3],'normal enemy phase resumes on the next player action');
});

test('defensive victory after movement keeps hero on source cell', () => {
    const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','rat',4,2);
    engine.applyAction({type:'move',dx:0,dy:-1});
    assert.deepEqual([run.mode,run.hero],['combat',{x:3,y:2}],'enemy can initiate contact after a free player step');
    const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
    assert.deepEqual([run.hero,run.groundItems.has('4,2')],[{x:3,y:2},false],'defensive victory after moving does not advance onto attacker');
});

test('offensive defeat and simultaneous death never advance or reward', () => {
    for(const maxHp of [1,100]) {
        const {run,engine,add}=fixture();run.hero={x:3,y:3};run.playerHp=1;
        add('a','rat',4,3,{maxHp});engine.applyAction({type:'move',dx:1,dy:0});
        const [weapon]=selected(run);const log=run.processCombatTurn(weapon.id,null);
        assert.deepEqual([run.mode,run.hero,run.allGroundItems().length],['defeat',{x:3,y:3},0],'offensive defeat never advances or grants reward '+maxHp);
        assert.deepEqual(log.isEnemyDead,maxHp===1,'offensive simultaneous death preserves defeat priority');
    }
});

test('victory on exit waits for explicit leave action', () => {
    const {run,engine,add}=fixture();run.hero={x:3,y:3};run.map.exit={x:4,y:3};add('a','rat',4,3);
    engine.applyAction({type:'move',dx:1,dy:0});
    const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
    assert.deepEqual([run.hero,run.mode,engine.contextualAction(),run.sectorIndex],[{x:4,y:3},'exploration','exit',0],'offensive victory onto exit waits for explicit leave action');
});

test('search reveals loot before contact and cannot duplicate contents', () => {
    const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','rat',3,2);
    run.lootPoints=[{id:'cache',name:'Scrap Heap',x:3,y:3,searched:false,loot:[{kind:'item',definitionId:'weak_battery'},{kind:'item',definitionId:'copper_wire'}]}];
    engine.applyAction({type:'search'});assert.deepEqual([run.mode,run.lootPoints[0].searched,run.itemsAtHero().length],['combat',true,2],'search opens loot before contact');
    const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);const count=run.itemsAtHero().length;
    assert.ok(!engine.applyAction({type:'search'}).accepted&&run.itemsAtHero().length===count,'search cannot duplicate contents');
});

test('encounter retains HP; simultaneous death has defeat priority', () => {
    const {run,add}=fixture();run.playerHp=73;const enemy=add('a','scorpion',1,1);
    run.beginEncounter(enemy.id);assert.deepEqual(run.combatEngine.playerHp,73,'encounter preserves prior HP');
    const [weapon,armor]=selected(run);run.combatEngine.enemyHp=4;run.combatEngine.playerHp=1;
    const log=run.processCombatTurn(weapon.id,null);
    assert.ok(log.isEnemyDead&&log.isPlayerDead&&run.mode==='defeat','simultaneous death ends run as defeat');
    assert.deepEqual(run.itemsAtHero().length,0,'defeat awards no loot');
});

test('same seed reproduces wandering without overlapping monsters', () => {
    const left=fixture(987),right=fixture(987);
    for(const f of [left,right]){f.run.hero={x:0,y:7};f.add('a','rat',5,1,{detectionRadius:0});f.add('b','scorpion',6,2,{detectionRadius:0})}
    for(let turn=0;turn<18;turn++){
        left.engine.applyAction({type:'wait'});right.engine.applyAction({type:'wait'});
        assert.ok(new Set(left.run.enemies.map(e=>e.x+','+e.y)).size===left.run.enemies.length,'monsters never overlap '+turn);
    }
    assert.deepEqual([left.run.enemies,left.run.rngState],[right.run.enemies,right.run.rngState],'seeded wandering is reproducible');
});

test('workshop transitions preserve resources, instances and selection; completion freezes actions', () => {
    const {run,engine}=fixture();run.playerHp=61;const item=run.inventory.items[0];item.charge=7;
    const inventory=run.inventory.items.slice(),selection=inventory.map(i=>i.isSelectedForTurn);
    const abandoned=run.createItem('copper_wire');run.putOnGround(abandoned);run.putOnGround(abandoned);
    assert.deepEqual(run.itemsAtHero().length,1,'ground ownership does not duplicate an instance');
    run.hero={...run.map.exit};const result=engine.applyAction({type:'exit'});
    assert.deepEqual([run.mode,run.worldTurn,run.playerHp,item.charge],['workshop',0,61,7],'workshop transition keeps resources');
    assert.ok(run.continueFromWorkshop(),'workshop continues to second sector');
    assert.deepEqual(run.allGroundItems().length,0,'continuing discards former ground and bench');
    assert.deepEqual(run.sectorIndex,1,'continue loads second sector');
    assert.ok(inventory.every((i,n)=>run.inventory.items[n]===i),'transition keeps exact item instances');
    assert.deepEqual(run.inventory.items.map(i=>i.isSelectedForTurn),selection,'transition retains selection');
    assert.deepEqual(result.events[0].type,'workshop-entered','workshop entry event');
    run.requiredBossId=null;run.hero={...run.map.exit};engine.applyAction({type:'exit'});
    assert.ok(run.mode==='workshop'&&run.workshopFinal,'second exit opens final workshop');
    assert.ok(run.continueFromWorkshop(),'final workshop finishes demonstration');
    assert.deepEqual([run.mode,run.worldTurn],['complete',0],'finish completes without monster phase');
    assert.ok(!engine.applyAction({type:'wait'}).accepted,'completion freezes gameplay');
});
