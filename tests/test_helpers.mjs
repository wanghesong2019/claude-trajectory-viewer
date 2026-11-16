// 前端纯逻辑测试（node:test，无需构建步骤）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRunChip, runChipClass, shouldShowStop, basename, findSample } from '../static/helpers.mjs';

test('formatRunChip 完整字段拼成 $cost · 耗时 · 轮数', () => {
  assert.equal(
    formatRunChip({ total_cost_usd: 0.42, duration_ms: 21000, num_turns: 8 }),
    '$0.42 · 21.0s · 8 turns'
  );
});

test('formatRunChip 缺成本/耗时时跳过空段', () => {
  assert.equal(
    formatRunChip({ total_cost_usd: null, duration_ms: null, num_turns: 3 }),
    '3 turns'
  );
});

test('runChipClass 成功为 ok，其他为 err', () => {
  assert.equal(runChipClass({ subtype: 'success' }), 'ok');
  assert.equal(runChipClass({ subtype: 'error' }), 'err');
});

test('shouldShowStop 只在 live 且运行中为真', () => {
  assert.equal(shouldShowStop(true, 'live'), true);
  assert.equal(shouldShowStop(true, 'replay'), false);
  assert.equal(shouldShowStop(false, 'live'), false);
});

test('basename 提取路径最后一段', () => {
  assert.equal(basename('D:/x/y/sample_real.jsonl'), 'sample_real.jsonl');
  assert.equal(basename('C:\\a\\b\\sample_subagent.jsonl'), 'sample_subagent.jsonl');
});

test('findSample 按 basename 或完整路径匹配，找不到返回 null', () => {
  const samples = ['D:/a/sample_real.jsonl', 'D:/a/sample_subagent.jsonl'];
  assert.equal(findSample(samples, 'sample_real.jsonl'), 'D:/a/sample_real.jsonl');
  assert.equal(findSample(samples, 'D:/a/sample_subagent.jsonl'), 'D:/a/sample_subagent.jsonl');
  assert.equal(findSample(samples, 'nope.jsonl'), null);
});
