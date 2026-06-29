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
  const events = [];
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method?.startsWith('Network.')) {
      events.push(message);
    }
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
  return { ws, opened, send, events };
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
if (!Array.isArray(images) || !images.length) throw new Error('No cached images available');
const testImage = images[Math.min(10, images.length - 1)];
const before = await getJson('http://127.0.0.1:9801/');

const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const pageTarget = targets.find((item) => item.type === 'page' && item.url.includes('annot.aminer.cn'));
if (!pageTarget) throw new Error('AMiner page not found');

const page = connect(pageTarget.webSocketDebuggerUrl);
await page.opened;
await page.send('Network.enable');
await page.send('Network.setCacheDisabled', { cacheDisabled: true });
const resultJson = await evaluate(page, `new Promise((resolve) => {
  const img = new Image();
  const started = performance.now();
  img.onload = () => resolve(JSON.stringify({ ok: true, width: img.naturalWidth, height: img.naturalHeight, elapsed: Math.round(performance.now() - started) }));
  img.onerror = () => resolve(JSON.stringify({ ok: false, elapsed: Math.round(performance.now() - started) }));
  img.src = ${JSON.stringify(testImage.url)};
})`);
await page.send('Network.setCacheDisabled', { cacheDisabled: false });
page.ws.close();

await new Promise((resolve) => setTimeout(resolve, 500));
const after = await getJson('http://127.0.0.1:9801/');
const interestingEvents = page.events
  .filter((event) => {
    const text = JSON.stringify(event.params || {});
    return /oss-cn-beijing|127\.0\.0\.1:9801/.test(text);
  })
  .map((event) => ({
    method: event.method,
    url: event.params?.request?.url || event.params?.response?.url || event.params?.documentURL || '',
    type: event.params?.type || '',
    status: event.params?.response?.status,
    fromDiskCache: event.params?.response?.fromDiskCache,
    fromPrefetchCache: event.params?.response?.fromPrefetchCache,
  }));

console.log(JSON.stringify({
  imageLoad: JSON.parse(resultJson),
  proxyBefore: before,
  proxyAfter: after,
  delta: {
    total: after.total - before.total,
    hit: after.hit - before.hit,
    miss: after.miss - before.miss,
    error: after.error - before.error,
  },
  networkEvents: interestingEvents,
  testedQuestionNum: testImage.questionNum,
  testedFileSize: testImage.fileSize,
}, null, 2));
