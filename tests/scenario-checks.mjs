// Real launcher lifecycle and ordinary input. Detailed rule assertions remain in
// core/energy-plan/power-reason/crafting checks; no complete-run replay here.
import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { runScenario } from '../scripts/scenario.mjs';
import { probePort, repositoryRoot } from '../scripts/doctor.mjs';
import { spawnCaptured, awaitReady, stopOwnedProcess } from './browser-harness.mjs';

const snapshot = `({seed:s.run.seed,rng:s.run.rngState,mode:s.run.mode,world:s.run.worldTurn,
    size:[s.inventory.width,s.inventory.height],hp:s.run.playerHp,enemy:s.combatEngine.enemyHp,
    enemyDamage:s.combatEngine.enemyBaseDamage,turn:s.completedTurns,
    intent:s.combatEngine.enemyIntent,tactics:s.combatEngine.enemyTactics,
    items:s.inventory.items.map(i=>({id:i.id,definition:i.definitionId,x:i.gridX,y:i.gridY,
        q:i.quarterTurns,charge:i.charge,selected:i.isSelectedForTurn})),
    ground:s.run.allGroundItems().map(i=>i.id),materials:s.run.materials})`;

async function controls({ evaluate, send }) {
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const viewport = async (width, height) => {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await delay(120);
        await evaluate('s.applyLayout()');
    };
    await viewport(1366, 650);
    let held = 0;
    const mouse = async (type, x, y) => {
        if (type === 'mousePressed') held = 1;
        if (type === 'mouseReleased') held = 0;
        const point = await evaluate(`(() => { const r=s.game.canvas.getBoundingClientRect();
            return {x:r.x+${x}*r.width/s.scale.width,y:r.y+${y}*r.height/s.scale.height}; })()`);
        await send('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons: held, clickCount: 1 });
        await delay(25);
    };
    const click = async (x, y) => {
        await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
    };
    const key = async () => {
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
    };
    const button = async expression => {
        const point = await evaluate(`(() => { const r=${expression};return [r.x+r.width/2,r.y+r.height/2]; })()`);
        await click(...point);
        for (let attempt=0; attempt<100; attempt++) {
            if (await evaluate('!s.isProcessingTurn && s.time.now>=s.nextAllowedTurnAt')) return;
            await delay(25);
        }
        throw Error('UI did not leave action cooldown');
    };
    return { mouse, click, key, button, viewport };
}

async function assertClean(resources) {
    assert.equal(resources.server.exited, true, 'owned Vite stopped');
    assert.equal(resources.chrome.exited, true, 'owned Chrome stopped');
    await assert.rejects(access(resources.profile), { code: 'ENOENT' });
    assert.deepEqual(await probePort(), { ok: true }, 'port released');
}

async function gestures(api, input, itemId) {
    const { evaluate, send } = api;
    const before = await evaluate(`JSON.stringify(s.inventory.items.map(i=>[i.id,i.gridX,i.gridY,i.quarterTurns]).sort())`);
    const point = await evaluate(`(() => { const r=s.visualItemsMap.get(${JSON.stringify(itemId)}).rect;return [r.x+15,r.y+15]; })()`);
    for (const cancel of ['edge', 'blur', 'resize']) {
        await input.mouse('mouseMoved', ...point);
        await input.mouse('mousePressed', ...point);
        await input.mouse('mouseMoved', point[0]+20, point[1]);
        await input.key();
        assert.equal(await evaluate('!!s.activeDrag && !s.canEndTurn() && !s.healButton.enabled'), true, 'drag blocks both actions');
        if (cancel === 'edge') await input.mouse('mouseMoved', 763, 270); // GROUND header/outside item region
        if (cancel === 'blur') {
            await send('Emulation.setFocusEmulationEnabled', { enabled: false });
            await evaluate('window.dispatchEvent(new Event("blur"))');
        }
        if (cancel === 'resize') await input.viewport(800, 600);
        await input.mouse('mouseReleased', cancel === 'edge' ? 763 : point[0]+20, cancel === 'edge' ? 270 : point[1]);
        await delay(80);
        assert.equal(await evaluate('!!s.activeDrag'), false, cancel+' cancels drag');
        assert.equal(await evaluate(`JSON.stringify(s.inventory.items.map(i=>[i.id,i.gridX,i.gridY,i.quarterTurns]).sort())`), before, cancel+' restores placement/orientation');
        await send('Emulation.setFocusEmulationEnabled', { enabled: true });
        await evaluate('window.dispatchEvent(new Event("focus"))');
        await input.viewport(1366, 650);
    }
}

// Each pair is launched twice: one run exercises input, the next must reproduce
// the entire initial snapshot after the previous run changed resources/state.
for (const renderer of ['webgl', 'canvas']) for (const id of ['transformer-chain', 'combat-heal']) {
    let initial, resources;
    for (let repeat = 0; repeat < 2; repeat++) {
        const code = await runScenario({ id, renderer }, { headless: true, onReady: async api => {
            resources = api;
            const input = await controls(api);
            const state = await api.evaluate(snapshot);
            assert.equal(state.seed, 170117);
            assert.equal(state.rng, 170117);
            assert.equal(state.mode, 'combat');
            assert.equal(state.world, 0);
            assert.deepEqual(state.ground, []);
            assert.equal(state.hp, id === 'combat-heal' ? 60 : 100);
            assert.equal(state.enemy, id === 'combat-heal' ? 24 : 50);
            assert.equal(state.enemyDamage, id === 'combat-heal' ? 8 : 12);
            assert.deepEqual(state.size, id === 'combat-heal' ? [4,4] : [6,6]);
            assert.deepEqual(state.items.map(item=>[item.definition,item.x,item.y,item.q,item.selected]),
                id === 'combat-heal' ? [
                    ['heavy_battery',0,0,0,false], ['laser_pistol',2,0,0,true],
                    ['weak_battery',0,2,0,false], ['makeshift_vest',1,2,0,true], ['medkit',0,1,0,false]
                ] : [ ['weak_battery',0,0,0,false], ['step_up_transformer',1,0,0,false], ['laser_pistol',2,0,0,false] ]);
            assert.deepEqual(state.items.filter(item=>item.definition.includes('battery')).map(item=>item.charge),
                id === 'combat-heal' ? [12,5] : [5]);
            if (repeat) {
                assert.deepEqual(state, initial, 'new launch restores exact fixture');
                // Close the tab while onReady remains pending: stopping must not
                // depend on a callback completing, and must be safe twice.
                await api.transport.send('Target.closeTarget', { targetId: api.targetId });
                return new Promise(() => {});
            }
            initial = state;
            const weapon = state.items.find(item => item.definition === 'laser_pistol');
            await gestures(api, input, weapon.id);
            if (id === 'transformer-chain') {
                await input.click(325, 175);
                await input.button('s.endTurnButton');
                assert.deepEqual(await api.evaluate('[s.lastTurnLog.damageDealt,s.run.playerHp,s.combatEngine.enemyHp,s.inventory.items.find(i=>i.id==="A").charge]'), [22,88,28,1]);
                await input.button('s.endTurnButton');
                assert.deepEqual(await api.evaluate('[s.lastTurnLog.damageDealt,s.inventory.items.find(i=>i.id==="A").charge]'), [4,1]);
            } else {
                // Drag clears weapon selection; healing still requires no weapon.
                await input.button('s.healButton.rect');
                assert.deepEqual(await api.evaluate('[s.run.playerHp,s.combatEngine.enemyHp,s.inventory.items.filter(i=>i.definitionId==="medkit").length,s.inventory.items.find(i=>i.voltageType==="high").charge,s.inventory.items.find(i=>i.voltageType==="low").charge]'), [85,24,0,12,4]);
                await input.button('s.healButton.rect');
                assert.deepEqual(await api.evaluate('[s.run.playerHp,s.completedTurns,s.healButton.enabled]'), [85,1,false], 'second heal rejected without kit');
                // Full HP in this encounter cannot be reached with its one kit.
                await api.evaluate(`(async()=>{await prepareScenario('combat-heal');s.run.playerHp=100;s.combatEngine.playerHp=100;s.updateCombatUI()})()`);
                const full = await api.evaluate(snapshot);
                await input.button('s.healButton.rect');
                assert.deepEqual(await api.evaluate(snapshot), full, 'full HP rejects healing atomically');
            }
            api.stop(); api.stop();
        } });
        assert.equal(code, 0, `${renderer}/${id} launch ${repeat+1}`);
        await assertClean(resources);
    }
    console.log(`PASS ${renderer}/${id}: fixture repeatability, input, cancellation and lifecycle`);
}

for (const renderer of ['webgl','canvas']) {
    let initial,resources;
    for(let repeat=0;repeat<2;repeat++) {
        const code=await runScenario({id:'scrap-brute',renderer},{headless:true,onReady:async api=>{
            resources=api;const input=await controls(api),state=await api.evaluate(snapshot);
            assert.deepEqual([state.seed,state.rng,state.mode,state.hp,state.enemy,state.enemyDamage,state.world,state.size],
                [170117,170117,'combat',70,66,14,0,[4,4]]);
            assert.equal(state.intent.type,'strike');
            assert.deepEqual(state.tactics,{repairUsesRemaining:2,repairCooldown:0,slamCooldown:0});
            assert.deepEqual(state.items.map(i=>[i.definition,i.x,i.y,i.q,i.selected]),[
                ['arc_baton',1,0,0,true],['weak_battery',0,0,0,false],['weak_battery',0,1,0,false],
                ['makeshift_vest',2,0,0,true],['weak_battery',2,2,0,false],['dagger',0,2,0,false],
                ['medkit',0,3,0,false],['medkit',1,3,0,false]
            ]);
            if(repeat)assert.deepEqual(state,initial,'new launch restores exact tactical fixture');else initial=state;
            await input.button('s.endTurnButton');
            await input.button('s.endTurnButton');
            assert.equal(await api.evaluate('s.combatEngine.enemyIntent.type'),'slam');
            await input.button('s.braceButton.rect');
            assert.deepEqual(await api.evaluate('[s.run.playerHp,s.combatEngine.enemyHp,s.lastTurnLog.shieldGenerated,s.lastTurnLog.damageTaken]'),[58,42,16,6]);
            api.stop();
        }});
        assert.equal(code,0,`${renderer}/scrap-brute launch ${repeat+1}`);await assertClean(resources);
    }
    console.log(`PASS ${renderer}/scrap-brute: exact fixture repeatability and defensive input`);
}

// Expected failures use the same diagnostic writer as every browser suite.
const artifacts = join(repositoryRoot, 'artifacts/harness');
async function expectFailure(options, extra, pattern, screenshot = false) {
    const before = new Set(await readdir(artifacts).catch(() => []));
    console.log(`EXPECTED FAILURE: ${pattern}`);
    assert.equal(await runScenario(options, { headless: true, ...extra }), 1);
    const created = (await readdir(artifacts)).filter(name => !before.has(name));
    assert.equal(created.length, 1);
    const dir = join(artifacts, created[0]);
    const diagnostic = JSON.parse(await readFile(join(dir, 'failure.json'), 'utf8'));
    assert.match(diagnostic.error, pattern);
    assert.match(diagnostic.check, new RegExp(options.id));
    if (screenshot) await access(join(dir, 'failure.png'));
    else assert.ok(diagnostic.screenshotError);
    assert.deepEqual(await probePort(), { ok: true });
}

// Busy port must remain owned by the unrelated process.
const occupied = createServer();
await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(4175, '127.0.0.1', resolve); });
try {
    console.log('EXPECTED FAILURE: occupied port');
    assert.equal(await runScenario({ id:'combat-heal' }, { headless:true }), 1);
    assert.equal(occupied.listening, true);
} finally { await new Promise(resolve => occupied.close(resolve)); }

