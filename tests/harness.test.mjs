import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { checkDocuments } from '../scripts/check-docs.mjs';
import { diagnose, inspectChrome, probePort, repositoryRoot } from '../scripts/doctor.mjs';
import { spawnCaptured, awaitReady, createCdp, stopOwnedProcess, writeFailureArtifacts } from './browser-harness.mjs';

async function temporary(t) {
    const path = await mkdtemp(join(tmpdir(), 'scrappack-harness-test-'));
    t.after(() => rm(path, { recursive: true, force: true }));
    return path;
}

async function documentFixture(t) {
    const root = await temporary(t);
    for (const directory of ['docs/tasks/active', 'docs/tasks/done', 'docs/archive', '.agents/skills/scrappack-task']) {
        await mkdir(join(root, directory), { recursive: true });
    }
    const files = {
        'AGENTS.md': '# Инструкции\n[Состояние](docs/status.md)\n',
        'README.md': '# Project\n',
        'docs/status.md': '# State\n<!-- active-task: none -->\n',
        'docs/tasks/README.md': '# Tasks\n',
        'docs/tasks/_template.md': await readFile(join(repositoryRoot, 'docs/tasks/_template.md'), 'utf8'),
        '.agents/skills/scrappack-task/SKILL.md': '# Skill\n',
        'docs/archive/legacy-spec.md': '[Historical missing file](obsolete.md)\n'
    };
    for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text);
    return root;
}

async function addTask(root, status = 'implementing', location = 'active') {
    const id = '2026-11-17-example';
    const text = (await readFile(join(root, 'docs/tasks/_template.md'), 'utf8'))
        .replaceAll('YYYY-MM-DD-short-slug', id)
        .replace('updated: YYYY-MM-DD', 'updated: 2026-11-17')
        .replace('status: draft', `status: ${status}`);
    const path = `docs/tasks/${location}/${id}.md`;
    await writeFile(join(root, path), text);
    if (location === 'active') await writeFile(join(root, 'docs/status.md'), `# State\n<!-- active-task: ${path} -->\n`);
    return path;
}

test('documentation fixture accepts archived history and catches broken navigation', async t => {
    const root = await documentFixture(t);
    assert.deepEqual(await checkDocuments(root), []);
    await writeFile(join(root, 'AGENTS.md'), '[Missing](docs/missing.md)\n');
    assert.ok((await checkDocuments(root)).some(error => error.includes('broken local link')));
});

test('Markdown examples are not links, real references and encoded filenames are checked', async t => {
    const root = await documentFixture(t);
    await writeFile(join(root, 'docs/with space.md'), '# Target\n');
    await writeFile(join(root, 'README.md'), '```md\n[example](absent.md)\n```\n`[also example](absent.md)`\n[real](docs/with%20space.md#heading)\n[ref]: docs/status.md\n');
    assert.deepEqual(await checkDocuments(root), []);
    await writeFile(join(root, 'README.md'), '[ref]: absent.md\n');
    assert.ok((await checkDocuments(root)).some(error => error.includes('absent.md')));
});

test('documentation cannot link outside checkout', async t => {
    const root = await documentFixture(t);
    await writeFile(join(root, 'README.md'), '[outside](../outside.md)\n');
    assert.ok((await checkDocuments(root)).some(error => error.includes('broken local link')));
});

test('instruction budgets count UTF-8 bytes', async t => {
    const root = await documentFixture(t);
    await writeFile(join(root, 'AGENTS.md'), 'я'.repeat(4097));
    await writeFile(join(root, 'docs/status.md'), '<!-- active-task: none -->\n' + 'я'.repeat(2048));
    const errors = await checkDocuments(root);
    assert.ok(errors.some(error => error.includes('8192')));
    assert.ok(errors.some(error => error.includes('4096')));
});

test('active task resumes with matching pointer; accepted task moves to done', async t => {
    const root = await documentFixture(t);
    const path = await addTask(root);
    assert.deepEqual(await checkDocuments(root), []);
    await writeFile(join(root, 'docs/status.md'), '<!-- active-task: none -->\n');
    assert.ok((await checkDocuments(root)).some(error => error.includes('pointer')));
    await rm(join(root, path));
    await addTask(root, 'accepted', 'done');
    assert.deepEqual(await checkDocuments(root), []);
});

