import { setTimeout as delay } from 'node:timers/promises';

// Exercise the real Phaser frame refresh, rather than forcing a tooltip layout.
export async function runSlowTooltipChecks({ evaluate, read, check, mouse, restart, send, renderer, group }) {
    const rate = 6;
    const snapshot = `({
        visible:s.itemTooltip.visible,
        target:s.hoveredItem?.itemModel.id,
        pointer:[s.input.activePointer.x,s.input.activePointer.y],
        frame:s.game.loop.frame,
        texts:s.itemTooltip.labels.filter(label=>label.visible).map(label=>label.text)
    })`;
    const waitForTooltip = async (target, texts, label) => group(`slow tooltip: ${label}`, async () => {
        const deadline = Date.now() + 5000;
        let observed;
        do {
            observed = await read(snapshot);
            if (observed.visible && observed.target === target && texts.every(text => observed.texts.includes(text))) return;
            await delay(25);
        } while (Date.now() < deadline);
        throw new Error(`${renderer}: slow tooltip timed out (${rate}x CPU): ${label}; `
            + `expected ${JSON.stringify({ target, texts })}; last observed ${JSON.stringify(observed)}`);
    });
    const hover = async (x, y, target, texts) => {
        await mouse('mouseMoved', x, y);
        await waitForTooltip(target, texts, `open ${target}`);
        await check('s.tooltipTimer===null', true, 'slow tooltip has finished its initial hover timer');
    };

    await restart();
    let scenarioError;
    try {
        await send('Emulation.setCPUThrottlingRate', { rate });
        await evaluate(`seed([{definitionId:'laser_pistol',type:'weapon',id:'slow-gun',x:0,y:0}])`);
        await hover(225, 175, 'slow-gun', ['► Base damage: 4', 'Connected batteries: 0']);
        const gunPointer = await read('[s.input.activePointer.x,s.input.activePointer.y]');

        // No mouse movement, turn, or explicit tooltip refresh after each mutation.
        await evaluate(`seed([{definitionId:'heavy_battery',type:'battery',id:'slow-source',x:2,y:0}])`);
        await waitForTooltip('slow-gun', ['► Powered damage: 22', 'Connected batteries: 1'], 'connected source powers open weapon');
        await evaluate(`s.inventory.items.find(item=>item.id==='slow-source').charge=0.005`);
        await waitForTooltip('slow-gun', ['► Base damage: 4', 'Connected batteries: 1',
            '! Insufficient charge for powered damage.'], 'tiny charge removes powered effect');
        await evaluate(`s.inventory.items.find(item=>item.id==='slow-source').charge=12`);
        await waitForTooltip('slow-gun', ['► Powered damage: 22', 'Connected batteries: 1'], 'restored charge powers open weapon');
        await check('[s.input.activePointer.x,s.input.activePointer.y]', gunPointer, 'slow weapon refresh keeps cursor stationary');

        await hover(325, 175, 'slow-source', ['Charge: 12 / 12', '100%']);
        const batteryPointer = await read('[s.input.activePointer.x,s.input.activePointer.y]');
        await evaluate(`s.inventory.items.find(item=>item.id==='slow-source').charge=0.005`);
        await waitForTooltip('slow-source', ['Charge: <0.01 / 12', '<1%'], 'tiny charge and percentage refresh');
        await evaluate(`s.inventory.items.find(item=>item.id==='slow-source').charge=0`);
        await waitForTooltip('slow-source', ['Charge: 0 / 12', '0%'], 'zero charge and percentage refresh');
        await evaluate(`s.inventory.items.find(item=>item.id==='slow-source').charge=12`);
        await waitForTooltip('slow-source', ['Charge: 12 / 12', '100%'], 'full charge and percentage restore');
        await check('[s.input.activePointer.x,s.input.activePointer.y]', batteryPointer, 'slow battery refresh keeps cursor stationary');
        await check("[s.inventory.items.find(item=>item.id==='slow-source').charge,s.completedTurns]", [12, 0],
            'slow tooltip inspection preserves charge and spends no turns');
    } catch (error) {
        scenarioError = error;
        throw error;
    } finally {
        // Do not slow down subsequent groups, including when a predicate fails.
        try {
            await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        } catch (error) {
            if (!scenarioError) throw error;
            scenarioError.message += `; CPU throttle reset also failed: ${error.message}`;
        }
    }
    await restart();
    console.log(`PASS ${renderer}: slow tooltip at ${rate}x CPU, stationary power/charge refresh; CPU rate restored to 1`);
}
