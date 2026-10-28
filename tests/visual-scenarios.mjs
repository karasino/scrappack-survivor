import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// The same real-game fixture is used on both sides of the visual comparison.
export async function captureVisualScenarios({ evaluate, read, mouse, click, restart, send, renderer }, stage) {
    if (!['before', 'after'].includes(stage)) return;
    const directory = join(process.cwd(), 'artifacts', 'visual-prototype', stage);
    await mkdir(directory, { recursive: true });
    await restart();
    await evaluate(`seed([
        {type:'battery',id:'preview-battery',definitionId:'weak_battery',x:0,y:0,charge:5},
        {type:'transformer',id:'preview-transformer',x:1,y:0},
        {type:'weapon',id:'preview-pistol',definitionId:'laser_pistol',x:2,y:0},
        {type:'armor',id:'preview-armor',x:0,y:1},
        {type:'battery',id:'preview-heavy',definitionId:'heavy_battery',name:'Heavy Battery',
            x:0,y:4,width:2,voltageType:'high',charge:12,maxCharge:12},
        {type:'wire',id:'preview-wire',x:2,y:4}
    ]);s.visualItemsMap.get('scrap_battery_01').setPosition(562,280)`);
    const capture = async name => {
        await delay(150);
        const clip = await read(`(() => {const r=document.querySelector('canvas').getBoundingClientRect();
            return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
        const screenshot = await send('Page.captureScreenshot', { format: 'png', clip });
        await writeFile(join(directory, `${renderer}-${name}.png`), Buffer.from(screenshot.data, 'base64'));
    };
    await mouse('mouseMoved',20,20);
    await capture('normal');
    await click(325,175);
    await mouse('mouseMoved',20,20);
    await capture('powered-selected');
    await evaluate(`s.inventory.items.find(i=>i.id==='preview-battery').charge=3;s.updateCombatUI()`);
    await mouse('mouseMoved',325,175);
    for (let i=0;i<100 && !(await read('s.itemTooltip.visible'));i++) await delay(20);
    if (!(await read('s.itemTooltip.visible'))) throw Error('Visual capture tooltip did not open');
    await capture('warning');
    await mouse('mouseMoved',325,375);
    await mouse('mousePressed',325,375);
    await mouse('mouseMoved',340,375);
    await capture('drag-connections');
    await mouse('mouseReleased',340,375);
    await restart();
    console.log(`CAPTURE ${renderer}: ${directory}`);
}
