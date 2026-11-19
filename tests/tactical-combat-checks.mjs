import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runTacticalCombatChecks({evaluate,read,check,mouse,click,restart,send,renderer}) {
    const original=await read('[window.innerWidth,window.innerHeight]');
    const until=async(expression,label)=>{
        for(let n=0;n<250;n++){if(await read(expression))return;await delay(20);}
        throw Error(`${renderer}: ${label}; last state: ${JSON.stringify(await read('({turn:s.completedTurns,intent:s.combatEngine?.enemyIntent,hint:s.hintText.text})'))}`);
    };
    const ready=()=>until('!s.isProcessingTurn && s.nextAllowedTurnAt===0','combat action cooldown ends');
    const viewport=async(width,height)=>{
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await until(`window.innerWidth===${width}&&window.innerHeight===${height}`,'viewport resize');
        await evaluate('s.applyLayout()');
    };
    const point=expression=>read(`(()=>{const r=${expression};return[r.x+r.width/2,r.y+r.height/2]})()`);
    const itemPoint=definition=>read(`(()=>{const i=s.inventory.items.find(i=>i.definitionId===${JSON.stringify(definition)}),r=s.visualItemsMap.get(i.id).rect;return[r.x+15,r.y+15]})()`);
    const itemClick=async definition=>click(...await itemPoint(definition));
    const action=type=>`(()=>{const selected=s.inventory.items.filter(i=>i.isSelectedForTurn),armorId=selected.find(i=>i.type==='armor')?.id??null;
        return ${JSON.stringify(type)}==='brace'?{type:'brace',armorId}:{type:'attack',weaponId:selected.find(i=>i.type==='weapon')?.id??null,armorId}})()`;
    const state=()=>read(`({hp:s.run.playerHp,enemy:s.combatEngine.enemyHp,turn:s.completedTurns,world:s.run.worldTurn,rng:s.run.rngState,
        intent:s.combatEngine.enemyIntent,tactics:s.combatEngine.enemyTactics,
        items:s.inventory.items.map(i=>[i.id,i.definitionId,i.gridX,i.gridY,i.quarterTurns,i.charge]).sort((a,b)=>a[0].localeCompare(b[0]))})`);
    const turn=async(type,label,double=false)=>{
        await ready();
        const preview=await read(`s.combatEngine.previewAction(${action(type)})`);
        const position=await point(type==='brace'?'s.braceButton.rect':'s.endTurnButton');
        await click(...position);if(double)await click(...position);
        await ready();
        const actual=await read('({log:s.lastTurnLog,hp:s.run.playerHp,enemy:s.combatEngine.enemyHp})');
        for(const key of ['actionType','damageDealt','shieldGenerated','damageTaken','healingRestored','enemyHealingRestored','isUnarmed','enemyAction'])
            assert.deepEqual(actual.log[key],preview[key],`${renderer}/${label}: ${key} matches preview`);
        assert.deepEqual([actual.hp,actual.enemy],[preview.playerHpAfter,preview.enemyHpAfter],label+': HP matches preview');
        return preview;
    };
    const rKey=async()=>{
        for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'r',code:'KeyR',windowsVirtualKeyCode:82});
    };
    try {
        for(const [width,height] of [[1366,650],[1280,620],[1024,640],[800,600]]) {
            const label=`${renderer}/${width}x${height}`;
            await viewport(width,height);await evaluate("prepareScenario('scrap-brute')");await ready();
            await check('[s.combatEngine.enemyHp,s.run.playerHp,s.combatEngine.enemyIntent.type,s.braceButton.enabled]',[66,70,'strike',true],label+': real boss and powered armor');
            await check('[s.groundTitle.text,s.groundStatus.text]',['NEXT ACTION','STRIKE · 14 damage'],label+': visible opening intent');
            const initial=await state();
            for(let n=0;n<3;n++)await read(`s.combatEngine.previewAction(${action('brace')})`);
            assert.deepEqual(await state(),initial,label+': previews are pure');
            const first=await turn('attack',label+': strong hit');
            assert.deepEqual([first.damageDealt,first.shieldGenerated,first.damageTaken],[12,8,6]);
            await check('s.combatEngine.enemyIntent.type','wind-up',label+': strong hit announces WIND-UP');
            await turn('attack',label+': preparation');
            await check('[s.run.playerHp,s.combatEngine.enemyHp,s.combatEngine.enemyIntent.type]',[64,42,'slam'],label+': harmless preparation then SLAM');
            await check('s.braceHint.text','SHIELD 16 · HIT 6\nNo attack. Armor only.',label+': independent brace preview');

            const announced=await state();await rKey();await viewport(width+19,height+13);await viewport(width,height);
            await evaluate('s.game.events.emit("blur");s.game.events.emit("focus")');
            assert.deepEqual(await state(),announced,label+': resize, blur and R preserve committed intent');
            const weaponCharges=await read("s.inventory.items.filter(i=>i.gridX===0&&i.gridY<=1).map(i=>i.charge)");
            await turn('brace',label+': brace and double click',true);
            await check('[s.run.playerHp,s.combatEngine.enemyHp,s.completedTurns,s.combatEngine.enemyTactics.slamCooldown]',[58,42,3,4],label+': brace uses one turn');
            await check("s.inventory.items.filter(i=>i.gridX===0&&i.gridY<=1).map(i=>i.charge)",weaponCharges,label+': no weapon energy during brace');
            await itemClick('makeshift_vest');await check('s.braceButton.enabled',false,label+': no armor blocks brace');
            const refused=await state();await click(...await point('s.braceButton.rect'));
            assert.deepEqual(await state(),refused,label+': refused brace is free');await itemClick('makeshift_vest');
            await turn('attack',label+': first cooldown turn');await turn('attack',label+': second cooldown turn');
            await check('[s.combatEngine.enemyHp,s.combatEngine.enemyIntent.type,s.combatEngine.enemyTactics.slamCooldown]',[18,'repair',2],label+': low HP announces repair');
            await check("s.inventory.items.some(i=>i.type==='battery'&&i.gridX===2&&i.gridY===2)",false,label+': last armor charge removes battery');
            await check('s.braceHint.text','SHIELD 4 · HIT 0\nNo attack. Armor only.',label+': depleted armor uses base shield');
            await check('s.healHint.text','Uses a combat turn.\nEnemy: REPAIR.',label+': healing describes actual intent');
            await itemClick('arc_baton');assert.match(await read('s.hintText.text'),/^UNARMED 2/);
            const beforePunch=await read("s.inventory.items.filter(i=>i.type==='battery').map(i=>i.charge)");
            const punch=await turn('attack',label+': unarmed during repair');
            assert.deepEqual([punch.isUnarmed,punch.damageDealt,punch.shieldGenerated,punch.enemyHealingRestored],[true,2,2,12]);
            await check('[s.combatEngine.enemyHp,s.combatEngine.enemyTactics.repairUsesRemaining,s.combatEngine.enemyTactics.repairCooldown]',[28,1,4],label+': repair resolves and starts cooldown');
            await check("s.inventory.items.filter(i=>i.type==='battery').map(i=>i.charge)",beforePunch,label+': unarmed preserves weapon sources');
            await itemClick('arc_baton');
            for(const cancel of ['edge','blur','resize']) {
                const before=await state(),grab=await itemPoint('arc_baton');
                await mouse('mousePressed',...grab);await mouse('mouseMoved',grab[0]+25,grab[1]);
                await check('[!!s.activeDrag,s.braceButton.enabled,s.canEndTurn()]',[true,false,false],label+': drag blocks actions');
                await rKey();
                if(cancel==='edge') {await mouse('mouseMoved',763,270);await mouse('mouseReleased',763,270);}
                if(cancel==='blur') {await evaluate('s.game.events.emit("blur");s.game.events.emit("focus")');await mouse('mouseReleased',...grab);}
                if(cancel==='resize') {await viewport(width+19,height+13);await mouse('mouseReleased',...grab);await viewport(width,height);}
                assert.deepEqual(await state(),before,label+': '+cancel+' restores ownership/orientation and preserves tactics');
                await check("s.inventory.items.find(i=>i.definitionId==='arc_baton').isSelectedForTurn",false,label+': drag clears selection');
                assert.match(await read('s.hintText.text'),/^UNARMED /);await itemClick('arc_baton');
            }
            await check('s.combatEngine.previewAction('+action('attack')+').isUnarmed',false,label+': selection restores weapon attack');
            const directory=join(process.cwd(),'artifacts','tactical-combat');await mkdir(directory,{recursive:true});
            await mouse('mouseMoved',20,20);
            const shot=await send('Page.captureScreenshot',{format:'png',clip:await read('(()=>{const r=s.game.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()')});
            await writeFile(join(directory,`${renderer}-${width}x${height}.png`),Buffer.from(shot.data,'base64'));
        }
        await evaluate('s.startNewRun()');
        await check('[s.run.mode,s.combatEngine,s.braceButton.rect.visible,s.enemyIntentText.visible]',['exploration',null,false,false],'NEW RUN clears tactical UI and encounter');
        await evaluate("prepareScenario('scrap-brute')");
        await check('s.combatEngine.enemyTactics',{repairUsesRemaining:2,repairCooldown:0,slamCooldown:0},'new boss resets tactics');
    } finally {await viewport(...original);await restart();}
    console.log(`PASS ${renderer}: tactical boss, BRACE, UNARMED, cooldowns, cancellations and four viewports`);
}
