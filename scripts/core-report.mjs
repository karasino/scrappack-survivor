import { relative, resolve } from 'node:path';

// Node 24 emits an internal test:summary for each isolated file, in addition
// to its final cumulative summary. File-wrapper passes alone are insufficient.
// https://nodejs.org/download/release/v24.15.0/docs/api/test.html#event-testsummary
export function createCoreReportGuard(files, { cwd = process.cwd() } = {}) {
    const selected = new Set(files.map(file => resolve(cwd, file)));
    const summaries = new Map();
    let finalSummary;
    const completedCount = summary => {
        const counts = summary?.counts;
        if (typeof summary?.success !== 'boolean' || !counts) return null;
        const values = ['tests', 'skipped', 'todo', 'cancelled'].map(key => counts[key]);
        if (!values.every(value => Number.isInteger(value) && value >= 0)) return null;
        const completed = counts.tests - counts.skipped - counts.todo - counts.cancelled;
        return completed >= 0 ? completed : null;
    };
    return {
        observe(event) {
            if (event?.type !== 'test:summary') return;
            const summary = event.data;
            if (summary?.file === undefined) finalSummary = summary;
            else if (typeof summary.file === 'string') {
                const file = resolve(cwd, summary.file);
                if (selected.has(file)) summaries.set(file, summary);
            }
        },
        finish() {
            const errors = [];
            let executed = 0;
            if (selected.size === 0) errors.push('No explicit core test files were selected.');
            for (const file of selected) {
                const label = relative(cwd, file) || file;
                const summary = summaries.get(file);
                if (!summary) {
                    errors.push(`${label}: no internal node:test summary. Check test registration and child-process reporting; file-level passes are insufficient.`);
                    continue;
                }
                const count = completedCount(summary);
                if (count === null) errors.push(`${label}: invalid internal node:test summary.`);
                else {
                    executed += count;
                    if (count === 0) errors.push(`${label}: no executed core scenarios (empty, skipped, TODO or cancelled tests).`);
                }
                if (summary.success === false) errors.push(`${label}: node:test reported a failed run; see the original test diagnostics.`);
            }
            if (completedCount(finalSummary) === null) errors.push('Missing or invalid final node:test summary; execution was not fully reported.');
            else if (!finalSummary.success) errors.push('node:test reported an unsuccessful final result.');
            return { ok: errors.length === 0, errors, executed, files: selected.size };
        }
    };
}

export default async function* coreReport(source) {
    // The Node CLI has already parsed its options; argv contains the selected files.
    const guard = createCoreReportGuard(process.argv.slice(1));
    for await (const event of source) guard.observe(event);
    const result = guard.finish();
    if (!result.ok) {
        process.exitCode ||= 1;
        for (const error of result.errors) yield `[core-report] FAIL ${error}\n`;
    } else yield `[core-report] Verified ${result.executed} executed scenarios across ${result.files} files.\n`;
}
