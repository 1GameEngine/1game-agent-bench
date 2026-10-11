import { runProcess } from './process-supervisor.mjs';

// Keep validation's early cutoff; other workers use their full stage deadline.
export function runValidationProcess(argv, { stopAt, ...options } = {}) {
  return runProcess(argv, { ...options, deadline: stopAt, stopAt, deadlineReason: 'closing_reserve' });
}
