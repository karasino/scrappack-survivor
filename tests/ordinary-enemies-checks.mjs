import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runOrdinaryEnemyChecks({evaluate,read,check,mouse,click,restart,send,renderer}) {
    const original=await read('[window.innerWidth,window.innerHeight]');
    const until=async(expression)=>{for(let n=0;n<200;n++){if(await read(expression))return;await delay(20);}throw Error('Ordinary enemies timeout: '+expression);};
    const ready=()=>until('!s.isProcessingTurn && s.nextAllowedTurnAt===0');
    const viewport=async(width,height)=>{
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await until(`window.innerWidth===${width}&&window.innerHeight===${height}`);await evaluate('s.applyLayout()');
    };
    const point=expression=>read(`(()=>{const r=${expression};return[r.x+r.width/2,r.y+r.height/2]})()`);
    const itemPoint=()=>read("(()=>{const i=s.inventory.items.find(i=>i.definitionId==='dagger'),r=s.visualItemsMap.get(i.id).rect;return[r.x+15,r.y+15]})()");
    const key=async(key,code,virtual)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:virtual});};
    const state=()=>read(`({hp:s.run.playerHp,poison:s.run.playerPoisonTurns,world:s.run.worldTurn,rng:s.run.rngState,turn:s.completedTurns,
        enemy:s.combatEngine.enemyHp,intent:s.combatEngine.enemyIntent,cd:s.combatEngine.abilityCooldown,
        items:s.inventory.items.map(i=>[i.id,i.gridX,i.gridY,i.quarterTurns,i.charge]).sort((a,b)=>a[0].localeCompare(b[0]))})`);
    const action=type=>`(()=>{const selected=s.inventory.items.filter(i=>i.isSelectedForTurn),armorId=selected.find(i=>i.type==='armor')?.id??null;
        return ${JSON.stringify(type)}==='heal'?{type:'heal',consumableId:s.run.findMedkit().id,armorId}:
            ${JSON.stringify(type)}==='brace'?{type:'brace',armorId}:{type:'attack',weaponId:selected.find(i=>i.type==='weapon')?.id??null,armorId}})()`;
    const turn=async(type,double=false)=>{
        await ready();const preview=await read(`s.combatEngine.previewAction(${action(type)})`),before=await read('s.completedTurns');
        const target=await point(type==='attack'?'s.endTurnButton':type==='brace'?'s.braceButton.rect':'s.healButton.rect');
        await click(...target);if(double)await click(...target);await ready();
        const {playerHpAfter,enemyHpAfter,poisonTurnsAfter,plan,...expected}=preview;
        await check('s.lastTurnLog',expected,'ordinary enemy action equals full preview');
        await check('[s.run.playerHp,s.combatEngine.enemyHp,s.run.playerPoisonTurns,s.completedTurns]',
            [playerHpAfter,enemyHpAfter,poisonTurnsAfter,before+1],'ordinary enemy HP, poison and single action');
    };
    const capture=async(label,width,height)=>{
        const directory=join(process.cwd(),'artifacts','ordinary-enemies');await mkdir(directory,{recursive:true});
        await mouse('mouseMoved',20,20);
        const shot=await send('Page.captureScreenshot',{format:'png',clip:await read('(()=>{const r=s.game.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()')});
        await writeFile(join(directory,`${renderer}-${width}x${height}-${label}.png`),Buffer.from(shot.data,'base64'));
    };
    try {
        for(const [width,height]of [[1366,650],[1280,620],[1024,640],[800,600]]) {
            await viewport(width,height);await evaluate("prepareScenario('rat-gnaw')");await ready();
            await turn('brace');
            await check('[s.groundStatus.text,s.combatEngine.abilityCooldown]',['GNAW · 5 damage',0],'rat announces gnaw');
            await capture('gnaw',width,height);
            await turn('brace',true);
            await check('[s.run.playerHp,s.combatEngine.abilityCooldown,s.inventory.items.filter(i=>i.type==="battery").map(i=>i.charge)]',[70,3,[4,2]],'full block still loses reserve charge');
            assert.match(await read('s.messages.join("\\n")'),/GNAW: Weak Battery CHARGE -1/);
            for(const cancel of ['edge','blur','resize']) {
                const before=await state(),grab=await itemPoint();
                await mouse('mousePressed',...grab);await mouse('mouseMoved',grab[0]+25,grab[1]);await key('r','KeyR',82);
                await check('[!!s.activeDrag,s.braceButton.enabled,s.healButton.enabled,s.canEndTurn()]',[true,false,false,false],'drag blocks all combat actions');
                if(cancel==='edge'){await mouse('mouseMoved',763,270);await mouse('mouseReleased',763,270);}
                if(cancel==='blur'){await evaluate('s.game.events.emit("blur");s.game.events.emit("focus")');await mouse('mouseReleased',...grab);}
                if(cancel==='resize'){await viewport(width+19,height+13);await mouse('mouseReleased',...grab);await viewport(width,height);}
                assert.deepEqual(await state(),before,'cancel preserves charge, poison, cooldown and orientation');
                await check("s.inventory.items.find(i=>i.definitionId==='dagger').isSelectedForTurn",false,'drag clears selection');
                await click(...await itemPoint());
            }
            await turn('attack');await check('s.combatEngine.abilityCooldown',2,'attack advances cooldown');
            await turn('heal');await check('s.combatEngine.abilityCooldown',1,'healing advances cooldown');
            await turn('brace');await check('[s.combatEngine.abilityCooldown,s.combatEngine.enemyIntent.type]',[0,'gnaw'],'three full intervening responses');
            await turn('brace');await check('[s.combatEngine.abilityCooldown,s.lastTurnLog.batteryChargeDrained]',[3,1],'sixth response gnaws again');

            await evaluate("prepareScenario('scorpion-poison')");await ready();await turn('brace');
            await check('s.groundStatus.text','VENOM STING · 8 damage','scorpion announces sting');
            await check('s.enemyIntentText.height<=76 && s.enemyIntentText.y+s.enemyIntentText.height<=s.enemyTacticsText.y',true,'special description fits before cooldown');
            await capture('sting',width,height);await turn('brace');
            await check('[s.run.playerHp,s.run.playerPoisonTurns,s.poisonText.visible,s.poisonText.text,s.healButton.enabled,s.healButton.label.text]',
                [100,3,true,'POISON 2 HP x 3',true,'HEAL / CURE (2)'],'full shield does not prevent poison; full HP cure available');
            assert.match(await read('s.hintText.text'),/HEAL 0 · RECOIL 0 · HIT 0/,'poison preview retains healing and recoil');
            await check('s.hintText.getBounds().bottom+6<=s.endTurnButton.getBounds().top',true,'full preview fits above action button');
            const poisoned=await state(),grab=await itemPoint();
            await mouse('mousePressed',...grab);await mouse('mouseMoved',grab[0]+25,grab[1]);await key('r','KeyR',82);
            await evaluate('s.game.events.emit("blur");s.game.events.emit("focus")');await mouse('mouseReleased',...grab);
            await viewport(width===800?1366:800,600);await viewport(width,height);
            assert.deepEqual(await state(),poisoned,'active poison and cooldown survive drag, R, blur and layout change');
            await check('s.poisonText.visible',true,'poison remains visible after layout change');
            await click(...await itemPoint());
            await capture('poison',width,height);await turn('heal',true);
            await check('[s.run.playerHp,s.run.playerPoisonTurns,s.poisonText.visible,s.combatEngine.abilityCooldown,s.run.findMedkit()!==null]',[100,0,false,2,true],'one medkit cures with zero HP restored');

            await evaluate("prepareScenario('scorpion-poison')");await ready();
            for(let n=0;n<5;n++)await turn('brace');
            await check('[s.run.playerHp,s.run.playerPoisonTurns,s.combatEngine.enemyIntent.type,s.inventory.items.some(i=>i.type==="battery")]',[94,0,'venom-sting',false],'poison expires and last armor charge depletes');
            assert.match(await read('s.healHint.text'),/STING applies poison/);
            await turn('heal');await check('[s.run.playerHp,s.run.playerPoisonTurns,s.combatEngine.abilityCooldown]',[94,3,3],'sting after healing reapplies poison with base armor');

            await evaluate("prepareScenario('scorpion-poison')");await ready();
            for(let n=0;n<4;n++)await turn('attack');
            await check('[s.run.mode,s.run.playerHp,s.run.playerPoisonTurns,s.poisonText.visible]',['exploration',96,1,true],'victory retains remaining poison');
            await check('s.hintText.y',482,'exploration restores preview position');
            if(await read('s.compact')){
                await key('b','KeyB',66);await check('[s.run.playerHp,s.run.playerPoisonTurns,s.poisonText.visible]',[96,1,true],'compact backpack preserves and displays active poison');
                await key('b','KeyB',66);
            }
            // Initial sting on turn 2 ticks on turns 3/4; cooldown prevents another sting on turn 4.
            await key(' ','Space',32);await until('s.run.worldTurn===1');
            await check('[s.run.playerHp,s.run.playerPoisonTurns,s.poisonText.visible]',[94,0,false],'world wait consumes exactly the remaining poison tick');
        }
        await evaluate('s.startNewRun()');await check('[s.run.playerPoisonTurns,s.poisonText.visible]',[0,false],'new run clears poison UI');
    } finally {await viewport(...original);await restart();}
    console.log(`PASS ${renderer}: ordinary enemy cooldowns, gnaw, poison/cure, world persistence, gestures and four viewports`);
}
