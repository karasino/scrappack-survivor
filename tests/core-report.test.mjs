import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreReportGuard } from '../scripts/core-report.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const reporter=join(root,'scripts/core-report.mjs');
const emptyFixture=join(root,'tests/fixtures/core-empty.mjs');
const summary=(file,tests=1,{skipped=0,todo=0,cancelled=0,success=true,suites=0}={})=>({
    type:'test:summary',data:{...(file===undefined?{}:{file}),success,counts:{tests,skipped,todo,cancelled,suites}}
});
const validate=(files,events)=>{
    const guard=createCoreReportGuard(files,{cwd:root});for(const event of events)guard.observe(event);return guard.finish();
};

test('core report requires internal summaries from every selected file, without a fixed test count',()=>{
    const a='tests/core/a.mjs',b='tests/core/b.mjs';
    const result=validate([a,resolve(root,b)],[summary(resolve(root,a),3),summary(b,11),summary(undefined,14)]);
    assert.deepEqual(result,{ok:true,errors:[],executed:14,files:2});
});

test('core report rejects green file wrappers and plausible test names without internal summaries',()=>{
    const files=['tests/core/a.mjs','tests/core/b.mjs'];
    const events=files.flatMap(file=>[
        {type:'test:pass',data:{name:resolve(root,file),file:resolve(root,file),nesting:0,details:{type:'test'}}},
        {type:'test:pass',data:{name:'looks like a real scenario',file:resolve(root,file),nesting:1,details:{type:'test'}}}
    ]);
    const result=validate(files,[...events,summary(undefined,4)]);
    assert.equal(result.ok,false);assert.equal(result.executed,0);
    for(const file of files)assert.ok(result.errors.some(error=>error.includes(file)&&error.includes('no internal')));
});

test('core report cannot cover an unreported file with another file or a helper summary',()=>{
    const result=validate(['tests/core/good.mjs','tests/core/missing.mjs'],[
        summary('tests/core/good.mjs',10),summary('tests/helpers/register.mjs',20),summary(undefined,30)
    ]);
    assert.equal(result.ok,false);assert.equal(result.executed,10);
    assert.equal(result.errors.length,1);assert.match(result.errors[0],/tests\/core\/missing.mjs: no internal/);
});

test('core report excludes empty suites, skip, TODO and cancelled cases from proof of execution',()=>{
    for(const event of [summary('a.mjs',0,{suites:1}),summary('a.mjs',2,{skipped:2}),
        summary('a.mjs',2,{todo:2}),summary('a.mjs',2,{cancelled:2})]){
        const result=validate(['a.mjs'],[event,summary(undefined,2)]);
        assert.equal(result.ok,false);assert.equal(result.executed,0);assert.match(result.errors.join('\n'),/no executed core scenarios/);
    }
    const mixed=validate(['a.mjs'],[summary('a.mjs',4,{skipped:1,todo:1,suites:2}),summary(undefined,4)]);
    assert.equal(mixed.ok,true);assert.equal(mixed.executed,2);
});

test('core report preserves failed runs and rejects missing or invalid final evidence',()=>{
    const failed=validate(['a.mjs'],[summary('a.mjs',1,{success:false}),summary(undefined,1,{success:false})]);
    assert.equal(failed.ok,false);assert.equal(failed.executed,1);assert.match(failed.errors.join('\n'),/failed run/);
    const truncated=validate(['a.mjs'],[summary('a.mjs')]);assert.equal(truncated.ok,false);assert.match(truncated.errors.join('\n'),/final node:test summary/);
    const invalid=summary('a.mjs',1,{skipped:2});
    assert.match(validate(['a.mjs'],[invalid,summary(undefined)]).errors.join('\n'),/invalid internal/);
    assert.equal(validate([],[summary(undefined,0)]).ok,false);
});

async function fixture(t,source,name='cases.test.mjs') {
    const directory=await mkdtemp(join(tmpdir(),'scrappack-core-report-'));
    t.after(()=>rm(directory,{recursive:true,force:true}));
    await writeFile(join(directory,'package.json'),'{"type":"module"}\n');
    const file=join(directory,name);await writeFile(file,source);return {directory,file};
}

function cli(files,{guard=true}={}) {
    const args=['--import=tsx','--test','--test-timeout=1000','--test-reporter=spec'];
    if(guard)args.push('--test-reporter='+reporter,'--test-reporter-destination=stdout','--test-reporter-destination=stderr');
    args.push(...files);
    return runNode(args);
}

function runNode(args,{extraEnv={}}={}) {
    const env={...process.env,...extraEnv};delete env.NODE_TEST_CONTEXT;
    return new Promise((resolveResult,reject)=>{
        execFile(process.execPath,args,{cwd:root,env,timeout:5000,maxBuffer:1_000_000},(error,stdout,stderr)=>{
            if(error&&(typeof error.code!=='number'||error.killed))return reject(error);
            resolveResult({code:error?.code??0,stdout,stderr});
        });
    });
}

