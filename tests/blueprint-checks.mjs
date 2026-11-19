import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function runBlueprintChecks({evaluate,read,check,mouse,click,send,renderer}) {
    const until=async(expression)=>{for(let i=0;i<100;i++){if(await read(expression))return;await delay(30)}throw Error('Timed out: '+expression)};
    const button=async expression=>{const p=await read(`(()=>{const r=${expression}.rect;return[r.x+r.width/2,r.y+r.height/2]})()`);await click(...p)};
    const key=async(key,code,v)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:v});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:v})};
    const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(120);await evaluate('s.applyLayout()')};
    const itemPoint=async id=>read(`(()=>{const r=s.visualItemsMap.get(${JSON.stringify(id)}).rect;return[r.x+10,r.y+10]})()`);
    const hoverItem=async id=>{
        await mouse('mouseMoved',20,580);await until('!s.itemTooltip.visible');
        const point=await itemPoint(id);await mouse('mouseMoved',...point);
        await until('s.itemTooltip.visible');
        return point;
    };
    const capture=async name=>{
        const directory=join(process.cwd(),'artifacts','blueprints');await mkdir(directory,{recursive:true});
        const clip=await read('(()=>{const r=s.game.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()');
        const shot=await send('Page.captureScreenshot',{format:'png',clip});await writeFile(join(directory,`${renderer}-${name}.png`),Buffer.from(shot.data,'base64'));
    };
    await evaluate('freshAuthoredRun(123)');await viewport(1366,650);
    await check('s.inventory.items.map(i=>[i.definitionId,i.gridX,i.gridY,i.powerMode])',[
        ['dagger',0,0,'none'],['combat_bra',1,0,'none'],['weak_battery',0,1,'none'],['medkit',1,1,'none']], 'physical start positions');
    await check('s.inventory.items.filter(i=>i.type==="weapon"||i.type==="armor").every(i=>i.isSelectedForTurn&&!i.isPowered)',true,'physical equipment selected without connection');
    await evaluate('s.run.enemies=[];s.updateCombatUI()');
    await key('d','KeyD',68);await key('w','KeyW',87);await key('e','KeyE',69);
    await check('[s.blueprintChoice.visible,s.run.worldTurn,s.run.knownRecipes.length]',[true,3,4],'E opens real cache and spends one turn');
    const offers=await read('JSON.stringify(s.run.activeBlueprintChoice.offers)');const frozen=await read('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.hero,s.inventory.items.map(i=>i.quarterTurns)])');
    for(const [width,height] of [[1366,650],[1280,620],[1024,640],[800,600]]) {
        await viewport(width,height);await key('d','KeyD',68);await key('r','KeyR',82);await key('e','KeyE',69);await key('b','KeyB',66);
        await check('JSON.stringify(s.run.activeBlueprintChoice.offers)',offers,'offers survive viewport '+width);
        await check('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.hero,s.inventory.items.map(i=>i.quarterTurns)])',frozen,'modal blocks keys '+width);
        await check('s.blueprintChoice.details.every(t=>t.getBounds().bottom<s.blueprintChoice.learnButtons[0].rect.y)',true,'complete price and properties fit above buttons '+width);
        await capture('choice-'+width);
    }
    await evaluate('s.game.events.emit("blur");s.game.events.emit("focus")');
    await check('JSON.stringify(s.run.activeBlueprintChoice.offers)',offers,'blur preserves modal');
    await button('s.blueprintChoice.closeButton');await button('s.blueprintChoice.closeButton');
    await check('[s.blueprintChoice.visible,s.run.worldTurn]',[false,3],'CLOSE and repeated click do not spend turn');
    await until('!s.hasOverlay()');await key('e','KeyE',69);
    await check('JSON.stringify(s.run.activeBlueprintChoice.offers)',offers,'free reopen preserves exact offers');
    await key('Escape','Escape',27);await until('!s.hasOverlay()');await key('e','KeyE',69);
    await check('s.blueprintChoice.visible',true,'Escape permits reopening the postponed choice');
    const count=await read('s.inventory.items.length');await button('s.blueprintChoice.learnButtons[0]');await button('s.blueprintChoice.learnButtons[0]');
    await check('[s.run.knownRecipes.length,s.inventory.items.length,s.blueprintChoice.visible,s.run.worldTurn]',[5,count,false,3],'LEARN grants one recipe and repeated click cannot grant item');
    await until('!s.hasOverlay()');await viewport(1366,650);
    await evaluate('s.run.hero={...s.run.map.exit};s.performWorldAction({type:"exit"});Object.assign(s.run.materials,{metal:3,electronics:2,fabric:0});s.updateCombatUI()');
    await button('s.workshopView.nextButton');await button('s.workshopView.rows[0]');
    await check('s.workshopView.details.text.includes("Sharp")&&s.workshopView.details.text.includes("Reckless")',true,'workshop describes exact learned variant');
    await button('s.workshopView.craftButton');
    await check('[s.run.workshopItems.length,s.run.materials.metal,s.run.materials.electronics]',[1,0,0],'variant crafts onto bench with base price');
    const saved=await read('JSON.stringify(s.run.workshopItems[0].variant)');const id=await read('s.run.workshopItems[0].id');
    await check('s.run.workshopItems[0].definitionId','arc_baton','seed 123 reproduces crafted powered weapon tooltip');
    const origin=await hoverItem(id);
    await check('s.itemTooltip.labels.filter(l=>l.visible).length',9,'BENCH Arc Baton renders title, type, five stats and both traits');
    await check('s.itemTooltip.labels.filter(l=>l.visible).slice(-2).map(l=>l.text)',
        ['Sharp: Damage +3','Reckless: Shield -1'],'crafted Arc Baton tooltip includes both properties');
    await mouse('mousePressed',...origin);await mouse('mouseMoved',origin[0]+15,origin[1]);await key('r','KeyR',82);
    await mouse('mouseMoved',650,250);await mouse('mouseReleased',650,250);
    await check(`JSON.stringify(s.run.workshopItems.find(i=>i.id===${JSON.stringify(id)}).variant)`,saved,'invalid drop and rotation preserve variant');
    await check(`s.run.workshopItems.find(i=>i.id===${JSON.stringify(id)}).quarterTurns`,0,'invalid header drop restores orientation');
    const benchPoint=await itemPoint(id);
    const packPoint=await read('[s.gridStartX+2*s.cellSize+10,s.gridStartY+s.cellSize+10]');
    await mouse('mouseMoved',...benchPoint);await mouse('mousePressed',...benchPoint);
    await mouse('mouseMoved',benchPoint[0]+15,benchPoint[1]);
    await mouse('mouseMoved',...packPoint);await mouse('mouseReleased',...packPoint);
    await check(`(()=>{const i=s.inventory.items.find(i=>i.id===${JSON.stringify(id)});return[i?.gridX,i?.gridY,i?.isPowered]})()`,
        [2,1,false],'drag after tooltip places Arc Baton away from its battery');
    await hoverItem(id);
    await check('s.itemTooltip.labels.filter(l=>l.visible).length',10,'unpowered Arc Baton renders all stats, warning and both traits');
    await check('s.itemTooltip.labels.filter(l=>l.visible).slice(-3).map(l=>l.text)',
        ['! No compatible power source.','Sharp: Damage +3','Reckless: Shield -1'],'warning does not displace either property');
    await check('s.itemTooltip.labels.every(l=>l.parentContainer===s.itemTooltip.container)',true,'all pooled tooltip labels belong to the tooltip container');
    await evaluate('globalThis.blueprintTooltipPool=[...s.itemTooltip.labels];globalThis.blueprintTooltipChildren=s.itemTooltip.container.length');
    const daggerId=await read('s.inventory.items.find(i=>i.definitionId==="dagger").id');
    const batteryId=await read('s.inventory.items.find(i=>i.definitionId==="weak_battery").id');
    await hoverItem(daggerId);
    await check('s.itemTooltip.labels.filter(l=>l.visible).length',5,'short physical tooltip hides surplus pooled labels');
    await check('s.itemTooltip.labels.filter(l=>l.visible).some(l=>/Sharp|Reckless|compatible power/.test(l.text))',false,'short tooltip has no stale properties or warning');
    await hoverItem(batteryId);
    await check('[s.itemTooltip.labels.filter(l=>l.visible).length,s.itemTooltip.chargeGraphics.commandBuffer.length>0]',[5,true],'battery tooltip retains charge percentage and bar');
    await hoverItem(id);
    await check('[s.itemTooltip.labels.filter(l=>l.visible).length,s.itemTooltip.chargeGraphics.commandBuffer.length]',[10,0],'returning to long weapon tooltip clears the battery bar');
    await check('s.itemTooltip.labels.length===blueprintTooltipPool.length&&s.itemTooltip.labels.every((l,i)=>l===blueprintTooltipPool[i])&&s.itemTooltip.container.length===blueprintTooltipChildren',true,'repeated tooltip layouts reuse labels without growing the container');
    await click(...packPoint);
    await check(`s.inventory.items.find(i=>i.id===${JSON.stringify(id)}).isSelectedForTurn`,true,'real click selects Arc Baton after repeated long tooltip layouts');
    await evaluate('s.run.continueFromWorkshop();s.updateCombatUI()');
    await check('[s.run.knownRecipes.length,s.run.blueprintCaches.length]',[5,0],'sector transition retains recipes and discards unchosen offers');
    await evaluate('freshAuthoredRun(123)');assert.equal(await read('s.run.knownRecipes.length'),4,'new run resets knowledge');
    console.log(`PASS ${renderer}: blueprints, modal input, four viewports, learn/craft ownership and reset`);
}
