import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ownerKey = 'SCRAPPACK_HARNESS_OWNERS';
const maxTimeout = 2 ** 31 - 1;
export const defaultTimeoutMs = 60_000;

export function parseHarnessArgs(args) {
    let timeoutMs = defaultTimeoutMs;
    const files = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--timeout-ms') {
            const value = args[++index];
            if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maxTimeout) {
                throw new Error('--timeout-ms must be an integer from 1 to 2147483647.');
            }
            timeoutMs = Number(value);
        } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        else files.push(arg);
    }
    if (!files.length) throw new Error('Select at least one test file.');
    return { files, timeoutMs };
}

async function identity(pid) {
    try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
        // comm can contain spaces and parentheses. Fields after it begin at state (3).
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
        const group = Number(fields[2]), start = fields[19];
        if (!Number.isSafeInteger(group) || group < 0 || !/^\d+$/.test(start ?? '')) throw new Error(`Invalid process identity for ${pid}.`);
        return { pid: Number(pid), state: fields[0], group, start };
    } catch (error) {
        if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
        throw error;
    }
}

// A per-run environment token survives reparenting and setsid(). Never log environ.
// https://docs.kernel.org/filesystems/proc.html (environ and stat)
async function ownedProcesses(owner) {
    const processes = await Promise.all((await readdir('/proc')).filter(pid => /^\d+$/.test(pid)).map(async pid => {
        try {
            const before = await identity(pid);
            if (!before || ['Z', 'X'].includes(before.state)) return null;
            const entry = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0').find(value => value.startsWith(`${ownerKey}=`));
            if (!entry || !entry.includes(owner)) return null;
            const owners = JSON.parse(entry.slice(ownerKey.length + 1));
            if (!Array.isArray(owners) || !owners.includes(owner)) return null;
            const process = await identity(pid);
            return process && process.start === before.start && process.group === before.group && !['Z', 'X'].includes(process.state) ? process : null;
        } catch (error) {
            if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return null;
            throw error;
        }
    }));
    return processes.filter(Boolean);
}

async function signalGroups(processes, signal, ownGroup) {
    const signalled = new Set();
    for (const previous of processes) {
        if (signalled.has(previous.group)) continue;
        const current = await identity(previous.pid);
        // Recheck identity before signalling: a PID from the snapshot may have exited.
        if (!current || current.start !== previous.start || current.group !== previous.group) continue;
        if (current.group <= 1 || current.group === ownGroup) throw new Error('Refusing to signal the supervisor process group.');
        try { process.kill(-current.group, signal); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        signalled.add(current.group);
    }
}

async function cleanup(owner, ownGroup, signal, graceMs) {
    let remaining = await ownedProcesses(owner);
    await signalGroups(remaining, signal, ownGroup);
    for (const nextSignal of ['SIGKILL', null]) {
        const deadline = performance.now() + graceMs;
        while (performance.now() < deadline) {
            remaining = await ownedProcesses(owner);
            if (!remaining.length) {
                // A parent can fork after readdir's snapshot and exit during the scan.
                // Require a second empty scan before declaring cleanup complete.
                await delay(20);
                remaining = await ownedProcesses(owner);
                if (!remaining.length) return;
            }
            // Catch groups created during the grace period, even if their parent just exited.
            if (!nextSignal) await signalGroups(remaining, 'SIGKILL', ownGroup);
            await delay(20);
        }
        remaining = await ownedProcesses(owner);
        if (!remaining.length) {
            await delay(20);
            remaining = await ownedProcesses(owner);
        }
        if (!remaining.length) return;
        if (nextSignal) await signalGroups(remaining, nextSignal, ownGroup);
    }
    throw new Error(`Cleanup did not finish; ${remaining.length} owned processes remain.`);
}

export async function runHarness({ files, timeoutMs = defaultTimeoutMs }, { graceMs = 1000, cwd = process.cwd() } = {}) {
    if (process.platform !== 'linux') throw new Error('test:harness supervision requires Linux /proc.');
    const ownGroup = (await identity(process.pid)).group;
    const owner = randomUUID();
    const ancestors = JSON.parse(process.env[ownerKey] ?? '[]');
    if (!Array.isArray(ancestors) || !ancestors.every(value => typeof value === 'string')) throw new Error('Invalid inherited harness ownership.');
    const env = { ...process.env, [ownerKey]: JSON.stringify([...ancestors, owner]) };
    // This is a separate CLI run, including when a test launches a nested supervisor.
    delete env.NODE_TEST_CONTEXT;
    const args = ['--test', '--test-timeout=15000', '--test-reporter=spec', '--test-reporter=./scripts/core-report.mjs',
        '--test-reporter-destination=stdout', '--test-reporter-destination=stderr', ...files];
    let child, timer, finish, reason;
    const done = new Promise(resolveDone => { finish = resolveDone; });
    const stop = (code, signal = 'SIGTERM', message) => {
        if (reason) return;
        reason = { code, signal, reportCleanup: Boolean(message) };
        if (message) console.error(`[test:harness] ${message}`);
        finish();
    };
    const interrupt = () => stop(130, 'SIGINT', 'Interrupted; cleaning up owned processes.');
    const terminate = () => stop(143, 'SIGTERM', 'Terminated; cleaning up owned processes.');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
        // Only the child receives this run's token. The supervisor stays outside its group.
        child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: 'inherit' });
        child.once('error', error => stop(1, 'SIGTERM', `Could not start tests (${error.code}).`));
        child.once('exit', (code, signal) => stop(code ?? (constants.signals[signal] ? 128 + constants.signals[signal] : 1),
            'SIGTERM', signal ? `Tests exited from ${signal}; cleaning up owned processes.` : undefined));
        timer = setTimeout(() => stop(124, 'SIGTERM', `Timed out after ${timeoutMs} ms; cleaning up owned processes.`), timeoutMs);
        await done;
    } finally {
        clearTimeout(timer);
        try {
            await cleanup(owner, ownGroup, reason?.signal ?? 'SIGTERM', graceMs);
            if (reason?.reportCleanup) console.error('[test:harness] Cleanup complete.');
        }
        catch (error) {
            console.error(`[test:harness] ${error.message}`);
            reason ??= { code: 1 };
            if (reason.code === 0) reason.code = 1;
        }
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
        child?.unref();
    }
    return reason?.code ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { process.exitCode = await runHarness(parseHarnessArgs(process.argv.slice(2))); }
    catch (error) { console.error(`[test:harness] ${error.message}`); process.exitCode = 2; }
}
