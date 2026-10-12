const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 3456);
const HOST = process.env.HOST || '127.0.0.1';
const OPENCODE_DIR = path.join(os.homedir(), '.config', 'opencode');
const BACKUP_DIR = path.join(OPENCODE_DIR, 'backups');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const DEFAULT_NPM = '@ai-sdk/openai-compatible';
const DEFAULT_SETTINGS = { autoBackup: true, backupPageSize: 10 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function removeTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

function parseJsonc(raw) {
  return JSON.parse(removeTrailingCommas(stripJsonComments(raw)));
}

function resolveConfigPath() {
  const jsonc = path.join(OPENCODE_DIR, 'opencode.jsonc');
  const json = path.join(OPENCODE_DIR, 'opencode.json');
  if (fs.existsSync(jsonc)) return jsonc;
  if (fs.existsSync(json)) return json;
  return jsonc;
}

function readConfig() {
  const p = resolveConfigPath();
  if (!fs.existsSync(p)) return { config: {}, path: p, exists: false };
  const raw = fs.readFileSync(p, 'utf8');
  let config;
  try {
    config = parseJsonc(raw);
  } catch (e) {
    throw httpError(500, '配置文件解析失败: ' + e.message);
  }
  if (!config || typeof config !== 'object') config = {};
  return { config, path: p, exists: true };
}

function writeConfig(p, config) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = JSON.stringify(config, null, 2) + '\n';
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
}

function backupConfig(p) {
  if (!fs.existsSync(p)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = path.basename(p) + '.' + stamp + '.bak';
  fs.copyFileSync(p, path.join(BACKUP_DIR, name));
  return name;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.bak'))
    .map((f) => {
      const full = path.join(BACKUP_DIR, f);
      const st = fs.statSync(full);
      return { file: f, size: st.size, time: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.time < b.time ? 1 : -1));
}

function listBackupsPaged(query) {
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize'), 10) || readSettings().backupPageSize));
  const all = listBackups();
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, parseInt(query.get('page'), 10) || 1), totalPages);
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total, page, pageSize, totalPages };
}

function readSettings() {
  let s = {};
  try {
    if (fs.existsSync(SETTINGS_FILE)) s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    s = {};
  }
  if (!s || typeof s !== 'object') s = {};
  const merged = Object.assign({}, DEFAULT_SETTINGS, s);
  merged.autoBackup = merged.autoBackup !== false;
  merged.backupPageSize = Math.min(100, Math.max(1, parseInt(merged.backupPageSize, 10) || DEFAULT_SETTINGS.backupPageSize));
  return merged;
}

