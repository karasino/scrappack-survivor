import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { parseScenarioArgs, runScenario } from '../scripts/scenario.mjs';
import { spawnCaptured, stopOwnedProcess } from './browser-harness.mjs';

test('scenario CLI selects two explicit fixtures and validates renderer/options', () => {
    assert.deepEqual(parseScenarioArgs(['transformer-chain']), { id: 'transformer-chain', renderer: 'webgl' });
    assert.deepEqual(parseScenarioArgs(['combat-heal', '--renderer', 'canvas']), { id: 'combat-heal', renderer: 'canvas' });
    assert.deepEqual(parseScenarioArgs(['combat-heal', '--renderer', 'webgl']), { id: 'combat-heal', renderer: 'webgl' });
    assert.deepEqual(parseScenarioArgs(['--help']), { help: true });
    for (const args of [[], ['unknown'], ['combat-heal', '--renderer', 'auto'], ['combat-heal', '--renderer'],
        ['combat-heal', '--extra', 'canvas'], ['combat-heal', '--renderer', 'canvas', '--extra']]) {
        assert.throws(() => parseScenarioArgs(args), /Unknown scenario|Unknown renderer|Expected --renderer/);
    }
});

test('invalid programmatic scenario is rejected before environment/process startup', async () => {
    await assert.rejects(runScenario({ id: 'unknown' }), /Unknown scenario/);
    await assert.rejects(runScenario({ id: 'combat-heal', renderer: 'auto' }), /Unknown renderer/);
});

for (const args of [['unknown'], ['combat-heal', '--renderer', 'invalid'], ['--help']]) {
    test(`scenario command exits without Chrome for ${args.join(' ')}`, async t => {
        const state = spawnCaptured('Scenario CLI', process.execPath, ['scripts/scenario.mjs', ...args], {
            env: { ...process.env, CHROME_BIN: '/nonexistent/scrappack-chrome' }
        });
        t.after(() => stopOwnedProcess(state, 100));
        const deadline = Date.now() + 3000;
        while (!state.exited && Date.now() < deadline) await delay(20);
        assert.equal(state.code, args[0] === '--help' ? 0 : 1);
        assert.match(state.stdout + state.stderr, /Usage: npm run scenario/);
        assert.doesNotMatch(state.stderr, /Chrome unavailable|Port .*unavailable/);
    });
}
