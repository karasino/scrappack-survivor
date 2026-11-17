import test from 'node:test';
import assert from 'node:assert/strict';
import { RunState } from '../../src/game/core/RunState.ts';
import { ExplorationEngine } from '../../src/game/core/ExplorationEngine.ts';
import { Inventory } from '../../src/game/core/Inventory.ts';

test('starting loadout preserves positions, selection, physical power and charges', () => {
    const initial=new RunState(42);

    assert.deepEqual(initial.inventory.items.map(i=>[i.definitionId,i.gridX,i.gridY]),[
        ['heavy_battery',0,0],['laser_pistol',2,0],['weak_battery',0,2],['makeshift_vest',1,2],['medkit',0,1]],'guaranteed starting loadout');
    assert.ok(initial.inventory.items.filter(i=>i.type==='weapon'||i.type==='armor').every(i=>i.isSelectedForTurn&&i.isPowered),'starting weapon and armor selected and powered');
    assert.deepEqual(initial.inventory.items.filter(i=>i.type==='battery').map(i=>i.charge),[12,5],'starting charges');
});

test('closed starting cells and four rotations of components and medkit', () => {
    const initial=new RunState(123);
    assert.ok(!initial.inventory.canPlaceItem(initial.createItem('power_core'),4,0),'closed cells reject placement');
    for(const definitionId of ['power_core','precision_mechanism','medkit']){
        const item=initial.createItem(definitionId);const before=item.quarterTurns;
        for(let i=0;i<4;i++)item.rotate();
        assert.deepEqual([item.width,item.height,item.quarterTurns],[1,1,before],'canonical four rotations '+definitionId);
        assert.ok(!item.isEnergySource&&!item.isSelectedForTurn,'noncombat component or consumable '+definitionId);
    }
});

test('boss expansion stages preserve instances, reject invalid sizes and reward replay', () => {
    const run=new RunState(16),inventory=run.inventory,items=inventory.items.slice();
    const sizes=[[5,4],[5,5],[6,5],[6,6],[6,6]];
    for(let index=0;index<5;index++){
        const id='synthetic-boss-'+index,turn=run.worldTurn,rng=run.rngState;
        run.applyBossReward(id,'Scrap Brute');
        assert.deepEqual([inventory.width,inventory.height],sizes[index],'capacity stage '+index);
        assert.deepEqual(run.bossVictoryCount,index+1,'boss victory counter '+index);
        assert.ok(run.pendingBossReward.expansionApplied===(index<4),'no fifth expansion '+index);
        const count=run.allGroundItems().length;
        run.applyBossReward(id,'Scrap Brute');
        assert.deepEqual([run.bossVictoryCount,run.allGroundItems().length],[index+1,count],'reward idempotence before acknowledgement '+index);
        assert.ok(!new ExplorationEngine(run).applyAction({type:'wait'}).accepted,'reward blocks world');
        assert.ok(!run.dropMaterial('metal')&&run.useMedkit()===0,'reward blocks other commands');
        assert.ok(run.acknowledgeBossReward(),'acknowledge reward');
        run.applyBossReward(id,'Scrap Brute');
        assert.deepEqual([run.bossVictoryCount,run.allGroundItems().length,run.mode],[index+1,count,'exploration'],'reward replay stays closed '+index);
        assert.deepEqual([run.worldTurn,run.rngState],[turn,rng],'reward and acknowledgement free '+index);
        assert.ok(items.every(i=>inventory.items.includes(i)),'expansion preserves instances '+index);
        assert.ok(inventory.canPlaceItem(run.createItem('power_core'),inventory.width-1,0),'new right column is available '+index);
    }
    assert.ok(!inventory.expandTo(7,6)&&!inventory.expandTo(4,4),'invalid expansion cannot shrink or exceed maximum');
    const generic=new Inventory();assert.deepEqual([generic.width,generic.height],[6,6],'generic inventory stays compatible');
    const fresh=new RunState(16);assert.deepEqual([fresh.inventory.width,fresh.inventory.height,fresh.bossVictoryCount],[4,4,0],'new run resets progression');
});
