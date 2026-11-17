import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const testPort = 4175;

export function probePort(port = testPort) {
    return new Promise(resolveResult => {
        const server = createServer();
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolveResult(result);
        };
        const timer = setTimeout(() => {
            server.close();
            finish({ ok: false, code: 'TIMEOUT' });
        }, 3000);
        server.once('error', error => finish({ ok: false, code: error.code }));
        server.once('listening', () => server.close(error =>
            finish(error ? { ok: false, code: error.code } : { ok: true })));
        server.listen({ host: '127.0.0.1', port, exclusive: true });
    });
}

export function inspectChrome(executable = process.env.CHROME_BIN || 'google-chrome') {
    const result = spawnSync(executable, ['--version'], {
        encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.error) {
        const code = result.error.code;
        const hint = code === 'ENOENT' ? 'install Chrome or set CHROME_BIN'
            : code === 'ETIMEDOUT' ? 'version check exceeded 5 seconds'
                : 'check executable permissions and sandbox restrictions';
        return { ok: false, message: `Chrome unavailable (${code}): ${hint}.` };
    }
    if (result.status !== 0) return { ok: false, message: `Chrome version check exited ${result.status ?? result.signal}.` };
    const version = result.stdout.match(/\b(?:Google Chrome(?: for Testing)?|Chromium)\s+(\d+(?:\.\d+){1,3})\b/i)?.[1];
    return { ok: !!version, message: version ? `Chrome ${version} is available.` : 'Chrome returned an unrecognized version response.' };
}

export async function diagnose(root = repositoryRoot) {
    const results = [];
    const report = (ok, message) => results.push({ ok, message });
    report(Number(process.versions.node.split('.')[0]) === 24, `Node ${process.versions.node}; baseline is Node 24.x.`);
    const json = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
    try {
        const manifest = await json('package.json');
        const lock = await json('package-lock.json');
        const fields = ['dependencies', 'devDependencies', 'optionalDependencies'];
        const lockedRoot = lock.packages?.[''];
        if (!lockedRoot || lock.lockfileVersion !== 3) throw new Error('Expected lockfile version 3 with root metadata.');
        const sameEntries = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => a[key] === b[key]);
        const matched = fields.every(field => sameEntries(manifest[field], lockedRoot[field]));
        report(matched, matched ? 'Dependency declarations match package-lock.json.' : 'Package declarations differ from the lockfile; synchronize them.');
        for (const name of new Set(fields.flatMap(field => Object.keys(manifest[field] ?? {})))) {
            try {
                const expected = lock.packages[`node_modules/${name}`]?.version;
                const installed = await json(`node_modules/${name}/package.json`);
                const ok = typeof expected === 'string' && expected === installed.version;
                report(ok, ok ? `${name} matches the lockfile (${expected}).` : `${name} differs from the lockfile; run npm ci.`);
            } catch {
                report(false, `${name} is unavailable; run npm ci.`);
            }
        }
    } catch (error) {
        report(false, `Cannot validate package manifests (${error.code ?? 'invalid manifest'}); check package.json/package-lock.json.`);
    }
    results.push(inspectChrome());
    const port = await probePort();
    const hint = port.code === 'EADDRINUSE' ? 'port is busy; stop its owner yourself or retry later'
        : ['EPERM', 'EACCES'].includes(port.code) ? 'sandbox/system permissions prohibit local servers'
            : 'cannot probe local test port';
    report(port.ok, port.ok ? `Local test port 127.0.0.1:${testPort} is available.` : `${testPort}: ${hint} (${port.code}).`);
    return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const results = await diagnose();
    for (const result of results) console.log(`${result.ok ? 'OK' : 'FAIL'} ${result.message}`);
    const failed = results.filter(result => !result.ok).length;
    console.log(failed ? `Diagnostics failed: ${failed} check(s).` : 'Environment is ready.');
    process.exitCode = failed ? 1 : 0;
}
