const CDP_PORT = 9224;
const question = Number(process.argv[2] || 0);
if (!question) throw new Error('Usage: node tools/simulate-aminer-question.mjs <question>');

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
const pageTarget = targets.find((item) => item.type === 'page' && item.url.includes('annot.aminer.cn'));
if (!pageTarget) throw new Error('AMiner page not found');

const page = connect(pageTarget.webSocketDebuggerUrl);
await page.opened;
await page.send('Runtime.enable');
await page.send('Runtime.evaluate', {
  expression: `window.dispatchEvent(new CustomEvent('aminer-monitor:event', { detail: { question: ${question}, total: 0 } }))`,
  returnByValue: true,
});
page.ws.close();
console.log(JSON.stringify({ sent: question }));
