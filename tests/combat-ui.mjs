// Integration checks use real Phaser rendering and browser input; no production test hooks.
// Requires Chrome (or CHROME_BIN) and Node 22+.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp(join(tmpdir(), 'scrappack-ui-'));
const origin = 'http://127.0.0.1:4175';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
    '--port', '4175', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let chrome;
let cdp;
const pending = new Map();
const browserErrors = [];
const timeout = setTimeout(() => {
    console.error('Browser checks exceeded 90 seconds.');
    server.kill();
    chrome?.kill();
    process.exitCode = 1;
}, 90_000);

try {
    await new Promise((resolve, reject) => {
        server.stdout.on('data', data => { if (data.toString().includes(origin)) resolve(); });
        server.stderr.on('data', data => process.stderr.write(data));
        server.once('error', reject);
        server.once('exit', code => reject(new Error(`Vite exited: ${code}`)));
    });
    chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--remote-debugging-pipe', `--user-data-dir=${profile}`
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    let serial = 0;
    let buffer = '';
    chrome.stdio[4].on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\0')) !== -1) {
            const message = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (message.id) {
                const callback = pending.get(message.id);
                pending.delete(message.id);
                callback?.(message);
            } else if (message.method === 'Runtime.exceptionThrown') {
                browserErrors.push(message.params.exceptionDetails);
            }
        }
    });
    cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, result => result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result));
        chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
    chrome.on('error', error => {
        for (const callback of pending.values()) callback({ error: { message: error.message } });
        pending.clear();
    });

    for (const renderer of ['webgl', 'canvas']) {
        const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params) => cdp(method, params, sessionId);
        const evaluate = async expression => {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 640, deviceScaleFactor: 1, mobile: false });
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
        const ready = await evaluate(`(async () => {
            const { game } = await import('/src/game/main.ts');
            const { Item } = await import('/src/game/core/Item.ts');
            const { LootTable } = await import('/src/game/core/LootTable.ts');
            for (let i = 0; i < 100 && !game.scene.isActive('GameScene'); i++) {
                await new Promise(r => setTimeout(r, 20));
            }
            globalThis.s = game.scene.getScene('GameScene');
            globalThis.seed = (items) => {
                for (const config of items) {
                    const base = LootTable.find(item => item.type === config.type);
                    const item = new Item({ ...base, ...config });
                    s.addItemVisual(item);
                    if (config.x !== undefined) {
                        if (!s.inventory.placeItem(item, config.x, config.y)) throw Error('Invalid fixture placement');
                        s.visualItemsMap.get(item.id).setPosition(200 + 50 * config.x, 150 + 50 * config.y);
                    }
                }
                s.refreshPowerGrid();
                s.updateCombatUI();
            };
            globalThis.reset = async () => {
                const previous = s.combatEngine;
                s.scene.restart();
                for (let i = 0; i < 100 && s.combatEngine === previous; i++) await new Promise(r => setTimeout(r, 20));
                if (s.combatEngine === previous) throw Error('Scene did not restart');
            };
            return game.renderer.type;
        })()`);
        assert.equal(ready, renderer === 'webgl' ? 2 : 1, `${renderer}: renderer`);
        let heldButtons = 0;
        const mouse = async (type, x, y, button = 'left') => {
            if (type === 'mousePressed') heldButtons = button === 'left' ? 1 : 2;
            if (type === 'mouseReleased') heldButtons = 0;
            const offset = await evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x:r.x,y:r.y }; })()`);
            await send('Input.dispatchMouseEvent', { type, x: x + offset.x, y: y + offset.y,
                button: type === 'mouseMoved' ? 'none' : button,
                buttons: heldButtons, clickCount: 1 });
        };
        const click = async (x, y, button = 'left') => {
            await mouse('mouseMoved', x, y);
            await mouse('mousePressed', x, y, button);
            await mouse('mouseReleased', x, y, button);
        };
        const read = expression => evaluate(`(${expression})`);
        const check = async (expression, expected, label) => assert.deepEqual(await read(expression), expected, `${renderer}: ${label}`);
        const frame = () => delay(35);
        const restart = () => evaluate('reset()');

        await check(`({ hp:s.playerHpText.text, enemy:s.enemyHpText.text, status:s.statusText.text,
            hint:s.hintText.text, ready:s.canEndTurn(), inventory:s.inventory.items.length,
            button:[s.endTurnButton.x,s.endTurnButton.y,s.endTurnButton.width,s.endTurnButton.height] })`,
        { hp:'100 / 100',enemy:'50 / 50',status:'TURN 01',hint:'SELECT A WEAPON',ready:false,inventory:0,button:[550,520,226,48] }, 'initial state');
        await click(663, 544);
        await check('s.completedTurns', 0, 'disabled turn');
        await click(650, 460);
        await check('s.visualItemsMap.size', 2, 'scavenge');
        await check(`Array.from(s.visualItemsMap.values()).every(v => v.rect.x >= 562 && v.rect.y >= 246
            && v.rect.x+v.rect.width <= 764 && v.rect.y+v.rect.height <= 408)`, true, 'loot bounds');
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
            selected:v.itemModel.isSelectedForTurn,inside:v.rect.x>=562&&v.rect.y>=246&&v.rect.x+v.rect.width<=764&&v.rect.y+v.rect.height<=408}})()`,
        {placed:0,selected:false,inside:true}, 'invalid drop returns to scrap');
        const lootPoint = await read(`(() => {const r=s.visualItemsMap.get('a').rect;return [r.x+10,r.y+10]})()`);
        await click(...lootPoint);
        await check("s.visualItemsMap.get('a').itemModel.isSelectedForTurn",false,'loot cannot select');
        await mouse('mousePressed',...lootPoint);
        await mouse('mouseMoved',lootPoint[0]+15,lootPoint[1]);
        await evaluate('s.game.events.emit("blur")');
        await mouse('mouseReleased',...lootPoint);
        await check('!!s.activeDrag',false,'blur cancels drag');
        await restart();

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0}])`);
        await click(225,175);
        await mouse('mouseMoved',663,544);
        await check('s.endTurnButton.fillColor',0x164429,'hover fill');
        await mouse('mousePressed',663,544);
        await check('s.endTurnButton.fillColor',0x39ff14,'pressed fill');
        await mouse('mouseReleased',663,544);
        await click(663,544);
        await check(`({enemy:s.combatEngine.enemyHp,hp:s.combatEngine.playerHp,turns:s.completedTurns,
            shield:s.shieldText.text,selected:s.inventory.items[0].isSelectedForTurn,status:s.statusText.text})`,
        {enemy:46,hp:88,turns:1,shield:'SHIELD LAST: 0',selected:true,status:'TURN 02'},'base damage and double click');
        for (let attempt = 0; attempt < 40 && !(await read('s.endTurnButton.alpha === 1')); attempt++) {
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
        await check(`(() => {const v=s.visualItemsMap.get('a');return [v.rect.isStroked,v.selectionGraphics.commandBuffer.length>0,v.rect.fillAlpha]})()`,[true,true,1],'power and selection coexist');
        await click(663,544);
        await check(`({enemy:s.combatEngine.enemyHp,hp:s.combatEngine.playerHp,shield:s.shieldText.text,
            high:s.inventory.items.find(i=>i.id==='high').charge,low:s.inventory.items.find(i=>i.id==='low').charge})`,
        {enemy:28,hp:96,shield:'SHIELD LAST: 8',high:10,low:5},'powered damage and weapon-only energy drain');
        await evaluate(`s.inventory.items.find(i=>i.id==='high').charge=2; s.nextAllowedTurnAt=0; s.updateCombatUI();
            globalThis.bfsCalls=0;const original=s.inventory.updatePowerGrid.bind(s.inventory);
            s.inventory.updatePowerGrid=()=>{bfsCalls++;original()}`);
        await click(663,544);
        await check(`({battery:s.visualItemsMap.has('high'),grid:s.inventory.grid.flat().includes('high'),
            loot:s.visualItemsMap.has('scrap_battery_01'),powered:s.inventory.items.find(i=>i.id==='a').isPowered,
            selected:s.inventory.items.find(i=>i.id==='a').isSelectedForTurn,bfs:bfsCalls})`,
        {battery:false,grid:false,loot:true,powered:false,selected:true,bfs:1},'depletion removes only placed battery and recalculates once');
        await restart();

        for (const [enemyHp,playerHp,outcome] of [[4,100,'victory'],[50,12,'defeat'],[4,12,'defeat']]) {
            await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0}]);s.combatEngine.enemyHp=${enemyHp};s.combatEngine.playerHp=${playerHp};s.updateCombatUI()`);
            await click(225,175);
            await click(663,544);
            await check('s.battleState',outcome,'terminal outcome');
            await check(`({ready:s.canEndTurn(),scavenge:s.scavengeButton.input.enabled,
                item:s.visualItemsMap.get('a').rect.input.enabled,status:s.statusText.text,
                enemyVisible:s.enemyHpFill.visible,playerVisible:s.playerHpFill.visible})`,
            {ready:false,scavenge:false,item:false,status:outcome.toUpperCase(),enemyVisible:enemyHp!==4,playerVisible:playerHp!==12},'terminal controls and zero bars');
            const snapshot=await read('[s.combatEngine.enemyHp,s.combatEngine.playerHp,s.visualItemsMap.size,s.inventory.items[0].isSelectedForTurn]');
            await delay(280);
            await click(663,544);
            await click(650,460);
            await click(225,175);
            await mouse('mousePressed',225,175);
            await mouse('mouseMoved',260,175);
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
            await send('Input.dispatchKeyEvent',{type:'keyUp',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
            await mouse('mouseReleased',260,175);
            await check('[s.combatEngine.enemyHp,s.combatEngine.playerHp,s.visualItemsMap.size,s.inventory.items[0].isSelectedForTurn]',snapshot,'terminal state frozen');
            if(enemyHp===4&&playerHp===12) await check('s.messages.at(-1).includes("both died")',true,'simultaneous deaths logged');
            await restart();
        }

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0}]);globalThis.calls=0;
            s.combatEngine.processTurn=()=>{calls++;s.combatEngine.playerHp=73;s.inventory.removeItem('a');throw Error('Injected partial failure')}`);
        await click(225,175);
        await click(663,544);
        await click(663,544);
        await check(`({calls,error:s.hasCombatError,hp:s.playerHpText.text,turn:s.completedTurns,
            processing:s.isProcessingTurn,hint:s.hintText.text,ready:s.canEndTurn()})`,
        {calls:1,error:true,hp:'73 / 100',turn:0,processing:false,hint:'COMBAT ERROR\nRESTART REQUIRED',ready:false},'partial error synchronizes and never retries');
        await restart();

        await evaluate(`seed([{type:'weapon',id:'a',x:0,y:0},{type:'weapon',id:'b',x:0,y:1}]);
            s.inventory.items.forEach(i=>i.isSelectedForTurn=true);s.resolveTurn()`);
        await check('[s.completedTurns,s.messages.at(-1).includes("Turn cancelled")]',[0,true],'invalid selection cancels before engine');
        await evaluate(`for(let i=0;i<70;i++)s.appendMessage('LongWeaponNameWithoutSpaces'.repeat(8));s.updateCombatUI()`);
        await check(`({history:s.messages.length,lines:s.logText.text.split(String.fromCharCode(10)).length,fits:s.logText.width<=452
            &&s.logText.height<=60,mask:!!s.logText.mask||!!s.logText.filters?.external.list.length})`,
        {history:64,lines:4,fits:true,mask:true},'bounded wrapped log');
        await evaluate(`s.combatEngine = new (s.combatEngine.constructor)(s.inventory,0,0,12,'Rad-Scorpion');s.updateCombatUI()`);
        await check('[s.playerHpFill.visible,s.enemyHpFill.visible]',[false,false],'zero maximum health');
        await restart();

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
        const image = await send('Page.captureScreenshot',{format:'png',clip:{x:8,y:8,width:800,height:600,scale:1}});
        await writeFile(join(tmpdir(),`scrappack-${renderer}.png`),Buffer.from(image.data,'base64'));
        console.log(`PASS ${renderer}: selection, gestures, combat, energy, terminal states, errors, log, restart`);
        await cdp('Target.closeTarget',{targetId});
    }
    assert.deepEqual(browserErrors, [], 'No uncaught browser errors');
} finally {
    clearTimeout(timeout);
    if (chrome && chrome.exitCode === null) {
        const exited = once(chrome, 'exit');
        await cdp?.('Browser.close').catch(() => {});
        await exited;
    }
    server.kill();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
