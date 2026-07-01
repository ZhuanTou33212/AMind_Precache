// Keep service worker alive, relay page events to the desktop app,
// and maintain a fixed image cache batch for the current annotation group.
// v1.15 -- completed slot web submit request
const SERVER = 'http://127.0.0.1:9800';
const DEFAULT_GROUP_SIZE = 200;
const MIN_GROUP_SIZE = 1;
const PAGE_SIZE = 20;

// When extension updates/reloads, auto-refresh annot tabs to re-inject content scripts
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: '*://*/project/label_page_feed/*' }, tabs => {
    tabs.forEach(t => { try { chrome.tabs.reload(t.id); } catch(e) {} });
  });
});

console.log('[AMiner cache background] v1.17 loaded, group size:', DEFAULT_GROUP_SIZE);

let activeGroupStart = 0;
let activeGroupEnd = 0;
let busy = false;
let queuedQuestion = 0;
let lastConfigKey = '';
let groupSize = DEFAULT_GROUP_SIZE;
let configLoaded = false;
let ossHost = 'mm-group-image.oss-cn-beijing.aliyuncs.com';

function post(path, data) {
  return fetch(SERVER + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  }).catch(() => {});
}

async function api(path, options) {
  const r = await fetch(SERVER + path, options || {});
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function normalizeGroupSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_GROUP_SIZE;
  return Math.max(MIN_GROUP_SIZE, Math.floor(size));
}

function storageGet(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function storageSet(items) { return new Promise(r => chrome.storage.local.set(items, r)); }

async function refreshConfig() {
  const config = await api('/api/config').catch(() => null);
  let nextGroupSize = DEFAULT_GROUP_SIZE;
  const settingsURL = chrome.runtime.getURL('settings.json');
  const settings = await fetch(settingsURL).then(r => r.json()).catch(() => null);
  if (settings && settings.cacheSize !== undefined) {
    nextGroupSize = normalizeGroupSize(settings.cacheSize);
  }
  const localSettings = await storageGet(['cacheSize']).catch(() => ({}));
  if (localSettings && localSettings.cacheSize !== undefined && (!config || config.cacheSize === undefined)) {
    nextGroupSize = normalizeGroupSize(localSettings.cacheSize);
  }
  if (config && config.cacheSize !== undefined) {
    nextGroupSize = normalizeGroupSize(config.cacheSize);
  }
  if (groupSize !== nextGroupSize) { groupSize = nextGroupSize; if (activeGroupStart > 0) activeGroupEnd = activeGroupStart + groupSize - 1; }
  if (config && config.ossHost) ossHost = config.ossHost;
  configLoaded = true;
  return config || {};
}

function questionPage(question) { return Math.max(1, Math.ceil(question / PAGE_SIZE)); }
function questionIndex(question) { return question - (questionPage(question) - 1) * PAGE_SIZE - 1; }

function imageURL(question) {
  const text = JSON.stringify(question);
  const escaped = ossHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('https://' + escaped + '/[^\\s"\'<>)]+', 'g');
  const m = text.match(pattern);
  return m && m[0] ? m[0].replace(/[)\].,;]+$/g, '') : '';
}

async function promptAt(question) {
  const data = await api('/api/prompts?page=' + questionPage(question));
  if (data.error) throw new Error(JSON.stringify(data.error));
  const p = (data.prompts || [])[questionIndex(question)];
  return p ? { prompt: p, questionNum: question } : null;
}

async function nextPendingPrompts(startQuestion) {
  const items = [];
  let page = Math.ceil(Math.max(1, startQuestion) / PAGE_SIZE);
  let startIdx = startQuestion - (page - 1) * PAGE_SIZE - 1;
  const endQuestion = startQuestion + groupSize - 1;
  while ((page - 1) * PAGE_SIZE + 1 <= endQuestion) {
    try {
      const data = await api('/api/prompts?page=' + page);
      const prompts = data.prompts || [];
      if (!prompts.length) break;
      const pageBase = (page - 1) * PAGE_SIZE;
      for (let i = startIdx; i < prompts.length; i++) {
        const qn = pageBase + i + 1;
        if (qn > endQuestion) break;
        if (prompts[i].state !== 1) items.push({ prompt: prompts[i], questionNum: qn });
      }
    } catch (e) { break; }
    page++;
    startIdx = 0;
  }
  return items;
}