test('task validation rejects invalid state, placement, missing sections and multiple active tasks', async t => {
    const root = await documentFixture(t);
    const path = await addTask(root, 'accepted');
    assert.ok((await checkDocuments(root)).some(error => error.includes('placement')));
    let text = await readFile(join(root, path), 'utf8');
    text = text.replace('status: accepted', 'status: imaginary').replace('## Ручная приёмка', '## Other');
    await writeFile(join(root, path), text);
    await writeFile(join(root, 'docs/tasks/active/2026-11-17-second.md'), text.replaceAll('2026-11-17-example', '2026-11-17-second'));
    const errors = await checkDocuments(root);
    assert.ok(errors.some(error => error.includes('unknown status')));
    assert.ok(errors.some(error => error.includes('Ручная приёмка')));
    assert.ok(errors.some(error => error.includes('at most one')));
});

test('task headings inside fenced examples do not alter its structure', async t => {
    const root = await documentFixture(t);
    const path = await addTask(root);
    const text = await readFile(join(root, path), 'utf8');
    await writeFile(join(root, path), text + '\n```md\n## Ручная приёмка\n```\n');
    assert.deepEqual(await checkDocuments(root), []);
});

test('missing Chrome is actionable without dumping environment', () => {
    const result = inspectChrome(join(tmpdir(), 'scrappack-nonexistent-chrome'));
    assert.equal(result.ok, false);
    assert.match(result.message, /ENOENT.*CHROME_BIN/);
});

test('doctor detects installed dependency drift against the lockfile', async t => {
    const root = await temporary(t);
    await mkdir(join(root, 'node_modules/example'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { example: '^1.0.0' } }));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
        '': { dependencies: { example: '^1.0.0' } }, 'node_modules/example': { version: '1.0.0' }
    } }));
    await writeFile(join(root, 'node_modules/example/package.json'), '{"version":"2.0.0"}');
    const results = await diagnose(root);
    assert.ok(results.some(result => !result.ok && /example.*npm ci/.test(result.message)));
});

test('occupied port is diagnosed and its owner stays running', async t => {
    const server = createServer();
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    assert.deepEqual(await probePort(server.address().port), { ok: false, code: 'EADDRINUSE' });
    assert.equal(server.listening, true);
});

function fixtureProcess(t, source, cdp = false) {
    const state = spawnCaptured('Fixture', process.execPath, ['--input-type=module', '-e', source],
        cdp ? { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] } : {});
    t.after(() => stopOwnedProcess(state, 100));
    return state;
}

test('aggregate check stops on the first failing command and preserves its exit code', async t => {
    const root = await temporary(t);
    const log = join(root, 'steps.jsonl');
    const fakeNpm = join(root, 'npm-fixture.mjs');
    await writeFile(fakeNpm, `import {appendFileSync} from 'node:fs';
        const step=process.argv.at(-1);appendFileSync(${JSON.stringify(log)},JSON.stringify(step)+'\\n');
        process.exit(step==='check:docs'?7:0);`);
    const state = spawnCaptured('Check fixture', process.execPath, [join(repositoryRoot, 'scripts/check.mjs')], {
        env: { ...process.env, npm_execpath: fakeNpm }
    });
    t.after(() => stopOwnedProcess(state, 100));
    const deadline = Date.now() + 5000;
    while (!state.exited && Date.now() < deadline) await delay(20);
    assert.equal(state.code, 7);
    assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)), ['doctor', 'check:docs']);
    assert.match(state.stderr, /Stopped at check:docs/);
});

test('startup reports child exit code and stderr; silent startup is bounded', async t => {
    const failed = fixtureProcess(t, 'console.error("fixture startup failure");process.exit(7)');
    await assert.rejects(awaitReady(failed, 'READY'), /exit 7[\s\S]*fixture startup failure/);
    const silent = fixtureProcess(t, 'setInterval(()=>{},1000)');
    await assert.rejects(awaitReady(silent, 'READY', { timeoutMs: 60 }), /timed out/);
});

test('cleanup kills an owned process that ignores SIGTERM', async t => {
    const state = fixtureProcess(t, 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);console.log("READY")');
    await awaitReady(state, 'READY');
    await stopOwnedProcess(state, 100);
    assert.equal(state.child.signalCode, 'SIGKILL');
});