await expectFailure({ id:'combat-heal', renderer:'canvas' }, { chromeBin:'/nonexistent/scrappack-chrome' }, /Chrome unavailable/);
await expectFailure({ id:'combat-heal', renderer:'webgl' }, { startupTimeoutMs:1 }, /startup timed out/);
await expectFailure({ id:'combat-heal', renderer:'webgl' }, { onReady:() => { throw Error('Injected preparation verification failure'); } }, /Injected preparation verification failure/, true);

// Exercise the actual CLI signal handler, using a headless Chrome wrapper rather
// than exposing an automation-only flag in the interactive public command.
const scratch = await mkdtemp(join(tmpdir(), 'scrappack-scenario-signals-'));
let cli;
try {
    const wrapper = join(scratch, 'chrome.mjs');
    const executable = process.env.CHROME_BIN || 'google-chrome';
    await writeFile(wrapper, `#!/usr/bin/env node\nimport {spawn} from 'node:child_process';
        const child=spawn(${JSON.stringify(executable)},['--headless=new',...process.argv.slice(2)],{stdio:['ignore','inherit','inherit',3,4]});
        child.on('exit',code=>process.exit(code??1));\n`, { mode:0o755 });
    // --version does not provide CDP fds; use a shell-free version branch.
    await writeFile(wrapper, (await readFile(wrapper, 'utf8')).replace("const child=spawn", "if(process.argv.includes('--version')){console.log('Google Chrome 149.0.0.0');process.exit(0);}\nconst child=spawn"));
    cli = spawnCaptured('Scenario SIGINT', process.execPath, ['scripts/scenario.mjs','combat-heal'], { env:{...process.env,CHROME_BIN:wrapper} });
    await awaitReady(cli, 'READY combat-heal', { timeoutMs:30_000 });
    cli.child.kill('SIGINT');
    const deadline = Date.now()+10_000;
    while (!cli.exited && Date.now()<deadline) await delay(25);
    assert.equal(cli.code, 130, cli.stderr);
    assert.deepEqual(await probePort(), { ok:true });
} finally {
    await stopOwnedProcess(cli);
    await rm(scratch, {recursive:true,force:true});
}
console.log('PASS launcher: validation failures, occupied port, timeout, diagnostics and SIGINT cleanup');
