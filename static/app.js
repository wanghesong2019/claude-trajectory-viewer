import { formatRunChip, runChipClass, shouldShowStop, basename, findSample } from './helpers.mjs';

// Claude Trajectory Viewer — 前端（M3：树形轨迹 + 大纲跳转 + 子树折叠）
const es = new EventSource('/api/events');
const trajectory = document.getElementById('trajectory');
const outline = document.getElementById('outline');
const numbers = document.getElementById('numbers');
const status = document.getElementById('status');

let currentSessionId = null;
let callSeq = 0;
const cardEls = new Map();   // tool_use_id -> { el, depth, hasSubtree }
let isRunning = false;
let currentMode = 'live';

es.onmessage = (e) => render(JSON.parse(e.data));

function render(ev) {
  const t = ev.type;

  if (t === 'system' && ev.subtype === 'init') { currentSessionId = ev.session_id; return; }

  // 有非 null parent_tool_use_id 的事件属于某个 subagent，标记其父 Task 卡为"有子树"
  if ((t === 'assistant' || t === 'user') && ev.parent_tool_use_id) {
    markSubtree(ev.parent_tool_use_id);
  }

  if (t === 'assistant') {
    const parentId = ev.parent_tool_use_id || null;
    const container = getContainer(parentId);
    const depth = depthOf(parentId);
    for (const c of ev.message?.content || []) {
      if (c.type === 'text' && c.text?.trim()) appendText(c.text, container);
      else if (c.type === 'tool_use') renderToolUse(c, container, depth);
    }
    return;
  }

  if (t === 'user') {
    for (const c of ev.message?.content || []) {
      if (c.type === 'tool_result') renderToolResult(c);
    }
    return;
  }

  if (t === 'run_stopped') {
    setStatus('stopped');
    setRunning(false);
    return;
  }

  if (t === 'run_error') {
    setStatus('failed');
    setRunning(false);
    const bar = document.createElement('div');
    bar.className = 'run-error';
    bar.textContent = '✕ ' + ev.message;
    trajectory.appendChild(bar);
    scrollBottom();
    return;
  }

  if (t === 'result') {
    setStatus(ev.subtype === 'success' ? 'finished' : 'failed');
    addRunChip(ev);
    setRunning(false);
    if (ev.session_id) currentSessionId = ev.session_id;
  }
}

// ---- 容器：主轨迹 vs 某个 Task 卡的子树体 ----
function getContainer(parentId) {
  if (!parentId) return trajectory;
  const entry = cardEls.get(parentId);
  return entry ? entry.el.querySelector('.call-body') : trajectory;
}
function depthOf(parentId) {
  if (!parentId) return 0;
  const entry = cardEls.get(parentId);
  return entry ? entry.depth + 1 : 0;
}

// ---- 工具调用卡片 ----
function renderToolUse(c, container, depth) {
  callSeq++;
  const domId = 'call-' + callSeq;
  const card = document.createElement('div');
  card.className = 'call pending';
  card.id = domId;
  card.innerHTML = `
    <div class="call-head">
      <span class="collapse-toggle" hidden>▾</span>
      <span class="tool">${escapeHtml(c.name)}</span>
      <span class="input">${escapeHtml(shortInput(c.input))}</span>
      <span class="state">⏳</span>
    </div>
    <div class="call-body"></div>`;
  container.appendChild(card);
  cardEls.set(c.id, { el: card, depth, hasSubtree: false });
  addOutline(c.name, domId, depth);
  scrollBottom();
}

// ---- 工具结果：按 tool_use_id 配对 ----
function renderToolResult(c) {
  const entry = cardEls.get(c.tool_use_id);
  if (!entry) return;
  const card = entry.el;
  const isErr = c.is_error === true;
  card.classList.remove('pending');
  card.classList.add(isErr ? 'err' : 'ok');

  const state = card.querySelector('.state');
  state.textContent = isErr ? '✕' : '✓';
  state.className = 'state ' + (isErr ? 'err' : 'ok');

  const text = stringify(c.content);
  const body = card.querySelector('.call-body');
  const resultEl = document.createElement('div');
  resultEl.className = 'result';
  if (text.length > 400) {
    resultEl.classList.add('folded');
    resultEl.innerHTML = `<pre>${escapeHtml(text.slice(0, 400))}</pre><div class="fold-hint">▸ 展开 ${text.length - 400} 字</div>`;
    resultEl.onclick = () => toggleFold(resultEl, text);
  } else {
    resultEl.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
  }
  body.appendChild(resultEl);
  scrollBottom();
}

// ---- 子树折叠 ----
function markSubtree(parentId) {
  const entry = cardEls.get(parentId);
  if (!entry || entry.hasSubtree) return;
  entry.hasSubtree = true;
  const toggle = entry.el.querySelector('.collapse-toggle');
  toggle.hidden = false;
  toggle.onclick = () => {
    const body = entry.el.querySelector('.call-body');
    const collapsed = body.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▸' : '▾';
  };
}