test('cleanup also stops descendants in its own process group', { skip: process.platform !== 'linux' }, async t => {
    const state = fixtureProcess(t, `import {spawn} from 'node:child_process';
        const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
        setTimeout(()=>console.log('READY '+child.pid),100);setInterval(()=>{},1000);`);
    await awaitReady(state, 'READY');
    const pid = Number(state.stdout.match(/READY (\d+)/)[1]);
    await stopOwnedProcess(state, 100);
    let stopped = false;
    for (let attempt = 0; attempt < 50 && !stopped; attempt++) {
        try { stopped = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2] === 'Z'; }
        catch (error) { if (error.code === 'ENOENT') stopped = true; else throw error; }
        if (!stopped) await delay(20);
    }
    assert.equal(stopped, true, 'owned descendant must be dead after cleanup');
});

async function cdpFixture(t) {
    const source = `import fs from 'node:fs';
        const input=fs.createReadStream(null,{fd:3});const output=fs.createWriteStream(null,{fd:4});
        let buffer='';const reply=(id,result)=>output.write(JSON.stringify({id,result})+'\\0');
        input.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\0'))!==-1){
            const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
            if(message.method==='hang')continue;
            if(message.method==='malformed'){output.write('{bad\\0');continue;}
            if(message.method==='close'){output.end();continue;}
            if(message.method==='late'){setTimeout(()=>reply(message.id,{late:true}),120);continue;}
            if(message.method==='Page.captureScreenshot'){reply(message.id,{data:Buffer.from('png fixture').toString('base64')});continue;}
            if(message.method==='Runtime.evaluate'){reply(message.id,{result:{value:{seed:123,url:'http://fixture'}}});continue;}
            const data=JSON.stringify({id:message.id,result:{ok:true}})+'\\0';
            output.write(data.slice(0,5));output.write(data.slice(5));
        }});console.log('READY');`;
    const state = fixtureProcess(t, source, true);
    await awaitReady(state, 'READY');
    return state;
}

test('CDP timeout names scenario/method, late replies do not poison subsequent commands', async t => {
    const state = await cdpFixture(t);
    const cdp = createCdp(state.child, { timeoutMs: 60, context: () => 'canvas: energy shortage' });
    await assert.rejects(cdp.send('late'), /canvas: energy shortage: CDP late timed out/);
    await delay(140);
    assert.deepEqual(await cdp.send('echo'), { ok: true });
    cdp.dispose();
});

test('malformed transport and closed pipe reject pending CDP requests', async t => {
    const state = await cdpFixture(t);
    const cdp = createCdp(state.child);
    const waiting = assert.rejects(cdp.send('hang'), /Malformed CDP JSON/);
    await assert.rejects(cdp.send('malformed'), /Malformed CDP JSON/);
    await waiting;
    const other = await cdpFixture(t);
    const closed = createCdp(other.child);
    const pending = assert.rejects(closed.send('hang'), /pipe ended/);
    await assert.rejects(closed.send('close'), /pipe ended/);
    await pending;
});

test('suite abort rejects requests, diagnostics can still use a live transport', async t => {
    const root = await temporary(t);
    const state = await cdpFixture(t);
    const controller = new AbortController();
    const cdp = createCdp(state.child, { signal: controller.signal });
    const pending = assert.rejects(cdp.send('hang'), /suite deadline/);
    controller.abort(new Error('suite deadline'));
    await pending;
    assert.deepEqual(await cdp.send('echo', {}, undefined, { signal: null }), { ok: true });
    const directory = await writeFailureArtifacts({ error: new Error('intentional failure'), renderer: 'canvas',
        currentCheck: 'healing action', chrome: state, transport: cdp, sessionId: 'page', browserErrors: [], root });
    const diagnostic = JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8'));
    assert.equal(diagnostic.seed, 123);
    assert.equal(diagnostic.check, 'healing action');
    assert.match(diagnostic.error, /intentional failure/);
    assert.equal(await readFile(join(directory, 'failure.png'), 'utf8'), 'png fixture');
    cdp.dispose();
});

test('startup failure saves JSON even when no screenshot is available', async t => {
    const root = await temporary(t);
    const directory = await writeFailureArtifacts({ error: new Error('Vite unavailable'), renderer: 'startup',
        currentCheck: 'start Vite', browserErrors: [], root });
    const diagnostic = JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8'));
    assert.match(diagnostic.screenshotError, /No active browser page/);
    assert.match(diagnostic.error, /Vite unavailable/);
});
