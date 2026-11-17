import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { repositoryRoot, inspectChrome, probePort } from './doctor.mjs';
import { spawnCaptured, awaitReady, createCdp, stopOwnedProcess, writeFailureArtifacts } from '../tests/browser-harness.mjs';
import { browserFixtureSource, scenarioIds, scenarioSeed } from '../tests/browser-fixtures.mjs';

const origin = 'http://127.0.0.1:4175';
export const usage = `Usage: npm run scenario -- <${scenarioIds.join('|')}> [--renderer webgl|canvas]
Opens a controlled fixture in a separate Chrome window. Default renderer: webgl.
Stop with Enter in this terminal, Ctrl+C, or by closing the game tab/window.`;

export function parseScenarioArgs(args) {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
    const [id, ...rest] = args;
    if (!scenarioIds.includes(id)) throw new Error(`Unknown scenario '${id ?? ''}'. Available: ${scenarioIds.join(', ')}.`);
    let renderer = 'webgl';
    if (rest.length) {
        if (rest.length !== 2 || rest[0] !== '--renderer') throw new Error('Expected --renderer webgl|canvas.');
        renderer = rest[1];
    }
    if (!['webgl', 'canvas'].includes(renderer)) throw new Error(`Unknown renderer '${renderer}'. Available: webgl, canvas.`);
    return { id, renderer };
}

