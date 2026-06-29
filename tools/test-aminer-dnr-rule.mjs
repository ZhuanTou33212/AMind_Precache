const CDP_PORT = 9224;

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  function send(method, params = {}) {
    return new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  return { ws, opened, send };
}

async function evaluate(target, expression) {
  await target.opened;
  await target.send('Runtime.enable');
  const result = await target.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.result?.value;
}

const images = await getJson('http://127.0.0.1:9800/api/images');
const sampleUrl = images[0]?.url || 'https://mm-group-image.oss-cn-beijing.aliyuncs.com/example';
const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const workerTarget = targets.find((item) => item.type === 'service_worker' && item.url.includes('/background.js'));
if (!workerTarget) throw new Error('AMiner extension service worker not found');

const worker = connect(workerTarget.webSocketDebuggerUrl);
const expression = `JSON.stringify({
  manifest: chrome.runtime.getManifest(),
  hasTestMatchOutcome: Boolean(chrome.declarativeNetRequest.testMatchOutcome),
  enabledRulesets: chrome.declarativeNetRequest.getEnabledRulesets
    ? await chrome.declarativeNetRequest.getEnabledRulesets()
    : null,
  availableStaticRuleCount: chrome.declarativeNetRequest.getAvailableStaticRuleCount
    ? await chrome.declarativeNetRequest.getAvailableStaticRuleCount()
    : null,
  disabledStaticRuleIds: chrome.declarativeNetRequest.getDisabledRuleIds
    ? await chrome.declarativeNetRequest.getDisabledRuleIds({ rulesetId: 'oss_proxy_rules' }).catch((error) => ({ error: error.message }))
    : null,
  rules: await chrome.declarativeNetRequest.getDynamicRules(),
  match: chrome.declarativeNetRequest.testMatchOutcome
    ? await chrome.declarativeNetRequest.testMatchOutcome({
        url: ${JSON.stringify(sampleUrl)},
        type: 'image',
        tabId: -1
      }).catch((error) => ({ error: error.message }))
    : null
})`;

const result = JSON.parse(await evaluate(worker, `(async () => { return ${expression}; })()`));
worker.ws.close();

console.log(JSON.stringify({
  manifest: {
    name: result.manifest.name,
    version: result.manifest.version,
    permissions: result.manifest.permissions,
  host_permissions: result.manifest.host_permissions,
  },
  hasTestMatchOutcome: result.hasTestMatchOutcome,
  enabledRulesets: result.enabledRulesets,
  availableStaticRuleCount: result.availableStaticRuleCount,
  disabledStaticRuleIds: result.disabledStaticRuleIds,
  rules: result.rules,
  match: result.match,
}, null, 2));
