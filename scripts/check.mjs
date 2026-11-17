import { spawn } from 'node:child_process';
import { repositoryRoot } from './doctor.mjs';

const steps = ['doctor', 'check:docs', 'test:harness', 'build', 'test:combat-ui', 'test:exploration', 'test:crafting'];

for (const step of steps) {
    console.log(`\n[check] Running ${step}`);
    const code = await new Promise(resolve => {
        const npm = process.env.npm_execpath;
        const child = spawn(npm ? process.execPath : 'npm', npm ? [npm, 'run', step] : ['run', step], {
            cwd: repositoryRoot, stdio: 'inherit', shell: false
        });
        const interrupt = () => child.kill('SIGINT');
        const terminate = () => child.kill('SIGTERM');
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', terminate);
        const cleanup = () => {
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', terminate);
        };
        child.once('error', error => {
            cleanup();
            console.error(`[check] Could not start ${step} (${error.code ?? 'spawn error'}).`);
            resolve(1);
        });
        child.once('close', (status, signal) => {
            cleanup();
            resolve(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : status ?? 1);
        });
    });
    if (code !== 0) {
        console.error(`[check] Stopped at ${step} (exit ${code}).`);
        process.exitCode = code;
        break;
    }
}
if (!process.exitCode) console.log('\n[check] All checks passed.');
