import { runBlueprintChecks } from './blueprint-checks.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Browser coverage retains actual Phaser input, crafting UI and both renderers.
export async function runCraftingChecks({ evaluate, read, check, mouse, click, send, renderer }) {
    await runBlueprintChecks({ evaluate, read, check, mouse, click, send, renderer });
    await evaluate('freshRun()');
    await send('Emulation.setDeviceMetricsOverride',{width:1366,height:650,deviceScaleFactor:1,mobile:false});
    await delay(100);await evaluate('s.applyLayout()');
    await check('[s.inventory.width,s.inventory.height,s.inventory.items.length]',[4,4,4],'crafting UI starts with restricted backpack and medkit');
    await check('s.healButton.enabled',false,'full-health HEAL control disabled');
    const directory=join(process.cwd(),'artifacts','crafting');
    await mkdir(directory,{recursive:true});
    const capture=async(name)=>{
        await delay(100);
        const clip=await read('(()=>{const r=s.game.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()');
        const image=await send('Page.captureScreenshot',{format:'png',clip});
        await writeFile(join(directory,renderer+'-'+name+'.png'),Buffer.from(image.data,'base64'));
    };
    await capture('wide-start');
    const key=async(value,code,windowsVirtualKeyCode)=>{
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code,windowsVirtualKeyCode});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code,windowsVirtualKeyCode});
    };
    const viewport=async(width,height)=>{
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await delay(110);await evaluate('s.applyLayout()');await delay(60);
    };
    const button=async(expression)=>{
        const point=await read('(()=>{const r='+expression+'.rect;return[r.x+r.width/2,r.y+r.height/2]})()');
        await click(...point);
    };
    const drag=async(id,x,y,rotate=false)=>{
        const point=await read('(()=>{const r=s.visualItemsMap.get('+JSON.stringify(id)+').rect;return[r.x+10,r.y+10]})()');
        await mouse('mouseMoved',...point);await mouse('mousePressed',...point);
        await mouse('mouseMoved',point[0]+15,point[1]);
        if(rotate)await key('r','KeyR',82);
        await mouse('mouseMoved',x,y);await mouse('mouseReleased',x,y);await delay(45);
    };
    const until=async(expression,label)=>{
        for(let n=0;n<100;n++){if(await read(expression))return;await delay(25)}
        throw Error(renderer+': '+label);
    };
    await evaluate("s.run.enemies=[];s.run.putMaterialOnGround('metal',4);s.updateCombatUI()");
    await check('[s.takeMaterialButton.rect.visible,s.takeMaterialButton.enabled,s.groundMaterialText.text.includes("Scrap Metal")]',[true,true,true],'material packet has TAKE instead of grid interaction');
    const free=await read('[s.run.worldTurn,s.run.rngState]');
    await button('s.takeMaterialButton');
    await check('[s.run.materials.metal,s.run.looseLoot().length]',[4,0],'TAKE collects actual packet');
    await check('[s.run.worldTurn,s.run.rngState]',free,'TAKE is free');
    await click(240,50);
    await check('s.runOverlay.kind','materials','click opens reserve panel');
    await key('d','KeyD',68);await key(' ','Space',32);await key('b','KeyB',66);
    await check('[s.run.worldTurn,s.run.rngState]',free,'reserve panel blocks world keys');
    await button('s.runOverlay.dropButtons.metal');
    await check('[s.run.materials.metal,s.run.looseLoot()[0].amount]',[3,1],'DROP 1 moves actual material to ground');
    await capture('wide-materials');
    await button('s.runOverlay.closeButton');
    await check('s.runOverlay.kind',null,'close reserve panel');
    await button('s.takeMaterialButton');
    await check('s.run.materials.metal',4,'ground material can be collected again');
    await evaluate("s.run.putMaterialOnGround('electronics',3);s.updateCombatUI()");
    await capture('wide-loot');

    await evaluate('(async()=>{await freshElectricRun();s.run.enemies=[];globalThis.heavyRecipeId=await learnFixtureBlueprint("heavy_battery");s.run.learnUtilityRecipe("copper_wire");s.run.learnUtilityRecipe("step_up_transformer")})()');
    // This isolated UI fixture complements the ordinary complete-run test above.
    await evaluate("s.run.hero={...s.run.map.exit};s.performWorldAction({type:'exit'});Object.assign(s.run.materials,{metal:3,electronics:3,fabric:0});s.run.putOnGround(s.run.createItem('power_core'));s.groundPage=0;s.updateCombatUI()");
    await check('[s.run.mode,s.workshopView.rows.length,s.workshopView.continueButton.label.text]', ['workshop',4,'CONTINUE'],'workshop shows four known recipes per page');
    await button('s.workshopView.nextButton');await button('s.workshopView.rows[0]');
    await check('s.workshopView.craftButton.enabled',false,'recipe requires physical component in backpack');
    const coreId=await read("s.run.itemsAtHero().find(i=>i.definitionId==='power_core').id");
    await drag(coreId,375,225);
    await check('s.inventory.items.some(i=>i.id==='+JSON.stringify(coreId)+')',true,'component drag transfers bench ownership');
    await check('s.workshopView.craftButton.enabled',true,'picking component refreshes craft availability');
    const inventoryBefore=await read('s.inventory.items.length');
    await button('s.workshopView.craftButton');
    await check('[s.run.materials.metal,s.run.materials.electronics,s.run.workshopItems[0].definitionId,s.inventory.items.length]',[0,0,'heavy_battery',inventoryBefore-1],'CRAFT consumes exact cost and puts output on bench');
    await check('s.visualItemsMap.has('+JSON.stringify(coreId)+')',false,'consumed component visual removed');
    await capture('wide-workshop');
    const crafted=await read('s.run.workshopItems[0].id');
    await drag(crafted,275,225);
    await check('s.inventory.items.some(i=>i.id==='+JSON.stringify(crafted)+')',true,'crafted output can enter backpack');
    const gunId=await read("s.inventory.items.find(i=>i.type==='weapon').id");
    for(let quarter=1;quarter<=4;quarter++){
        await drag(gunId,650,300,true);
        await check('s.visualItemsMap.get('+JSON.stringify(gunId)+').itemModel.quarterTurns',quarter%4,'model orientation survives bench transfer '+quarter);
        await check('s.run.workshopItems.filter(i=>i.id==='+JSON.stringify(gunId)+').length',1,'one bench owner after rotation '+quarter);
    }
    await drag(gunId,325,175);
    await evaluate('globalThis.craftingSavedVisual=s.visualItemsMap.get('+JSON.stringify(gunId)+');undefined');
    await mouse('mousePressed',325,175);await mouse('mouseMoved',345,175);await key('r','KeyR',82);
    await viewport(1024,640);await mouse('mouseReleased',345,175);
    await check('(()=>{const v=s.visualItemsMap.get('+JSON.stringify(gunId)+');return[v===craftingSavedVisual,v.itemModel.quarterTurns,v.itemModel.gridX,v.itemModel.gridY,!!s.activeDrag]})()',
        [true,0,2,0,false],'compact resize cancels rotation preserving original');
    await check('[s.compact,s.backpackView]',[true,false],'compact workshop initially uses recipe view');
    await button('s.workshopView.rows[2]');
    await check('s.workshopView.craftButton.enabled',false,'expensive unavailable recipe remains disabled');
    await mouse('mouseMoved',20,580);
    await check('[s.workshopView.rows[2].rect.lineWidth,s.workshopView.rows[2].rect.strokeColor]',[2,0xc9aa72],'selected recipe frame survives pointerout');
    await mouse('mouseMoved',400,150+2*28+13);
    await check('[s.workshopView.rows[2].rect.lineWidth,s.workshopView.rows[2].rect.strokeColor]',[2,0xc9aa72],'selected recipe frame survives hover');
    await check('s.workshopView.hint.getBounds().bottom<=600',true,'compact missing-ingredients hint and loss warning fit viewport');
    await capture('compact-workshop');
    await key('b','KeyB',66);await check('s.backpackView',true,'B opens backpack in workshop');
    await check('[s.workshopView.craftButton.rect.visible,s.workshopView.craftButton.rect.input.enabled]',[false,false],'hidden workshop does not intercept input');
    await capture('compact-backpack');
    await viewport(800,600);await key('b','KeyB',66);
    await check('[s.compact,s.backpackView]',[true,false],'minimum viewport retains compact workshop');
    await viewport(1280,620);await check('s.compact',false,'1280 viewport uses wide workshop');

    await evaluate('freshRun()');await viewport(1366,650);
    await evaluate("s.run.loadSector(1);s.run.enemies=[];s.run.hero={x:0,y:4};s.run.playerHp=80;s.updateCombatUI()");
    await check('s.mapView.actionButton.label.text','USE STATION','aid station exposes its contextual action');
    await button('s.mapView.actionButton');
    await check('[s.run.playerHp,s.run.worldTurn,s.run.aidStations[0].used]',[100,1,true],'station button heals once and spends world turn');
    await capture('wide-aid-station');

    await evaluate('freshRun()');await viewport(1366,650);
    await evaluate('prepareCombatHeal()');
    const healingState=await read('({enemy:s.combatEngine.enemyHp,high:s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="high").charge,low:s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="low").charge,world:s.run.worldTurn})');
    await button('s.healButton');
    await check('[s.run.playerHp,s.combatEngine.playerHp,s.combatEngine.enemyHp,s.inventory.items.filter(i=>i.definitionId==="medkit").length]',[85,85,healingState.enemy,0],'HEAL replaces attack and synchronizes HP');
    await check('[s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="high").charge,s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="low").charge,s.run.worldTurn]',
        [healingState.high,healingState.low-1,healingState.world],'HEAL only pays armor and freezes map');
    await check('s.messages.some(message=>/restored|healed/i.test(message))',true,'combat log describes healing');
    await capture('wide-healing');

    await evaluate('freshElectricRun()');
    await evaluate("s.run.playerHp=50;const weapon=s.inventory.items.find(i=>i.type==='weapon');s.inventory.removeItem(weapon.id);s.run.beginEncounter(s.run.enemies.find(e=>e.kind==='scorpion').id);s.combatEngine=s.run.combatEngine;s.backpackView=true;s.updateCombatUI()");
    await check('[s.canEndTurn(),s.healButton.enabled]',[false,true],'HEAL remains available without a weapon');
    await button('s.healButton');
    await check('[s.run.playerHp,s.combatEngine.enemyHp,s.inventory.items.filter(i=>i.definitionId==="medkit").length]',[75,24,0],'weaponless UI healing consumes medkit and preserves enemy HP');

    await evaluate('freshRun()');await viewport(800,600);
    await evaluate("s.run.loadSector(1);const boss=s.run.enemies.find(e=>e.isBoss);s.run.hero={x:6,y:0};s.run.beginEncounter(boss.id,'player');s.combatEngine=s.run.combatEngine;s.backpackView=true;s.combatEngine.enemyHp=1;s.updateCombatUI()");
    await click(663,544);
    await until("s.run.mode==='boss-reward'&&s.runOverlay.kind==='reward'",'boss victory opens reward overlay');
    await check('[s.inventory.width,s.inventory.height,s.run.bossVictoryCount,s.backpackView]',[5,4,1,true],'reward applies before compact modal closes');
    const rewardFreeze=await read('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.hero,s.run.looseLoot().map(l=>l.id),s.run.playerHp])');
    const orientation=await read('s.inventory.items.find(i=>i.type==="weapon").quarterTurns');
    await key('b','KeyB',66);await key('d','KeyD',68);await key(' ','Space',32);await key('e','KeyE',69);await key('r','KeyR',82);
    await click(663,544);await button('s.healButton');await click(240,50);
    await mouse('mousePressed',325,175);await mouse('mouseMoved',345,175);await mouse('mouseReleased',345,175);
    await evaluate('s.performWorldAction({type:"wait"});s.performHeal();s.openMaterials();s.collectGroundMaterial();s.game.events.emit("blur")');
    await check('JSON.stringify([s.run.worldTurn,s.run.rngState,s.run.hero,s.run.looseLoot().map(l=>l.id),s.run.playerHp])',rewardFreeze,'reward blocks all background commands');
    await check('[s.runOverlay.kind,s.backpackView,!!s.activeDrag,s.inventory.items.find(i=>i.type==="weapon").quarterTurns]',['reward',true,false,orientation],'blur and keyboard cannot dismiss or mutate reward');
    await capture('compact-boss-reward');
    await viewport(1366,650);
    await check('[s.runOverlay.kind,s.run.bossVictoryCount,s.inventory.width]', ['reward',1,5],'reward survives wide resize without duplicate issuance');
    await capture('wide-boss-reward');
    await viewport(800,600);await button('s.runOverlay.continueButton');
    await check('[s.run.mode,s.runOverlay.kind,s.backpackView,s.run.bossVictoryCount,s.run.looseLoot().length]',['exploration',null,false,1,3],'CONTINUE only closes notification and returns compact map');
    await key('b','KeyB',66);await capture('expanded-backpack');
    console.log('PASS '+renderer+': crafting UI, material transfers, workshop, healing, orientations, modal gates and four viewports');
}
