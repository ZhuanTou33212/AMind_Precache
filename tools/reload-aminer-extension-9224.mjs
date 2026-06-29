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

const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const worker = targets.find((target) =>
  target.type === 'service_worker' &&
  target.url.includes('/background.js')
);

if (!worker) throw new Error('AMiner extension service worker not found');

const cdp = connect(worker.webSocketDebuggerUrl);
await cdp.opened;
await cdp.send('Runtime.enable');
await cdp.send('Runtime.evaluate', {
  expression: 'chrome.runtime.reload()',
  returnByValue: true,
});
cdp.ws.close();

console.log('reload requested');
