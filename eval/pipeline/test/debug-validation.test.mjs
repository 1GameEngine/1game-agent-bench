import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { diagnosticPlan } from '../src/validation-plan.mjs';
import { selfCheckEvidenceError } from '../src/self-check-evidence.mjs';
import { createSubmissionManifest } from '../src/submission-manifest.mjs';
import { WORK_DIR, taskDir } from '../src/paths.mjs';
import { loadYaml } from '../src/load.mjs';
import { validateTraces, validateStageTraces } from '../src/validate-traces.mjs';
import { validationBudget } from '../src/validation-control.mjs';
import { builderDiagnosticContext, defaultRunSubagent, validationSpec } from '../src/subagent-stage.mjs';
import { StageRecorder } from '../src/stage-records.mjs';
import { EvalError } from '../src/util.mjs';
import { publishStageResponse } from '../src/stage-close.mjs';
import { runAgentStage } from '../src/stage-runner.mjs';
import { validationIndexPath } from '../src/validation-control.mjs';
import { godotBin } from '../src/p1-godot.mjs';

const scenarios = ['intro','loop','fail','clear'];
function candidate(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(),'debug-candidate-'));
  fs.mkdirSync(path.join(workspace,'demo_outputs'));
  fs.mkdirSync(path.join(workspace,'assets'));
  fs.writeFileSync(path.join(workspace,'game.gd'),'extends Node2D\n');
  fs.writeFileSync(path.join(workspace,'game.tscn'),'[gd_scene format=3]\n');
  fs.writeFileSync(path.join(workspace,'project.godot'),'config_version=5\n');
  for (const [i,scenario] of scenarios.entries()) fs.writeFileSync(path.join(workspace,'demo_outputs',`0${i+1}_${scenario}.json`),JSON.stringify({
    schema:'eval.trace/1', scenario,duration_frames:40,viewport:{w:1280,h:720},
    events:scenario==='intro'?[]:[{frame:1,type:'click',x:640,y:655},{frame:20,type:'click',x:160,y:655}],
  }));
  t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));
  return workspace;
}

test('a diagnostic prefix preserves original event frames, bytes and full candidate identity', t=>{
  const workspace = candidate(t);
  const taskId='p1-tower-defense',task=loadYaml(path.join(taskDir(taskId),'task.yaml'));
  const before=createSubmissionManifest({workspace,engine:'godot',taskId,publicTask:task});
  let actual;
  const report=validateTraces({engine:'godot',taskId,workspace,scenario:'loop',untilFrame:'20',checkpoints:'1,19,20'}, {
    replay: options=>{actual=options;return {G:true,primary:'TRACE_OK',replayed_scenarios:['loop'],stills:[],notes:[]};},
  });
  t.after(()=>fs.rmSync(report.artifact_dir,{recursive:true,force:true}));
  assert.equal(report.validation_mode,'diagnostic');
  assert.equal(report.submission_id,before.submission_id);
  assert.equal(actual.tracesOverride.length,1);
  assert.equal(actual.tracesOverride[0].trace.duration_frames,21);
  assert.deepEqual(actual.tracesOverride[0].trace.events.map(e=>e.frame),[1,20]);
  assert.deepEqual(actual.sampleFrames,[1,19,20]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace,'demo_outputs/02_loop.json'))).duration_frames,40);
  assert.equal(fs.readdirSync(path.join(report.artifact_dir,'submission/demo_outputs')).length,4);
  assert.equal(fs.existsSync(path.join(workspace,'REPLAY.json')),false);
});

test('diagnostics reject invalid frame requests and never mutate their source trace', ()=>{
  const traces=[{audit:{ok:true},trace:{scenario:'loop',duration_frames:100,events:[{frame:1,type:'click'}]}}];
  const prior=JSON.stringify(traces);
  for(const options of [{untilFrame:5},{scenario:'loop',untilFrame:-1},{scenario:'loop',untilFrame:'bad'},
    {scenario:'loop',untilFrame:100},{scenario:'loop',untilFrame:20,checkpoints:'21'},
    {scenario:'loop',checkpoints:'1,NaN'},{scenario:'loop',checkpoints:Array(39).fill(1)}]) {
    assert.throws(()=>diagnosticPlan(traces,options),e=>e.primary==='TRACE_INVALID');
  }
  assert.equal(JSON.stringify(traces),prior);
});

