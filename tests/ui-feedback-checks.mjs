import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function captureFeedback({read,send,renderer,mouse},name){
    // A capture should show the panel state, rather than a delayed tooltip from
    // the preceding drag gesture covering another item's caption.
    await mouse?.('mouseMoved',20,580);
    await delay(50);
    const directory=join(process.cwd(),'artifacts','ui-feedback');
    await mkdir(directory,{recursive:true});
    const clip=await read('(()=>{const r=s.game.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()');
    const shot=await send('Page.captureScreenshot',{format:'png',clip});
    await writeFile(join(directory,renderer+'-'+name+'.png'),Buffer.from(shot.data,'base64'));
    return shot.data;
}

export async function runItemFeedbackChecks(context){
    const {evaluate,read,check,mouse,click,restart,send,renderer}=context;
    await restart();
    await evaluate("seed([{type:'battery',id:'feedback-source',name:'',x:0,y:1,charge:0},{type:'weapon',id:'feedback-gun',name:'',definitionId:undefined,x:1,y:1,width:2,height:1,requiredVoltage:'low'},{type:'armor',id:'feedback-armor',name:'',definitionId:undefined,x:0,y:2,width:2,height:1}]);s.hideTooltip()");
    const states=()=>read("['feedback-gun','feedback-armor'].map(id=>{const v=s.visualItemsMap.get(id);return[v.rect.isStroked,v.powerGraphics.commandBuffer.length>0,v.selectionGraphics.commandBuffer.length>0]})");
    const pixelState=async(name)=>{
        await mouse('mouseMoved',20,20);
        const data=await captureFeedback(context,name);
        return evaluate('(async()=>{const source=new Image();source.src="data:image/png;base64,'+data+'";await source.decode();'+
            'const canvas=document.createElement("canvas");canvas.width=s.scale.width;canvas.height=s.scale.height;'+
            'const ctx=canvas.getContext("2d");ctx.drawImage(source,0,0,canvas.width,canvas.height);'+
            'const rects=["feedback-gun","feedback-armor"].map(id=>s.visualItemsMap.get(id).rect);'+
            'const isColor=(x,y,color)=>{const p=ctx.getImageData(x,y,1,1).data;return color.every((v,i)=>Math.abs(p[i]-v)<12)};'+
            'const inside=(r,x,y)=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height;'+
            'let outsideGold=0;const minX=Math.min(...rects.map(r=>r.x))-4,maxX=Math.max(...rects.map(r=>r.x+r.width))+4,'+
            'minY=Math.min(...rects.map(r=>r.y))-4,maxY=Math.max(...rects.map(r=>r.y+r.height))+4;'+
            'for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++)if(!rects.some(r=>inside(r,x,y))&&isColor(x,y,[201,170,114]))outsideGold++;'+
            'const items=rects.map(r=>{let bolt=0,gold=0;for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++){'+
            'if(isColor(x,y,[201,170,114]))gold++;if(x>=r.x+r.width-20&&y<r.y+24&&isColor(x,y,[128,180,162]))bolt++;}return{bolt:bolt>0,selection:gold>0}});'+
            'let contactGold=0;for(let x=258;x<292;x++)for(const y of [249,250])if(isColor(x,y,[201,170,114]))contactGold++;'+
            'return{items,outsideGold,contactGold}})()');
    };
    assert.deepEqual(await states(),[[false,false,false],[false,false,false]],renderer+': neutral consumers have neither border nor bolt');
    let pixels=await pixelState('unselected-unpowered');
    assert.deepEqual(pixels.items,[{bolt:false,selection:false},{bolt:false,selection:false}],renderer+': neutral state pixels');
    await click(275,225);
    pixels=await pixelState('selected-unpowered');
    assert.deepEqual(pixels.items,[{bolt:false,selection:true},{bolt:false,selection:false}],renderer+': selection without available power');
    assert.equal(pixels.outsideGold,0,renderer+': selected outline stays inside');
    await click(275,225);
    await evaluate("s.visualItemsMap.get('feedback-source').itemModel.charge=10;s.refreshPowerGrid();s.updateCombatUI()");
    pixels=await pixelState('unselected-powered');
    assert.deepEqual(pixels.items,[{bolt:true,selection:false},{bolt:true,selection:false}],renderer+': power is a bolt without selected frame');
    await click(275,225);await click(225,275);
    pixels=await pixelState('adjacent-powered-selected');
    assert.deepEqual(await states(),[[false,true,true],[false,true,true]],renderer+': adjacent selected powered consumers have independent states');
    assert.deepEqual(pixels.items,[{bolt:true,selection:true},{bolt:true,selection:true}],renderer+': both bolts and selected outlines render');
    assert.equal(pixels.outsideGold,0,renderer+': adjacent frames never spill outside occupied bounds');
    assert.equal(pixels.contactGold,0,renderer+': touching items retain an unpainted boundary');
    await evaluate("s.visualItemsMap.get('feedback-source').itemModel.charge=0.5;s.updateCombatUI()");
    pixels=await pixelState('selected-insufficient-charge');
    await check("['feedback-gun','feedback-armor'].map(id=>s.visualItemsMap.get(id).itemModel.isPowered)",[true,true],'physical connection remains with insufficient charge');
    assert.deepEqual(pixels.items,[{bolt:false,selection:true},{bolt:false,selection:true}],renderer+': insufficient charge hides both bolts and retains selection');
    await evaluate("s.visualItemsMap.get('feedback-source').itemModel.charge=10;s.updateCombatUI()");
    await mouse('mousePressed',275,225);await mouse('mouseMoved',290,225);
    await check("s.visualItemsMap.get('feedback-gun').powerGraphics.commandBuffer.length",0,'dragging disconnected item clears power badge');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
    await mouse('mouseMoved',275,175);await mouse('mouseReleased',275,175);await delay(50);
    await check("(()=>{const v=s.visualItemsMap.get('feedback-gun'),i=v.itemModel;return[i.gridX,i.gridY,i.width,i.height,i.quarterTurns,v.powerGraphics.commandBuffer.length>0,v.rect.isStroked]})()",
        [1,0,1,2,1,true,false],'rotated and moved item restores its top-right power badge');
    pixels=await pixelState('rotated-powered');
    assert.equal(pixels.items[0].bolt,true,renderer+': bolt follows new rotated bounds in rendered output');
    await evaluate("s.run.mode='exploration';s.backpackView=false;s.applyLayout()");
    await check("['feedback-gun','feedback-armor'].map(id=>{const v=s.visualItemsMap.get(id);return[v.rect.visible,v.powerGraphics.visible,v.selectionGraphics.visible]})",[[false,false,false],[false,false,false]],'compact hidden backpack hides all indicators');
    await evaluate('s.backpackView=true;s.applyLayout()');
    await check("s.visualItemsMap.get('feedback-gun').powerGraphics.visible",true,'revealed backpack restores badge visibility');
    await evaluate("seed([{type:'battery',id:'label-source',name:'',x:3,y:4,charge:0},{type:'armor',id:'label-armor',name:'Makeshift Vest',definitionId:undefined,x:4,y:4}])");
    const labelLayout=await read("(()=>{const t=s.visualItemsMap.get('label-armor').text;return[t.text,t.width,t.height,t.style.wordWrapWidth]})()");
    await check("(()=>{const v=s.visualItemsMap.get('label-armor');return v.text.getBounds().right<=v.rect.x+v.rect.width-uiTheme.item.powerBadge.margin-uiTheme.item.powerBadge.width})()",true,'consumer placeholder reserves a permanent strip for power badge');
    await evaluate("s.visualItemsMap.get('label-source').itemModel.charge=5;s.refreshPowerGrid();s.updateCombatUI()");
    await check("(()=>{const t=s.visualItemsMap.get('label-armor').text;return[t.text,t.width,t.height,t.style.wordWrapWidth]})()",labelLayout,'placeholder label does not jump when power appears');
    await check("s.visualItemsMap.get('label-armor').powerGraphics.commandBuffer.length>0",true,'placeholder armor power badge renders alongside label');
    await captureFeedback(context,'placeholder-armor-bolt');
    await restart();
    console.log('PASS '+renderer+': inset selection and power bolt pixels across four states, insufficient charge, adjacent items, drag, rotation and visibility');
}

