// Integration checks use real Phaser rendering and browser input; no production test hooks.
// Requires Chrome (or CHROME_BIN) and Node 24.x.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnCaptured, awaitReady, createCdp, stopOwnedProcess, writeFailureArtifacts } from './browser-harness.mjs';
import { browserFixtureSource } from './browser-fixtures.mjs';
import { runTask4Checks } from './task4-checks.mjs';
import { runSlowTooltipChecks } from './slow-tooltip-checks.mjs';
import { runEnergyPlanChecks } from './energy-plan-checks.mjs';
import { runPowerReasonChecks } from './power-reason-checks.mjs';
import { captureVisualScenarios } from './visual-scenarios.mjs';
import { runVisualPrototypeChecks } from './visual-prototype-checks.mjs';
import { runExplorationChecks } from './exploration-checks.mjs';
import { runCraftingChecks } from './crafting-checks.mjs';
import { runItemFeedbackChecks } from './ui-feedback-checks.mjs';
import { runTacticalCombatChecks } from './tactical-combat-checks.mjs';

const origin = 'http://127.0.0.1:4175';
let profile;
let server;
let chrome;
let cdp;
let transport;
let currentRenderer = 'startup';
let currentCheck = 'start Vite';
let activeSessionId;
let runFailed = false;
let closing = false;
const controller = new AbortController();
const browserErrors = [];
const timeout = setTimeout(() => controller.abort(new Error('Browser checks exceeded 240 seconds.')), 240_000);
const interrupt = () => controller.abort(new Error('Browser checks interrupted by SIGINT.'));
const terminate = () => controller.abort(new Error('Browser checks interrupted by SIGTERM.'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);
const watchProcess = state => state.child.once('exit', (code, signal) => {
    if (!closing) controller.abort(new Error(`${state.label} exited unexpectedly: code=${code}, signal=${signal}.\n${state.stderr || state.stdout}`));
});

try {
    profile = await mkdtemp(join(tmpdir(), 'scrappack-ui-'));
    server = spawnCaptured('Vite', process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
        '--port', '4175', '--strictPort']);
    watchProcess(server);
    await awaitReady(server, origin, { signal: controller.signal });
    currentCheck = 'start Chrome';
    chrome = spawnCaptured('Chrome', process.env.CHROME_BIN || 'google-chrome', [
        '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--remote-debugging-pipe', `--user-data-dir=${profile}`
    ], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
    watchProcess(chrome);
    transport = createCdp(chrome.child, {
        signal: controller.signal,
        context: () => `${currentRenderer}: ${currentCheck}`,
        onEvent: message => {
            if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
        }
    });
    cdp = transport.send;

    for (const renderer of ['webgl', 'canvas']) {
        currentRenderer = renderer;
        currentCheck = 'create browser page';
        activeSessionId = undefined;
        const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
        activeSessionId = sessionId;
        currentCheck = 'load game and test fixtures';
        const send = (method, params) => cdp(method, params, sessionId);
        const evaluate = async expression => {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Emulation.setFocusEmulationEnabled', { enabled: true });
        await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
        if (renderer === 'canvas') {
            // Force Phaser.AUTO down its Canvas path without changing the game's config.
            await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
                const original = HTMLCanvasElement.prototype.getContext;
                HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                    return /webgl/i.test(type) ? null : original.call(this, type, ...args);
                };
            })();` });
        }
        await send('Page.navigate', { url: origin });
        await send('Page.bringToFront');
        for (let attempt = 0; attempt < 100; attempt++) {
            if (await evaluate(`location.origin === '${origin}' && document.readyState === 'complete'`)) break;
            await delay(30);
        }
        const ready = await evaluate(browserFixtureSource);
        assert.equal(ready, renderer === 'webgl' ? 2 : 1, `${renderer}: renderer`);
        let heldButtons = 0;
        const mouse = async (type, x, y, button = 'left') => {
            if (type === 'mousePressed') heldButtons = button === 'left' ? 1 : 2;
            if (type === 'mouseReleased') heldButtons = 0;
            const offset = await evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x:r.x,y:r.y,sx:r.width/s.scale.width,sy:r.height/s.scale.height }; })()`);
            await send('Input.dispatchMouseEvent', { type, x: x * offset.sx + offset.x, y: y * offset.sy + offset.y,
                button: type === 'mouseMoved' ? 'none' : button,
                buttons: heldButtons, clickCount: 1 });
        };
        const click = async (x, y, button = 'left') => {
            await mouse('mouseMoved', x, y);
            await mouse('mousePressed', x, y, button);
            await mouse('mouseReleased', x, y, button);
        };
        const read = expression => evaluate(`(${expression})`);
        const check = async (expression, expected, label) => {
            currentCheck = label;
            assert.deepEqual(await read(expression), expected, `${renderer}: ${label}`);
        };
        const group = async (name, run) => { currentCheck = name; return run(); };
        const frame = () => delay(35);
        const restart = () => evaluate('reset()');

        if (process.argv.includes('--tactical-only')) {
            await group('tactical boss and defensive actions', () => runTacticalCombatChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
            await cdp('Target.closeTarget',{targetId});
            continue;
        }

        if (process.argv.includes('--slow-tooltip-only')) {
            await group('slow tooltip refresh', () => runSlowTooltipChecks({ evaluate,read,check,mouse,restart,send,renderer,group }));
            await cdp('Target.closeTarget',{targetId});
            continue;
        }

        if (process.argv.includes('--crafting-only')) {
            await group('crafting UI integration', () => runCraftingChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
            await cdp('Target.closeTarget',{targetId});
            continue;
        }

        if (process.argv.includes('--exploration-only')) {
            await group('exploration UI integration', () => runExplorationChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
            await cdp('Target.closeTarget',{targetId});
            continue;
        }
        await restart();
        await captureVisualScenarios({ evaluate,read,mouse,click,restart,send,renderer },
            process.env.SCRAPPACK_VISUAL_CAPTURE);

        if (process.argv.includes('--visual-only')) {
            await group('visual prototype', () => runVisualPrototypeChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
            await group('item feedback', () => runItemFeedbackChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
            await cdp('Target.closeTarget',{targetId});
            continue;
        }

        await check(`({ hp:s.playerHpText.text, enemy:s.enemyHpText.text, status:s.statusText.text,
            hint:s.hintText.text, ready:s.canEndTurn(), inventory:s.inventory.items.length,
            button:[s.endTurnButton.x,s.endTurnButton.y,s.endTurnButton.width,s.endTurnButton.height] })`,
        { hp:'100 / 100',enemy:'50 / 50',status:'TURN 01',hint:'UNARMED 2 · SHIELD 0\nHEAL 0 · RECOIL 0 · HIT 12',ready:true,inventory:0,button:[550,520,226,48] }, 'initial unarmed state');
        await click(663, 544);
        await check('[s.completedTurns,s.combatEngine.enemyHp,s.run.playerHp]', [1,48,88], 'unarmed turn without equipment');
        await check("s.children.getAll().some(o=>o.type==='Text'&&o.text==='SCAVENGE SCRAP')", false, 'test scavenge removed');
        await check(`Array.from(s.visualItemsMap.values()).every(v => v.rect.x >= uiTheme.ground.x && v.rect.y >= uiTheme.ground.y
            && v.rect.x+v.rect.width <= uiTheme.ground.x+uiTheme.ground.width && v.rect.y+v.rect.height <= uiTheme.ground.y+uiTheme.ground.height)`, true, 'ground bounds');
        await restart();

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0},{type:'weapon',id:'b',x:0,y:1},
            {type:'armor',id:'armor',x:3,y:0},{type:'wire',id:'wire',x:0,y:3}])`);
        await click(225, 175);
        await check(`({ selected:s.inventory.items.find(i=>i.id==='a').isSelectedForTurn,
            count:s.inventory.items.length, powered:s.inventory.items[0].isPowered, ready:s.canEndTurn() })`,
        { selected:true,count:4,powered:false,ready:true }, 'unpowered short click keeps item placed');
        await click(375, 175);
        await click(225, 225);
        await check('s.inventory.items.filter(i=>i.isSelectedForTurn).map(i=>i.id)', ['b','armor'], 'same-type exclusivity');
        await click(225, 225);
        await check('s.inventory.items.filter(i=>i.isSelectedForTurn).map(i=>i.id)', ['armor'], 'toggle off');
        await click(225, 325);
        await click(225, 175, 'right');
        await check('s.inventory.items.filter(i=>i.isSelectedForTurn).map(i=>i.id)', ['armor'], 'wire and right click ignored');
        await click(225, 175);
        await mouse('mousePressed', 225, 175);
        await mouse('mouseMoved', 228, 175);
        await mouse('mouseReleased', 228, 175);
        await check("s.visualItemsMap.get('a').itemModel.isSelectedForTurn", false, 'subthreshold gesture is click');
        await click(225, 175);
        await mouse('mousePressed', 225, 175);
        await mouse('mouseMoved', 240, 175);
        await frame();
        await check(`({drag:!!s.activeDrag,selected:s.visualItemsMap.get('a').itemModel.isSelectedForTurn,
            placed:s.inventory.items.some(i=>i.id==='a'),ready:s.canEndTurn(),hint:s.hintText.text,
            alpha:s.visualItemsMap.get('a').rect.fillAlpha,textAlpha:s.visualItemsMap.get('a').text.alpha})`,
        {drag:true,selected:false,placed:false,ready:false,hint:'FINISH MOVING ITEM',alpha:0.6,textAlpha:1}, 'drag clears selection and blocks turn');
        await evaluate('s.resolveTurn()');
        await check('s.completedTurns', 0, 'turn blocked during drag');
        await send('Input.dispatchKeyEvent', {type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
        await send('Input.dispatchKeyEvent', {type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
        await check(`(() => {const v=s.visualItemsMap.get('a');return [v.itemModel.width,v.itemModel.height,v.rect.input.hitArea.width,v.rect.input.hitArea.height]})()`, [1,2,50,100], 'rotation resizes hit area');
        await mouse('mouseMoved', 225, 175);
        await mouse('mouseReleased', 225, 175);
        await check(`({selected:s.visualItemsMap.get('a').itemModel.isSelectedForTurn,drag:!!s.activeDrag})`, {selected:false,drag:false}, 'returning drag does not click');
        await restart();

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0}])`);
        await click(225,175);
        await mouse('mousePressed',225,175);
        await mouse('mouseMoved',240,175);
        await mouse('mouseMoved',700,350);
        await mouse('mouseReleased',700,350);
        await check(`(() => {const v=s.visualItemsMap.get('a');return {placed:s.inventory.items.length,
            selected:v.itemModel.isSelectedForTurn,inside:v.rect.x>=uiTheme.ground.x&&v.rect.y>=uiTheme.ground.y&&v.rect.x+v.rect.width<=uiTheme.ground.x+uiTheme.ground.width&&v.rect.y+v.rect.height<=uiTheme.ground.y+uiTheme.ground.height}})()`,
        {placed:1,selected:false,inside:false}, 'combat ground drop restores original inventory position');
        const lootPoint = await read(`(() => {const r=s.visualItemsMap.get('a').rect;return [r.x+10,r.y+10]})()`);
        await click(...lootPoint);
        await check("s.visualItemsMap.get('a').itemModel.isSelectedForTurn",true,'restored item remains selectable');
        await mouse('mousePressed',...lootPoint);
        await mouse('mouseMoved',lootPoint[0]+15,lootPoint[1]);
        await evaluate('s.game.events.emit("blur")');
        await mouse('mouseReleased',...lootPoint);
        await check('!!s.activeDrag',false,'blur cancels drag');
        await evaluate('s.game.events.emit("focus")');
        await restart();

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0}])`);
        await click(225,175);
        await mouse('mouseMoved',663,544);
        await delay(160);
        await check('s.endTurnButton.fillColor',0x46515d,'hover fill completes its 120ms transition');
        await mouse('mousePressed',663,544);
        await check('s.endTurnButton.fillColor',0x6b5c43,'pressed fill');
        await mouse('mouseReleased',663,544);
        await click(663,544);
        await check(`({enemy:s.combatEngine.enemyHp,hp:s.combatEngine.playerHp,turns:s.completedTurns,
            shield:s.shieldText.text,selected:s.inventory.items[0].isSelectedForTurn,status:s.statusText.text})`,
        {enemy:46,hp:88,turns:1,shield:'SHIELD LAST: 0',selected:true,status:'TURN 02'},'base damage and double click');
        for (let attempt = 0; attempt < 40 && !(await read('s.canEndTurn()')); attempt++) {
            await delay(20);
        }
        await check('[s.canEndTurn(),s.endTurnButton.alpha]',[true,1],'cooldown expires without selection change');
        await restart();
        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0},{type:'armor',id:'armor',x:3,y:0}])`);
        await click(225,175);
        await click(375,175);
        await click(663,544);
        await check('[s.combatEngine.enemyHp,s.combatEngine.playerHp,s.lastTurnLog.shieldGenerated]',[46,90,2],'base armor');
        await restart();

        await evaluate(`seed([{type:'battery',id:'high',x:0,y:0,width:2,charge:12,maxCharge:12,voltageType:'high'},
            {type:'weapon',id:'a',x:2,y:0},{type:'battery',id:'low',x:0,y:3},
            {type:'armor',id:'armor',x:1,y:3}])`);
        await click(325,175);
        await click(275,325);
        await check(`(() => {const v=s.visualItemsMap.get('a');return [v.rect.isStroked,v.powerGraphics.commandBuffer.length>0,v.selectionGraphics.commandBuffer.length>0,v.rect.fillAlpha]})()`,[false,true,true,1],'power indicator and selection coexist');
        await click(663,544);
        await check(`({enemy:s.combatEngine.enemyHp,hp:s.combatEngine.playerHp,shield:s.shieldText.text,
            high:s.inventory.items.find(i=>i.id==='high').charge,low:s.inventory.items.find(i=>i.id==='low').charge})`,
        {enemy:28,hp:96,shield:'SHIELD LAST: 8',high:10,low:4},'powered damage and weapon plus armor energy drain');
        await evaluate(`s.inventory.items.find(i=>i.id==='high').charge=2; s.nextAllowedTurnAt=0; s.updateCombatUI();
            globalThis.bfsCalls=0;const original=s.inventory.updatePowerGrid.bind(s.inventory);
            s.inventory.updatePowerGrid=()=>{bfsCalls++;original()}`);
        await click(663,544);
        await check(`({battery:s.visualItemsMap.has('high'),grid:s.inventory.grid.flat().includes('high'),
            loot:s.visualItemsMap.has('scrap_battery_01'),powered:s.inventory.items.find(i=>i.id==='a').isPowered,
            selected:s.inventory.items.find(i=>i.id==='a').isSelectedForTurn,bfs:bfsCalls})`,
        {battery:false,grid:false,loot:true,powered:false,selected:true,bfs:1},'depletion removes only placed battery and recalculates once');
        await restart();

        for (const [enemyHp,playerHp,outcome] of [[50,12,'defeat'],[4,12,'defeat']]) {
            await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0}]);s.combatEngine.enemyHp=${enemyHp};s.combatEngine.playerHp=${playerHp};s.updateCombatUI()`);
            await click(225,175);
            await click(663,544);
            await check('s.battleState',outcome,'terminal outcome');
            await check(`({ready:s.canEndTurn(),
                hover:s.visualItemsMap.get('a').rect.input.enabled,drag:s.visualItemsMap.get('a').rect.input.draggable,status:s.statusText.text,
                enemyVisible:s.enemyHpFill.visible,playerVisible:s.playerHpFill.visible})`,
            {ready:false,hover:true,drag:false,status:outcome.toUpperCase(),enemyVisible:enemyHp!==4,playerVisible:playerHp!==12},'terminal controls and zero bars');
            const snapshot=await read('[s.combatEngine.enemyHp,s.combatEngine.playerHp,s.visualItemsMap.size,s.inventory.items[0].isSelectedForTurn]');
            await delay(280);
            await evaluate('s.resolveTurn()');
            await click(650,460);
            await click(225,175);
            await mouse('mousePressed',225,175);
            await mouse('mouseMoved',260,175);
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
            await send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
            await mouse('mouseReleased',260,175);
            await check('[s.combatEngine.enemyHp,s.combatEngine.playerHp,s.visualItemsMap.size,s.inventory.items[0].isSelectedForTurn]',snapshot,'terminal state frozen');
            await mouse('mouseMoved',225,175);
            for(let i=0;i<100 && !(await read('s.itemTooltip.visible'));i++) await delay(20);
            if (!(await read('s.itemTooltip.visible'))) console.error(await read(`({
                focused:s.tooltipFocused,inside:s.pointerInside,hasFocus:s.game.hasFocus,
                drag:!!s.activeDrag,processing:s.isProcessingTurn,hovered:s.hoveredItem?.itemModel.id,
                timer:s.tooltipTimer?.elapsed,now:s.time.now,pointer:[s.input.activePointer.x,s.input.activePointer.y],
                under:s.itemUnderPointer()?.itemModel.id,input:s.visualItemsMap.get('a').rect.input.enabled
            })`));
            await check('s.itemTooltip.visible',true,'tooltips viewable after terminal outcome');
            await check("[s.visualItemsMap.get('a').itemModel.width,s.visualItemsMap.get('a').itemModel.height]",[2,1],'terminal rotation remains locked');
            if(enemyHp===4&&playerHp===12) await check('s.messages.at(-1).includes("both died")',true,'simultaneous deaths logged');
            await restart();
        }

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0}]);globalThis.calls=0;
            s.combatEngine.processAction=()=>{calls++;s.combatEngine.playerHp=73;s.inventory.removeItem('a');throw Error('Injected partial failure')}`);
        await click(225,175);
        await click(663,544);
        await evaluate('s.resolveTurn()');
        await check(`({calls,error:s.hasCombatError,hp:s.playerHpText.text,turn:s.completedTurns,
            processing:s.isProcessingTurn,hint:s.hintText.text,ready:s.canEndTurn()})`,
        {calls:1,error:true,hp:'73 / 100',turn:0,processing:false,hint:'ERROR: START A NEW RUN',ready:false},'partial error synchronizes and never retries');
        await restart();

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0},{type:'weapon',id:'b',x:0,y:1}]);
            s.inventory.items.forEach(i=>i.isSelectedForTurn=true);s.resolveTurn()`);
        await check('[s.completedTurns,s.messages.at(-1).includes("Turn cancelled")]',[0,true],'invalid selection cancels before engine');
        await evaluate(`for(let i=0;i<70;i++)s.appendMessage('LongWeaponNameWithoutSpaces'.repeat(8));s.updateCombatUI()`);
        await check(`({history:s.messages.length,lines:s.logText.text.split(String.fromCharCode(10)).length,fits:s.logText.width<=452
            &&s.logText.height<=60,mask:!!s.logText.mask||!!s.logText.filters?.external.list.length})`,
        {history:64,lines:4,fits:true,mask:true},'bounded wrapped log');
        await evaluate(`s.combatEngine = new (s.combatEngine.constructor)(s.inventory,0,0,12,'Rad-Scorpion');s.run.playerHp=0;s.updateCombatUI()`);
        await check('[s.playerHpFill.visible,s.enemyHpFill.visible]',[false,false],'zero maximum health');
        await restart();

        await group('tooltips and connection arrows', () => runTask4Checks({ evaluate,read,check,mouse,click,restart,send,renderer }));
        await group('tactical boss and defensive actions', () => runTacticalCombatChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
        await group('slow tooltip refresh', () => runSlowTooltipChecks({ evaluate,read,check,mouse,restart,send,renderer,group }));
        await group('energy allocation and transformer chain', () => runEnergyPlanChecks({ evaluate,read,check,mouse,click,restart,renderer }));
        await group('power shortage reasons', () => runPowerReasonChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
        await group('visual prototype', () => runVisualPrototypeChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));
        await group('item feedback', () => runItemFeedbackChecks({ evaluate,read,check,mouse,click,restart,send,renderer }));

        const listeners = await read(`({children:s.children.length,up:s.input.listenerCount('pointerup'),
            move:s.input.listenerCount('pointermove'),rotate:s.input.keyboard.listenerCount('keydown-R'),
            blur:s.game.events.listenerCount('blur')})`);
        for(let i=0;i<3;i++)await restart();
        await check(`({children:s.children.length,up:s.input.listenerCount('pointerup'),
            move:s.input.listenerCount('pointermove'),rotate:s.input.keyboard.listenerCount('keydown-R'),
            blur:s.game.events.listenerCount('blur')})`,listeners,'restart keeps listener and UI counts');
        await check(`({turn:s.completedTurns,history:s.messages.length,error:s.hasCombatError,
            active:s.battleState,drag:!!s.activeDrag,delay:s.nextAllowedTurnAt,items:s.visualItemsMap.size})`,
        {turn:0,history:1,error:false,active:'active',drag:false,delay:0,items:1},'restart resets state');
        const image = await send('Page.captureScreenshot',{format:'png',clip:await read(`(()=>{const r=s.game.canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`)});
        await writeFile(join(tmpdir(),`scrappack-${renderer}.png`),Buffer.from(image.data,'base64'));
        console.log(`PASS ${renderer}: selection, gestures, combat, energy, terminal states, errors, log, restart`);
        await cdp('Target.closeTarget',{targetId});
    }
    currentCheck = 'no uncaught browser errors';
    assert.deepEqual(browserErrors, [], 'No uncaught browser errors');
    if (controller.signal.aborted) throw controller.signal.reason;
} catch (error) {
    runFailed = true;
    console.error(`FAIL ${currentRenderer}: ${currentCheck}: ${error.message}`);
    try {
        const directory = await writeFailureArtifacts({ error, renderer: currentRenderer, currentCheck,
            server, chrome, transport, sessionId: activeSessionId, browserErrors });
        console.error(`Failure artifacts: ${directory}`);
    } catch (artifactError) { console.error(`Could not save failure artifacts: ${artifactError.message}`); }
    process.exitCode = 1;
} finally {
    closing = true;
    clearTimeout(timeout);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    controller.abort(new Error('Browser checks finished.'));
    if (chrome?.child.pid && !chrome.exited) {
        await cdp?.('Browser.close', {}, undefined, { timeoutMs: 500, signal: null }).catch(() => {});
    }
    for (const state of [chrome, server]) {
        try { await stopOwnedProcess(state); }
        catch (error) { console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1; }
    }
    transport?.dispose();
    if (profile) {
        try { await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) { console.error(`Profile cleanup failed (${error.code}).`); process.exitCode = 1; }
    }
    if (!runFailed && process.exitCode) console.error('Checks completed but cleanup failed.');
}