function evidenceFixture(t) {
  const workspace=candidate(t), taskId='p1-tower-defense',stageId='own-debug-stage';
  const session=`validation-${Date.now()}-${randomBytes(6).toString('hex')}`,dir=path.join(WORK_DIR,session);
  fs.mkdirSync(path.join(dir,'stills'),{recursive:true});
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const task=loadYaml(path.join(taskDir(taskId),'task.yaml'));
  const manifest=createSubmissionManifest({workspace,engine:'godot',taskId,stageId,publicTask:task});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6sAAAAASUVORK5CYII=','base64');
  const stills=scenarios.flatMap(s=>[0,39].map(f=>{
    const id=`${s}_f${f}`,file=path.join(dir,'stills',id+'.png');fs.writeFileSync(file,png);
    return {id,path:file,ok:true,sha256:createHash('sha256').update(png).digest('hex')};
  }));
  const report={schema:'eval.trace-validation/2',diagnostic_only:true,engine:'godot',taskId,stage_id:stageId,workspace,
    ok:true,validation_mode:'full',submission_id:manifest.submission_id,expected_scenarios:scenarios,replayed_scenarios:scenarios,
    process_exit_status:0,process_started_at:new Date(Date.now()-1000).toISOString(),process_finished_at:new Date().toISOString(),cleanup_finished_at:new Date().toISOString(),trace_frames:Object.fromEntries(scenarios.map(s=>[s,40])),stills};
  const progress={schema:'eval.validation-progress/1',state:'COMPLETE',session_id:session,stage_id:stageId,submission_id:manifest.submission_id,cleanup_finished_at:report.cleanup_finished_at,process_exit_status:0};
  const save=()=>{for(const [name,value] of Object.entries({'SUBMISSION.json':manifest,'VALIDATION.json':report,'PROGRESS.json':progress}))fs.writeFileSync(path.join(dir,name),JSON.stringify(value));};save();
  const spec={role:'debug',engine:'godot',taskId,workspace,stage_id:stageId,self_check_contract:'eval.self-check/1'};
  const data={stdout:'',exitCode:0,self_check:{session_id:session,submission_id:manifest.submission_id,reviewed_still_ids:stills.map(s=>s.id),
    preflight:{passed:true,checks:['build/types/assets checked']},scenarios:Object.fromEntries(scenarios.map(s=>[s,{passed:true,checks:[{requirement:'visible submitted scene matches public task',passed:true,evidence:[`${s}_f39`]}]}]))}};
  return {workspace,dir,report,progress,save,spec,data};
}

test('success evidence requires the final full candidate and every reviewed frame', t=>{
  const f=evidenceFixture(t);
  const error=()=>selfCheckEvidenceError(f.spec,f.data,{checkWorkspace:true});
  assert.equal(error(),null);
  f.report.validation_mode='diagnostic';f.save();assert.equal(error().primary,'STAGE_VALIDATION_INCOMPLETE');
  f.report.validation_mode='full';f.save();
  const removed=f.data.self_check.reviewed_still_ids.pop();assert.equal(error().primary,'STAGE_VALIDATION_INCOMPLETE');f.data.self_check.reviewed_still_ids.push(removed);
  f.data.self_check.scenarios.loop.checks[0].evidence=['clear_f39'];assert.equal(error().primary,'STAGE_VALIDATION_INCOMPLETE');f.data.self_check.scenarios.loop.checks[0].evidence=['loop_f39'];
  f.progress.state='FAILED';f.save();assert.equal(error().primary,'SUBAGENT_PROCESS_FAILED');f.progress.state='COMPLETE';f.save();
  f.report.stage_id='other';f.save();assert.equal(error().primary,'SUBAGENT_INVALID');f.report.stage_id=f.spec.stage_id;f.save();
  fs.writeFileSync(f.report.stills[0].path,'damaged');assert.equal(error().primary,'STAGE_VALIDATION_INCOMPLETE');
});

