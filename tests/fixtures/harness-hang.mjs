// Intentionally hangs. Run only through scripts/run-harness.mjs with a short limit.
import test from 'node:test';
import { spawnCaptured, awaitReady } from '../browser-harness.mjs';

test('intentional hang with a separately grouped descendant', async () => {
    const grandchild = `process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('READY');`;
    const guardian = `import {spawn} from 'node:child_process';
        const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','inherit']});
        child.stdout.once('data',()=>console.log('READY '+process.pid+' '+child.pid));
        setInterval(()=>{},1000);`;
    const state = spawnCaptured('Hanging fixture', process.execPath, ['--input-type=module', '-e', guardian]);
    await awaitReady(state, 'READY', { timeoutMs: 5000 });
    const [, parent, child] = state.stdout.match(/READY (\d+) (\d+)/);
    console.log(`HANG READY ${parent} ${child}`);
    console.log(`RUNNER ${process.ppid}`);
    await new Promise(() => {});
});
