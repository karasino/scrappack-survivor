import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runLocationFeedbackChecks } from './ui-feedback-checks.mjs';
import { runGeneratedSectorChecks } from './sector-checks.mjs';

// Browser coverage retains real input, rendering and the UI connection to RunState.
export async function runExplorationChecks({ evaluate, read, check, mouse, click, send, renderer }) {
    await runGeneratedSectorChecks({evaluate,read,check,mouse,click,send,renderer});
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
    await evaluate('freshAuthoredRun()');
    await viewport(1366,650);
    await check('[s.compact,s.scale.width,s.scale.height,s.run.mode,s.inventory.items.length]',[false,1248,640,'exploration',4],'wide new run');
    await check("s.children.getAll().some(o=>o.type==='Text'&&o.text==='SCAVENGE SCRAP')",false,'scavenge is absent');
    await capture('wide-exploration');
    await mouse('mouseMoved',1049,225);
    await check('s.enemyNameText.text','Scrap Rat','hover shows monster information');
    await evaluate('s.performWorldAction({type:"wait"})');
    await mouse('mouseMoved',1050,226);
    await check('s.enemyNameText.text','Scrap Rat','hover over same monster recovers after a world action');
    await evaluate('freshElectricRun()');await viewport(1366,650);
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
    await check('[s.run.looseLoot().length,s.run.worldTurn]',[2,4],'first search reveals two material packets');
    await evaluate("for(const loot of [...s.run.looseLoot()])if(loot.kind==='material')s.run.collectMaterials(loot.id);s.run.putOnGround(s.run.createItem('power_core'));s.run.putOnGround(s.run.createItem('precision_mechanism'));s.groundPage=0;s.updateCombatUI()");
    await capture('wide-loot');
    const groundId=await read('s.run.itemsAtHero()[0].id');
    const groundPoint=await read(`(()=>{const v=s.visualItemsMap.get(${JSON.stringify(groundId)});return [v.rect.x+10,v.rect.y+10]})()`);
    await mouse('mousePressed',...groundPoint);await mouse('mouseMoved',groundPoint[0]+15,groundPoint[1]);
    await mouse('mouseMoved',375,225);await mouse('mouseReleased',375,225);
    await check(`s.inventory.items.some(i=>i.id===${JSON.stringify(groundId)})`,true,'ground drag picks up item');
    await check('[s.run.itemsAtHero().length,s.run.worldTurn]',[1,4],'pickup costs no world turn');
    const placed=await read(`(()=>{const v=s.visualItemsMap.get(${JSON.stringify(groundId)});return [v.rect.x+10,v.rect.y+10]})()`);
    await mouse('mousePressed',...placed);await mouse('mouseMoved',placed[0]+15,placed[1]);
    await mouse('mouseMoved',650,300);await mouse('mouseReleased',650,300);
    await check(`!s.inventory.items.some(i=>i.id===${JSON.stringify(groundId)})&&s.run.itemsAtHero().some(i=>i.id===${JSON.stringify(groundId)})`,true,'drop transfers item to current cell');
    const lootBefore=await read('s.run.itemsAtHero().map(i=>i.id).sort()');
    await evaluate(`s.performWorldAction({type:'move',dx:0,dy:1});s.performWorldAction({type:'move',dx:0,dy:-1})`);
    await check('s.run.itemsAtHero().map(i=>i.id).sort()',lootBefore,'ground persists after leaving and returning');

    await evaluate(`for(let y=0;y<s.inventory.height;y++)for(let x=0;x<s.inventory.width;x++){
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

    await evaluate('freshElectricRun()');await viewport(1366,650);
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
    await check('[s.backpackView,s.run.looseLoot().length,s.run.worldTurn]',[false,2,1],'victory returns compact map and grants one reward');
    await check('[s.run.hero,s.run.groundMaterials.has("4,1"),s.run.groundMaterials.has("4,0"),s.mapView.labels[12].text]',
        [{x:4,y:1},true,false,'P'],'click-initiated victory moves hero and loot to enemy cell in compact map');
    await evaluate(`s.run.enemies=[{...s.run.enemies[0],x:3,y:1,maxHp:12}];s.updateCombatUI()`);
    await key(' ','Space',32);
    await check('[s.run.mode,s.run.hero]',['combat',{x:4,y:1}],'waiting lets the enemy initiate contact');
    const defensiveWorld=await read('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.enemies])');
    await click(663,544);
    await waitFor("s.run.mode==='exploration'",'defensive victory returns exploration');
    await check('[s.run.hero,s.run.looseLoot().length,s.run.groundMaterials.has("3,1")]',
        [{x:4,y:1},4,false],'wait-initiated defensive victory keeps hero and loot on hero cell');
    await check('JSON.stringify([s.run.worldTurn,s.run.rngState])',
        JSON.stringify(JSON.parse(defensiveWorld).slice(0,2)),'defensive victory adds no world turn or RNG');
    await evaluate('s.run.enemies=[];s.run.hero={...s.run.map.exit};globalThis.sessionInventory=s.inventory.items.slice();globalThis.hpBefore=s.run.playerHp;globalThis.chargeBefore=s.inventory.items.filter(i=>i.type===\'battery\').map(i=>i.charge);s.performWorldAction({type:"exit"})');
    await check('[s.run.mode,s.run.playerHp===hpBefore,s.inventory.items.every((i,n)=>i===sessionInventory[n]),s.inventory.items.filter(i=>i.type===\'battery\').map(i=>i.charge)]',['workshop',true,true,await read('chargeBefore')],'UI workshop transition retains HP, charge and instances');
    await evaluate('s.continueWorkshop()');
    await check('s.run.sectorIndex',1,'UI workshop continue loads second sector');
    await evaluate('s.run.requiredBossId=null;s.run.hero={...s.run.map.exit};s.performWorldAction({type:"exit"})');
    await check('[s.run.mode,s.run.workshopFinal,s.canEndTurn()]',['workshop',true,false],'second UI exit opens final workshop');
    await evaluate('s.continueWorkshop()');
    await check('s.run.mode','complete','final workshop finishes demo');
    const oldSeed=await read('s.run.seed');await click(408,576);
    await waitFor("s.run.mode==='exploration'",'NEW RUN button starts a fresh session');
    await check('[s.run.mode,s.run.sectorIndex,s.run.worldTurn,s.run.playerHp,s.inventory.items.length]',['exploration',0,0,100,4],'new run resets resources');
    assert.notEqual(await read('s.run.seed'),oldSeed,`${renderer}: new run chooses another seed`);
    console.log(`PASS ${renderer}: UI controls, four viewports, resize rollback, ground ownership, repeated combat and two-sector completion`);
    await runLocationFeedbackChecks({evaluate,read,check,mouse,click,send,renderer});
}