test('source, trace, asset and lockfile changes invalidate a previously reviewed success', t=>{
  for(const rel of ['game.gd','demo_outputs/02_loop.json','assets/new.png','pnpm-lock.yaml']) {
    const f=evidenceFixture(t);
    assert.equal(selfCheckEvidenceError(f.spec,f.data,{checkWorkspace:true}),null);
    fs.writeFileSync(path.join(f.workspace,rel),'changed candidate');
    assert.equal(selfCheckEvidenceError(f.spec,f.data,{checkWorkspace:true})?.primary,'STAGE_VALIDATION_INCOMPLETE',rel);
  }
});

test('publisher rejects unverified/stale success before archiving and preserves a verified declaration exactly', t=>{
  const f=evidenceFixture(t),id=f.spec.stage_id,now=Date.now();
  const timingPath=path.join(f.workspace,`${id}.timing.json`);
  const lifecycle={timing_path:timingPath,response_path:path.join(f.workspace,`${id}.response.json`),archive_response_path:path.join(f.workspace,`${id}.archive.json`)};
  fs.writeFileSync(timingPath,JSON.stringify({schema:'eval.cloud-stage-timing/1',id,role:f.spec.role,engine:f.spec.engine,taskId:f.spec.taskId,state:'RUNNING',started_at:new Date(now-1000).toISOString(),execution_timeout_ms:600000,execution_deadline_at:new Date(now+599000).toISOString(),closing_reserve_ms:60000}));
  fs.writeFileSync(path.join(f.workspace,`${id}.request.json`),JSON.stringify({id,spec:f.spec,lifecycle}));
  assert.throws(()=>publishStageResponse({timingPath,data:{stdout:'',exitCode:0}}),e=>e.primary==='STAGE_VALIDATION_INCOMPLETE');
  fs.appendFileSync(path.join(f.workspace,'game.gd'),'# changed\n');
  assert.throws(()=>publishStageResponse({timingPath,data:f.data}),e=>e.primary==='STAGE_VALIDATION_INCOMPLETE');
  assert.equal(fs.existsSync(lifecycle.archive_response_path),false);
  fs.writeFileSync(path.join(f.workspace,'game.gd'),'extends Node2D\n');
  publishStageResponse({timingPath,data:f.data});
  assert.deepEqual(JSON.parse(fs.readFileSync(lifecycle.response_path)),f.data);
  assert.equal(fs.readFileSync(lifecycle.archive_response_path,'utf8'),fs.readFileSync(lifecycle.response_path,'utf8'));
});

test('negative receipts cannot hide an active validation or missing cleanup', t=>{
  const f=evidenceFixture(t),timingPath=path.join(f.workspace,'owner.timing.json');
  const file=validationIndexPath(timingPath);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({schema:'eval.validation-index/1',stage_id:f.spec.stage_id,sessions:[{progress_path:path.join(f.dir,'PROGRESS.json')}]}));
  f.progress.state='REPLAYING';f.progress.cleanup_finished_at=null;f.save();
  const data={stdout:'',exitCode:1,failure:{kind:'validation_incomplete',message:'unfinished'}};
  assert.equal(selfCheckEvidenceError(f.spec,data,{timingPath})?.primary,'SUBAGENT_PROCESS_FAILED');
});

