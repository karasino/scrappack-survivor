import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function spawnCaptured(label, command, args, options = {}) {
    const grouped = process.platform !== 'win32' && options.detached !== false;
    const child = spawn(command, args, { ...options, detached: grouped, stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'] });
    const state = { label, child, grouped, stdout: '', stderr: '', error: null, exited: false, code: null, signal: null };
    child.stdout?.on('data', chunk => { state.stdout = (state.stdout + chunk).slice(-8000); });
    child.stderr?.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-8000); });
    child.once('error', error => { state.error = error; });
    child.once('exit', (code, signal) => { state.exited = true; state.code = code; state.signal = signal; });
    return state;
}

export async function awaitReady(state, expected, { timeoutMs = 15_000, signal } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        if (signal?.aborted) throw signal.reason;
        if (state.error || state.exited) {
            const reason = state.error?.code ?? `exit ${state.code}, signal ${state.signal}`;
            throw new Error(`${state.label} startup failed (${reason}).\n${state.stderr || state.stdout}`);
        }
        if (state.stdout.includes(expected)) return;
        if (Date.now() >= deadline) throw new Error(`${state.label} startup timed out after ${timeoutMs} ms.\n${state.stderr || state.stdout}`);
        await delay(20);
    }
}

export async function stopOwnedProcess(state, graceMs = 1000) {
    if (!state?.child.pid || state.cleaned) return;
    const signal = name => {
        try {
            if (state.grouped) process.kill(-state.child.pid, name);
            else if (!state.exited) state.child.kill(name);
        } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const waitForExit = async () => {
        const deadline = Date.now() + graceMs;
        while (!state.exited && Date.now() < deadline) await delay(20);
        return state.exited;
    };
    signal('SIGTERM');
    const exited = await waitForExit();
    // A directly launched browser/server can leave descendants after exiting.
    // Address only the process group created by this harness, never a port/name.
    if (state.grouped || !exited) signal('SIGKILL');
    if (exited) { state.cleaned = true; return; }
    if (!await waitForExit()) throw new Error(`${state.label} did not exit after SIGKILL.`);
    state.cleaned = true;
}

export function createCdp(child, { signal, context = () => 'browser startup', timeoutMs = 15_000, onEvent = () => {} } = {}) {
    const pending = new Map();
    const recent = [];
    let serial = 0;
    let buffer = '';
    let failure = null;
    const remember = entry => { recent.push(entry); if (recent.length > 30) recent.shift(); };
    const dispose = error => {
        if (failure) return;
        failure = error ?? new Error('CDP closed.');
        for (const request of [...pending.values()]) request.finish(failure);
    };
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', chunk => {
        if (failure) return;
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\0')) !== -1) {
            const payload = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (!payload.trim()) continue;
            let message;
            try { message = JSON.parse(payload); }
            catch { dispose(new Error('Malformed CDP JSON.')); return; }
            if (!message || typeof message !== 'object') { dispose(new Error('Invalid CDP message.')); return; }
            if (typeof message.id === 'number') {
                const request = pending.get(message.id);
                if (!request) continue;
                request.finish(message.error ? new Error(`CDP ${request.method}: ${message.error.message}`) : null, message.result);
            } else onEvent(message);
        }
        if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) dispose(new Error('CDP buffer exceeded 32 MiB.'));
    });
    child.stdio[3].on('error', error => dispose(new Error(`CDP write failed (${error.code}).`)));
    child.stdio[4].on('error', error => dispose(new Error(`CDP read failed (${error.code}).`)));
    child.stdio[4].on('end', () => dispose(new Error('CDP pipe ended.')));
    child.once('error', error => dispose(new Error(`Chrome startup failed (${error.code}); check CHROME_BIN and permissions.`)));
    child.once('exit', (code, exitSignal) => dispose(new Error(`Chrome exited: code=${code}, signal=${exitSignal}.`)));

    const send = (method, params = {}, sessionId, options = {}) => {
        const requestSignal = options.signal === undefined ? signal : options.signal;
        const requestTimeout = options.timeoutMs ?? timeoutMs;
        const stage = context();
        if (failure) return Promise.reject(new Error(`${stage}: ${failure.message}`));
        if (requestSignal?.aborted) return Promise.reject(requestSignal.reason ?? new Error(`${stage}: aborted.`));
        return new Promise((resolve, reject) => {
            const id = ++serial;
            let settled = false;
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                requestSignal?.removeEventListener('abort', abort);
                pending.delete(id);
                if (error) reject(new Error(`${stage}: ${error.message}`, { cause: error }));
                else resolve(result);
            };
            const abort = () => finish(requestSignal.reason ?? new Error(`CDP ${method} aborted.`));
            const timer = setTimeout(() => finish(new Error(`CDP ${method} timed out after ${requestTimeout} ms.`)), requestTimeout);
            pending.set(id, { method, finish });
            requestSignal?.addEventListener('abort', abort, { once: true });
            remember({ method, stage });
            try {
                child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => {
                    if (error) finish(error);
                });
            } catch (error) { finish(error); }
        });
    };
    return { send, dispose, recent: () => [...recent] };
}

export async function writeFailureArtifacts({ error, renderer, currentCheck, seed, server, chrome, transport, sessionId, browserErrors, root = process.cwd() }) {
    const directory = join(root, 'artifacts', 'harness', `${Date.now()}-${process.pid}-${renderer}`);
    await mkdir(directory, { recursive: true });
    const describe = state => state ? {
        pid: state.child.pid, exited: state.exited, code: state.code, signal: state.signal,
        spawnError: state.error?.code, stdoutTail: state.stdout, stderrTail: state.stderr
    } : null;
    const diagnostic = {
        timestamp: new Date().toISOString(), renderer, check: currentCheck, seed,
        error: error.stack ?? String(error), server: describe(server), chrome: describe(chrome),
        browserErrors, recentCommands: transport?.recent() ?? []
    };
    if (transport && sessionId) {
        try {
            const state = await transport.send('Runtime.evaluate', {
                expression: '({seed:globalThis.s?.run?.seed,url:location.href})', returnByValue: true
            }, sessionId, { timeoutMs: 1000, signal: null });
            Object.assign(diagnostic, state.result?.value);
        } catch (stateError) { diagnostic.stateError = stateError.message; }
        try {
            const shot = await transport.send('Page.captureScreenshot', { format: 'png' }, sessionId, { timeoutMs: 2000, signal: null });
            await writeFile(join(directory, 'failure.png'), Buffer.from(shot.data, 'base64'));
        } catch (captureError) { diagnostic.screenshotError = captureError.message; }
    } else diagnostic.screenshotError = 'No active browser page available.';
    await writeFile(join(directory, 'failure.json'), JSON.stringify(diagnostic, null, 2) + '\n');
    return directory;
}
