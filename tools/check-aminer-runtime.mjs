const CDP_PORT = 9224;
const PROXY_URL = 'http://127.0.0.1:9801/';
const CACHE_URL = 'http://127.0.0.1:9800/api/images';

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

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
const pageTarget = targets.find((item) => item.type === 'page' && item.url.includes('annot.aminer.cn'));
const workerTarget = targets.find((item) => item.type === 'service_worker' && item.url.includes('/background.js'));

const summary = {
  cdp: {
    port: CDP_PORT,
    pageFound: Boolean(pageTarget),
    workerFound: Boolean(workerTarget),
    targets: targets.map((item) => ({ type: item.type, title: item.title, url: item.url })),
  },
};

if (pageTarget) {
  const page = connect(pageTarget.webSocketDebuggerUrl);
  summary.page = JSON.parse(await evaluate(page, `JSON.stringify({
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    imageCount: document.images.length,
    ossImages: Array.from(document.images).map((img) => img.currentSrc || img.src || '').filter((url) => url.includes('mm-group-image.oss-cn-beijing.aliyuncs.com')).slice(0, 10),
    proxyImages: Array.from(document.images).map((img) => img.currentSrc || img.src || '').filter((url) => url.includes('127.0.0.1:9801')).slice(0, 10),
    resourceCounts: performance.getEntriesByType('resource').reduce((acc, entry) => {
      const name = entry.name || '';
      if (name.includes('mm-group-image.oss-cn-beijing.aliyuncs.com')) acc.oss += 1;
      if (name.includes('127.0.0.1:9801')) acc.proxy += 1;
      if (name.includes('127.0.0.1:9800')) acc.cacheApi += 1;
      return acc;
    }, { oss: 0, proxy: 0, cacheApi: 0 }),
    recentImageResources: performance.getEntriesByType('resource')
      .filter((entry) => /oss-cn-beijing|127\\.0\\.0\\.1:9801|127\\.0\\.0\\.1:9800/.test(entry.name || ''))
      .slice(-15)
      .map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType, duration: Math.round(entry.duration) }))
  })`));
  summary.page.recentImageResources = summary.page.recentImageResources.map((entry) => ({
    ...entry,
    name: redactUrl(entry.name),
  }));
  summary.page.ossImages = summary.page.ossImages.map(redactUrl);
  summary.page.proxyImages = summary.page.proxyImages.map(redactUrl);
  page.ws.close();
}

if (workerTarget) {
  const worker = connect(workerTarget.webSocketDebuggerUrl);
  const rulesJson = await evaluate(worker, 'chrome.declarativeNetRequest.getDynamicRules().then((rules) => JSON.stringify(rules))');
  summary.worker = {
    url: workerTarget.url,
    dynamicRules: JSON.parse(rulesJson),
  };
  worker.ws.close();
}

summary.proxy = await getJson(PROXY_URL).catch((error) => ({ error: error.message }));
summary.cache = await getJson(CACHE_URL)
  .then((images) => ({
    count: Array.isArray(images) ? images.length : null,
    first: Array.isArray(images) && images.length ? {
      questionNum: images[0].questionNum,
      fileSize: images[0].fileSize,
      urlHost: new URL(images[0].url).host,
    } : null,
  }))
  .catch((error) => ({ error: error.message }));

console.log(JSON.stringify(summary, null, 2));