export async function runLocationFeedbackChecks(context){
    const {evaluate,read,check,mouse,click,send,renderer}=context;
    await evaluate('freshElectricRun()');
    await send('Emulation.setDeviceMetricsOverride',{width:1366,height:650,deviceScaleFactor:1,mobile:false});
    await delay(100);await evaluate('s.applyLayout();s.run.enemies=[];s.updateCombatUI()');
    await check('[s.groundTitle.text,s.groundStatus.text]',['GROUND','Items on your current tile'],'normal tile retains neutral ground title');
    await evaluate("s.run.hero={x:1,y:5};s.updateCombatUI()");
    await check('[s.groundTitle.text,s.groundStatus.text]',['SCRAP HEAP','Unsearched · Search takes 1 turn'],'unsearched scrap heap names current location');
    await captureFeedback(context,'scrap-heap-unsearched');
    const kitId=await read("s.inventory.items.find(i=>i.definitionId==='medkit').id");
    const start=await read('(()=>{const r=s.visualItemsMap.get('+JSON.stringify(kitId)+').rect;return[r.x+10,r.y+10]})()');
    await mouse('mousePressed',...start);await mouse('mouseMoved',start[0]+15,start[1]);
    await mouse('mouseMoved',650,250);await mouse('mouseReleased',650,250);
    await check('s.inventory.items.some(i=>i.id==='+JSON.stringify(kitId)+')',true,'dropping onto location status header is rejected');
    await mouse('mousePressed',...start);await mouse('mouseMoved',start[0]+15,start[1]);
    await mouse('mouseMoved',650,300);await mouse('mouseReleased',650,300);
    await check('[s.run.lootPoints.find(p=>p.x===1&&p.y===5).searched,s.groundTitle.text,s.groundStatus.text,s.run.worldTurn]',[false,'SCRAP HEAP','Unsearched · Search takes 1 turn',0],'dropping an owned item does not search or rename location');
    await evaluate("s.performWorldAction({type:'search'})");
    await check('[s.groundTitle.text,s.groundStatus.text,s.run.worldTurn]',['SCRAP HEAP','Searched · Supplies remaining',1],'search changes availability while keeping location title');
    await captureFeedback(context,'scrap-heap-searched');
    await evaluate("for(const loot of [...s.run.looseLoot()])if(loot.kind==='material')s.run.collectMaterials(loot.id);s.groundPage=0;s.updateCombatUI()");
    const groundKitPoint=await read('(()=>{const r=s.visualItemsMap.get('+JSON.stringify(kitId)+').rect;return[r.x+r.width/2,r.y+r.height/2]})()');
    await mouse('mousePressed',...groundKitPoint);await mouse('mouseMoved',groundKitPoint[0]+15,groundKitPoint[1]);
    await mouse('mouseMoved',225,225);await mouse('mouseReleased',225,225);
    await check('(()=>{const v=s.visualItemsMap.get('+JSON.stringify(kitId)+');return[s.inventory.items.includes(v.itemModel),v.rect.x,v.rect.y]})()',[true,200,200],'physical pickup returns item model and its visual to backpack');
    await check('s.groundStatus.text','Searched · Empty','taking all contents leaves searched empty location');
    await evaluate("s.performWorldAction({type:'search'})");
    await check('[s.run.worldTurn,s.groundStatus.text]',[1,'Searched · Empty'],'searched location cannot be searched again');
    await evaluate("s.run.hero={x:6,y:2};s.updateCombatUI()");
    await check('[s.groundTitle.text,s.groundStatus.text]',['ABANDONED KIOSK','Unsearched · Search takes 1 turn'],'kiosk title follows hero location');
    await captureFeedback(context,'abandoned-kiosk');
    await evaluate("s.run.loadSector(1);s.run.enemies=[];s.run.hero={x:0,y:4};s.updateCombatUI()");
    await check('[s.groundTitle.text,s.groundStatus.text]',['FIRST AID STATION','Unused · Health is full'],'unused station explains full health');
    await evaluate('s.run.playerHp=80;s.updateCombatUI()');
    await check('s.groundStatus.text','Heals up to 30 HP · Takes 1 turn','station advertises healing and turn cost');
    const stationShot=await captureFeedback(context,'first-aid-station');
    await check('(()=>{const item=s.inventory.items.find(i=>i.type==="armor"),t=s.visualItemsMap.get(item.id).text;return[t.visible,t.alpha,t.text]})()',[true,1,'Makeshift Vest'],'starter armor placeholder remains visible on location screenshots');
    const labelPixels=await evaluate('(async()=>{const image=new Image();image.src="data:image/png;base64,'+stationShot+'";await image.decode();'+
        'const canvas=document.createElement("canvas");canvas.width=s.scale.width;canvas.height=s.scale.height;const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0,canvas.width,canvas.height);'+
        'const item=s.inventory.items.find(i=>i.type==="armor"),r=s.visualItemsMap.get(item.id).rect;let count=0;'+
        'for(let y=r.y+4;y<r.y+40;y++)for(let x=r.x+4;x<r.x+r.width-22;x++){const p=ctx.getImageData(x,y,1,1).data;if(p[0]>180&&p[1]>180&&p[2]>170)count++;}return count})()');
    assert.ok(labelPixels>10,renderer+': actual armor label pixels survive context transitions');
    await click(1032,586);
    await check('[s.groundTitle.text,s.groundStatus.text,s.run.aidStations[0].used]',['FIRST AID STATION','Used · No healing remaining',true],'station keeps location title after use');
    await evaluate('s.run.requiredBossId=null;s.run.hero={...s.run.map.exit};s.performWorldAction({type:"exit"})');
    await check('[s.groundTitle.text,s.groundStatus.text]',['BENCH','Crafted and dropped items'],'workshop always names bench');
    await evaluate('freshElectricRun()');
    console.log('PASS '+renderer+': location titles, unsearched/searched/empty states, safe drop area and aid-station explanations');
}
