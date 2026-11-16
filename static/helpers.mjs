// 前端纯逻辑（可测、无 DOM 依赖）
export function formatRunChip(ev) {
  const parts = [];
  if (ev.total_cost_usd != null) parts.push(`$${ev.total_cost_usd.toFixed(2)}`);
  if (ev.duration_ms != null) parts.push(`${(ev.duration_ms / 1000).toFixed(1)}s`);
  if (ev.num_turns != null) parts.push(`${ev.num_turns} turns`);
  return parts.join(' · ');
}

export function runChipClass(ev) {
  return ev.subtype === 'success' ? 'ok' : 'err';
}

export function shouldShowStop(isRunning, mode) {
  return isRunning && mode === 'live';
}

export function basename(path) {
  return String(path).split(/[\\/]/).pop();
}

export function findSample(samples, param) {
  return samples.find(p => basename(p) === param || p === param) || null;
}
