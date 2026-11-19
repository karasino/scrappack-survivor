import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Real generated maps and ordinary input. No teleports, enemy removal or resource injection.
export async function runGeneratedSectorChecks({evaluate,read,check,mouse,click,send,renderer}) {
    const until=async(expression,label)=>{
        for(let i=0;i<120;i++){if(await read(expression))return;await delay(25)}
        throw Error(`${renderer}: ${label}; state=${JSON.stringify(await read('({mode:s.run.mode,hero:s.run.hero,turn:s.run.worldTurn,hp:s.run.playerHp,messages:s.messages})'))}`);
    };
    const key=async(key,code,v)=>{
        await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:v});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:v});
    };
    const button=async expression=>{
        const point=await read(`(()=>{const r=${expression}.getBounds();return[r.centerX,r.centerY]})()`);
        await click(...point);
    };
    const viewport=async(width,height)=>{
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await delay(100);await evaluate('s.applyLayout()');
    };
    const capture=async name=>{
        const directory=join(process.cwd(),'artifacts','sectors');await mkdir(directory,{recursive:true});
        const clip=await read('(()=>{const r=s.game.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()');
        const shot=await send('Page.captureScreenshot',{format:'png',clip});
        await writeFile(join(directory,`${renderer}-${name}.png`),Buffer.from(shot.data,'base64'));
    };
    const layout='JSON.stringify([s.run.map,s.run.enemies,s.run.lootPoints,s.run.blueprintCaches,s.run.aidStations])';
    const carry='JSON.stringify([s.run.playerHp,s.inventory.items.map(i=>[i.id,i.gridX,i.gridY,i.quarterTurns,i.charge,i.isSelectedForTurn]),s.run.materials,s.run.knownRecipes])';
    await viewport(1366,650);await evaluate('freshRun(123)');
    const initial=await read(layout);
    await evaluate('freshRun(124)');assert.notEqual(await read(layout),initial,`${renderer}: different seeds vary placement`);
    await evaluate('freshRun(123)');await check(layout,initial,'same seed restores actual generated map and objects');
    await check('s.run.map.rows',await read('(async()=>(await import("/src/game/core/SectorGenerator.ts")).generateSector(123,0).rows)()'),'ordinary RunState uses the generator');
    await check('[s.mapView.labels[56].text,s.mapView.labels[7].text]',['P','X'],'generated start and exit rendered in original corners');
    const enemies=await read('s.run.enemies.map(({x,y,name})=>({x,y,name}))');
    for(const enemy of enemies){
        await mouse('mouseMoved',824+enemy.x*50+25,150+enemy.y*50+25);
        await check('s.enemyNameText.text',enemy.name,'hover matches generated enemy position');
    }
    await capture('first-start');

    for(const [width,height] of [[1280,620],[1024,640],[800,600]]){
        await viewport(width,height);await check(layout,initial,'generated layout survives resize '+width);
        await check('[s.run.worldTurn,s.run.rngState]',[0,123],'resize preserves world and RNG');
        if(width<1280){await key('b','KeyB',66);await key('b','KeyB',66);await check(layout,initial,'B preserves generated map')}
    }
    await viewport(1366,650);
    const armor=await read('s.inventory.items.find(i=>i.type==="armor").id');
    const origin=await read(`(()=>{const r=s.visualItemsMap.get(${JSON.stringify(armor)}).rect;return[r.x+10,r.y+10]})()`);
    const beginDrag=async()=>{
        await mouse('mouseMoved',...origin);await mouse('mousePressed',...origin);await mouse('mouseMoved',origin[0]+15,origin[1]);
        await key('r','KeyR',82);
    };
    await beginDrag();await mouse('mouseMoved',650,250);await mouse('mouseReleased',650,250);
    await check(`(()=>{const i=s.inventory.items.find(i=>i.id===${JSON.stringify(armor)});return[i.gridX,i.gridY,i.quarterTurns,i.isSelectedForTurn,s.run.draggedItem===null]})()`,[1,0,0,false,true],'panel-edge refusal restores rotated armor and clears selection');
    await beginDrag();await evaluate('s.game.events.emit("blur");s.game.events.emit("focus")');await mouse('mouseReleased',...origin);
    await check('s.run.draggedItem===null',true,'blur cancels a generated-run drag');
    await beginDrag();await viewport(1024,640);await mouse('mouseReleased',...origin);
    await check('s.run.draggedItem===null',true,'resize cancels a generated-run drag');
    await check(layout,initial,'cancelled drags preserve generated world');
    await check('[s.run.worldTurn,s.run.rngState]',[0,123],'drag, R and cancellation are free');

    await viewport(1366,650);await evaluate('freshRun(123)');
    await click(824+75,150+375);
    await check('[s.run.hero,s.run.worldTurn]',[{x:1,y:7},1],'adjacent click moves on generated terrain');
    await key('a','KeyA',65);
    const beforeReject=await read('JSON.stringify([s.run.hero,s.run.worldTurn,s.run.rngState])');
    await key('a','KeyA',65);
    await check('JSON.stringify([s.run.hero,s.run.worldTurn,s.run.rngState])',beforeReject,'boundary refusal is free on generated map');

    const settle=async()=>{
        for(let i=0;i<16&&await read('s.run.mode==="combat"');i++){
            await until('s.canEndTurn()','END TURN becomes available');
            const turns=await read('s.completedTurns');await button('s.endTurnButton');
            await until(`s.completedTurns>${turns}||s.run.mode!=="combat"`,'real attack resolves');
        }
        assert.notEqual(await read('s.run.mode'),'defeat',`${renderer}: generated UI route survives`);
        assert.notEqual(await read('s.run.mode'),'combat',`${renderer}: battle finishes within limit`);
    };
    const travel=async target=>{
        for(let n=0;n<160;n++){
            if(await read(`s.run.hero.x===${target.x}&&s.run.hero.y===${target.y}`))return;
            await until('!s.hasOverlay()','world controls unblocked');
            const d=await read(`(()=>{
                const q=[{p:s.run.hero,first:null}],seen=new Set([s.run.hero.x+','+s.run.hero.y]);
                for(let h=0;h<q.length;h++){
                    const {p,first}=q[h];if(p.x===${target.x}&&p.y===${target.y})return first;
                    for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){
                        const next={x:p.x+dx,y:p.y+dy},k=next.x+','+next.y;
                        if(s.run.isWalkable(next)&&!seen.has(k)){seen.add(k);q.push({p:next,first:first??{dx,dy}})}
                    }
                }return null;
            })()`);
            assert.ok(d,`${renderer}: reachable generated destination`);
            const t=await read('s.run.worldTurn');
            if(d.dx===1)await key('d','KeyD',68);else if(d.dx===-1)await key('a','KeyA',65);
            else if(d.dy===1)await key('s','KeyS',83);else await key('w','KeyW',87);
            await check('s.run.worldTurn',t+1,'real key moves or initiates combat on generated map');
            await settle();
        }
        throw Error(`${renderer}: generated route exceeded move limit`);
    };
    await travel(await read('s.run.blueprintCaches[0]'));
    const openedAt=await read('s.run.worldTurn');await key('e','KeyE',69);await settle();
    await check('[s.blueprintChoice.visible,s.run.worldTurn]',[true,openedAt+1],'E opens cache at generated position');
    const offers=await read('JSON.stringify(s.run.activeBlueprintChoice.offers)');await capture('blueprint');
    await button('s.blueprintChoice.closeButton.rect');await until('!s.hasOverlay()','CLOSE completes');
    await key('e','KeyE',69);await check('JSON.stringify(s.run.activeBlueprintChoice.offers)',offers,'generated cache reopens without reroll');
    await key('Escape','Escape',27);await until('!s.hasOverlay()','Escape completes');await key('e','KeyE',69);
    await button('s.blueprintChoice.learnButtons[0].rect');await until('!s.hasOverlay()','LEARN completes');
    await check('[s.run.knownRecipes.length,s.run.worldTurn]',[5,openedAt+1],'LEARN and repeated openings are free');

    for(const point of await read('s.run.lootPoints')){
        await travel(point);await key('e','KeyE',69);await settle();
        await check(`s.run.lootPoints.find(p=>p.id===${JSON.stringify(point.id)}).searched`,true,'SEARCH works at generated loot position');
        for(let i=0;i<8&&await read('s.takeMaterialButton.rect.visible&&s.takeMaterialButton.enabled');i++){
            const world=await read('[s.run.worldTurn,s.run.rngState]');await button('s.takeMaterialButton.rect');
            await check('[s.run.worldTurn,s.run.rngState]',world,'TAKE on generated map is free');
        }
    }
    await travel(await read('s.run.map.exit'));const carried=await read(carry);
    await key('e','KeyE',69);await check('s.run.mode','workshop','generated exit opens WORKSHOP');
    await button('s.workshopView.continueButton.rect');
    await check('[s.run.sectorIndex,s.run.worldTurn,s.run.mode]',[1,0,'exploration'],'CONTINUE loads generated second sector');
    await check(carry,carried,'generated sector transition preserves HP, item identity, charge, selection and recipes');
    await check('s.run.map.rows',await read('(async()=>(await import("/src/game/core/SectorGenerator.ts")).generateSector(123,1).rows)()'),'second sector matches seed independently of first route');
    await travel(await read('s.run.aidStations[0]'));const hp=await read('s.run.playerHp'),turn=await read('s.run.worldTurn');
    assert.ok(hp<100,`${renderer}: earned damage enables station`);
    await key('e','KeyE',69);await settle();
    await check('[s.run.aidStations[0].used,s.run.worldTurn]',[true,turn+1],'generated First Aid Station heals once and spends a turn');
    await check('s.run.playerHp',Math.min(100,hp+30),'station restores capped health on generated map');
    const used=await read('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.playerHp])');await key('e','KeyE',69);
    await check('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.playerHp])',used,'used generated station refuses for free');
    await capture('second-station');
    console.log(`PASS ${renderer}: generated terrain, actual movement/combat/cache/SEARCH/TAKE/station, preserved transition, drag/R/resize/blur`);
}
