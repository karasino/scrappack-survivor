import test from 'node:test';
import assert from 'node:assert/strict';
import { runFullCraftingRun } from './scenarios/full-run.mjs';

test('authored fixture seed 123 completes two sectors with earned resources and deterministic final state', () => {
    assert.deepEqual(runFullCraftingRun(), {
        seed: 123, hp: 33, fights: 7, steps: 50, healingActions: 3, braceActions: 1,
        sectorOneBudget: { metal: 8, electronics: 7, fabric: 4 },
        size: [5, 4], finalItem: 'arc_baton'
    });
});

test('generated seed 123 completes both sectors with earned resources and deterministic final state', () => {
    assert.deepEqual(runFullCraftingRun({ generated: true }), {
        seed: 123, hp: 33, fights: 7, steps: 66, healingActions: 3, braceActions: 1,
        sectorOneBudget: { metal: 8, electronics: 7, fabric: 4 },
        size: [5, 4], finalItem: 'arc_baton'
    });
});
