import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseHarnessArgs, defaultTimeoutMs } from '../scripts/run-harness.mjs';
import { spawnCaptured, awaitReady, stopOwnedProcess } from './browser-harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runner = join(root, 'scripts/run-harness.mjs');
const hang = join(root, 'tests/fixtures/harness-hang.mjs');
const helper = pathToFileURL(join(root, 'tests/browser-harness.mjs')).href;

async function fixture(t, source, name = 'case.test.mjs') {
    const directory = await mkdtemp(join(tmpdir(), 'scrappack-harness-timeout-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, name);
    await writeFile(file, source);
    return { directory, file };
}

async function exited(state, timeoutMs = 6000) {
    const deadline = performance.now() + timeoutMs;
    while (!state.exited && !state.error && performance.now() < deadline) await delay(20);
    assert.ok(state.exited || state.error, `command must finish: ${state.stdout}\n${state.stderr}`);
    return state;
}

async function stopped(pid) {
    try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
        return ['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
    } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

function launch(t, args, extraEnv = {}) {
    const env = { ...process.env, ...extraEnv }; delete env.NODE_TEST_CONTEXT;
    const state = spawnCaptured('Harness supervisor', process.execPath, [runner, ...args], { cwd: root, env });
    t.after(async () => {
        if (!state.exited) {
            state.child.kill('SIGTERM');
            await exited(state, 3500).catch(() => {});
        }
        await stopOwnedProcess(state, 100);
        // Independent fallback so a regression in the supervisor does not leak the fixture.
        for (const match of state.stdout.matchAll(/HANG READY (\d+) (\d+)|ORPHAN (\d+)/g)) {
            try { process.kill(-Number(match[1] ?? match[3]), 'SIGKILL'); }
            catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
    });
    return state;
}

async function assertHangStopped(state) {
    const match = state.stdout.match(/HANG READY (\d+) (\d+)/);
    assert.ok(match, 'both grouped parent and grandchild must have reached readiness');
    for (const pid of match.slice(1)) assert.equal(await stopped(pid), true, `owned process ${pid} must stop`);
    assert.match(state.stderr, /Cleanup complete/);
}

test('harness supervisor validates the total limit before starting tests', async t => {
    assert.deepEqual(parseHarnessArgs(['a.mjs']), { files: ['a.mjs'], timeoutMs: defaultTimeoutMs });
    assert.deepEqual(parseHarnessArgs(['a.mjs', '--timeout-ms', '123', 'b.mjs']), { files: ['a.mjs', 'b.mjs'], timeoutMs: 123 });
    for (const value of [undefined, '0', '-1', '1.5', 'NaN', 'Infinity', '2147483648', '9007199254740993']) {
        assert.throws(() => parseHarnessArgs(['a.mjs', '--timeout-ms', ...(value === undefined ? [] : [value])]), /integer/);
    }
    assert.throws(() => parseHarnessArgs([]), /Select/);
    assert.throws(() => parseHarnessArgs(['--unknown', 'a.mjs']), /Unknown option/);
    const state = await exited(launch(t, [hang, '--timeout-ms', '0']));
    assert.equal(state.code, 2); assert.match(state.stderr, /integer/); assert.doesNotMatch(state.stdout, /HANG READY/);
});

test('harness supervisor preserves original assertion diagnostics and exit code', async t => {
    const { file } = await fixture(t, "import test from 'node:test'; test('named failure',()=>{throw Error('supervisor fixture assertion')});");
    const state = await exited(launch(t, [file]));
    assert.equal(state.code, 1); assert.match(state.stdout, /named failure/);
    assert.match(state.stdout + state.stderr, /supervisor fixture assertion/);
    assert.doesNotMatch(state.stderr, /Timed out/);
});

test('total deadline kills a hanging worker and orphaned grouped descendant, preserving unrelated processes', async t => {
    const unrelated = spawnCaptured('Unrelated fixture', process.execPath, ['-e', "setInterval(()=>{},1000);console.log('READY')"]);
    t.after(() => stopOwnedProcess(unrelated, 100));
    await awaitReady(unrelated, 'READY');
    const start = performance.now();
    const state = launch(t, [hang, '--timeout-ms', '2000']);
    await awaitReady(state, 'HANG READY', { timeoutMs: 1900 });
    await exited(state);
    assert.equal(state.code, 124); assert.match(state.stderr, /Timed out after 2000 ms/);
    assert.ok(performance.now() - start < 5500, 'total limit and cleanup must be bounded');
    await assertHangStopped(state);
    assert.equal(unrelated.exited, false); assert.equal(await stopped(unrelated.child.pid), false);
});

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    test(`harness supervisor handles ${signal} with cleanup and exit ${code}`, async t => {
        const state = launch(t, [hang]);
        await awaitReady(state, 'HANG READY', { timeoutMs: 5000 });
        state.child.kill(signal);
        await exited(state);
        assert.equal(state.code, code); assert.doesNotMatch(state.stderr, /Timed out/);
        await assertHangStopped(state);
    });
}

test('supervisor preserves SIGKILL of the runner and still cleans its detached descendants', async t => {
    const state = launch(t, [hang]);
    await awaitReady(state, 'RUNNER', { timeoutMs: 5000 });
    const [, pid] = state.stdout.match(/RUNNER (\d+)/);
    process.kill(Number(pid), 'SIGKILL');
    await exited(state);
    assert.equal(state.code, 137); assert.match(state.stderr, /Tests exited from SIGKILL/);
    await assertHangStopped(state);
});

test('successful runner exit cleans leftovers, including a new detached group created during TERM', async t => {
    const { directory, file } = await fixture(t, '');
    const latePidFile = join(directory, 'late.pid');
    const leftover = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');
        process.on('SIGTERM',()=>{
            const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:'ignore'});
            child.unref();writeFileSync(${JSON.stringify(latePidFile)},String(child.pid));process.exit(0);
        });setInterval(()=>{},1000);console.log('READY');`;
    await writeFile(file, `import test from 'node:test'; import {spawnCaptured,awaitReady} from ${JSON.stringify(helper)};
        test('successful case with leftover',async()=>{
            const child=spawnCaptured('Leftover',process.execPath,['-e',${JSON.stringify(leftover)}]);
            await awaitReady(child,'READY'); console.log('ORPHAN '+child.child.pid);
            child.child.stdout.destroy(); child.child.stderr.destroy(); child.child.unref();
        });`);
    const state = await exited(launch(t, [file]));
    assert.equal(state.code, 0, state.stdout + state.stderr);
    assert.match(state.stderr, /Verified 1 executed scenarios/);
    const match = state.stdout.match(/ORPHAN (\d+)/); assert.ok(match);
    assert.equal(await stopped(match[1]), true);
    const latePid = Number(await readFile(latePidFile, 'utf8'));
    t.after(() => {
        try { process.kill(-latePid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
    });
    assert.equal(await stopped(latePid), true, 'the group created after TERM must also stop');
});

test('outer deadline also cleans groups belonging to a nested harness invocation', async t => {
    const { file } = await fixture(t, `import test from 'node:test'; import {spawn} from 'node:child_process';
        test('nested hanging supervisor',async()=>{
            spawn(process.execPath,${JSON.stringify([runner, hang])},{stdio:'inherit'});
            await new Promise(()=>{});
        });`);
    const state = launch(t, [file, '--timeout-ms', '2000']);
    await awaitReady(state, 'HANG READY', { timeoutMs: 1900 });
    await exited(state);
    assert.equal(state.code, 124); await assertHangStopped(state);
});

test('aggregate check preserves real harness timeout 124 and stops before build', async t => {
    const { directory, file } = await fixture(t, '', 'npm-fixture.mjs');
    const log = join(directory, 'steps.jsonl');
    const hung = await fixture(t, "import test from 'node:test'; test('hang',async()=>{setInterval(()=>{},1000);await new Promise(()=>{})});");
    await writeFile(file, `import {appendFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
        const step=process.argv.at(-1);appendFileSync(${JSON.stringify(log)},JSON.stringify(step)+'\\n');
        if(step==='test:harness'){
            const child=spawnSync(process.execPath,${JSON.stringify([runner, hung.file, '--timeout-ms', '300'])},{stdio:'inherit'});
            process.exit(child.status??1);
        }`);
    const env = { ...process.env, npm_execpath: file }; delete env.NODE_TEST_CONTEXT;
    const state = spawnCaptured('Aggregate timeout fixture', process.execPath, [join(root, 'scripts/check.mjs')], { cwd: root, env });
    t.after(() => stopOwnedProcess(state, 100));
    await exited(state);
    assert.equal(state.code, 124); assert.match(state.stderr, /Stopped at test:harness \(exit 124\)/);
    assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse), ['doctor', 'check:docs', 'test:core', 'test:harness']);
});
