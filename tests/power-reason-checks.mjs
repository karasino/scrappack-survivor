import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function runPowerReasonChecks({ evaluate, read, check, mouse, click, restart, send, renderer }) {
    const noSource = '! No compatible power source.';
    const weaponShortage = '! Insufficient charge for powered damage.';
    const armorShortage = '! Insufficient charge for powered shield.';
    const sharedShortage = '! Insufficient charge to power both selected items.';
    await evaluate(`(async () => {
        const { prepareEnergyPlan, previewPoweredEffect, canUsePoweredEffect } = await import('/src/game/core/EnergyPlan.ts');
        globalThis.powerPreview=previewPoweredEffect;
        globalThis.reasonCase = options => {
            const f=energyFixture(options);
            const before=f.state();
            const armor=options.useArmor===false?null:f.armor;
            const plan=prepareEnergyPlan(f.inventory,f.weapon,armor);
            for(let i=0;i<20;i++) {
                prepareEnergyPlan(f.inventory,f.weapon,armor);
                const preview=previewPoweredEffect(f.inventory,f.weapon);
                if(preview.available!==canUsePoweredEffect(f.inventory,f.weapon))throw Error('Boolean API mismatch');
                previewPoweredEffect(f.inventory,f.armor);
            }
            return {weapon:plan.weaponReason,armor:plan.armorReason,pure:before===f.state()};
        };
        globalThis.reasonLines = () => s.itemTooltip.labels.filter(l=>l.visible&&l.text.startsWith('!')).map(l=>l.text);
    })()`);
    for(const [options,weapon,armor] of [
        [{charges:{A:5}},null,null],
        [{charges:{A:5},weaponSources:[],armorSources:[]},'no-source','no-source'],
        [{charges:{A:0.5}},'insufficient-charge','insufficient-charge'],
        [{charges:{A:2}},'shared-charge-conflict','shared-charge-conflict'],
        [{charges:{A:1}},'insufficient-charge',null],
        [{charges:{A:2},armorCost:3},null,'insufficient-charge'],
        [{charges:{A:0.5,B:1.5},weaponSources:[['A',1],['B',1]],useArmor:false},null,null]
    ]) {
        assert.deepEqual(await evaluate(`reasonCase(${JSON.stringify(options)})`),{weapon,armor,pure:true},
            `${renderer}: core reason and pure preview`);
    }
    const waitFor = async (predicate,label) => {
        for(let i=0;i<100;i++) {if(await read(predicate))return;await delay(20);}
        throw Error(`${renderer}: timeout: ${label}`);
    };
    const hover = async (x,y) => {
        await mouse('mouseMoved',x,y);
        await waitFor('s.itemTooltip.visible','reason tooltip');
    };
    const activeLine = "s.itemTooltip.labels.filter(l=>l.visible).find(l=>l.text.startsWith('►')).text";
    const hasReason = message => `reasonLines()[0] === ${JSON.stringify(message)}`;
    await restart();
    await evaluate(`seed([{type:'weapon',id:'gun',x:0,y:0},{type:'armor',id:'vest',x:3,y:0}])`);
    await hover(225,175);
    await check('reasonLines()',[noSource],'placed weapon without source');
    await check("tooltipTexts().includes('Connected batteries: 0')",true,'missing source count stays visible');
    await hover(375,175);
    await check('reasonLines()',[noSource],'placed armor without source');
    await evaluate(`s.run.mode='exploration';seed([{type:'weapon',id:'loot'}]);s.groundPage=s.run.itemsAtHero().findIndex(i=>i.id==='loot');s.updateCombatUI();s.visualItemsMap.get('loot').setPosition(650,300)`);
    await hover(675,325);
    await check('reasonLines()',[],'normal loot does not warn about power');
    await check("tooltipTexts().includes('Connected batteries: 0')",true,'loot count remains zero');
    await restart();

    await evaluate(`seed([{type:'battery',id:'A',x:0,y:0,charge:1},
        {type:'transformer',id:'transformer',x:1,y:0},{type:'weapon',id:'gun',x:2,y:0}])`);
    await click(325,175);
    await hover(325,175);
    await check('reasonLines()',[weaponShortage],'connected but insufficient weapon');
    await check("tooltipTexts().includes('Connected batteries: 1')",true,'insufficient source remains counted');
    await check(activeLine,'► Base damage: 4','shortage keeps base active');
    await check("s.itemTooltip.labels.filter(l=>l.visible&&l.text.startsWith('!')).map(l=>l.style.color)",['#d6ad65'],'explanation uses warning accent');
    const pointer = await read('[s.input.activePointer.x,s.input.activePointer.y]');
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=4");
    await waitFor('reasonLines().length===0','sufficient charge clears warning');
    await check(activeLine,'► Powered damage: 22','sufficient charge highlights powered damage');
    await check("s.visualItemsMap.get('gun').rect.isStroked",true,'existing power frame remains consistent');
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=1");
    await waitFor(hasReason(weaponShortage),'warning returns after charge change');
    await check("s.visualItemsMap.get('gun').itemModel.connectedBatteries.length",1,'preview leaves connections unchanged');
    await evaluate(`s.run.putOnGround(s.visualItemsMap.get('A').itemModel);s.refreshPowerGrid()`);
    await waitFor(hasReason(noSource),'connection change updates visible reason');
    await check("tooltipTexts().includes('Connected batteries: 0')",true,'actual disconnection updates count');
    await evaluate(`const source=s.visualItemsMap.get('A');source.itemModel.charge=4;s.run.removeFromGround('A');
        s.inventory.placeItem(source.itemModel,0,0);source.setPosition(200,150);s.refreshPowerGrid()`);
    await waitFor('reasonLines().length===0','restoring connection clears warning');
    await check('[s.input.activePointer.x,s.input.activePointer.y]',pointer,'charge and connection changes need no pointer movement');
    await restart();

    await evaluate(`seed([{type:'battery',id:'A',x:1,y:0,charge:0.5,voltageType:'high'},
        {type:'battery',id:'B',x:0,y:1,charge:1.5,voltageType:'high'},
        {type:'weapon',id:'gun',x:1,y:1}])`);
    await hover(275,225);
    await check("tooltipTexts().includes('Connected batteries: 2')",true,'all partial sources counted');
    await check('reasonLines()',[],'combined partial sources have no warning');
    await check(activeLine,'► Powered damage: 22','partial sources jointly power weapon');
    await restart();

    await evaluate(`seed([{type:'battery',id:'A',x:0,y:0,charge:2},
        {type:'weapon',id:'gun',x:1,y:0,requiredVoltage:'low'},{type:'armor',id:'vest',x:0,y:1}])`);
    await click(275,175);
    await click(225,225);
    await hover(275,175);
    await check('reasonLines()',[sharedShortage],'joint conflict explains weapon');
    await hover(225,225);
    await check('reasonLines()',[sharedShortage],'joint conflict explains armor');
    await evaluate("s.selectItem(s.visualItemsMap.get('gun'))");
    await waitFor('reasonLines().length===0','selection change clears stationary armor warning');
    await check(activeLine,'► Powered shield: 8','selected armor can work alone');
    await evaluate("s.selectItem(s.visualItemsMap.get('gun'))");
    await waitFor(hasReason(sharedShortage),'selection change restores stationary conflict');
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=1");
    await waitFor('reasonLines().length===0','independently available armor has no warning');
    await check(activeLine,'► Powered shield: 8','armor stays powered when weapon cannot work alone');
    await hover(275,175);
    await check('reasonLines()',[weaponShortage],'individual weapon shortage is not joint conflict');
    await evaluate("s.visualItemsMap.get('vest').itemModel.energyCost=3;s.visualItemsMap.get('A').itemModel.charge=2");
    await waitFor('reasonLines().length===0','independently available weapon has no warning');
    await check(activeLine,'► Powered damage: 22','weapon stays powered when armor cannot work alone');
    await hover(225,225);
    await check('reasonLines()',[armorShortage],'armor has shield-specific shortage text');
    await evaluate("s.visualItemsMap.get('vest').itemModel.energyCost=1;s.visualItemsMap.get('A').itemModel.charge=2");
    await waitFor(hasReason(sharedShortage),'joint reason updates after cost change');
    await evaluate("s.selectItem(s.visualItemsMap.get('vest'))");
    await check('reasonLines()',[sharedShortage],'unselected armor preview still includes selected weapon');
    await hover(275,175);
    await check('reasonLines()',[],'selected weapon alone has no conflict');
    await evaluate("s.selectItem(s.visualItemsMap.get('vest'))");
    await waitFor(hasReason(sharedShortage),'stationary weapon sees selected counterpart');

    await mouse('mouseMoved',100,100);
    await evaluate(`const gun=s.visualItemsMap.get('gun');gun.itemModel.name='Long Laser Pistol Name '.repeat(6);
        gun.setPosition(740,540);globalThis.warningLabels=s.itemTooltip.labels.slice();undefined`);
    await hover(780,580);
    await check('reasonLines()',[sharedShortage],'long tooltip retains final explanation');
    await check(`(() => {
        const t=s.itemTooltip,last=t.labels[7];
        return t.labels.length===8 && t.labels.filter(l=>l.visible).length===8 && last.visible
            && last.text.startsWith('!') && last.getWrappedText().length>1
            && last.y+last.height<=t.height-12 && t.labels.filter(l=>l.visible).every(l=>l.width<=256)
            && t.container.x>=8 && t.container.y>=8 && t.container.x+280<=792 && t.container.y+t.height<=592;
    })()`,true,'warning pool capacity, wrapping, full height and viewport bounds');
    const height = await read('s.itemTooltip.height');
    const screenshot=await send('Page.captureScreenshot',{format:'png',clip:await read(`(()=>{const r=s.game.canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`)});
    await writeFile(join(tmpdir(),`scrappack-power-warning-${renderer}.png`),Buffer.from(screenshot.data,'base64'));
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=3");
    await waitFor('reasonLines().length===0','fix clears warning and reflows visible panel');
    assert.ok(await read('s.itemTooltip.height')<height,`${renderer}: panel shrinks without stale warning`);
    await check('s.itemTooltip.labels.every((label,i)=>label===warningLabels[i])',true,'text objects remain reused');
    await check(`(() => {const t=s.itemTooltip;return t.container.x>=8&&t.container.y>=8
        &&t.container.x+280<=792&&t.container.y+t.height<=592;})()`,true,'reflow keeps panel inside viewport');
    await check('[s.input.activePointer.x,s.input.activePointer.y]',[780,580],'reflow needs no pointer movement');
    await restart();
    console.log(`PASS ${renderer}: power shortage reasons, stationary updates, source counts and tooltip bounds`);
}
