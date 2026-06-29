const expression = process.argv.slice(2).join(' ');
if (!expression) throw new Error('Usage: node tools/run-aminer-worker-expression.mjs <expression>');

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

const targets = await getJson('http://127.0.0.1:9224/json/list');
const workerTarget = targets.find((item) => item.type === 'service_worker' && item.url.includes('/background.js'));
if (!workerTarget) throw new Error('AMiner extension service worker not found');

const worker = connect(workerTarget.webSocketDebuggerUrl);
await worker.opened;
await worker.send('Runtime.enable');
const result = await worker.send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
});
worker.ws.close();
console.log(JSON.stringify(result.result?.result?.value ?? result.result, null, 2));