function writeSettings(body) {
  const cur = readSettings();
  const next = Object.assign({}, cur);
  if (body && typeof body === 'object') {
    if ('autoBackup' in body) next.autoBackup = body.autoBackup !== false;
    if ('backupPageSize' in body) next.backupPageSize = Math.min(100, Math.max(1, parseInt(body.backupPageSize, 10) || cur.backupPageSize));
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function maybeAutoBackup(p) {
  if (!readSettings().autoBackup) return null;
  return backupConfig(p);
}

function manualBackup() {
  const p = resolveConfigPath();
  if (!fs.existsSync(p)) throw httpError(400, '配置文件尚不存在，无法备份');
  const file = backupConfig(p);
  return { file };
}

function deleteBackup(body) {
  const safe = path.basename(String(body.file || '').trim());
  if (!safe) throw httpError(400, '缺少备份文件名');
  const full = path.join(BACKUP_DIR, safe);
  if (!full.startsWith(BACKUP_DIR) || !fs.existsSync(full)) throw httpError(404, '备份不存在: ' + safe);
  fs.unlinkSync(full);
  return { deleted: safe };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(httpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(httpError(400, '请求体不是有效 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function extractModels(json) {
  let arr = null;
  if (Array.isArray(json)) arr = json;
  else if (json && Array.isArray(json.data)) arr = json.data;
  else if (json && json.data && Array.isArray(json.data.models)) arr = json.data.models;
  else if (json && Array.isArray(json.models)) arr = json.models;
  if (!arr) return [];
  const ids = [];
  for (const item of arr) {
    let id = null;
    if (typeof item === 'string') id = item;
    else if (item && typeof item === 'object') id = item.id || item.model || item.name;
    if (id) ids.push(String(id).trim());
  }
  return Array.from(new Set(ids.filter(Boolean)));
}

function buildCandidateUrls(baseURL) {
  const base = String(baseURL).trim().replace(/\/+$/, '');
  const list = [];
  if (/\/models$/i.test(base)) {
    list.push(base);
  } else {
    list.push(base + '/models');
    if (!/\/v\d+$/i.test(base) && !/\/v1$/i.test(base)) list.push(base + '/v1/models');
  }
  return Array.from(new Set(list));
}

function buildAuthHeaders(body, withContentType) {
  const headers = { Accept: 'application/json' };
  if (withContentType) headers['Content-Type'] = 'application/json';
  if (body.headerName && body.headerValue) headers[body.headerName] = body.headerValue;
  else if (body.apiKey) headers['Authorization'] = 'Bearer ' + body.apiKey;
  if (body.extraHeaders && typeof body.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(body.extraHeaders)) {
      if (k && v != null) headers[k] = String(v);
    }
  }
  return headers;
}

function chatCompletionsUrl(baseURL) {
  let base = String(baseURL).trim().replace(/\/+$/, '').replace(/\/models$/i, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  return base + '/chat/completions';
}

async function testConnection(body) {
  if (!body.baseURL || !String(body.baseURL).trim()) throw httpError(400, '缺少 API 地址');
  const headers = buildAuthHeaders(body, false);
  const candidates = buildCandidateUrls(body.baseURL);
  const result = {
    baseURL: String(body.baseURL).trim().replace(/\/+$/, ''),
    reachable: false,
    authOk: false,
    latencyMs: null,
    modelCount: 0,
    url: null,
    status: null,
    message: '',
    keyChecked: false,
    keyValid: null
  };
  let lastErr = null;
  for (const url of candidates) {
    const started = Date.now();
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      result.url = url;
      result.status = res.status;
      result.latencyMs = Date.now() - started;
      result.reachable = true;
      if (res.status === 401 || res.status === 403) {
        result.message = '端点可访问，但认证失败（HTTP ' + res.status + '），请检查 API Key 或认证头';
        break;
      }
      if (res.ok) {
        result.authOk = true;
        try {
          result.modelCount = extractModels(JSON.parse(text)).length;
        } catch {}
        result.message = '连接成功，认证通过' + (result.modelCount ? '，发现 ' + result.modelCount + ' 个模型' : '');
        break;
      }
      lastErr = new Error('HTTP ' + res.status + ' ' + res.statusText);
    } catch (e) {
      lastErr = e;
      result.latencyMs = Date.now() - started;
    }
  }

  if (!result.reachable) {
    result.message = '无法连接: ' + (lastErr ? lastErr.message : '未知错误');
    result.ok = false;
    return result;
  }
  if (!result.authOk) {
    if (result.status && ![401, 403].includes(result.status)) {
      result.message = '端点有响应（HTTP ' + result.status + '），但地址可能不正确';
    }
    result.ok = false;
    return result;
  }

  const model = body.model && String(body.model).trim();
  if (model) {
    result.keyChecked = true;
    const started = Date.now();
    try {
      const res = await fetch(chatCompletionsUrl(body.baseURL), {
        method: 'POST',
        headers: buildAuthHeaders(body, true),
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
        signal: AbortSignal.timeout(30000)
      });
      const latency = Date.now() - started;
      await res.text();
      result.chatLatencyMs = latency;
      if (res.status === 401 || res.status === 403) {
        result.keyValid = false;
        result.message = '认证通过但对话校验失败（HTTP ' + res.status + '），Key 可能无效或无权访问模型 ' + model;
      } else if (res.ok) {
        result.keyValid = true;
        result.message = '连接与 Key 校验均通过（模型 ' + model + '，' + latency + 'ms）';
      } else {
        result.keyValid = null;
        result.message = 'Key 可用，但对话校验返回 HTTP ' + res.status + '（模型 ' + model + ' 可能不支持或参数受限）';
      }
      result.chatStatus = res.status;
    } catch (e) {
      result.keyValid = null;
      result.message = 'Key 可用，但对话校验请求失败: ' + e.message;
    }
  }

  result.ok = result.authOk && result.keyValid !== false;
  return result;
}

async function fetchModels(body) {
  const { baseURL } = body;
  if (!baseURL || !String(baseURL).trim()) throw httpError(400, '缺少 API 地址');
  const headers = buildAuthHeaders(body, false);
  const candidates = buildCandidateUrls(baseURL);
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
      const text = await res.text();
      if (!res.ok) {
        lastErr = new Error('HTTP ' + res.status + ' ' + res.statusText + ' @ ' + url);
        continue;
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        lastErr = new Error('返回内容不是有效 JSON @ ' + url);
        continue;
      }
      const models = extractModels(json);
      if (models.length) return { url, models };
      lastErr = new Error('返回中未找到模型列表 @ ' + url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw httpError(502, '拉取模型失败: ' + (lastErr ? lastErr.message : '未知错误'));
}

function normalizedHeaders(headers) {
  const out = {};
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (k && v != null && String(v).trim()) out[k] = String(v);
    }
  }
  return Object.keys(out).length ? out : null;
}

function addProvider(body) {
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, '缺少提供商 ID');
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw httpError(400, '提供商 ID 只能包含字母、数字、点、下划线和短横线');
  if (!body.baseURL || !String(body.baseURL).trim()) throw httpError(400, '缺少 API 地址');
  const models = Array.isArray(body.models) ? body.models : [];
  if (!models.length) throw httpError(400, '至少选择一个模型');

  const { config, path: configPath } = readConfig();
  if (!config.provider || typeof config.provider !== 'object') config.provider = {};

  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  const existing = config.provider[id];

  const modelMap = {};
  if (mode === 'merge' && existing && existing.models && typeof existing.models === 'object') {
    for (const [k, v] of Object.entries(existing.models)) modelMap[k] = v;
  }
  for (const m of models) {
    const mid = String(m.id || '').trim();
    if (!mid) continue;
    const mname = m.name && String(m.name).trim() ? String(m.name).trim() : mid;
    modelMap[mid] = { name: mname };
  }

  const options = { baseURL: String(body.baseURL).trim().replace(/\/+$/, '') };
  if (body.apiKey && String(body.apiKey).trim()) options.apiKey = String(body.apiKey).trim();
  const hdrs = normalizedHeaders(body.headers);
  if (hdrs) options.headers = hdrs;

  const provider = {
    name: body.name && String(body.name).trim() ? String(body.name).trim() : id,
    npm: body.npm && String(body.npm).trim() ? String(body.npm).trim() : DEFAULT_NPM,
    options,
    models: modelMap
  };

  config.provider[id] = provider;

  if (body.enable !== false && Array.isArray(config.disabled_providers)) {
    config.disabled_providers = config.disabled_providers.filter((x) => x !== id);
  }

  const backup = maybeAutoBackup(configPath);
  writeConfig(configPath, config);
  return {
    id,
    created: !existing,
    mode,
    modelCount: Object.keys(modelMap).length,
    addedCount: models.length,
    backup
  };
}

function getProviderDetail(body) {
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, '缺少提供商 ID');
  const { config } = readConfig();
  const p = config.provider && config.provider[id];
  if (!p) throw httpError(404, '提供商不存在: ' + id);
  const disabled = new Set(Array.isArray(config.disabled_providers) ? config.disabled_providers : []);
  return {
    id,
    name: p.name || id,
    npm: p.npm || DEFAULT_NPM,
    baseURL: (p.options && p.options.baseURL) || '',
    apiKey: (p.options && p.options.apiKey) || '',
    headers: (p.options && p.options.headers) || {},
    models: p.models && typeof p.models === 'object' ? Object.keys(p.models) : [],
    disabled: disabled.has(id)
  };
}

function deleteProvider(body) {
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, '缺少提供商 ID');
  const { config, path: configPath } = readConfig();
  if (!config.provider || !config.provider[id]) throw httpError(404, '提供商不存在: ' + id);
  delete config.provider[id];
  const backup = maybeAutoBackup(configPath);
  writeConfig(configPath, config);
  return { id, backup };
}

