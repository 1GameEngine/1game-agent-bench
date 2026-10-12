import { stageTimeoutMs, stageDispatchTimeoutMs } from './stage-timeout.mjs';

// Execution changes are versioned independently from product-100/2.
export const EXECUTION_POLICY_REVISION = 'eval.execution/3';

export function executionPolicy(env = process.env) {
  const budgets = Object.fromEntries(['builder', 'debug', 'replay', 'looks'].map(role => [role, stageTimeoutMs(role, env)]));
  return {
    revision: EXECUTION_POLICY_REVISION,
    stage_budgets_ms: budgets,
    dispatch_budget_ms: stageDispatchTimeoutMs(env),
    timing: {
      model_start: 'actual_started_receipt',
      process_start: 'worker_spawn',
      model_completion: 'atomic_response_publication',
      self_validation: 'inside_model_budget',
      boot_and_audit: 'outside_model_budget',
      wrap_up_reserve_ms: Object.fromEntries(['builder', 'debug', 'looks'].map(role => [role, Math.min(60_000, Math.floor(budgets[role] / 10))])),
      cleanup_grace_ms: 5000,
      cleanup_reap_ms: 2000,
      process_completion: 'worker_exit_and_process_group_cleanup_before_cutoff',
    },
    framework_budgets_ms: { prepare: 1_800_000, boot: 600_000, audit: 120_000, manifest: 120_000 },
    scheduling: {
      tasks: 'headline_order_sequential',
      engines: ['onegame', 'godot'],
      prepare: 'sequential',
      engine_pipeline_concurrency: 2,
      supervisor: 'asynchronous_linux_process_groups',
      adapter_execution: 'synchronous_inside_execution_process',
      validation_concurrency_limit: 1,
      validation_concurrency_scope: 'per_model_stage',
      cross_suite_concurrency_limit: null,
      cpu_limit: null,
      memory_limit_bytes: null,
    },
    recovery: 'reports_only_no_stage_resume',
    submission_policy: 'observational_manifests_no_new_acceptance_gate',
    self_check_policy: { revision: 'eval.self-check/1', diagnostics: 'submitted_trace_prefix_and_checkpoints',
      success_evidence: 'current_candidate_full_validation_and_model_visual_review',
      cancellation: 'owned_session_request_and_confirmed_process_group_cleanup',
      budget_planning: 'observed_full_duration_plus_review_and_safety_reserves' },
  };
}
