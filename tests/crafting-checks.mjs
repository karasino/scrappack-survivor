import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runFullCraftingRun } from './crafting-run-scenario.mjs';

// Exercises the production core through Vite and the actual Phaser UI in both renderers.
export async function runCraftingChecks({ evaluate, read, check, mouse, click, send, renderer }) {
    const results = await evaluate(`(async () => {
        const { RunState } = await import('/src/game/core/RunState.ts');
        const { ExplorationEngine } = await import('/src/game/core/ExplorationEngine.ts');
        const { Inventory } = await import('/src/game/core/Inventory.ts');
        const { RECIPES, MATERIAL_CAPACITY } = await import('/src/game/core/Crafting.ts');
        const { ENEMY_DEFINITIONS,SECTOR_DEFINITIONS } = await import('/src/game/core/SectorDefinitions.ts');
        const checks=[];
        const expect=(value,label)=>{if(!value)throw Error('Crafting core: '+label);checks.push(label)};
        const eq=(actual,expected,label)=>expect(JSON.stringify(actual)===JSON.stringify(expected),label+' '+JSON.stringify(actual));
        const materialSnapshot=run=>JSON.stringify([run.materials,run.worldTurn,run.rngState]);
        const gear=run=>({weapon:run.inventory.items.find(i=>i.type==='weapon'),armor:run.inventory.items.find(i=>i.type==='armor')});
        const kit=run=>run.inventory.items.find(i=>i.definitionId==='medkit');
        const loose=run=>run.looseLoot();
        const pack=(run,id,material,amount)=>{
            const entry={kind:'material',id,material,amount};
            const key=run.hero.x+','+run.hero.y;
            run.groundMaterials.set(key,[...(run.groundMaterials.get(key)||[]),entry]);return entry;
        };
        const fit=(run,item)=>{
            for(let y=0;y<run.inventory.height;y++)for(let x=0;x<run.inventory.width;x++)
                if(run.inventory.canPlaceItem(item,x,y))return{x,y};
            return null;
        };
        const put=(run,definitionId)=>{
            const item=run.createItem(definitionId),p=fit(run,item);
            expect(p!==null,'fixture component fits '+definitionId);
            expect(run.inventory.placeItem(item,p.x,p.y),'fixture place '+definitionId);return item;
        };
        const workshop=(run)=>{run.hero={...run.map.exit};const engine=new ExplorationEngine(run);
            expect(engine.applyAction({type:'exit'}).accepted,'enter workshop via actual exit');return engine};
        const initial=new RunState(123);
        eq([initial.inventory.width,initial.inventory.height,initial.inventory.items.length],[4,4,5],'restricted start plus medkit');
        eq([kit(initial).gridX,kit(initial).gridY,kit(initial).healingAmount],[0,1,25],'starting medkit');
        eq(initial.materials,{metal:0,electronics:0,fabric:0},'empty materials');
        eq(MATERIAL_CAPACITY,24,'shared material capacity');
        eq(RECIPES.length,7,'all recipes known');
        for(const [kind,definition]of Object.entries(ENEMY_DEFINITIONS))
            expect(definition.reward.every(loot=>loot.kind==='material'||['power_core','precision_mechanism'].includes(loot.definitionId)),'enemies only drop raw loot '+kind);
        for(let sector=0;sector<SECTOR_DEFINITIONS.length;sector++)
            expect(Object.values(SECTOR_DEFINITIONS[sector].loot).flat().every(loot=>loot.kind==='material'||['power_core','precision_mechanism'].includes(loot.definitionId)),'caches only drop raw loot '+sector);
        expect(!initial.inventory.canPlaceItem(initial.createItem('power_core'),4,0),'closed cells reject placement');
        for(const definitionId of ['power_core','precision_mechanism','medkit']){
            const item=initial.createItem(definitionId);const before=item.quarterTurns;
            for(let i=0;i<4;i++)item.rotate();
            eq([item.width,item.height,item.quarterTurns],[1,1,before],'canonical four rotations '+definitionId);
            expect(!item.isEnergySource&&!item.isSelectedForTurn,'noncombat component or consumable '+definitionId);
        }
        {
            const run=new RunState(321);run.materials.metal=23;const material=pack(run,'partial','electronics',5);
            const freeze=[run.worldTurn,run.rngState];
            eq(run.collectMaterials(material.id),1,'partial material pickup');
            eq([run.materialUsed,material.amount],[24,4],'partial remainder retained');
            eq(run.collectMaterials(material.id),0,'full reserve rejects pickup');
            expect(run.dropMaterial('metal'),'drop one material');
            eq([run.materialUsed,run.materials.metal],[23,22],'drop exact one');
            const dropped=loose(run).find(l=>l.kind==='material'&&l.material==='metal');
            eq(run.collectMaterials(dropped.id),1,'pick dropped material back up');
            eq(run.collectMaterials(dropped.id),0,'pickup same exhausted packet does not duplicate');
            eq([run.worldTurn,run.rngState],freeze,'materials transfers are free');
            run.beginEncounter(run.enemies[0].id);
            const snapshot=materialSnapshot(run);
            expect(!run.dropMaterial('metal'),'combat blocks material drop');
            eq(run.collectMaterials(material.id),0,'combat blocks material take');
            eq(materialSnapshot(run),snapshot,'rejected transfer is atomic');
        }
        {
            const expected={weak_battery:[2,1,0],heavy_battery:[3,3,0],copper_wire:[1,1,0],
                step_up_transformer:[2,3,0],laser_pistol:[5,4,0],makeshift_vest:[3,0,4],medkit:[0,1,2]};
            for(const recipe of RECIPES){
                eq([recipe.materials.metal,recipe.materials.electronics,recipe.materials.fabric],expected[recipe.id],'recipe costs '+recipe.id);
                const run=new RunState(13);workshop(run);
                Object.assign(run.materials,recipe.materials);
                for(const [definitionId,count]of Object.entries(recipe.components))for(let n=0;n<count;n++)put(run,definitionId);
                const before=[run.worldTurn,run.rngState,run.playerHp],inventory=run.inventory.items.slice();
                expect(run.previewRecipe(recipe.id).canCraft,'available recipe '+recipe.id);
                const result=run.craftRecipe(recipe.id);
                expect(result&&result.definitionId===recipe.outputDefinitionId,'craft output '+recipe.id);
                eq(run.materials,{metal:0,electronics:0,fabric:0},'exact material debit '+recipe.id);
                expect(run.workshopItems.includes(result)&&!run.inventory.items.includes(result),'bench owns crafted item '+recipe.id);
                expect(inventory.filter(i=>i.type!=='component').every(i=>run.inventory.items.includes(i)),'craft retains equipment '+recipe.id);
                eq([run.worldTurn,run.rngState,run.playerHp],before,'craft freezes world '+recipe.id);
                const snapshot=JSON.stringify([run.materials,run.inventory.items.map(i=>i.id),run.workshopItems.map(i=>i.id)]);
                eq(run.craftRecipe(recipe.id),null,'insufficient repeated craft rejected '+recipe.id);
                eq(JSON.stringify([run.materials,run.inventory.items.map(i=>i.id),run.workshopItems.map(i=>i.id)]),snapshot,'rejected craft is atomic '+recipe.id);
            }
            const run=new RunState(99);Object.assign(run.materials,{metal:3,electronics:3});
            expect(!run.previewRecipe('heavy_battery').canCraft,'craft unavailable outside workshop');
            workshop(run);const before=materialSnapshot(run);
            expect(!run.previewRecipe('heavy_battery').canCraft,'missing core explained');
            eq(run.craftRecipe('heavy_battery'),null,'missing component rejects');
            eq(materialSnapshot(run),before,'missing component does not debit material');
            const first=put(run,'power_core'),second=put(run,'power_core');first.id='z-core';second.id='a-core';
            // Rebuild only this isolated fixture's occupancy after choosing explicit IDs.
            for(const row of run.inventory.grid)row.fill(null);
            for(const item of run.inventory.items)for(let y=item.gridY;y<item.gridY+item.height;y++)for(let x=item.gridX;x<item.gridX+item.width;x++)run.inventory.grid[y][x]=item.id;
            expect(run.craftRecipe('heavy_battery')!==null,'craft with two possible cores');
            expect(run.inventory.items.includes(first)&&!run.inventory.items.includes(second),'components consumed in stable ID order');
        }
        {
            const run=new RunState(3);workshop(run);
            for(const item of [...run.inventory.items])run.inventory.removeItem(item.id);
            for(let y=0;y<4;y++)for(let x=0;x<4;x++)put(run,'power_core');
            eq(run.inventory.grid.flat().filter(Boolean).length,16,'full backpack fixture');
            Object.assign(run.materials,{metal:2,electronics:1});
            const item=run.craftRecipe('weak_battery');
            expect(item&&run.workshopItems.includes(item),'full backpack still crafts onto bench');
            eq(run.inventory.items.length,16,'full backpack contents unchanged');
            eq(run.craftRecipe('unknown_recipe'),null,'unknown recipe rejected');
            const leftId=item.id,hp=run.playerHp,rng=run.rngState;
            expect(run.continueFromWorkshop(),'continue workshop');
            expect(!run.allGroundItems().some(i=>i.id===leftId),'left bench item discarded');
            eq([run.playerHp,run.rngState,run.worldTurn,run.sectorIndex],[hp,rng,0,1],'continue preserves resources and resets sector turn');
        }
        {
            const run=new RunState(7),engine=new ExplorationEngine(run),item=kit(run);
            const before=materialSnapshot(run);
            eq(run.useMedkit(item.id),0,'full HP healing rejected');
            expect(run.inventory.items.includes(item),'full HP retains medkit');
            eq(materialSnapshot(run),before,'full HP refusal free');
            run.enemies=[];run.playerHp=92;
            eq(run.useMedkit(item.id),8,'healing capped at maximum');
            eq([run.playerHp,run.worldTurn,run.inventory.items.includes(item)],[100,1,false],'exploration heal spends item and one world turn');
            const second=put(run,'medkit');run.playerHp=40;run.putOnGround(second);
            eq(run.useMedkit(second.id),0,'ground medkit cannot be used');
            eq(run.playerHp,40,'wrong owner does not heal');
            workshop(run);
            expect(!run.looseLoot().some(loot=>loot.id===second.id),'old sector medkit is not on workshop bench');
            const workshopMed=put(run,'medkit'),turn=run.worldTurn;
            eq(run.useMedkit(workshopMed.id),25,'workshop medkit heals');
            eq([run.playerHp,run.worldTurn],[65,turn],'workshop healing is free in world time');
            expect(!engine.applyAction({type:'wait'}).accepted,'workshop freezes world actions');
        }
        {
            const run=new RunState(8);run.playerHp=50;const {weapon,armor}=gear(run),medkit=kit(run);
            run.beginEncounter(run.enemies.find(e=>e.kind==='scorpion').id);
            const before={hp:run.combatEngine.enemyHp,world:run.worldTurn,rng:run.rngState,
                high:run.inventory.items.find(i=>i.voltageType==='high'&&i.type==='battery').charge,
                low:run.inventory.items.find(i=>i.voltageType==='low'&&i.type==='battery').charge};
            const log=run.processCombatAction({type:'heal',consumableId:medkit.id,armorId:armor.id});
            eq([log.actionType,log.healingRestored,log.weaponUsedName],['heal',25,null],'healing log has distinct action');
            eq([run.combatEngine.enemyHp,log.damageDealt,log.shieldGenerated,log.damageTaken],[before.hp,0,8,0],'heal replaces attack and uses armor');
            eq(run.inventory.items.find(i=>i.voltageType==='high'&&i.type==='battery').charge,before.high,'selected weapon battery not debited');
            eq(run.inventory.items.find(i=>i.voltageType==='low'&&i.type==='battery').charge,before.low-1,'armor energy debited');
            eq([run.playerHp,run.combatEngine.playerHp,run.worldTurn,run.rngState],[75,75,before.world,before.rng],'combat healing syncs HP and freezes world');
            expect(weapon.isSelectedForTurn,'selected weapon remains selected without attacking');
            const spare=put(run,'medkit');run.inventory.removeItem(weapon.id);run.combatEngine.playerHp=50;run.playerHp=50;
            const second=run.processCombatAction({type:'heal',consumableId:spare.id,armorId:null});
            eq([second.healingRestored,second.damageTaken,run.playerHp],[25,8,67],'healing needs no weapon and receives enemy response');
        }
        {
            const run=new RunState(11);run.loadSector(1);run.enemies=[];
            const engine=new ExplorationEngine(run),station=run.aidStations[0];run.hero={x:station.x,y:station.y};
            expect(!engine.applyAction({type:'heal-station'}).accepted&&!station.used,'full HP does not consume aid station');
            run.playerHp=83;expect(engine.applyAction({type:'heal-station'}).accepted,'aid station usable');
            eq([run.playerHp,run.worldTurn,station.used],[100,1,true],'station capped at 30 and costs one turn');
            run.playerHp=40;expect(!engine.applyAction({type:'heal-station'}).accepted,'station one-use');
            eq([run.playerHp,run.worldTurn],[40,1],'used station refusal is free');
        }
        {
            const run=new RunState(16),inventory=run.inventory,items=inventory.items.slice();
            const sizes=[[5,4],[5,5],[6,5],[6,6],[6,6]];
            for(let index=0;index<5;index++){
                const id='synthetic-boss-'+index,turn=run.worldTurn,rng=run.rngState;
                run.applyBossReward(id,'Scrap Brute');
                eq([inventory.width,inventory.height],sizes[index],'capacity stage '+index);
                eq(run.bossVictoryCount,index+1,'boss victory counter '+index);
                expect(run.pendingBossReward.expansionApplied===(index<4),'no fifth expansion '+index);
                const count=run.allGroundItems().length;
                run.applyBossReward(id,'Scrap Brute');
                eq([run.bossVictoryCount,run.allGroundItems().length],[index+1,count],'reward idempotence before acknowledgement '+index);
                expect(!new ExplorationEngine(run).applyAction({type:'wait'}).accepted,'reward blocks world');
                expect(!run.dropMaterial('metal')&&run.useMedkit()===0,'reward blocks other commands');
                expect(run.acknowledgeBossReward(),'acknowledge reward');
                run.applyBossReward(id,'Scrap Brute');
                eq([run.bossVictoryCount,run.allGroundItems().length,run.mode],[index+1,count,'exploration'],'reward replay stays closed '+index);
                eq([run.worldTurn,run.rngState],[turn,rng],'reward and acknowledgement free '+index);
                expect(items.every(i=>inventory.items.includes(i)),'expansion preserves instances '+index);
                expect(inventory.canPlaceItem(run.createItem('power_core'),inventory.width-1,0),'new right column is available '+index);
            }
            expect(!inventory.expandTo(7,6)&&!inventory.expandTo(4,4),'invalid expansion cannot shrink or exceed maximum');
            const generic=new Inventory();eq([generic.width,generic.height],[6,6],'generic inventory stays compatible');
            const fresh=new RunState(16);eq([fresh.inventory.width,fresh.inventory.height,fresh.bossVictoryCount],[4,4,0],'new run resets progression');
        }
        {
            const run=new RunState(20);run.loadSector(1);const boss=run.enemies.find(e=>e.isBoss);
            eq([boss.name,boss.maxHp,boss.damage,boss.detectionRadius,boss.idlePeriod],['Scrap Brute',66,14,4,3],'boss stats');
            boss.x=6;boss.y=1;run.hero={...run.map.exit};const engine=new ExplorationEngine(run),before=materialSnapshot(run);
            expect(!engine.applyAction({type:'exit'}).accepted,'moved live boss still locks exit');
            eq(materialSnapshot(run),before,'blocked boss exit is free');
            run.playerHp=1;run.beginEncounter(boss.id,'player');run.combatEngine.enemyHp=1;
            const log=run.processCombatTurn(gear(run).weapon.id,null);
            expect(log.isEnemyDead&&log.isPlayerDead,'boss simultaneous death fixture');
            eq([run.mode,run.bossVictoryCount,run.pendingBossReward,run.allGroundItems().length],['defeat',0,null,0],'boss defeat gives no reward or expansion');
            eq([run.inventory.width,run.inventory.height],[4,4],'defeat retains initial capacity');
        }
        {
            const {prepareEnergyPlan}=await import('/src/game/core/EnergyPlan.ts');
            const run=new RunState(21);run.inventory.expandTo(6,6);
            for(const item of [...run.inventory.items])run.inventory.removeItem(item.id);
            const battery=run.createItem('weak_battery',2),armor=run.createItem('makeshift_vest'),weapon=run.createItem('laser_pistol');
            weapon.requiredVoltage='low';weapon.isSelectedForTurn=true;armor.isSelectedForTurn=true;
            run.inventory.placeItem(battery,0,0);run.inventory.placeItem(armor,1,0);run.inventory.placeItem(weapon,0,1);
            run.inventory.updatePowerGrid();const med=put(run,'medkit');run.playerHp=50;
            const preview=prepareEnergyPlan(run.inventory,weapon,armor);
            expect(!preview.weaponPowered||!preview.armorPowered,'attack fixture has shared-charge conflict');
            run.beginEncounter(run.enemies.find(e=>e.kind==='scorpion').id);
            const first=run.processCombatAction({type:'heal',consumableId:med.id,armorId:armor.id});
            eq([first.shieldGenerated,first.damageDealt,battery.charge],[8,0,1],'heal ignores selected weapon reservation and powers armor alone');
            armor.energyCost=2;const secondKit=put(run,'medkit');
            const second=run.processCombatAction({type:'heal',consumableId:secondKit.id,armorId:armor.id});
            eq([second.shieldGenerated,second.damageTaken,battery.charge],[2,6,1],'unaffordable armor uses base and does not debit partial charge during heal');
        }
        {
            const run=new RunState(22),engine=new ExplorationEngine(run),rat=run.enemies.find(e=>e.kind==='rat');
            run.hero={x:0,y:7};Object.assign(rat,{x:0,y:6});run.enemies=[rat];run.playerHp=1;
            const med=kit(run);expect(engine.applyAction({type:'heal',itemId:med.id}).accepted,'exploration healing accepted before contact');
            eq([run.playerHp,run.combatEngine.playerHp,run.worldTurn,run.mode],[26,26,1,'combat'],'heal occurs before AI contact creates encounter');
            const stationRun=new RunState(23);stationRun.loadSector(1);const station=stationRun.aidStations[0];
            stationRun.hero={x:station.x,y:station.y};stationRun.playerHp=1;
            const attacker=stationRun.enemies.find(e=>e.kind==='rat');Object.assign(attacker,{x:station.x,y:station.y-1});stationRun.enemies=[attacker];
            expect(new ExplorationEngine(stationRun).applyAction({type:'heal-station'}).accepted,'station resolves before AI');
            eq([stationRun.playerHp,stationRun.combatEngine.playerHp,station.used,stationRun.mode],[31,31,true,'combat'],'station marked used before resulting contact');
        }
        {
            const run=new RunState(24);workshop(run);Object.assign(run.materials,{metal:2,electronics:1});
            const snapshot=materialSnapshot(run),items=run.workshopItems.length,create=run.createItem;
            run.createItem=()=>{throw Error('Injected output construction failure')};
            let failed=false;try{run.craftRecipe('weak_battery')}catch{failed=true}
            expect(failed,'output failure fixture executed');eq([materialSnapshot(run),run.workshopItems.length],[snapshot,items],'output failure has no partial debit');
            run.createItem=create;Object.assign(run.materials,{metal:3,electronics:3});
            run.putOnGround(run.createItem('power_core'));
            expect(!run.previewRecipe('heavy_battery').canCraft,'component left on bench cannot be consumed as inventory ingredient');
        }
        for(const initiator of ['player','enemy']){
            const run=new RunState(25);run.loadSector(1);const boss=run.enemies.find(e=>e.isBoss);
            const source={x:6,y:0};run.hero={...source};const destination={x:boss.x,y:boss.y};
            run.beginEncounter(boss.id,initiator);run.combatEngine.enemyHp=1;
            const {weapon,armor}=gear(run);run.processCombatTurn(weapon.id,armor.id);
            eq(run.hero,initiator==='player'?destination:source,'boss reward honors '+initiator+' contact position');
            eq([run.mode,run.looseLoot().length,run.bossVictoryCount],['boss-reward',3,1],'boss creates component reward and one expansion '+initiator);
        }
        return {checks};
    })()`);
    console.log(`PASS ${renderer}: ${results.checks.length} crafting core assertions`);
    const fullRun = await evaluate('('+runFullCraftingRun.toString()+')()');
    assert.equal(fullRun.fights,7,`${renderer}: full run defeats six ordinary enemies and the boss`);
    assert.equal(fullRun.finalItem,'heavy_battery',`${renderer}: final workshop crafts with earned components`);
    console.log(`PASS ${renderer}: real seeded two-sector crafting run ${JSON.stringify(fullRun)}`);

    await evaluate('freshRun()');
    await send('Emulation.setDeviceMetricsOverride',{width:1366,height:650,deviceScaleFactor:1,mobile:false});
    await delay(100);await evaluate('s.applyLayout()');
    await check('[s.inventory.width,s.inventory.height,s.inventory.items.length]',[4,4,5],'crafting UI starts with restricted backpack and medkit');
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

    // This isolated UI fixture complements the ordinary complete-run test above.
    await evaluate("s.run.hero={...s.run.map.exit};s.performWorldAction({type:'exit'});Object.assign(s.run.materials,{metal:3,electronics:3,fabric:0});s.run.putOnGround(s.run.createItem('power_core'));s.groundPage=0;s.updateCombatUI()");
    await check('[s.run.mode,s.workshopView.rows.length,s.workshopView.continueButton.label.text]', ['workshop',7,'CONTINUE'],'workshop opens all recipes');
    await button('s.workshopView.rows[1]');
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
    await button('s.workshopView.rows[4]');
    await check('s.workshopView.craftButton.enabled',false,'expensive unavailable recipe remains disabled');
    await mouse('mouseMoved',20,580);
    await check('[s.workshopView.rows[4].rect.lineWidth,s.workshopView.rows[4].rect.strokeColor]',[2,0xc9aa72],'selected recipe frame survives pointerout');
    await mouse('mouseMoved',400,150+4*28+13);
    await check('[s.workshopView.rows[4].rect.lineWidth,s.workshopView.rows[4].rect.strokeColor]',[2,0xc9aa72],'selected recipe frame survives hover');
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
    await evaluate("s.run.playerHp=60;s.run.beginEncounter(s.run.enemies.find(e=>e.kind==='scorpion').id);s.combatEngine=s.run.combatEngine;s.backpackView=true;s.updateCombatUI()");
    const healingState=await read('({enemy:s.combatEngine.enemyHp,high:s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="high").charge,low:s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="low").charge,world:s.run.worldTurn})');
    await button('s.healButton');
    await check('[s.run.playerHp,s.combatEngine.playerHp,s.combatEngine.enemyHp,s.inventory.items.filter(i=>i.definitionId==="medkit").length]',[85,85,healingState.enemy,0],'HEAL replaces attack and synchronizes HP');
    await check('[s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="high").charge,s.inventory.items.find(i=>i.type==="battery"&&i.voltageType==="low").charge,s.run.worldTurn]',
        [healingState.high,healingState.low-1,healingState.world],'HEAL only pays armor and freezes map');
    await check('s.messages.some(message=>/restored|healed/i.test(message))',true,'combat log describes healing');
    await capture('wide-healing');

    await evaluate('freshRun()');
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
    assert(results.checks.length>50,`${renderer}: meaningful core coverage`);
}