function setEnabled(body) {
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, '缺少提供商 ID');
  const enabled = body.enabled !== false;
  const { config, path: configPath } = readConfig();
  if (!Array.isArray(config.disabled_providers)) config.disabled_providers = [];
  const set = new Set(config.disabled_providers);
  if (enabled) set.delete(id);
  else set.add(id);
  config.disabled_providers = Array.from(set);
  const backup = maybeAutoBackup(configPath);
  writeConfig(configPath, config);
  return { id, enabled, backup };
}

function restoreBackup(body) {
  const file = String(body.file || '').trim();
  if (!file) throw httpError(400, '缺少备份文件名');
  const safe = path.basename(file);
  const src = path.join(BACKUP_DIR, safe);
  if (!src.startsWith(BACKUP_DIR) || !fs.existsSync(src)) throw httpError(404, '备份不存在: ' + safe);
  const p = resolveConfigPath();
  const backup = maybeAutoBackup(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.copyFileSync(src, p);
  return { restored: safe, backup };
}

function state() {
  const { config, path: configPath, exists } = readConfig();
  const providers = [];
  const providerMap = config.provider && typeof config.provider === 'object' ? config.provider : {};
  const disabled = new Set(Array.isArray(config.disabled_providers) ? config.disabled_providers : []);
  for (const [id, p] of Object.entries(providerMap)) {
    providers.push({
      id,
      name: (p && p.name) || id,
      npm: (p && p.npm) || DEFAULT_NPM,
      baseURL: p && p.options ? p.options.baseURL : '',
      hasApiKey: !!(p && p.options && p.options.apiKey),
      headers: p && p.options && p.options.headers ? Object.keys(p.options.headers) : [],
      models: p && p.models && typeof p.models === 'object' ? Object.keys(p.models) : [],
      disabled: disabled.has(id)
    });
  }
  providers.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    configPath,
    configExists: exists,
    backupDir: BACKUP_DIR,
    settingsFile: SETTINGS_FILE,
    providers,
    settings: readSettings()
  };
}

