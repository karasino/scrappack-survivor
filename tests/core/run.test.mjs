import test from 'node:test';
import assert from 'node:assert/strict';
import { runFullCraftingRun } from './scenarios/full-run.mjs';

test('seed 123 completes two sectors with earned resources and deterministic final state', () => {
    assert.deepEqual(runFullCraftingRun(), {
        seed: 123, hp: 24, fights: 7, steps: 50, healingActions: 2,
        sectorOneBudget: { metal: 8, electronics: 7, fabric: 4 },
        size: [5, 4], finalItem: 'arc_baton'
    });
});
