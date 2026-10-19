const $ = (id) => document.getElementById(id);

let allModels = [];
let selected = new Set();
let caps = {};
let editingId = null;
let backupPage = 1;
let pageSize = 10;
let autoBackup = true;

function toast(message, type) {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.className = 'toast';
  }, 3600);
}

function setStatus(el, message, type) {
  el.textContent = message;
  el.className = 'status' + (type ? ' ' + type : '');
}

async function api(path, options) {
  const res = await fetch(path, {
    method: options && options.body ? 'POST' : 'GET',
    headers: options && options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options && options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await res.json().catch(() => ({ ok: false, error: '响应解析失败' }));
  if (!res.ok || !json.ok) throw new Error(json.error || 'HTTP ' + res.status);
  return json.data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;

function hostFromURL(u) {
  try {
    const url = new URL(u);
    return (
      (url.hostname + url.pathname)
        .replace(/\./g, '-')
        .replace(/\/v\d+\/?$/, '')
        .replace(/[^A-Za-z0-9-]/g, '')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'provider'
    );
  } catch {
    return '';
  }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'providers') loadState();
  if (name === 'backups') loadBackups(backupPage);
}

function defaultCaps() {
  return { attachment: false, reasoning: false, tool_call: true, temperature: undefined, modalities: { input: ['text'] } };
}

function ensureCaps(id) {
  if (!caps[id]) caps[id] = defaultCaps();
  return caps[id];
}

function modalitiesFor(c) {
  let input = Array.isArray(c.modalities && c.modalities.input) ? c.modalities.input.slice() : ['text'];
  if (!input.includes('text')) input.unshift('text');
  const hasImage = input.includes('image');
  if (c.attachment && !hasImage) input.push('image');
  if (!c.attachment && hasImage) input = input.filter((x) => x !== 'image');
  return { input };
}

function renderModels() {
  const list = $('modelList');
  const q = $('modelSearch').value.trim().toLowerCase();
  const shown = allModels.filter((m) => !q || m.toLowerCase().includes(q));
  if (!allModels.length) {
    list.innerHTML = '<div class="empty">尚未拉取模型</div>';
    $('modelCount').textContent = '0 个模型';
    return;
  }
  if (!shown.length) {
    list.innerHTML = '<div class="empty">没有匹配的模型</div>';
  } else {
    list.innerHTML = shown
      .map((m) => {
        const c = ensureCaps(m);
        const cap = (key, label, title) =>
          `<label class="cap" title="${title}"><input type="checkbox" data-cap="${key}" data-model="${escapeAttr(m)}" ${c[key] ? 'checked' : ''}/>${label}</label>`;
        return `<div class="model-item">
          <label class="model-pick">
            <input type="checkbox" data-model="${escapeAttr(m)}" ${selected.has(m) ? 'checked' : ''} />
            <span class="mid">${escapeHtml(m)}</span>
          </label>
          <span class="caps">
            ${cap('attachment', '视觉', '支持图片/附件（多模态）')}
            ${cap('reasoning', '推理', '支持推理/思考')}
            ${cap('tool_call', '工具', '支持工具调用')}
          </span>
        </div>`;
      })
      .join('');
    list.querySelectorAll('input[data-model]:not([data-cap])').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-model');
        if (cb.checked) selected.add(id);
        else selected.delete(id);
        updateCount();
      });
    });
    list.querySelectorAll('input[data-cap]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-model');
        ensureCaps(id)[cb.getAttribute('data-cap')] = cb.checked;
      });
    });
  }
  updateCount();
}

function updateCount() {
  $('modelCount').textContent = `已选 ${selected.size} / 共 ${allModels.length}`;
}