const ROUTES = {
  'GET /api/state': async () => state(),
  'GET /api/settings': async () => readSettings(),
  'POST /api/settings': async (req) => writeSettings(await readBody(req)),
  'GET /api/backups': async (req, url) => listBackupsPaged(url.searchParams),
  'POST /api/backup': async () => manualBackup(),
  'POST /api/backup/delete': async (req) => deleteBackup(await readBody(req)),
  'POST /api/models': async (req) => fetchModels(await readBody(req)),
  'POST /api/test': async (req) => testConnection(await readBody(req)),
  'POST /api/provider': async (req) => addProvider(await readBody(req)),
  'POST /api/provider/detail': async (req) => getProviderDetail(await readBody(req)),
  'POST /api/provider/delete': async (req) => deleteProvider(await readBody(req)),
  'POST /api/provider/enabled': async (req) => setEnabled(await readBody(req)),
  'POST /api/restore': async (req) => restoreBackup(await readBody(req))
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const key = req.method + ' ' + url.pathname;
  try {
    if (ROUTES[key]) {
      const result = await ROUTES[key](req, url);
      sendJson(res, 200, { ok: true, data: result });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: '未知接口: ' + key });
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    sendJson(res, status, { ok: false, error: (e && e.message) || '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  const url = 'http://' + HOST + ':' + PORT;
  console.log('');
  console.log('  opencode 提供商添加工具已启动');
  console.log('  打开浏览器访问:  ' + url);
  console.log('  配置文件:        ' + resolveConfigPath());
  console.log('  备份目录:        ' + BACKUP_DIR);
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});
