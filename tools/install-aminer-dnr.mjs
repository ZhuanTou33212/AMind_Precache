const CDP_PORT = 9224;
const PROXY = 'http://127.0.0.1:9801';

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

const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const workerTarget = targets.find((item) => item.type === 'service_worker' && item.url.includes('/background.js'));
if (!workerTarget) throw new Error('AMiner extension service worker not found');

const worker = connect(workerTarget.webSocketDebuggerUrl);
const expression = `(() => {
  const rule = {
    id: 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: '${PROXY}/proxy?url=\\\\1' }
    },
    condition: {
      regexFilter: '^(https://mm-group-image\\\\.oss-cn-beijing\\\\.aliyuncs\\\\.com/.*)',
      resourceTypes: ['image']
    }
  };
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [rule]
  }).then(() => chrome.declarativeNetRequest.getDynamicRules())
    .then((rules) => JSON.stringify(rules));
})()`;

const rules = JSON.parse(await evaluate(worker, expression));
worker.ws.close();
console.log(JSON.stringify({ installed: true, rules }, null, 2));
