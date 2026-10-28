import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Real core modules are loaded through Vite; the tests contain no replacement game rules.
export async function runExplorationChecks({ evaluate, read, check, mouse, click, send, renderer }) {
    const coreChecks = await evaluate(`(async () => {
        const { RunState } = await import('/src/game/core/RunState.ts');
        const { ExplorationEngine } = await import('/src/game/core/ExplorationEngine.ts');
        const checks=[];
        const expect=(value,label)=>{if(!value)throw Error('Exploration core: '+label);checks.push(label)};
        const equal=(a,b,label)=>expect(JSON.stringify(a)===JSON.stringify(b),label+' '+JSON.stringify(a));
        const fixture=(seed=123)=>{
            const run=new RunState(seed);
            const templates=Object.fromEntries(run.enemies.map(e=>[e.kind,{...e}]));
            run.map={rows:Array(8).fill('........'),width:8,height:8,exit:{x:7,y:0}};
            run.hero={x:0,y:7};run.enemies=[];run.lootPoints=[];
            const add=(id,kind,x,y,config={})=>{
                const enemy={...templates[kind],id,x,y,isChasing:false,...config};run.enemies.push(enemy);return enemy;
            };
            return {run,engine:new ExplorationEngine(run),add};
        };
        const selected=run=>[run.inventory.items.find(i=>i.type==='weapon'),run.inventory.items.find(i=>i.type==='armor')];
        const initial=new RunState(42);
        equal(initial.inventory.items.map(i=>[i.definitionId,i.gridX,i.gridY]),[
            ['heavy_battery',0,0],['laser_pistol',2,0],['weak_battery',0,2],['makeshift_vest',1,2]],'guaranteed starting loadout');
        expect(selected(initial).every(i=>i.isSelectedForTurn&&i.isPowered),'starting weapon and armor selected and powered');
        equal(initial.inventory.items.filter(i=>i.type==='battery').map(i=>i.charge),[12,5],'starting charges');
        for(let sector=0;sector<2;sector++){
            const run=new RunState(42);run.loadSector(sector);const engine=new ExplorationEngine(run);
            equal([run.map.width,run.map.height,run.enemies.length,run.lootPoints.length],[8,8,3,2],'manual sector dimensions '+sector);
            const visited=new Set([run.hero.x+','+run.hero.y]),queue=[run.hero];
            for(let head=0;head<queue.length;head++)for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){
                const p={x:queue[head].x+dx,y:queue[head].y+dy},key=p.x+','+p.y;
                if(run.isWalkable(p)&&!visited.has(key)){visited.add(key);queue.push(p)}
            }
            expect([run.map.exit,...run.lootPoints].every(p=>visited.has(p.x+','+p.y)),'exit and loot reachable '+sector);
        }
        {
            const {run,engine}=fixture();const snapshot=JSON.stringify([run.hero,run.worldTurn,run.rngState]);
            for(const a of [{type:'move',dx:-1,dy:0},{type:'move',dx:1,dy:1},{type:'move',dx:0,dy:0},
                {type:'search'},{type:'exit'}])expect(!engine.applyAction(a).accepted,'invalid action rejected '+JSON.stringify(a));
            equal(JSON.stringify([run.hero,run.worldTurn,run.rngState]),snapshot,'invalid actions are free');
            run.map.rows[6]='#.......';expect(!engine.applyAction({type:'move',dx:0,dy:-1}).accepted,'wall is free');
            expect(engine.applyAction({type:'move',dx:1,dy:0}).accepted,'cardinal movement accepted');
            equal([run.hero,run.worldTurn],[{x:1,y:7},1],'movement spends one turn');
            run.draggedItem=run.inventory.items[0];const freeze=JSON.stringify([run.hero,run.worldTurn,run.rngState]);
            expect(!engine.applyAction({type:'wait'}).accepted,'drag blocks world action');
            equal(JSON.stringify([run.hero,run.worldTurn,run.rngState]),freeze,'drag rejection preserves world');
        }
        {
            const {run,engine,add}=fixture(1);const rat=add('a','rat',4,4,{detectionRadius:0});
            const scorpion=add('b','scorpion',6,6,{detectionRadius:0});const rng=run.rngState;
            engine.applyAction({type:'wait'});equal([rat.x,rat.y,scorpion.x,scorpion.y,run.rngState],[4,4,6,6,rng],'idle periods skip turn one');
            engine.applyAction({type:'wait'});equal([rat.x,rat.y,scorpion.x,scorpion.y],[4,3,6,6],'rat wanders on turn two');
            const secondRng=run.rngState;engine.applyAction({type:'wait'});
            expect(run.rngState!==secondRng&&Math.abs(scorpion.x-6)+Math.abs(scorpion.y-6)===1,'scorpion wanders on turn three');
            equal(rat.detectionRadius,0,'fixture radius retained');
        }
        {
            const {run,engine,add}=fixture(1);add('a','rat',0,0,{detectionRadius:0,idlePeriod:1});
            const before=run.rngState;engine.applyAction({type:'wait'});
            equal([run.enemies[0].x,run.enemies[0].y],[0,0],'blocked random step waits');
            expect(run.rngState!==before,'blocked idle attempt consumes exactly one draw');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:2,y:2};run.map.rows[0]='.#......';
            const enemy=add('a','rat',0,0,{detectionRadius:8});const rng=run.rngState;
            engine.applyAction({type:'wait'});equal([enemy.x,enemy.y,enemy.isChasing],[0,1,true],'BFS goes around wall');
            equal(run.rngState,rng,'chase uses no random draw');
            run.hero={x:7,y:7};engine.applyAction({type:'wait'});expect(!enemy.isChasing,'chase ends outside radius');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:2,y:0};const enemy=add('a','rat',1,1);
            engine.applyAction({type:'wait'});equal([enemy.x,enemy.y],[1,0],'equal chase paths prefer up before right');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:2,y:0};
            run.map.rows[0]='.#......';run.map.rows[1]='.#......';run.map.rows[2]='.#......';
            const enemy=add('a','rat',0,0,{detectionRadius:3,idlePeriod:99});
            expect(!engine.detectionCells(enemy).some(p=>p.x===2&&p.y===0),'walls lengthen detection path');
            const rng=run.rngState;for(let i=0;i<10;i++)engine.detectionCells(enemy);equal(run.rngState,rng,'hover detection is pure');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};const first=add('a','rat',3,2);
            const other=add('b','scorpion',4,2);expect(run.mode==='exploration','adjacency alone does not start combat');
            const result=engine.applyAction({type:'wait'});
            equal([run.mode,run.activeEnemyId,run.worldTurn],['combat','a',1],'monster contact starts one encounter');
            equal([first.x,first.y,other.x,other.y],[3,2,4,2],'contact leaves cells and stops remaining phase');
            equal(result.events.filter(e=>e.type==='combat-started').length,1,'one encounter event');
            const frozen=JSON.stringify([run.worldTurn,run.rngState,run.enemies.map(e=>[e.id,e.x,e.y])]);
            const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
            equal(run.hero,{x:3,y:3},'defensive victory after waiting keeps hero on their cell');
            equal([run.itemsAtHero().length,run.groundItems.has('3,2')],[1,false],'defensive reward stays with hero');
            equal(JSON.stringify([run.worldTurn,run.rngState,[['a',3,2],...run.enemies.map(e=>[e.id,e.x,e.y])]]),frozen,'defensive victory spends no world action or remaining enemy phase');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};add('b','rat',3,2);add('a','scorpion',4,3);
            engine.applyAction({type:'wait'});equal(run.activeEnemyId,'a','stable ID order wins simultaneous contact');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','rat',4,3);add('b','scorpion',7,7);
            const positions=run.enemies.map(e=>[e.x,e.y]);const result=engine.applyAction({type:'move',dx:1,dy:0});
            equal(run.hero,{x:3,y:3},'hero contact leaves hero on source cell');
            equal(run.enemies.map(e=>[e.x,e.y]),positions,'hero contact skips monster phase');
            equal([run.worldTurn,result.events.filter(e=>e.type==='combat-started').length],[1,1],'hero contact consumes one action');
            const freeze=JSON.stringify([run.worldTurn,run.hero,run.enemies,run.rngState]);
            for(const action of [{type:'wait'},{type:'move',dx:0,dy:1},{type:'search'},{type:'exit'}])expect(!engine.applyAction(action).accepted,'combat rejects exploration '+action.type);
            equal(JSON.stringify([run.worldTurn,run.hero,run.enemies,run.rngState]),freeze,'combat freezes map and RNG');
            const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
            equal(run.hero,{x:4,y:3},'offensive victory completes the requested step onto enemy cell');
            expect(run.groundItems.get('4,3')===run.itemsAtHero()&&!run.groundItems.has('3,3'),'offensive reward appears on destination cell');
            equal([run.mode,run.enemies.length,run.itemsAtHero()[0].definitionId,run.itemsAtHero()[0].charge],['exploration',1,'weak_battery',2],'victory removes one monster and rewards once');
            equal([run.worldTurn,run.rngState],[1,123],'victory does not resume interrupted phase');
            let rejected=false;try{run.processCombatTurn(weapon.id,armor.id)}catch{rejected=true}expect(rejected&&run.itemsAtHero().length===1,'terminal battle cannot reward twice');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','scorpion',4,3);
            const observer=add('b','rat',7,3,{detectionRadius:3});
            const sourceLoot=run.createItem('weak_battery'),targetLoot=run.createItem('copper_wire');
            run.putOnGround(sourceLoot,3,3);run.putOnGround(targetLoot,4,3);
            run.lootPoints=[{id:'guarded-cache',name:'Scrap Heap',x:4,y:3,searched:false,definitionIds:['copper_wire']}];
            engine.applyAction({type:'move',dx:1,dy:0});
            const [weapon,armor]=selected(run);
            const first=run.processCombatTurn(weapon.id,armor.id);
            expect(!first.isEnemyDead,'multi-turn offensive fixture requires another attack');
            equal(run.hero,{x:3,y:3},'offensive hero does not advance before victory');
            const frozen=[run.worldTurn,run.rngState,observer.x,observer.y];
            run.processCombatTurn(weapon.id,armor.id);
            equal(run.hero,{x:4,y:3},'multi-turn victory advances exactly one cell');
            equal(run.groundItems.get('3,3'),[sourceLoot],'loot previously on source cell stays behind');
            expect(run.itemsAtHero().includes(targetLoot)&&run.itemsAtHero().length===2,'destination loot is preserved alongside reward');
            equal([run.worldTurn,run.rngState,observer.x,observer.y],frozen,'victory movement spends no turn RNG or enemy movement');
            expect(observer.isChasing,'detection indicator updates for the new hero position');
            equal([engine.contextualAction(),run.lootPoints[0].searched],['search',false],'victory does not automatically search guarded cache');
            engine.applyAction({type:'wait'});
            equal([observer.x,observer.y],[6,3],'normal enemy phase resumes on the next player action');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','rat',4,2);
            engine.applyAction({type:'move',dx:0,dy:-1});
            equal([run.mode,run.hero],['combat',{x:3,y:2}],'enemy can initiate contact after a free player step');
            const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
            equal([run.hero,run.groundItems.has('4,2')],[{x:3,y:2},false],'defensive victory after moving does not advance onto attacker');
        }
        for(const maxHp of [1,100]) {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};run.playerHp=1;
            add('a','rat',4,3,{maxHp});engine.applyAction({type:'move',dx:1,dy:0});
            const [weapon]=selected(run);const log=run.processCombatTurn(weapon.id,null);
            equal([run.mode,run.hero,run.allGroundItems().length],['defeat',{x:3,y:3},0],'offensive defeat never advances or grants reward '+maxHp);
            equal(log.isEnemyDead,maxHp===1,'offensive simultaneous death preserves defeat priority');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};run.map.exit={x:4,y:3};add('a','rat',4,3);
            engine.applyAction({type:'move',dx:1,dy:0});
            const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);
            equal([run.hero,run.mode,engine.contextualAction(),run.sectorIndex],[{x:4,y:3},'exploration','exit',0],'offensive victory onto exit waits for explicit leave action');
        }
        {
            const {run,engine,add}=fixture();run.hero={x:3,y:3};add('a','rat',3,2);
            run.lootPoints=[{id:'cache',name:'Scrap Heap',x:3,y:3,searched:false,definitionIds:['weak_battery','copper_wire']}];
            engine.applyAction({type:'search'});equal([run.mode,run.lootPoints[0].searched,run.itemsAtHero().length],['combat',true,2],'search opens loot before contact');
            const [weapon,armor]=selected(run);run.processCombatTurn(weapon.id,armor.id);const count=run.itemsAtHero().length;
            expect(!engine.applyAction({type:'search'}).accepted&&run.itemsAtHero().length===count,'search cannot duplicate contents');
        }
        {
            const {run,add}=fixture();run.playerHp=73;const enemy=add('a','scorpion',1,1);
            run.beginEncounter(enemy.id);equal(run.combatEngine.playerHp,73,'encounter preserves prior HP');
            const [weapon,armor]=selected(run);run.combatEngine.enemyHp=4;run.combatEngine.playerHp=1;
            const log=run.processCombatTurn(weapon.id,null);
            expect(log.isEnemyDead&&log.isPlayerDead&&run.mode==='defeat','simultaneous death ends run as defeat');
            equal(run.itemsAtHero().length,0,'defeat awards no loot');
        }
        {
            const left=fixture(987),right=fixture(987);
            for(const f of [left,right]){f.run.hero={x:0,y:7};f.add('a','rat',5,1,{detectionRadius:0});f.add('b','scorpion',6,2,{detectionRadius:0})}
            for(let turn=0;turn<18;turn++){
                left.engine.applyAction({type:'wait'});right.engine.applyAction({type:'wait'});
                expect(new Set(left.run.enemies.map(e=>e.x+','+e.y)).size===left.run.enemies.length,'monsters never overlap '+turn);
            }
            equal([left.run.enemies,left.run.rngState],[right.run.enemies,right.run.rngState],'seeded wandering is reproducible');
        }
        {
            const {run,engine}=fixture();run.playerHp=61;const item=run.inventory.items[0];item.charge=7;
            const inventory=run.inventory.items.slice(),selection=inventory.map(i=>i.isSelectedForTurn);
            const abandoned=run.createItem('copper_wire');run.putOnGround(abandoned);run.putOnGround(abandoned);
            equal(run.itemsAtHero().length,1,'ground ownership does not duplicate an instance');
            run.hero={...run.map.exit};const result=engine.applyAction({type:'exit'});
            equal([run.sectorIndex,run.worldTurn,run.playerHp,item.charge,run.allGroundItems().length],[1,0,61,7,0],'sector transition keeps resources and discards ground');
            expect(inventory.every((i,n)=>run.inventory.items[n]===i),'transition keeps exact item instances');
            equal(run.inventory.items.map(i=>i.isSelectedForTurn),selection,'transition retains selection');
            equal(result.events[0].type,'sector-entered','sector entry event');
            run.hero={...run.map.exit};engine.applyAction({type:'exit'});
            equal([run.mode,run.worldTurn],['complete',0],'second exit completes without monster phase');
            expect(!engine.applyAction({type:'wait'}).accepted,'completion freezes gameplay');
        }
        {
            // Complete a real seeded run by walking to both caches and the exit.
            // Only discovered batteries can replace existing sources; HP and positions
            // are changed exclusively by the real exploration/combat models.
            const dirs=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
            const key=p=>p.x+','+p.y;
            const assert=(value,label='full run action accepted')=>expect(Boolean(value),label);
            assert.equal=(actual,expected,label='full run state')=>equal(actual,expected,label);
            function firstStep(state, target) {
                const queue = [{ p: state.hero, step: null }];
                const seen = new Set([key(state.hero)]);
                for (let h = 0; h < queue.length; h++) {
                    const { p, step } = queue[h];
                    if (key(p) === key(target)) return step;
                    for (const d of dirs) {
                        const next = { x: p.x + d.x, y: p.y + d.y };
                        if (!state.isWalkable(next) || seen.has(key(next))) continue;
                        seen.add(key(next));
                        queue.push({ p: next, step: step ?? d });
                    }
                }
                throw new Error('Unreachable target');
            }
            function upgradeBatteries(state) {
                for (const voltage of ['high', 'low']) {
                    const existing = state.inventory.items.find(i => i.type === 'battery' && i.voltageType === voltage);
                    const best = state.itemsAtHero().filter(i => i.type === 'battery' && i.voltageType === voltage)
                        .sort((a, b) => b.charge - a.charge)[0];
                    if (!best || (existing && existing.charge >= best.charge)) continue;
                    if (existing) state.putOnGround(existing);
                    state.removeFromGround(best.id);
                    const pos = voltage === 'high' ? [0, 0] : [0, 2];
                    assert(state.inventory.placeItem(best, ...pos));
                    state.inventory.updatePowerGrid();
                }
            }
            function simulation(seed) {
                const state = new RunState(seed);
                const engine = new ExplorationEngine(state);
                let fights = 0;
                let steps = 0;
                function fight() {
                    if (state.mode !== 'combat') return;
                    fights++;
                    for (let n = 0; state.mode === 'combat' && n < 100; n++) {
                        const weapon = state.inventory.items.find(i => i.type === 'weapon');
                        const armor = state.inventory.items.find(i => i.type === 'armor');
                        state.processCombatTurn(weapon.id, armor?.id ?? null);
                    }
                    assert.equal(state.mode, 'exploration', 'seed '+seed+' survived battle');
                    upgradeBatteries(state);
                }
                for (let sector = 0; sector < 2; sector++) {
                    const goals = [...state.lootPoints.map(p => ({ x: p.x, y: p.y })), { ...state.map.exit }];
                    for (let goalIndex = 0; goalIndex < goals.length; goalIndex++) {
                        const target = goals[goalIndex];
                        for (let n = 0; key(state.hero) !== key(target) && n < 300; n++) {
                            const d = firstStep(state, target);
                            const result = engine.applyAction({ type: 'move', dx: d.x, dy: d.y });
                            assert(result.accepted);
                            steps++;
                            fight();
                        }
                        assert.equal(key(state.hero), key(target));
                        if (goalIndex < goals.length - 1) {
                            assert(engine.applyAction({ type: 'search' }).accepted);
                            fight();
                            upgradeBatteries(state);
                        } else {
                            assert(engine.applyAction({ type: 'exit' }).accepted);
                        }
                    }
                }
                assert.equal(state.mode, 'complete');
                return { seed, hp: state.playerHp, fights, steps };
            }
            const result=simulation(123);
            equal([result.hp,result.fights,result.steps],[100,6,48],'complete real two-sector run without teleports or resource edits');
        }
        return checks;
    })()`);
    console.log(`PASS ${renderer}: ${coreChecks.length} exploration core assertions`);

    const waitFor = async (condition,label) => {
        for(let i=0;i<100;i++){if(await read(condition))return;await delay(25);}
        console.error(await read(`({mode:s.run.mode,selection:s.inventory.items.filter(i=>i.isSelectedForTurn).map(i=>i.id),hp:[s.combatEngine?.playerHp,s.combatEngine?.enemyHp],error:s.hasCombatError,messages:s.messages,button:{visible:s.endTurnButton.visible,input:s.endTurnButton.input.enabled},pointer:[s.input.activePointer.x,s.input.activePointer.y]})`));
        throw Error(`${renderer}: ${label}`);
    };
    const viewport = async (width,height) => {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await delay(100);
        await evaluate('s.applyLayout()');
        await delay(80);
    };
    const key = async (key,code,windowsVirtualKeyCode,repeat=false) => {
        await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,autoRepeat:repeat});
        if(!repeat)await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
    };
    const directory=join(process.cwd(),'artifacts','exploration');
    await mkdir(directory,{recursive:true});
    const capture = async name => {
        await delay(100);
        const clip=await read(`(()=>{const r=s.game.canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
        const shot=await send('Page.captureScreenshot',{format:'png',clip});
        await writeFile(join(directory,renderer+'-'+name+'.png'),Buffer.from(shot.data,'base64'));
    };
    await evaluate('freshRun()');
    await viewport(1366,650);
    await check('[s.compact,s.scale.width,s.scale.height,s.run.mode,s.inventory.items.length]',[false,1248,640,'exploration',4],'wide new run');
    await check("s.children.getAll().some(o=>o.type==='Text'&&o.text==='SCAVENGE SCRAP')",false,'scavenge is absent');
    await capture('wide-exploration');
    await mouse('mouseMoved',1049,225);
    await check('s.enemyNameText.text','Scrap Rat','hover shows monster information');
    await evaluate('s.performWorldAction({type:"wait"})');
    await mouse('mouseMoved',1050,226);
    await check('s.enemyNameText.text','Scrap Rat','hover over same monster recovers after a world action');
    await evaluate('freshRun()');await viewport(1366,650);
    await evaluate('s.run.enemies=[];s.updateCombatUI()');
    // Keep the key held while sending its repeat, matching a real keyboard gesture.
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'d',code:'KeyD',windowsVirtualKeyCode:68});
    await check('[s.run.hero.x,s.run.hero.y,s.run.worldTurn]',[1,7,1],'keyboard moves one cell');
    await key('d','KeyD',68,true);
    await check('s.run.worldTurn',1,'key repeat ignored');
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'d',code:'KeyD',windowsVirtualKeyCode:68});
    await click(824+2*50+25,150+7*50+25);
    await check('[s.run.hero.x,s.run.worldTurn]',[2,2],'scaled canvas adjacent click');
    await click(824+6*50+25,150+7*50+25);
    await check('s.run.worldTurn',2,'distant click does not auto-walk');
    await key(' ','Space',32);
    await check('s.run.worldTurn',3,'space waits one turn');
    await viewport(1280,620);
    await check('s.compact',false,'1280 wide layout');
    await viewport(1024,640);
    await check('[s.compact,s.scale.width,s.scale.height]',[true,800,600],'1024 compact layout');
    await evaluate('s.backpackView=false;s.applyLayout()');
    await capture('compact-map');
    await key('b','KeyB',66);
    await check('s.backpackView',true,'B opens compact backpack');
    await capture('compact-backpack');
    await viewport(800,600);
    await check('[s.compact,s.scale.width,s.scale.height,s.run.worldTurn]',[true,800,600,3],'minimum viewport preserves world');
    await key('b','KeyB',66);
    await check('s.backpackView',false,'B returns map');

    // Ground pages, persistent ownership and both directions of actual drag/drop.
    await viewport(1366,650);
    await evaluate(`s.run.hero={x:1,y:5};s.performWorldAction({type:'search'});s.updateCombatUI()`);
    await check('[s.run.itemsAtHero().length,s.run.worldTurn]',[2,4],'first search reveals two items');
    await capture('wide-loot');
    const groundId=await read('s.run.itemsAtHero()[0].id');
    const groundPoint=await read(`(()=>{const v=s.visualItemsMap.get(${JSON.stringify(groundId)});return [v.rect.x+10,v.rect.y+10]})()`);
    await mouse('mousePressed',...groundPoint);await mouse('mouseMoved',groundPoint[0]+15,groundPoint[1]);
    await mouse('mouseMoved',425,375);await mouse('mouseReleased',425,375);
    await check(`s.inventory.items.some(i=>i.id===${JSON.stringify(groundId)})`,true,'ground drag picks up item');
    await check('[s.run.itemsAtHero().length,s.run.worldTurn]',[1,4],'pickup costs no world turn');
    const placed=await read(`(()=>{const v=s.visualItemsMap.get(${JSON.stringify(groundId)});return [v.rect.x+10,v.rect.y+10]})()`);
    await mouse('mousePressed',...placed);await mouse('mouseMoved',placed[0]+15,placed[1]);
    await mouse('mouseMoved',650,300);await mouse('mouseReleased',650,300);
    await check(`!s.inventory.items.some(i=>i.id===${JSON.stringify(groundId)})&&s.run.itemsAtHero().some(i=>i.id===${JSON.stringify(groundId)})`,true,'drop transfers item to current cell');
    const lootBefore=await read('s.run.itemsAtHero().map(i=>i.id).sort()');
    await evaluate(`s.performWorldAction({type:'move',dx:0,dy:1});s.performWorldAction({type:'move',dx:0,dy:-1})`);
    await check('s.run.itemsAtHero().map(i=>i.id).sort()',lootBefore,'ground persists after leaving and returning');

    await evaluate(`for(let y=0;y<6;y++)for(let x=0;x<6;x++){
        const item=s.run.createItem('copper_wire');item.width=item.height=1;
        if(s.inventory.canPlaceItem(item,x,y)){s.inventory.placeItem(item,x,y);s.addItemVisual(item)}
    }s.groundPage=0;s.updateCombatUI()`);
    await check('s.inventory.grid.flat().every(Boolean)',true,'full backpack fixture covers every cell');
    const fullGroundId=await read('s.run.itemsAtHero()[0].id');
    const fullGroundPoint=await read(`(()=>{const r=s.visualItemsMap.get(${JSON.stringify(fullGroundId)}).rect;return [r.x+10,r.y+10]})()`);
    await mouse('mousePressed',...fullGroundPoint);await mouse('mouseMoved',fullGroundPoint[0]+15,fullGroundPoint[1]);
    await mouse('mouseMoved',425,375);await mouse('mouseReleased',425,375);
    await check(`s.run.itemsAtHero().filter(i=>i.id===${JSON.stringify(fullGroundId)}).length===1
        &&!s.inventory.items.some(i=>i.id===${JSON.stringify(fullGroundId)})&&!s.run.draggedItem`,true,'failed pickup into full backpack preserves one ground owner');

    // Rotation and resize cancel restore a physical item without recreating it.
    const gunId=await read("s.inventory.items.find(i=>i.type==='weapon').id");
    await evaluate(`globalThis.savedVisual=s.visualItemsMap.get(${JSON.stringify(gunId)});globalThis.beforeResize={
        x:savedVisual.itemModel.gridX,y:savedVisual.itemModel.gridY,w:savedVisual.itemModel.width,h:savedVisual.itemModel.height,
        angle:savedVisual.image.angle};undefined`);
    await mouse('mousePressed',325,175);await mouse('mouseMoved',345,175);
    await key('r','KeyR',82);
    await viewport(1024,640);
    await mouse('mouseReleased',345,175);
    await check(`(()=>{const v=s.visualItemsMap.get(${JSON.stringify(gunId)}),i=v.itemModel;return [v===savedVisual,!!s.activeDrag,
        i.gridX,i.gridY,i.width,i.height,v.image.angle]})()`,[true,false,2,0,2,1,0],'resize restores drag position and orientation without recreation');

    await evaluate('freshRun()');await viewport(1366,650);
    await evaluate('s.run.hero={x:4,y:0};s.updateCombatUI()');
    await click(1049,225);
    await check('[s.run.mode,s.run.worldTurn,s.canEndTurn()]',['combat',1,true],'contact opens selected combat loadout');
    await capture('wide-combat');
    const world=await read('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.enemies,s.run.hero])');
    await key(' ','Space',32);await key('d','KeyD',68);
    await check('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.enemies,s.run.hero])',world,'browser world controls frozen in combat');
    await viewport(800,600);
    await check('s.backpackView',true,'combat forces compact backpack');
    await key('b','KeyB',66);await check('s.backpackView',true,'combat prevents map switch');
    await click(663,544);
    await waitFor("s.run.mode==='exploration'",'victory returns exploration');
    await check('[s.backpackView,s.run.itemsAtHero().length,s.run.worldTurn]',[false,1,1],'victory returns compact map and grants one reward');
    await check('[s.run.hero,s.run.groundItems.has("4,1"),s.run.groundItems.has("4,0"),s.mapView.labels[12].text]',
        [{x:4,y:1},true,false,'P'],'click-initiated victory moves hero and loot to enemy cell in compact map');
    await evaluate(`s.run.enemies=[{...s.run.enemies[0],x:3,y:1,maxHp:12}];s.updateCombatUI()`);
    await key(' ','Space',32);
    await check('[s.run.mode,s.run.hero]',['combat',{x:4,y:1}],'waiting lets the enemy initiate contact');
    const defensiveWorld=await read('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.enemies])');
    await click(663,544);
    await waitFor("s.run.mode==='exploration'",'defensive victory returns exploration');
    await check('[s.run.hero,s.run.itemsAtHero().length,s.run.groundItems.has("3,1")]',
        [{x:4,y:1},2,false],'wait-initiated defensive victory keeps hero and loot on hero cell');
    await check('JSON.stringify([s.run.worldTurn,s.run.rngState])',
        JSON.stringify(JSON.parse(defensiveWorld).slice(0,2)),'defensive victory adds no world turn or RNG');
    await evaluate('s.run.enemies=[];s.run.hero={...s.run.map.exit};globalThis.sessionInventory=s.inventory.items.slice();globalThis.hpBefore=s.run.playerHp;globalThis.chargeBefore=s.inventory.items.filter(i=>i.type===\'battery\').map(i=>i.charge);s.performWorldAction({type:"exit"})');
    await check('[s.run.sectorIndex,s.run.worldTurn,s.run.playerHp===hpBefore,s.inventory.items.every((i,n)=>i===sessionInventory[n]),s.inventory.items.filter(i=>i.type===\'battery\').map(i=>i.charge)]',[1,0,true,true,await read('chargeBefore')],'UI sector transition retains HP, charge and instances');
    await evaluate('s.run.hero={...s.run.map.exit};s.performWorldAction({type:"exit"})');
    await check('[s.run.mode,s.canEndTurn()]',['complete',false],'second UI exit completes demo');
    const oldSeed=await read('s.run.seed');await click(408,576);
    await waitFor("s.run.mode==='exploration'",'NEW RUN button starts a fresh session');
    await check('[s.run.mode,s.run.sectorIndex,s.run.worldTurn,s.run.playerHp,s.inventory.items.length]',['exploration',0,0,100,4],'new run resets resources');
    assert.notEqual(await read('s.run.seed'),oldSeed,`${renderer}: new run chooses another seed`);
    console.log(`PASS ${renderer}: UI controls, four viewports, resize rollback, ground ownership, repeated combat and two-sector completion`);
}
