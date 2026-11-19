import test from 'node:test';
import assert from 'node:assert/strict';
import { RunState } from '../../src/game/core/RunState.ts';
import { ExplorationEngine } from '../../src/game/core/ExplorationEngine.ts';
import { generateSector } from '../../src/game/core/SectorGenerator.ts';
import { generateBlueprintCaches } from '../../src/game/core/BlueprintGenerator.ts';
import { reachableDistances } from '../../src/game/core/GridTraversal.ts';
import { ENEMY_DEFINITIONS, SECTOR_PROFILES, worldKey } from '../../src/game/core/SectorDefinitions.ts';

const START={x:0,y:7},EXIT={x:7,y:0};
const seeds=[...Array.from({length:1000},(_,i)=>i),0x7fffffff,0x80000000,0xffffffff];
const cells=(rows,glyph)=>rows.flatMap((row,y)=>[...row].flatMap((c,x)=>c===glyph?[{x,y}]:[]));
const coords=positions=>positions.map(worldKey).sort();
const walkable=(rows,p)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.x<8&&p.y>=0&&p.y<8&&rows[p.y][p.x]!=='#';
const snapshot=run=>JSON.stringify([run.map,run.hero,run.enemies,run.lootPoints,run.blueprintCaches,run.aidStations,run.requiredBossId]);