function extraHeadersValue() {
  const raw = $('extraHeaders').value.trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

async function fetchModels() {
  const baseURL = $('baseURL').value.trim();
  if (!baseURL) {
    toast('请先填写 API 地址', 'err');
    return;
  }
  let extraHeaders;
  try {
    extraHeaders = extraHeadersValue();
  } catch {
    toast('额外请求头不是有效 JSON', 'err');
    return;
  }
  const btn = $('fetchBtn');
  btn.disabled = true;
  setStatus($('fetchStatus'), '拉取中…');
  try {
    const data = await api('/api/models', {
      body: { baseURL, apiKey: $('apiKey').value.trim(), headerName: $('headerName').value.trim(), headerValue: $('headerValue').value.trim(), extraHeaders }
    });
    allModels = data.models;
    selected = new Set(allModels);
    caps = {};
    for (const m of allModels) caps[m] = defaultCaps();
    if (!$('providerId').value.trim()) $('providerId').value = hostFromURL(baseURL);
    renderModels();
    setStatus($('fetchStatus'), `成功：从 ${data.url} 拉取到 ${data.models.length} 个模型`, 'ok');
    toast(`拉取到 ${data.models.length} 个模型`, 'ok');
  } catch (e) {
    setStatus($('fetchStatus'), e.message, 'err');
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function testConnectivity() {
  const baseURL = $('baseURL').value.trim();
  if (!baseURL) {
    toast('请先填写 API 地址', 'err');
    return;
  }
  let extraHeaders;
  try {
    extraHeaders = extraHeadersValue();
  } catch {
    toast('额外请求头不是有效 JSON', 'err');
    return;
  }
  const chosen = allModels.find((m) => selected.has(m)) || allModels[0];
  const body = { baseURL, apiKey: $('apiKey').value.trim(), headerName: $('headerName').value.trim(), headerValue: $('headerValue').value.trim(), extraHeaders };
  if (chosen) body.model = chosen;
  const btn = $('testBtn');
  btn.disabled = true;
  setStatus($('fetchStatus'), '测试中…');
  try {
    const d = await api('/api/test', { body });
    let msg;
    if (!d.reachable) msg = '连接失败：' + d.message;
    else if (!d.authOk) msg = '已连接，但认证失败：' + d.message;
    else if (d.keyChecked && d.keyValid === true) msg = '连接成功 · Key 校验通过 · ' + d.latencyMs + 'ms';
    else if (d.keyChecked && d.keyValid === false) msg = '连接成功，但 Key 校验未通过：' + d.message;
    else if (d.keyChecked) msg = '连接成功 · Key 可用（对话校验未确认）· ' + d.latencyMs + 'ms';
    else msg = '连接成功 · 认证通过 · ' + d.latencyMs + 'ms' + (chosen ? '' : '（未选模型，仅测连通性）');
    setStatus($('fetchStatus'), msg, d.ok ? 'ok' : 'err');
    toast(msg, d.ok ? 'ok' : 'err');
  } catch (e) {
    setStatus($('fetchStatus'), e.message, 'err');
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function reloadProvider(id) {
  const prevKey = $('apiKey').value.trim();
  try {
    const d = await api('/api/provider/detail', { body: { id } });
    editingId = id;
    $('baseURL').value = d.baseURL || '';
    const storedKey = (d.apiKey || '').trim();
    if (prevKey && prevKey !== storedKey) {
      const keepTyped = confirm(
        '表单里已有一个 API Key，与该提供商已保存的不同。\n\n【确定】保留你输入的 Key\n【取消】改用已保存的 Key（' + (storedKey || '空') + '）'
      );
      $('apiKey').value = keepTyped ? prevKey : storedKey;
      if (keepTyped) toast('已保留你输入的 API Key', 'ok');
    } else {
      $('apiKey').value = storedKey;
    }
    $('providerId').value = d.id;
    $('providerName').value = d.name || '';
    $('npm').value = d.npm || '@ai-sdk/openai-compatible';
    $('headerName').value = '';
    $('headerValue').value = '';
    $('extraHeaders').value = d.headers && Object.keys(d.headers).length ? JSON.stringify(d.headers, null, 2) : '';
    $('enable').checked = !d.disabled;
    $('modeReplace').checked = true;
    $('addBtn').textContent = '保存修改';
    $('resetEditBtn').hidden = false;
    switchTab('fetch');
    await fetchModels();
    const existing = new Set(d.models);
    for (const [mid, meta] of Object.entries(d.modelMeta || {})) {
      if (!caps[mid]) continue;
      const metaInput = meta.modalities && Array.isArray(meta.modalities.input) ? meta.modalities.input : null;
      caps[mid].attachment = meta.attachment === true || !!(metaInput && metaInput.includes('image'));
      caps[mid].reasoning = meta.reasoning === true;
      caps[mid].tool_call = meta.tool_call !== false;
      if (metaInput) caps[mid].modalities = { input: metaInput };
    }
    if (allModels.length || d.models.length) {
      selected = new Set(allModels.filter((m) => existing.has(m)));
      renderModels();
    }
    const missingModels = d.models.filter((m) => !allModels.includes(m));
    const kept = d.models.filter((m) => allModels.includes(m)).length;
    setStatus($('addStatus'), `正在编辑 ${id}：已勾选配置中的 ${kept} 个模型` + (missingModels.length ? `，另有 ${missingModels.length} 个配置模型未出现在接口列表中（合并模式会保留）` : ''), 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function resetEdit() {
  editingId = null;
  $('addBtn').textContent = '一键添加';
  $('resetEditBtn').hidden = true;
  $('modeReplace').checked = false;
}

async function addProvider() {
  const id = $('providerId').value.trim();
  const baseURL = $('baseURL').value.trim();
  if (!id) {
    toast('请填写提供商 ID', 'err');
    return;
  }
  if (!baseURL) {
    toast('请填写 API 地址', 'err');
    return;
  }
  const chosen = allModels.filter((m) => selected.has(m));
  if (!chosen.length) {
    toast('请至少勾选一个模型', 'err');
    return;
  }
  let extraHeaders;
  try {
    extraHeaders = extraHeadersValue();
  } catch {
    toast('额外请求头不是有效 JSON', 'err');
    return;
  }
  const btn = $('addBtn');
  btn.disabled = true;
  setStatus($('addStatus'), '写入中…');
  try {
    const headerName = $('headerName').value.trim();
    const headerValue = $('headerValue').value.trim();
    const headers = Object.assign({}, extraHeaders || {});
    if (headerName && headerValue) headers[headerName] = headerValue;
    const data = await api('/api/provider', {
      body: {
        id,
        name: $('providerName').value.trim(),
        npm: $('npm').value.trim(),
        baseURL,
        apiKey: $('apiKey').value.trim(),
        headers,
        models: chosen.map((m) => {
          const c = ensureCaps(m);
          const item = { id: m, name: m, attachment: c.attachment === true, reasoning: c.reasoning === true, tool_call: c.tool_call !== false, modalities: modalitiesFor(c) };
          if (typeof c.temperature === 'boolean') item.temperature = c.temperature;
          return item;
        }),
        enable: $('enable').checked,
        mode: $('modeReplace').checked ? 'replace' : 'merge'
      }
    });
    resetEdit();
    setStatus($('addStatus'), `${data.created ? '已创建' : '已更新'} ${data.id}，当前共 ${data.modelCount} 个模型${data.backup ? '（已备份）' : '（未自动备份）'}`, 'ok');
    toast(`提供商 ${data.id} 写入成功`, 'ok');
    await loadState();
  } catch (e) {
    setStatus($('addStatus'), e.message, 'err');
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function deleteProvider(id) {
  if (!confirm(`确定删除提供商「${id}」？` + (autoBackup ? '删除前会自动备份配置。' : '当前未开启自动备份。'))) return;
  try {
    await api('/api/provider/delete', { body: { id } });
    toast(`已删除 ${id}`, 'ok');
    await loadState();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function toggleEnabled(id, enabled) {
  try {
    await api('/api/provider/enabled', { body: { id, enabled } });
    toast(`${id} 已${enabled ? '启用' : '禁用'}`, 'ok');
    await loadState();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderProviders(providers) {
  const el = $('providerList');
  if (!providers.length) {
    el.innerHTML = '<div class="empty">暂无提供商</div>';
    return;
  }
  el.innerHTML = providers
    .map((p) => {
      const models = p.models.slice(0, 12).map((m) => `<span class="tag">${escapeHtml(m)}</span>`).join('');
      const more = p.models.length > 12 ? `<span class="tag">+${p.models.length - 12}</span>` : '';
      return `<div class="provider">
        <div class="p-head">
          <span class="p-id">${escapeHtml(p.id)}</span>
          <span class="tag ${p.disabled ? 'off' : 'on'}">${p.disabled ? '已禁用' : '启用中'}</span>
          <span class="p-name">${escapeHtml(p.name)}</span>
          <div class="actions">
            <button class="btn small" data-reload="${escapeAttr(p.id)}">重新拉取</button>
            <button class="btn small" data-toggle="${escapeAttr(p.id)}" data-enabled="${p.disabled}">${p.disabled ? '启用' : '禁用'}</button>
            <button class="btn small danger" data-delete="${escapeAttr(p.id)}">删除</button>
          </div>
        </div>
        <div class="p-meta">${escapeHtml(p.baseURL || '（无 baseURL）')} · ${p.models.length} 个模型 · ${p.hasApiKey ? '已配置 Key' : '无 Key'}</div>
        <div class="p-models">${models}${more}</div>
      </div>`;
    })
    .join('');
  el.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteProvider(b.getAttribute('data-delete'))));
  el.querySelectorAll('[data-reload]').forEach((b) => b.addEventListener('click', () => reloadProvider(b.getAttribute('data-reload'))));
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleEnabled(b.getAttribute('data-toggle'), b.getAttribute('data-enabled') === 'true')));
}

function renderBackups(data) {
  const el = $('backupList');
  if (!data.items.length) {
    el.innerHTML = '<div class="empty">暂无备份</div>';
  } else {
    el.innerHTML = data.items
      .map(
        (b) => `<div class="backup">
          <span class="b-file">${escapeHtml(b.file)}</span>
          <span class="b-size">${(b.size / 1024).toFixed(1)} KB</span>
          <span class="b-time">${new Date(b.time).toLocaleString()}</span>
          <button class="btn small" data-restore="${escapeAttr(b.file)}">恢复</button>
          <button class="btn small danger" data-delbk="${escapeAttr(b.file)}">删除</button>
        </div>`
      )
      .join('');
    el.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => restoreBackup(b.getAttribute('data-restore'))));
    el.querySelectorAll('[data-delbk]').forEach((b) => b.addEventListener('click', () => deleteBackup(b.getAttribute('data-delbk'))));
  }
  const pager = $('backupPager');
  pager.hidden = data.totalPages <= 1;
  $('pageInfo').textContent = `第 ${data.page} / ${data.totalPages} 页 · 共 ${data.total} 个备份`;
  $('prevPage').disabled = data.page <= 1;
  $('nextPage').disabled = data.page >= data.totalPages;
}

async function loadBackups(page) {
  try {
    const data = await api(`/api/backups?page=${page || 1}&pageSize=${pageSize}`);
    backupPage = data.page;
    renderBackups(data);
  } catch (e) {
    toast('加载备份失败: ' + e.message, 'err');
  }
}

async function backupNow() {
  const btn = $('backupNow');
  btn.disabled = true;
  try {
    const d = await api('/api/backup', { body: {} });
    toast('已生成备份: ' + d.file, 'ok');
    await loadBackups(1);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function deleteBackup(file) {
  if (!confirm(`确定删除备份「${file}」？`)) return;
  try {
    await api('/api/backup/delete', { body: { file } });
    toast('已删除备份', 'ok');
    await loadBackups(backupPage);
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function restoreBackup(file) {
  if (!confirm(`确定用备份「${file}」覆盖当前配置？` + (autoBackup ? '当前配置会先被备份。' : '当前未开启自动备份，将被直接覆盖。'))) return;
  try {
    await api('/api/restore', { body: { file } });
    toast('已恢复备份', 'ok');
    await loadState();
    await loadBackups(backupPage);
  } catch (e) {
    toast(e.message, 'err');
  }
}

function applySettings(s) {
  autoBackup = s.autoBackup !== false;
  pageSize = s.backupPageSize || 10;
  $('setAutoBackup').checked = autoBackup;
  $('setPageSize').value = pageSize;
  $('autoBackupHint').textContent = autoBackup ? '自动备份：已开启（写入配置前自动备份）' : '自动备份：已关闭（仅手动「立即备份」生成）';
}

async function saveSettings() {
  const btn = $('saveSettings');
  btn.disabled = true;
  try {
    const s = await api('/api/settings', { body: { autoBackup: $('setAutoBackup').checked, backupPageSize: Number($('setPageSize').value) || 10 } });
    applySettings(s);
    setStatus($('settingsStatus'), '已保存', 'ok');
    toast('设置已保存', 'ok');
    await loadBackups(1);
  } catch (e) {
    setStatus($('settingsStatus'), e.message, 'err');
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function loadState() {
  try {
    const data = await api('/api/state');
    $('configPath').textContent = data.configPath + (data.configExists ? '' : '（尚不存在，将创建）');
    $('infoConfig').textContent = data.configPath;
    $('infoBackup').textContent = data.backupDir;
    $('infoSettings').textContent = data.settingsFile || '-';
    if (data.settings) applySettings(data.settings);
    renderProviders(data.providers);
  } catch (e) {
    toast('加载配置失败: ' + e.message, 'err');
  }
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.getAttribute('data-tab'))));
$('fetchBtn').addEventListener('click', fetchModels);
$('testBtn').addEventListener('click', testConnectivity);
$('resetEditBtn').addEventListener('click', resetEdit);
$('addBtn').addEventListener('click', addProvider);
$('modelSearch').addEventListener('input', renderModels);
$('selectAll').addEventListener('click', () => {
  allModels.forEach((m) => selected.add(m));
  renderModels();
});
$('selectNone').addEventListener('click', () => {
  selected.clear();
  renderModels();
});
$('refreshProviders').addEventListener('click', loadState);
$('refreshBackups').addEventListener('click', () => loadBackups(backupPage));
$('backupNow').addEventListener('click', backupNow);
$('prevPage').addEventListener('click', () => loadBackups(backupPage - 1));
$('nextPage').addEventListener('click', () => loadBackups(backupPage + 1));
$('saveSettings').addEventListener('click', saveSettings);

loadState().then(() => loadBackups(1));