async function cachePrompt(item) {
  const question = await api('/api/question?id=' + encodeURIComponent(item.prompt.prompt_id));
  const url = imageURL(question);
  if (!url) return false;
  await api('/api/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, promptId: item.prompt.prompt_id, questionNum: item.questionNum }) });
  return true;
}

async function clearCache() { await api('/api/images', { method: 'DELETE' }).catch(() => {}); activeGroupStart = 0; activeGroupEnd = 0; }
async function deleteCachedImage(record) { if (record && record.hash) await api('/api/images/' + encodeURIComponent(record.hash), { method: 'DELETE' }); }

async function rebuildGroup(startQuestion) {
  await clearCache();
  activeGroupStart = startQuestion;
  activeGroupEnd = startQuestion + groupSize - 1;
  const group = await nextPendingPrompts(startQuestion);
  for (const item of group) await cachePrompt(item).catch(() => false);
}

async function ensureGroup(question) {
  if (!question || question < 1) return;
  await refreshConfig();
  queuedQuestion = question;
  if (busy) return;
  busy = true;
  try {
    while (queuedQuestion) {
      const current = queuedQuestion;
      queuedQuestion = 0;
      const cached = (await api('/api/images').catch(() => [])) || [];
      const stale = cached.filter(x => { const q = Number(x.questionNum || 0); return !q || q < current; });
      for (const r of stale) await deleteCachedImage(r).catch(() => false);
      const kept = cached.filter(x => !stale.includes(x));
      if (activeGroupStart === 0 || current < activeGroupStart || current > activeGroupEnd || !kept.length) await rebuildGroup(current);
    }
  } finally { busy = false; }
}

chrome.runtime.onConnect.addListener(port => {
  refreshConfig();
  const ci = setInterval(() => refreshConfig(), 30000);
  port.postMessage({ type: 'cache-settings', cacheSize: groupSize, ossHost });
  const pi = setInterval(async () => {
    try { const images = await api('/api/images').catch(() => []); port.postMessage({ type: 'cache-list', images: images || [], cacheSize: groupSize, ossHost }); } catch (e) {}
  }, 1000);
  port.onMessage.addListener(async msg => {
    if (msg.type === 'cleanup') { clearCache(); return; }
    if (msg.type === 'platform-init') {
      // Always forward platformUrl — do NOT overwrite taskId/startDate
      if (msg.platformUrl) post('/api/config', { platformUrl: msg.platformUrl });
      return;
    }
    if (msg.type === 'get-labels-config') {
      const config = await api('/api/labels-config').catch(() => null);
      port.postMessage({ type: 'labels-config', config });
      return;
    }
    if (msg.type === 'image-labels') {
      await api('/api/image-labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(e => {
        port.postMessage({ type: 'quicklabel-error', message: e.message || String(e) });
      });
      return;
    }
    if (msg.type === 'image-label-status') {
      await api('/api/image-label-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(e => {
        port.postMessage({ type: 'quicklabel-error', message: e.message || String(e) });
      });
      return;
    }
    if (msg.type === 'cache-size') { groupSize = normalizeGroupSize(msg.cacheSize); storageSet({ cacheSize: groupSize }).catch(() => {}); port.postMessage({ type: 'cache-settings', cacheSize: groupSize }); return; }
    if (msg.type === 'config') {
      if (!configLoaded) await refreshConfig();
      const token = String(msg.token || '').trim(), taskId = String(msg.taskId || '').trim(), startDate = String(msg.startDate || '').trim(), platformUrl = String(msg.platformUrl || '').trim();
      if (!token) return;
      const key = token + '|' + platformUrl + '|' + taskId + '|' + startDate;
      if (key !== lastConfigKey) { lastConfigKey = key; post('/api/config', { token, taskId, startDate, cacheSize: groupSize, platformUrl }); }
      return;
    }
    post('/api/monitor', msg);
    if (msg.type === 'submission') { if (msg.question) ensureGroup(Number(msg.question) + 1); return; }
    if (msg.question) ensureGroup(Number(msg.question));
  });

  // Auto-start caching for label_page_customize (KB-SDK doesn't report question numbers)
  let autoCacheTimer = setTimeout(async () => {
    const imgs = await api('/api/images').catch(() => []);
    if ((!imgs || !imgs.length) && groupSize > 0) {
      console.log('[BG] Auto-start caching from Q1');
      try { ensureGroup(1); } catch(e) {}
    }
  }, 8000);

  port.onDisconnect.addListener(() => { clearInterval(ci); clearInterval(pi); clearTimeout(autoCacheTimer); });
});