test('a candidate edit after receipt observation records incomplete self-check instead of pass', async t=>{
  const f=evidenceFixture(t),dir=path.join(f.workspace,'stage-records');
  const recorder=new StageRecorder({dir,runId:'candidate-race',engine:'godot',taskId:f.spec.taskId});
  const publicTask=loadYaml(path.join(taskDir(f.spec.taskId),'task.yaml'));
  // Mutate an existing source file, not an observation directory, after the
  // transport supplied the accepted candidate identity.
  await assert.rejects(runAgentStage(async spec=>{
    spec._onSelfCheck(f.data.self_check);fs.appendFileSync(path.join(f.workspace,'game.gd'),'# after receipt\n');return '';
  },f.spec,{recorder,publicTask}),e=>e.primary==='STAGE_VALIDATION_INCOMPLETE');
  const records=fs.readdirSync(path.join(dir,'STAGES')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,'STAGES',n))));
  const model=records.find(r=>r.role==='debug');
  assert.equal(model.execution_status,'COMPLETED');assert.equal(model.self_check_status,'INCOMPLETE');
  assert.equal(model.result_summary.self_check.session_id,f.data.self_check.session_id);
});

test('budget planning excludes incomplete diagnostics and uses completed full same-task observations', t=>{
  const workspace=candidate(t),timingPath=path.join(workspace,'stage.timing.json');
  const ctx={request:{lifecycle:{timing_path:timingPath},spec:{debug_context:{validations:[
    {taskId:'p1-tower-defense',completed_full_replay:true,elapsed_ms:206000},
    {taskId:'p1-tower-defense',completed_full_replay:false,elapsed_ms:55000},
    {taskId:'other-task',completed_full_replay:true,elapsed_ms:999000},
  ]}}},timing:{id:'owned',engine:'onegame',execution_deadline_at:new Date(700000).toISOString()},validationStopAt:670000};
  const budget=validationBudget(ctx,'p1-tower-defense');
  assert.equal(budget.estimated_full_validation_ms,206000);
  assert.equal(Date.parse(budget.final_validation_start_by),670000-206000-45000-30000);
  assert.equal(budget.execution_deadline_at,ctx.timing.execution_deadline_at);
});

test('debug context carries only this engine/task builder observations and marks previous candidates', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'debug-context-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const recorder=new StageRecorder({dir,runId:'own-run',engine:'godot',taskId:'p1-tower-defense'});
  const h=recorder.begin('builder');recorder.finish(h,{submissionId:'old-candidate',error:new EvalError('GAME_VALIDATION_FAILED','input remained on selection')});
  fs.writeFileSync(path.join(dir,'STAGES/other-engine.json'),JSON.stringify({schema:'eval.stage-record/1',role:'builder',engine:'onegame',task_id:'p1-tower-defense',finished_at:new Date(Date.now()+10000).toISOString(),submission_id:'do-not-share'}));
  const context=builderDiagnosticContext(recorder,new EvalError('GAME_VALIDATION_FAILED','input remained on selection'));
  assert.equal(context.submission_id,'old-candidate');
  assert.equal(context.issues[0].message,'input remained on selection');
  assert.ok(!JSON.stringify(context).includes('do-not-share'));
  assert.match(context.meaning,/Previous candidate/);
});