// Headless/onReady are for launcher integration checks; the public command is interactive.
export async function runScenario({ id, renderer = 'webgl' }, {
    headless = false, onReady, chromeBin = process.env.CHROME_BIN || 'google-chrome',
    startupTimeoutMs = 60_000, log = console.log
} = {}) {
    parseScenarioArgs([id, '--renderer', renderer]);
    let server, chrome, profile, transport, sessionId, targetId, terminal;
    let currentCheck = 'check environment';
    let ready = false;
    let closing = false;
    let stopped = false;
    let failure;
    let exitCode = 0;
    const browserErrors = [];
    const controller = new AbortController();
    let finish;
    const lifetime = new Promise(resolveDone => { finish = resolveDone; });
    const stop = (code = 0) => {
        if (stopped || failure) return;
        stopped = true;
        exitCode = code;
        finish();
        controller.abort(new Error('Scenario stopped.'));
    };
    const fail = error => {
        if (closing || stopped || failure) return;
        failure = error;
        controller.abort(error);
        finish();
    };
    const interrupt = () => stop(130);
    const terminate = () => stop(143);
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    const timeout = setTimeout(() => fail(new Error(`Scenario startup timed out after ${startupTimeoutMs} ms.`)), startupTimeoutMs);
    const watch = (state, isBrowser = false) => {
        state.child.once('error', error => fail(new Error(`${state.label} startup failed (${error.code}); check executable and permissions.`)));
        state.child.once('exit', (code, signal) => {
            if (closing || stopped) return;
            if (isBrowser && ready && code === 0) stop();
            else fail(new Error(`${state.label} exited: code=${code}, signal=${signal}.\n${state.stderr || state.stdout}`));
        });
    };
    try {
        const available = await probePort();
        if (!available.ok) throw new Error(`Port 127.0.0.1:4175 unavailable (${available.code}); stop its owner or check sandbox permissions.`);
        const chromeCheck = inspectChrome(chromeBin);
        if (!chromeCheck.ok) throw new Error(chromeCheck.message);
        controller.signal.throwIfAborted();
        profile = await mkdtemp(join(tmpdir(), 'scrappack-scenario-'));
        currentCheck = 'start Vite';
        server = spawnCaptured('Vite', process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { cwd: repositoryRoot });
        watch(server);
        await awaitReady(server, origin, { signal: controller.signal });
        currentCheck = 'start Chrome';
        chrome = spawnCaptured('Chrome', chromeBin, [
            ...(headless ? ['--headless=new'] : ['--no-startup-window']), '--no-sandbox', '--disable-dev-shm-usage',
            '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--no-first-run', '--no-default-browser-check', '--window-size=1366,850',
            '--remote-debugging-pipe', `--user-data-dir=${profile}`
        ], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
        watch(chrome, true);
        transport = createCdp(chrome.child, {
            signal: controller.signal,
            context: () => `${id}/${renderer}: ${currentCheck}`,
            onEvent: message => {
                if (message.method === 'Runtime.exceptionThrown') {
                    browserErrors.push(message.params.exceptionDetails);
                    if (ready) fail(new Error('Uncaught browser exception; see failure diagnostics.'));
                }
                if (message.method === 'Target.targetDestroyed' && message.params.targetId === targetId) {
                    if (ready) stop();
                    else fail(new Error('Game page closed during preparation.'));
                }
            }
        });
        await transport.send('Target.setDiscoverTargets', { discover: true });
        ({ targetId } = await transport.send('Target.createTarget', { url: 'about:blank', newWindow: !headless }));
        ({ sessionId } = await transport.send('Target.attachToTarget', { targetId, flatten: true }));
        const send = (method, params) => transport.send(method, params, sessionId);
        const evaluate = async expression => {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        currentCheck = 'load game';
        await send('Runtime.enable');
        await send('Page.enable');
        if (renderer === 'canvas') await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                return /webgl/i.test(type) ? null : original.call(this, type, ...args);
            };
        })();` });
        await send('Page.navigate', { url: origin });
        await send('Page.bringToFront');
        let loaded = false;
        for (let attempt = 0; attempt < 150; attempt++) {
            loaded = await evaluate(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`);
            if (loaded) break;
            await delay(30, undefined, { signal: controller.signal });
        }
        if (!loaded) throw new Error('Game page did not finish loading.');
        currentCheck = 'install fixtures';
        const actualRenderer = await evaluate(browserFixtureSource);
        if (actualRenderer !== (renderer === 'canvas' ? 1 : 2)) throw new Error(`Requested ${renderer}, Phaser renderer type is ${actualRenderer}.`);
        currentCheck = 'prepare fixture';
        await evaluate(`prepareScenario(${JSON.stringify(id)})`);
        if (browserErrors.length) throw new Error('Uncaught browser exception during preparation.');
        controller.signal.throwIfAborted();
        ready = true;
        clearTimeout(timeout);
        currentCheck = 'interactive session';
        log(`READY ${id} | renderer=${renderer} | seed=${scenarioSeed} | controlled fixture`);
        log('Use normal game controls. Stop: Enter in terminal, Ctrl+C, or close the game tab/window.');
        if (process.stdin.isTTY) {
            terminal = createInterface({ input: process.stdin, output: process.stdout });
            terminal.once('line', () => stop());
            terminal.once('SIGINT', interrupt);
        }
        await Promise.race([
            Promise.resolve().then(() => onReady?.({ evaluate, send, stop, server, chrome, profile,
                targetId, transport, sessionId, signal: controller.signal })),
            lifetime
        ]);
        await lifetime;
        if (!stopped) controller.signal.throwIfAborted();
    } catch (error) {
        if (!stopped) {
            failure ??= error;
            exitCode = 1;
            console.error(`FAIL ${id}/${renderer}: ${currentCheck}: ${error.message}`);
            try {
                const directory = await writeFailureArtifacts({ error, renderer, currentCheck: `${id}: ${currentCheck}`,
                    seed: scenarioSeed, server, chrome, transport, sessionId, browserErrors, root: repositoryRoot });
                console.error(`Failure artifacts: ${directory}`);
            } catch (artifactError) { console.error(`Could not save diagnostics: ${artifactError.message}`); }
        }
    } finally {
        closing = true;
        clearTimeout(timeout);
        terminal?.close();
        controller.abort(new Error('Scenario finished.'));
        if (chrome?.child.pid && !chrome.exited) {
            await transport?.send('Browser.close', {}, undefined, { timeoutMs: 500, signal: null }).catch(() => {});
        }
        for (const state of [chrome, server]) {
            try { await stopOwnedProcess(state); }
            catch (error) { console.error(`Cleanup failed: ${error.message}`); exitCode = 1; }
        }
        transport?.dispose();
        if (profile) {
            try { await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
            catch (error) { console.error(`Profile cleanup failed (${error.code}).`); exitCode = 1; }
        }
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
    }
    return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const options = parseScenarioArgs(process.argv.slice(2));
        if (options.help) console.log(usage);
        else process.exitCode = await runScenario(options);
    } catch (error) {
        console.error(`${error.message}\n${usage}`);
        process.exitCode = 1;
    }
}
