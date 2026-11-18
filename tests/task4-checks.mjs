import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function runTask4Checks({ evaluate, read, check, mouse, click, restart, send, renderer }) {
    const focusListeners = await read('s.game.events.listenerCount("focus")');
    await evaluate(`(async () => {
        const { buildItemTooltipContent, formatTooltipNumber } = await import('/src/game/ui/ItemTooltipContent.ts');
        const { previewPoweredEffect } = await import('/src/game/core/EnergyPlan.ts');
        globalThis.tooltipContent = item => buildItemTooltipContent(item, previewPoweredEffect(s.inventory,item));
        globalThis.formatNumber = formatTooltipNumber;
        globalThis.tooltipLabels = () => s.itemTooltip.labels.filter(t=>t.visible).map(t=>({text:t.text,color:t.style.color}));
        globalThis.tooltipTexts = () => tooltipLabels().map(t=>t.text);
    })()`);
    await check('[formatNumber(1),formatNumber(1.239),formatNumber(0.005),formatNumber(0)]',['1','1.24','<0.01','0'],'number formatting');

    await restart();
    await evaluate(`seed([{type:'weapon',id:'gun',x:0,y:0},{type:'armor',id:'vest',x:3,y:0},
        {type:'battery',id:'bat',charge:0.005,maxCharge:5,capacity:999,maxCapacity:999},
        {type:'wire',id:'wire',x:0,y:3},{type:'transformer',id:'transformer',x:3,y:3}]);
        s.visualItemsMap.get('bat').setPosition(680,350)`);
    const contents = await read(`Array.from(s.visualItemsMap.values()).filter(v=>v.itemModel.id!=='scrap_battery_01')
        .map(v=>tooltipContent(v.itemModel))`);
    assert.deepEqual(contents.map(c=>c.type),['Weapon','Armor','Battery','Wire','Transformer']);
    assert.deepEqual(contents[0].lines.map(l=>l.text),['Base damage: 4','Powered damage: 22','Required voltage: High','Base energy cost: 2 / attack','Connected batteries: 0','! No compatible power source.']);
    assert.deepEqual(contents[0].lines.slice(0,2).map(l=>l.active),[true,false]);
    assert.equal(contents[1].lines[3].text,'Base energy cost: 1 / turn used');
    assert.equal(contents[2].lines[0].text,'Charge: <0.01 / 5');
    assert.equal(contents[2].charge.percent,'<1%');
    assert.equal(contents[2].charge.ratio,0.001);
    assert.deepEqual(contents[3].lines,[{text:'Energy cost -20% once per path.'}]);
    assert.deepEqual(contents[4].lines.map(l=>l.text),['Conversion: Low → High','When converting: +1 to energy cost multiplier']);
    await evaluate(`s.visualItemsMap.get('transformer').itemModel.transformDirection='high-to-low'`);
    await check("tooltipContent(s.visualItemsMap.get('transformer').itemModel).lines[0].text",'Conversion: High → Low','reverse conversion');
    await evaluate(`s.visualItemsMap.get('transformer').itemModel.transformDirection=null`);
    await check("tooltipContent(s.visualItemsMap.get('transformer').itemModel).lines.map(l=>l.text)",['Conversion: No conversion'],'no conversion omits surcharge');
    await evaluate(`s.visualItemsMap.get('bat').itemModel.maxCharge=0`);
    await check("tooltipContent(s.visualItemsMap.get('bat').itemModel).charge",{ratio:0,percent:'0%'},'zero maximum charge');
    await evaluate(`Object.assign(s.visualItemsMap.get('bat').itemModel,{charge:1.999,maxCharge:2})`);
    await check("tooltipContent(s.visualItemsMap.get('bat').itemModel).charge.percent",'99%','percentage floors exact ratio');

    const waitFor = async (expression, label) => {
        for(let i=0;i<100;i++) {
            if(await read(expression))return;
            await delay(20);
        }
        throw Error(`${renderer}: timed out: ${label}`);
    };
    const hover = async (x,y) => {
        await mouse('mouseMoved',x,y);
        await waitFor('s.itemTooltip.visible','tooltip appears');
    };
    await mouse('mouseMoved',225,175);
    await delay(120);
    await check('s.itemTooltip.visible',false,'tooltip hidden before delay');
    await check('s.tooltipTimer.delay',300,'300ms timer');
    await evaluate('globalThis.firstTooltipTimer=s.tooltipTimer;undefined');
    await mouse('mouseMoved',230,178);
    await check('s.tooltipTimer===firstTooltipTimer',true,'movement inside item preserves timer');
    await waitFor('s.itemTooltip.visible','continuous hover');
    await check('tooltipTexts().slice(0,2)',['Laser Pistol','Weapon'],'weapon panel content');
    await check('tooltipLabels().find(l=>l.text.startsWith("►")).color','#e6e2d8','base effect highlighted with primary text');
    const children = await read('s.children.length');
    await evaluate('globalThis.tooltipInstance=s.itemTooltip;undefined');
    await click(230,178);
    await check("s.visualItemsMap.get('gun').itemModel.isSelectedForTurn",true,'visible tooltip does not intercept click');
    await check('!s.itemTooltip.container.input && s.itemTooltip.container.list.every(o=>!o.input)',true,'tooltip has no interactive objects');
    await hover(375,175);
    await check('tooltipTexts().includes("Base energy cost: 1 / turn used")',true,'armor panel uses paid cost');
    await hover(225,325);
    await check('tooltipTexts()',['Copper Wire','Wire','Energy cost -20% once per path.'],'wire describes saving');
    await hover(375,325);
    await check('tooltipTexts()',['Step-up Transformer','Transformer','Conversion: No conversion'],'transformer panel');
    await evaluate("s.run.mode='exploration';s.groundPage=s.run.itemsAtHero().findIndex(i=>i.id==='bat');s.updateCombatUI();s.visualItemsMap.get('bat').setPosition(680,350)");
    await hover(710,375);
    await check('tooltipTexts().includes("Charge: 2 / 2")',true,'loot battery values');
    await check('s.itemTooltip===tooltipInstance && s.children.length=== '+children,true,'single reused panel');
    await evaluate("s.visualItemsMap.get('bat').itemModel.charge=0.005");
    await waitFor('tooltipTexts().includes("Charge: <0.01 / 2") && tooltipTexts().includes("<1%")',
        'stationary tiny charge refresh');
    await check('tooltipTexts().includes("Charge: <0.01 / 2") && tooltipTexts().includes("<1%")',true,'stationary tooltip refreshes tiny charge');
    const snapshot = await send('Page.captureScreenshot',{format:'png',clip:await read(`(()=>{const r=s.game.canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`)});
    await writeFile(join(tmpdir(),`scrappack-tooltip-${renderer}.png`),Buffer.from(snapshot.data,'base64'));

    await mouse('mouseMoved',100,100);
    await check('!s.itemTooltip.visible && s.tooltipTimer===null',true,'leave hides and cancels timer');
    await mouse('mouseMoved',225,175);
    await delay(70);
    await mouse('mouseMoved',375,175);
    await check("s.hoveredItem.itemModel.id==='vest' && !s.itemTooltip.visible",true,'quick switch hides previous item');
    await waitFor('s.itemTooltip.visible','replacement hover');
    await check('tooltipTexts()[0]','Makeshift Vest','new target gets its own timer');

    await mouse('mouseMoved',100,100);
    await evaluate(`s.visualItemsMap.get('gun').itemModel.name='Long Laser Pistol Name '.repeat(6);
        s.visualItemsMap.get('gun').setPosition(740,540)`);
    await hover(780,580);
    await check(`(() => {const t=s.itemTooltip;return t.container.x>=8 && t.container.y>=8
        && t.container.x+280<=792 && t.container.y+t.height<=592
        && t.labels.filter(l=>l.visible).every(l=>l.width<=256);})()`,true,'long name wraps and bottom-right flips inside viewport');
    await check('tooltipTexts()[0]','Long Laser Pistol Name '.repeat(6),'full title preserved');
    await mouse('mouseMoved',100,100);
    await evaluate("s.visualItemsMap.get('gun').setPosition(0,0)");
    await hover(2,2);
    await check('[s.itemTooltip.container.x,s.itemTooltip.container.y]',[18,18],'top-left cursor offset');
    await evaluate('s.input.emit("gameout")');
    await check('!s.itemTooltip.visible && s.tooltipTimer===null',true,'gameout hides tooltip');
    await restart();

    // The new ground panel exposes one model-owned item at a time.
    await evaluate(`s.run.mode='exploration';seed([{type:'wire',id:'under'},{type:'armor',id:'over'}]);
        s.groundPage=s.run.itemsAtHero().findIndex(i=>i.id==='over');s.updateCombatUI()`);
    let groundPoint=await read("(()=>{const r=s.visualItemsMap.get('over').rect;return [r.x+10,r.y+10]})()");
    await hover(...groundPoint);
    await check('tooltipTexts()[0]','Makeshift Vest','current ground page is viewable');
    await check("s.visualItemsMap.get('under').rect.visible||s.visualItemsMap.get('under').rect.input.enabled",false,'other ground page cannot receive input');
    await mouse('mouseMoved',100,100);
    await evaluate("s.groundPage=s.run.itemsAtHero().findIndex(i=>i.id==='under');s.updateCombatUI()");
    groundPoint=await read("(()=>{const r=s.visualItemsMap.get('under').rect;return [r.x+10,r.y+10]})()");
    await hover(...groundPoint);
    await check('tooltipTexts()[0]','Copper Wire','switching ground page preserves earlier item');
    await restart();

    // Changes to the actual power grid must update the active stat without a new hover.
    await evaluate(`seed([{type:'weapon',id:'gun',x:0,y:0}])`);
    await hover(225,175);
    await evaluate(`seed([{type:'battery',id:'source',x:2,y:0,voltageType:'high',charge:12,maxCharge:12}])`);
    // The open tooltip refreshes on the next Phaser frame, which can take longer on CI.
    await waitFor('tooltipLabels().some(l=>l.text==="► Powered damage: 22")',
        'stationary powered effect refresh');
    await check('tooltipLabels().find(l=>l.text.startsWith("►")).text','► Powered damage: 22','stationary active effect updates');
    await check('tooltipTexts().includes("Connected batteries: 1")',true,'current sources shown');
    await click(225,175);
    await hover(325,175);
    await evaluate('s.resolveTurn()');
    await check('!s.itemTooltip.visible && s.tooltipTimer.delay===300',true,'turn restarts hover delay at stationary cursor');
    await waitFor('s.itemTooltip.visible','post-turn battery hover');
    await check('tooltipTexts().includes("Charge: 10 / 12")',true,'charge reflects successful turn');
    await evaluate(`s.visualItemsMap.get('source').itemModel.charge=2;s.nextAllowedTurnAt=0;s.resolveTurn()`);
    await check("!s.itemTooltip.visible && !s.visualItemsMap.has('source') && s.tooltipTimer===null",true,'depleted hovered battery cancels tooltip');
    await hover(225,175);
    await check('tooltipLabels().find(l=>l.text.startsWith("►")).text','► Base damage: 4','unpowered effect restores');
    await check('tooltipTexts().includes("Connected batteries: 0")',true,'removed source count updates');
    await evaluate('s.game.events.emit("blur")');
    await check('!s.itemTooltip.visible && s.tooltipTimer===null',true,'blur cancels visible tooltip');
    await delay(340);
    await check('s.itemTooltip.visible',false,'no popup while unfocused');
    await evaluate('s.game.events.emit("focus")');
    await waitFor('s.itemTooltip.visible','focus restores viewing');
    await restart();

    // Use real browser movement and rotation. Pixel probes verify the rendered arrow on each side.
    const arrowPixels = async () => {
        await delay(35);
        const screenshot=await send('Page.captureScreenshot',{format:'png',clip:await read(`(()=>{const r=s.game.canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`)});
        return evaluate(`(async () => {
            const image=new Image();image.src='data:image/png;base64,${screenshot.data}';await image.decode();
            const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
            const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,800,600);
            const v=s.visualItemsMap.get('conductor'),r=v.rect,m=v.itemModel;
            const sides=m.type==='wire'?m.connectionPorts:[m.inputDir,m.outputDir];
            return sides.map(side=>{
                const x=r.x+r.width/2+side.x*(r.width/2+6), y=r.y+r.height/2+side.y*(r.height/2+6);
                const pixels=ctx.getImageData(Math.floor(x)-3,Math.floor(y)-3,7,7).data;
                let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-201)<12
                    &&Math.abs(pixels[i+1]-170)<12&&Math.abs(pixels[i+2]-114)<12)count++;
                return count>0;
            });
        })()`);
    };
    for(const type of ['wire','transformer']) {
        await evaluate(`seed([{type:'${type}',id:'conductor',x:1,y:1}])`);
        await hover(275,225);
        await check("s.visualItemsMap.get('conductor').connectionGraphics.commandBuffer.length",0,'hover does not draw arrows');
        await mouse('mousePressed',275,225);
        await check("s.visualItemsMap.get('conductor').connectionGraphics.commandBuffer.length",0,'press does not draw arrows');
        await mouse('mouseMoved',290,225);
        await mouse('mouseMoved',350,250);
        await check('!s.itemTooltip.visible && s.tooltipTimer===null',true,'drag hides all tooltips');
        for(let rotation=0;rotation<4;rotation++) {
            assert.deepEqual(await arrowPixels(),[true,true],`${renderer}: ${type} arrows orientation ${rotation}`);
            await check("s.visualItemsMap.get('conductor').connectionGraphics.depth",35,'arrow layer');
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
            await send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
        }
        await mouse('mouseMoved',400,320);
        assert.deepEqual(await arrowPixels(),[true,true],`${renderer}: arrows follow position`);
        await mouse('mouseReleased',400,320);
        await check("s.visualItemsMap.get('conductor').connectionGraphics.commandBuffer.length",0,'release clears arrows');
        await waitFor('s.itemTooltip.visible','stationary cursor after drop');
        const point=await read("(()=>{const r=s.visualItemsMap.get('conductor').rect;return [r.x+10,r.y+10]})()");
        await mouse('mousePressed',...point);
        await mouse('mouseMoved',point[0]+15,point[1]);
        await evaluate('s.game.events.emit("blur")');
        await check("s.visualItemsMap.get('conductor').connectionGraphics.commandBuffer.length",0,'cancel clears arrows');
        await mouse('mouseReleased',point[0]+15,point[1]);
        await evaluate('s.game.events.emit("focus")');
        await restart();
    }

    await evaluate(`seed([{type:'weapon',id:'gun',x:0,y:0}])`);
    await mouse('mouseMoved',225,175);
    await delay(80);
    await evaluate('globalThis.oldTooltip=s.itemTooltip;globalThis.oldTimer=s.tooltipTimer;undefined');
    await restart();
    await delay(340);
    await check('!s.itemTooltip.visible && s.tooltipTimer===null && !oldTooltip.container.scene',true,'restart destroys panel and pending timer');
    await check('s.game.events.listenerCount("focus")',focusListeners,'focus listener not duplicated');
    await check('document.documentElement.lang','en','HTML language');
    await check(`(() => {const all=s.children.getAll().filter(o=>o.type==='Text').map(o=>o.text);
        all.push(...Array.from(s.visualItemsMap.values(),v=>v.itemModel.name));return all.every(t=>!/[А-Яа-яЁё]/.test(t));})()`,true,'visible copy is English');
    console.log(`PASS ${renderer}: all tooltips, delay, live data, arrow pixels and lifecycle`);
}