test('external agents receive deadline-bound validation/cancel/budget tools and structured negatives remain warnings', async t=>{
  const workspace=candidate(t),script=path.join(workspace,'external.mjs');
  fs.writeFileSync(script,`import fs from 'node:fs';
const spec=JSON.parse(fs.readFileSync(0,'utf8'));
if(!spec.validation.argv.includes('--stage-timing')||!spec.validation.cancel_argv.includes('cancel-validation')||!spec.validation.budget_argv.includes('validation-budget')) process.exit(2);
console.log(JSON.stringify({stdout:'',exitCode:1,failure:{kind:'validation_incomplete',message:'actual agent unfinished'}}));`);
  const saved={cmd:process.env.EVAL_SUBAGENT_CMD,args:process.env.EVAL_SUBAGENT_ARGS};
  let timingPath; const timingPaths=[];
  try {
    process.env.EVAL_SUBAGENT_CMD=process.execPath;process.env.EVAL_SUBAGENT_ARGS=JSON.stringify([script]);
    await assert.rejects(defaultRunSubagent({role:'debug',engine:'godot',taskId:'p1-tower-defense',workspace,
      self_check_contract:'eval.self-check/1',validation:validationSpec({engine:'godot',taskId:'p1-tower-defense',workspace}),
      _onLifecycle:event=>{if(event.timing_path)timingPaths.push(event.timing_path);timingPath=event.timing_path??timingPath;}}),e=>e.primary==='STAGE_VALIDATION_INCOMPLETE'&&e.message.includes('actual agent unfinished'));
    assert.equal(JSON.parse(fs.readFileSync(timingPath)).state,'FAILED');
    fs.writeFileSync(script,"console.log('malformed result');");
    await assert.rejects(defaultRunSubagent({role:'debug',engine:'godot',taskId:'p1-tower-defense',workspace,
      self_check_contract:'eval.self-check/1',validation:validationSpec({engine:'godot',taskId:'p1-tower-defense',workspace}),
      _onLifecycle:event=>{if(event.timing_path)timingPaths.push(event.timing_path);}}),e=>e.primary==='SUBAGENT_INVALID');
  } finally {
    for(const [key,value] of [['EVAL_SUBAGENT_CMD',saved.cmd],['EVAL_SUBAGENT_ARGS',saved.args]])if(value===undefined)delete process.env[key];else process.env[key]=value;
    for(const file of timingPaths){fs.rmSync(file,{force:true});fs.rmSync(file.replace(/\.timing\.json$/,'.request.json'),{force:true});}
  }
});

test('real supervised full validation links its current candidate, native captures and receipt checks', {
  skip:!fs.existsSync(godotBin())?'Godot 4.4.1 is not installed':false,
}, async t=>{
  const workspace=candidate(t),id='real-evidence-stage',now=Date.now(),timingPath=path.join(workspace,`${id}.timing.json`);
  // A synthetic adapter fixture, not a formal game or a model judgment.
  fs.writeFileSync(path.join(workspace,'game.tscn'),'[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://game.gd" id="1"]\n[node name="Fixture" type="Node2D"]\nscript = ExtResource("1")\n');
  fs.writeFileSync(path.join(workspace,'project.godot'),'config_version=5\n[application]\nrun/main_scene="res://game.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
  const spec={role:'debug',engine:'godot',taskId:'p1-tower-defense',workspace,self_check_contract:'eval.self-check/1'};
  fs.writeFileSync(timingPath,JSON.stringify({schema:'eval.cloud-stage-timing/1',id,...spec,state:'RUNNING',started_at:new Date(now).toISOString(),execution_timeout_ms:600000,execution_deadline_at:new Date(now+600000).toISOString(),closing_reserve_ms:60000}));
  fs.writeFileSync(path.join(workspace,`${id}.request.json`),JSON.stringify({id,spec,lifecycle:{timing_path:timingPath}}));
  const report=await validateStageTraces({...spec,timingPath},{notify:()=>{}});
  t.after(()=>fs.rmSync(report.artifact_dir,{recursive:true,force:true}));
  assert.equal(report.ok,true,JSON.stringify(report.notes));
  assert.equal(report.validation_mode,'full');
  assert.equal(report.stills.length,8);
  const data={stdout:'',exitCode:0,self_check:{session_id:path.basename(report.artifact_dir),submission_id:report.submission_id,
    reviewed_still_ids:report.stills.map(s=>s.id),preflight:{passed:true,checks:['synthetic fixture native import/boot completed']},
    scenarios:Object.fromEntries(scenarios.map(s=>[s,{passed:true,checks:[{requirement:'synthetic fixture observation declaration',passed:true,evidence:[`${s}_f39`]}]}]))}};
  assert.equal(selfCheckEvidenceError(spec,data,{stageId:id,timingPath,checkWorkspace:true}),null);
  fs.appendFileSync(path.join(workspace,'game.gd'),'# new candidate\n');
  assert.equal(selfCheckEvidenceError(spec,data,{stageId:id,timingPath,checkWorkspace:true})?.primary,'STAGE_VALIDATION_INCOMPLETE');
});
