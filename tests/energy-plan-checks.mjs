import { setTimeout as delay } from 'node:timers/promises';

export async function runEnergyPlanChecks({ evaluate, read, check, mouse, click, restart, renderer }) {
    const waitFor = async (predicate,label) => {
        for(let i=0;i<100;i++) {if(await read(predicate))return;await delay(20);}
        throw Error(`${renderer}: timeout: ${label}`);
    };
    const hover = async (x,y) => {
        await mouse('mouseMoved',x,y);
        await waitFor('s.itemTooltip.visible','tooltip');
    };
    const activeLine = `s.itemTooltip.labels.filter(l=>l.visible).find(l=>l.text.startsWith('►')).text`;
    const seedChain = charge => evaluate(`seed([{type:'battery',id:'A',x:0,y:0,charge:${charge}},
        {type:'transformer',id:'transformer',x:1,y:0},{type:'weapon',id:'gun',x:2,y:0}])`);
    await restart();
    for(const charge of [1,3,4,5]) {
        await seedChain(charge);
        await click(325,175);
        await hover(325,175);
        await check("[s.visualItemsMap.get('gun').itemModel.isPowered,(s.visualItemsMap.get('gun').powerGraphics.commandBuffer.length>0)]",
            [true,charge>=4],'physical connection and affordable power indicator are distinct');
        await check(activeLine,charge>=4?'► Powered damage: 22':'► Base damage: 4','preview matches available energy');
        await click(663,544);
        await check('[s.lastTurnLog.damageDealt,s.combatEngine.playerHp]',[charge>=4?22:4,88],'preview matches actual turn');
        await check("s.visualItemsMap.get('A')?.itemModel.charge ?? null",charge===4?null:charge>=4?charge-4:charge,'source retained or removed as planned');
        await restart();
    }
    await seedChain(5);
    await hover(325,175);
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=3");
    await delay(50);
    await check(activeLine,'► Base damage: 4','stationary tooltip follows charge without BFS');
    await check("[(s.visualItemsMap.get('gun').powerGraphics.commandBuffer.length>0),s.visualItemsMap.get('gun').itemModel.isPowered]",
        [false,true],'power indicator updates without changing physical power');
    await evaluate("s.visualItemsMap.get('A').itemModel.charge=4");
    await delay(50);
    await check(activeLine,'► Powered damage: 22','stationary tooltip restores affordable effect');
    await check("(s.visualItemsMap.get('gun').powerGraphics.commandBuffer.length>0)",true,'power indicator restores with charge');
    await restart();

    // Both physical connections are direct. The unselected preview includes the other selected type.
    await evaluate(`seed([{type:'battery',id:'A',x:0,y:0,charge:2},
        {type:'weapon',id:'gun',x:1,y:0,requiredVoltage:'low'},{type:'armor',id:'vest',x:0,y:1}])`);
    await delay(35);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).powerGraphics.commandBuffer.length>0)",[true,true],'unselected solo previews');
    await click(275,175);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).powerGraphics.commandBuffer.length>0)",[true,false],'unselected armor preview includes selected weapon');
    await click(225,225);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).powerGraphics.commandBuffer.length>0)",[false,false],'shared conflict updates both selected power indicators');
    await hover(275,175);
    await check(activeLine,'► Base damage: 4','joint conflict weapon tooltip');
    await hover(225,225);
    await check(activeLine,'► Base shield: 2','joint conflict armor tooltip');
    await evaluate('s.resolveTurn()');
    await check('[s.lastTurnLog.damageDealt,s.lastTurnLog.shieldGenerated,s.visualItemsMap.get("A").itemModel.charge]',[4,2,2],'joint preview and actual base effects agree');
    await click(275,175);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).powerGraphics.commandBuffer.length>0)",[false,true],'unselected weapon preview includes selected armor');
    await click(225,225);
    await check("['gun','vest'].map(id=>s.visualItemsMap.get(id).powerGraphics.commandBuffer.length>0)",[true,true],'clearing selection restores solo previews');
    await restart();
    console.log(`PASS ${renderer}: affordable power indicators, tooltip and actual turn consistency`);
}