for(let index=0;index<2;index++)test(`generated sector ${index+1}: structure, safety and variety over 1000 seeds and uint32 boundaries`,()=>{
    const geometries=new Set(),placements=new Set(),expected=SECTOR_PROFILES[index];
    for(const seed of seeds){
        const label=`seed ${seed} sector ${index}`,sector=generateSector(seed,index),rows=sector.rows;
        assert.deepEqual(sector,generateSector(seed,index),label+' deterministic');
        assert.equal(rows.length,8,label+' height');
        assert.ok(rows.every(row=>/^[SX#.rc12]{8}$/.test(row)),label+' width and symbols');
        assert.deepEqual(cells(rows,'S'),[START],label+' start');
        assert.deepEqual(cells(rows,'X'),[EXIT],label+' exit');
        assert.equal(cells(rows,'#').length,index===0?9:11,label+' wall budget');
        assert.ok(walkable(rows,{x:0,y:6})&&walkable(rows,{x:1,y:7}),label+' open starting neighbors');
        const distances=reachableDistances(START,64,p=>walkable(rows,p));
        assert.equal(distances.size,64-expected.wallCount,label+' all floor connected');
        assert.equal(cells(rows,'r').length,index===0?2:1,label+' rats');
        assert.equal(cells(rows,'c').length,index===0?1:2,label+' scorpions');
        assert.equal(cells(rows,'1').length,1,label+' Scrap Heap');
        assert.equal(cells(rows,'2').length,1,label+' Abandoned Kiosk');
        assert.equal(sector.blueprintCaches.length,index===0?2:0,label+' caches');
        assert.equal(sector.aidStations.length,index===0?0:1,label+' aid');
        assert.equal(Boolean(sector.boss),index===1,label+' boss');
        assert.deepEqual(sector.loot,expected.loot,label+' unchanged rewards');
        const occupied=[START,EXIT,...cells(rows,'r'),...cells(rows,'c'),...cells(rows,'1'),...cells(rows,'2'),...sector.blueprintCaches,...sector.aidStations];
        assert.ok(occupied.every(p=>walkable(rows,p)&&distances.has(worldKey(p))),label+' reachable objects on floor');
        assert.equal(new Set(coords(occupied)).size,occupied.length,label+' no initial overlap (boss shares X)');
        for(const [symbol,kind] of [['r','rat'],['c','scorpion']])for(const enemy of cells(rows,symbol))
            assert.ok(distances.get(worldKey(enemy))>ENEMY_DEFINITIONS[kind].detectionRadius,label+' safe '+kind);
        if(sector.boss)assert.ok(distances.get(worldKey(EXIT))>ENEMY_DEFINITIONS.brute.detectionRadius,label+' safe boss');
        geometries.add(rows.map(row=>row.replace(/[^#]/g,'.')).join('\n'));
        placements.add(JSON.stringify([cells(rows,'r'),cells(rows,'c'),cells(rows,'1'),cells(rows,'2'),sector.blueprintCaches,sector.aidStations]));
    }
    assert.ok(geometries.size>900,'wall geometry varies across seeds');
    assert.ok(placements.size>900,'object positions vary across seeds');
});

test('RunState loads all generated positions and uses the same detection metric for safe starts',()=>{
    for(const seed of [0,1,123,0x80000000,0xffffffff])for(let index=0;index<2;index++){
        const run=new RunState(seed);run.loadSector(index);const sector=generateSector(seed,index),engine=new ExplorationEngine(run);
        assert.deepEqual(run.map.rows,sector.rows);assert.deepEqual([run.map.width,run.map.height],[8,8]);
        assert.deepEqual(run.hero,START);assert.deepEqual(run.map.exit,EXIT);
        for(const [symbol,kind] of [['r','rat'],['c','scorpion']])assert.deepEqual(coords(run.enemies.filter(e=>e.kind===kind)),coords(cells(sector.rows,symbol)));
        const bosses=run.enemies.filter(e=>e.isBoss);
        assert.deepEqual(coords(bosses),index===1?[worldKey(EXIT)]:[]);
        assert.equal(run.requiredBossId,index===1?bosses[0].id:null);
        assert.ok(run.enemies.every(enemy=>!enemy.isChasing&&!engine.detectionCells(enemy).some(p=>worldKey(p)===worldKey(START))));
        assert.equal(new Set(run.enemies.map(e=>e.id)).size,run.enemies.length,'stable unique enemy IDs');
        for(const marker of ['1','2']){
            const point=run.lootPoints.find(p=>p.id.endsWith('-'+marker));
            assert.deepEqual(coords([point]),coords(cells(sector.rows,marker)));assert.deepEqual(point.loot,sector.loot[marker]);assert.equal(point.searched,false);
        }
        assert.deepEqual(coords(run.blueprintCaches),coords(sector.blueprintCaches));
        assert.deepEqual(coords(run.aidStations),coords(sector.aidStations));
        assert.ok(run.blueprintCaches.every(c=>!c.opened&&!c.selectedRecipeId));
        assert.ok(run.aidStations.every(s=>!s.used&&s.healingAmount===30));
        const before=snapshot(run),rng=run.rngState;run.loadSector(index);
        assert.equal(snapshot(run),before,'reloading reproduces layout and objects');assert.equal(run.rngState,rng);
    }
});

test('sector generation leaves the enemy RNG and sector profiles untouched',()=>{
    const profiles=JSON.stringify(SECTOR_PROFILES);
    for(const seed of [0,123,0xffffffff]){
        const run=new RunState(seed);assert.equal(run.rngState,seed>>>0);
        run.nextRandom();const rng=run.rngState;
        for(const index of [0,1,0,1]){run.loadSector(index);assert.equal(run.rngState,rng)}
    }
    assert.equal(JSON.stringify(SECTOR_PROFILES),profiles);
});

test('blueprint offers are independent of cache coordinates and retain cache identity/order',()=>{
    const first=[{x:2,y:5},{x:6,y:1}],second=[{x:0,y:0},{x:7,y:7}];
    for(const seed of [0,123,0x80000000,0xffffffff]){
        const a=generateBlueprintCaches(seed,0,first),b=generateBlueprintCaches(seed,0,second);
        assert.deepEqual(a.map(c=>[c.id,c.offers]),b.map(c=>[c.id,c.offers]));
        assert.deepEqual(a.map(({x,y})=>({x,y})),first);assert.deepEqual(b.map(({x,y})=>({x,y})),second);
    }
    assert.deepEqual(generateBlueprintCaches(123,1,[]),[]);
});

test('first-sector turns, RNG, free actions and cache visit order cannot change the next sector',()=>{
    for(const seed of [0,123,0xffffffff]){
        const baseline=new RunState(seed);baseline.loadSector(1);const expected=snapshot(baseline);
        for(const reverse of [false,true]){
            const run=new RunState(seed),engine=new ExplorationEngine(run);run.enemies=[];
            const offers=JSON.stringify(run.blueprintCaches.map(c=>c.offers));
            for(let i=0;i<9;i++){assert.ok(engine.applyAction({type:'wait'}).accepted);run.nextRandom()}
            for(const cache of reverse?[...run.blueprintCaches].reverse():run.blueprintCaches){
                run.hero={x:cache.x,y:cache.y};assert.ok(engine.applyAction({type:'blueprint-cache'}).accepted);
                assert.ok(run.closeBlueprintChoice());assert.ok(engine.applyAction({type:'blueprint-cache'}).accepted);
                assert.ok(run.closeBlueprintChoice());
            }
            const rng=run.rngState,turn=run.worldTurn;
            engine.detectionCells({x:7,y:0,detectionRadius:4});
            assert.equal(engine.applyAction({type:'move',dx:1,dy:1}).accepted,false);
            assert.deepEqual([run.rngState,run.worldTurn],[rng,turn]);
            assert.equal(JSON.stringify(run.blueprintCaches.map(c=>c.offers)),offers);
            // Transition uses the real workshop command; only this isolated fixture's travel is replaced.
            run.hero={...run.map.exit};assert.ok(engine.applyAction({type:'exit'}).accepted);assert.ok(run.continueFromWorkshop());
            assert.equal(snapshot(run),expected);
        }
    }
});

test('unknown sector indices fail before changing the run',()=>{
    const run=new RunState(123),before=snapshot(run),rng=run.rngState;
    for(const index of [-1,2,0.5,NaN,Infinity]){
        assert.throws(()=>generateSector(123,index),RangeError);assert.throws(()=>run.loadSector(index),RangeError);
        assert.equal(snapshot(run),before);assert.equal(run.rngState,rng);
    }
});