test('aggregate check stops at test:core when the real reporter rejects a native green file',async t=>{
    const {directory,file}=await fixture(t,'','npm-fixture.mjs');
    const log=join(directory,'steps.jsonl');
    await writeFile(file,`import {appendFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
        const step=process.argv.at(-1);appendFileSync(${JSON.stringify(log)},JSON.stringify(step)+'\\n');
        if(step==='test:core'){
            const result=spawnSync(process.execPath,${JSON.stringify(['--test','--test-reporter=spec','--test-reporter='+reporter,'--test-reporter-destination=stdout','--test-reporter-destination=stderr',emptyFixture])},{stdio:'inherit'});
            process.exit(result.status??1);
        }`);
    const result=await runNode([join(root,'scripts/check.mjs')],{extraEnv:{npm_execpath:file}});
    assert.equal(result.code,1);assert.match(result.stdout,/pass 1/);
    assert.match(result.stderr,/\[core-report\] FAIL/);assert.match(result.stderr,/Stopped at test:core \(exit 1\)/);
    const {readFile}=await import('node:fs/promises');
    assert.deepEqual((await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),['doctor','check:docs','test:core']);
});

test('core reporter CLI makes the native green empty-file result fail with the exact filename',async()=>{
    const native=await cli([emptyFixture],{guard:false});assert.equal(native.code,0);assert.match(native.stdout,/pass 1/);
    const guarded=await cli([emptyFixture]);assert.equal(guarded.code,1);assert.match(guarded.stdout,/pass 1/);
    assert.match(guarded.stderr,/\[core-report\] FAIL tests\/fixtures\/core-empty.mjs: no internal node:test summary/);
});

test('core reporter CLI retains named cases, suites, helper registration and the tsx loader',async t=>{
    const {directory,file}=await fixture(t,"import {test,describe,it} from 'node:test'; import {answer} from './model.ts'; import {register} from './helper.mjs'; test('ordinary named case',()=>{if(answer!==42)throw Error('wrong TS value')}); describe('suite',()=>it('nested named case',()=>{})); register();");
    await writeFile(join(directory,'model.ts'),'export const answer: number = 42;\n');
    await writeFile(join(directory,'helper.mjs'),"import {test} from 'node:test'; export const register=()=>test('helper declared case',()=>{});\n");
    const second=join(directory,'second.test.mjs');await writeFile(second,"import {test} from 'node:test'; test('second file case',()=>{});\n");
    const result=await cli([file,second]);assert.equal(result.code,0,result.stderr+result.stdout);
    for(const name of ['ordinary named case','nested named case','helper declared case','second file case'])assert.ok(result.stdout.includes(name));
    assert.match(result.stderr,/Verified 4 executed scenarios across 2 files/);
});

test('core reporter CLI rejects an empty file even alongside a complete good file',async t=>{
    const {file}=await fixture(t,"import {test} from 'node:test'; test('real case',()=>{});");
    const result=await cli([file,emptyFixture]);assert.equal(result.code,1);assert.match(result.stdout,/real case/);
    assert.match(result.stderr,/core-empty.mjs: no internal/);assert.doesNotMatch(result.stderr,/Verified/);
});

test('core reporter CLI requires a real executed case rather than only suites, skip or TODO',async t=>{
    for(const source of ["import {describe} from 'node:test'; describe('empty suite',()=>{});",
        "import {test} from 'node:test'; test.skip('skip only',()=>{}); test.todo('todo only');"]){
        const {file}=await fixture(t,source);const result=await cli([file]);
        assert.equal(result.code,1);assert.match(result.stderr,/no executed core scenarios/);
    }
    const {file}=await fixture(t,"import {test} from 'node:test'; test('real',()=>{}); test.skip('skip',()=>{}); test.todo('expected failure',()=>{throw Error('TODO failure')});");
    const result=await cli([file]);assert.equal(result.code,0,result.stderr+result.stdout);
    assert.match(result.stderr,/Verified 1 executed scenarios across 1 files/);
});

test('core reporter CLI preserves an ordinary assertion failure and its original diagnostics',async t=>{
    const {file}=await fixture(t,"import {test} from 'node:test'; test('failing case',()=>{throw Error('core fixture assertion failed')});");
    const result=await cli([file]);assert.equal(result.code,1);assert.match(result.stdout+result.stderr,/core fixture assertion failed/);
    assert.match(result.stderr,/node:test reported a failed run/);assert.doesNotMatch(result.stderr,/Verified/);
});

test('core reporter CLI preserves import failures and bounded test timeouts',async t=>{
    const {file}=await fixture(t,"throw Error('core fixture import failed');");
    const imported=await cli([file]);assert.equal(imported.code,1);assert.match(imported.stdout+imported.stderr,/core fixture import failed/);
    const timed=await fixture(t,"import {test} from 'node:test'; test('bounded timeout',{timeout:30},async()=>{await new Promise(r=>setTimeout(r,150))});");
    const result=await cli([timed.file]);assert.equal(result.code,1);assert.match(result.stdout+result.stderr,/timed out|testTimeoutFailure/);
});