// ---- 大纲（点击跳转，自动展开折叠的祖先）----
function addOutline(name, domId, depth) {
  const o = document.createElement('div');
  o.className = 'outline-item';
  o.style.paddingLeft = (depth * 12 + 4) + 'px';
  o.textContent = name;
  o.onclick = () => revealCard(domId);
  outline.appendChild(o);
}

function revealCard(domId) {
  const el = document.getElementById(domId);
  if (!el) return;
  let p = el.parentElement;
  while (p && p !== trajectory) {
    p.classList.remove('collapsed');
    p = p.parentElement;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- 模式切换 ----
const liveFields = document.getElementById('liveFields');
const replayFields = document.getElementById('replayFields');
function syncModeFields() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  liveFields.hidden = mode !== 'live';
  replayFields.hidden = mode !== 'replay';
}
document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', syncModeFields));

document.getElementById('run').onclick = () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  trajectory.innerHTML = '';
  outline.querySelectorAll('.outline-item').forEach(n => n.remove());
  cardEls.clear();
  callSeq = 0;
  currentMode = mode;
  setStatus('running');
  setRunning(true);

  const body = { mode, resume_session_id: null, skip_permissions: false };
  if (mode === 'replay') {
    body.prompt = '';
    body.cwd = '';
    body.replay_file = document.getElementById('replayFile').value.trim();
  } else {
    body.prompt = document.getElementById('prompt').value.trim();
    body.cwd = document.getElementById('cwd').value.trim();
    body.replay_file = null;
    const resumeChecked = document.getElementById('resume').checked;
    body.resume_session_id = (resumeChecked && currentSessionId) ? currentSessionId : null;
  }

  fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
};

// ---- 运行状态：Run 禁用 / Stop 显示 ----
function setRunning(running) {
  isRunning = running;
  document.getElementById('run').disabled = running;
  document.getElementById('stop').hidden = !shouldShowStop(running, currentMode);
}

document.getElementById('stop').onclick = () => {
  fetch('/api/stop', { method: 'POST' });
};

// ---- run 成本历史 ----
function addRunChip(ev) {
  const chip = document.createElement('div');
  chip.className = 'run-chip ' + runChipClass(ev);
  chip.textContent = formatRunChip(ev);
  chip.title = ev.session_id ? `session ${ev.session_id}` : '';
  numbers.appendChild(chip);
  numbers.scrollLeft = numbers.scrollWidth;
}

// ---- 样例下拉 ----
fetch('/api/samples').then(r => r.json()).then(d => {
  const sel = document.getElementById('sampleSelect');
  d.samples.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = basename(p);
    sel.appendChild(opt);
  });
});
document.getElementById('sampleSelect').onchange = (e) => {
  const v = e.target.value;
  if (v) document.getElementById('replayFile').value = v;
};

// ---- 深链：?sample=<文件名> 自动切 replay + 填充 + 运行（用于截图/分享）----
const sampleParam = new URLSearchParams(location.search).get('sample');
if (sampleParam) {
  fetch('/api/samples').then(r => r.json()).then(d => {
    const match = findSample(d.samples, sampleParam);
    if (match) {
      document.querySelector('input[name="mode"][value="replay"]').checked = true;
      syncModeFields();
      document.getElementById('replayFile').value = match;
      document.getElementById('run').click();
    }
  });
}

// ---- helpers ----
function appendText(text, container) {
  const div = document.createElement('div');
  div.className = 'msg';
  if (window.marked) div.innerHTML = marked.parse(text);
  else div.textContent = text;   // CDN 加载失败时回退纯文本
  container.appendChild(div);
  scrollBottom();
}

function toggleFold(el, fullText) {
  if (el.classList.contains('folded')) {
    el.classList.remove('folded');
    el.innerHTML = `<pre>${escapeHtml(fullText)}</pre><div class="fold-hint">▾ 收起</div>`;
  } else {
    el.classList.add('folded');
    el.innerHTML = `<pre>${escapeHtml(fullText.slice(0, 400))}</pre><div class="fold-hint">▸ 展开 ${fullText.length - 400} 字</div>`;
  }
}

function scrollBottom() { trajectory.scrollTop = trajectory.scrollHeight; }
const STATUS_TEXT = { idle: '就绪', running: '运行中', finished: '完成', failed: '失败', stopped: '已停止' };
function setStatus(s) {
  status.textContent = STATUS_TEXT[s] || s;
  status.className = 'status ' + s;
}

function shortInput(input) {
  if (!input || typeof input !== 'object') return '';
  if (input.file_path) return input.file_path;
  if (input.command) return input.command;
  if (input.pattern) return (input.path ? input.path + ' · ' : '') + input.pattern;
  if (input.description) return input.description;
  const s = JSON.stringify(input);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function stringify(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
