const CDP_PORT = 9222;
const AMINER_URL = 'https://annot.aminer.cn/project/label_page_feed/181903?start=1781830800';

async function getAminerTab() {
  const tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const tab = tabs.find((item) => item.type === 'page' && item.url.includes('annot.aminer.cn'));
  if (!tab) throw new Error('No annot.aminer.cn tab found');
  return tab;
}

function connect(wsURL) {
  const ws = new WebSocket(wsURL);
  let id = 0;
  const pending = new Map();
  const contexts = [];

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === 'Runtime.executionContextCreated') {
      contexts.push(message.params.context);
    }
  };

  const opened = new Promise((resolve) => {
    ws.onopen = resolve;
  });

  function send(method, params = {}) {
    return new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  return { ws, opened, send, contexts };
}

async function evaluate(send, contextId, expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression,
    contextId,
    awaitPromise,
    returnByValue: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.result?.value;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const tab = await getAminerTab();
const cdp = connect(tab.webSocketDebuggerUrl);
await cdp.opened;

await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url: AMINER_URL });
await wait(10000);

const mainInfo = await evaluate(
  cdp.send,
  undefined,
  `JSON.stringify({
    href: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 500),
    images: Array.from(document.images).map((img) => ({
      src: img.currentSrc || img.src || '',
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0
    })).slice(0, 20)
  })`,
);

const contextSummaries = cdp.contexts.map((context) => ({
  id: context.id,
  name: context.name,
  origin: context.origin,
  aux: context.auxData && {
    isDefault: context.auxData.isDefault,
    type: context.auxData.type,
    frameId: context.auxData.frameId,
  },
}));

const cacheContexts = cdp.contexts.filter((context) => {
  if (context.auxData?.isDefault) return false;
  return context.name === 'AMiner Local Cache';
});
const cacheContext = cacheContexts[cacheContexts.length - 1];

let cacheReport = null;
let prefetchResult = null;
let cacheReportAfter = null;
let cacheDiagnostics = null;

if (cacheContext) {
  cacheDiagnostics = await evaluate(
    cdp.send,
    cacheContext.id,
    `JSON.stringify({
      type: typeof AMinerLocalCache,
      keys: typeof AMinerLocalCache === 'object' ? Object.keys(AMinerLocalCache) : []
    })`,
  );

  cacheReport = await evaluate(
    cdp.send,
    cacheContext.id,
    `typeof AMinerLocalCache === 'object' ? String(AMinerLocalCache.report()) : 'NO_AMINER_LOCAL_CACHE'`,
  );

  prefetchResult = await evaluate(
    cdp.send,
    cacheContext.id,
    `typeof AMinerLocalCache === 'object'
      ? AMinerLocalCache.prefetchCurrentPage().then(() => String(AMinerLocalCache.report()))
      : Promise.resolve('NO_AMINER_LOCAL_CACHE')`,
    true,
  );

  cacheReportAfter = await evaluate(
    cdp.send,
    cacheContext.id,
    `typeof AMinerLocalCache === 'object' ? String(AMinerLocalCache.report()) : 'NO_AMINER_LOCAL_CACHE'`,
  );
}

console.log(JSON.stringify({
  mainInfo: JSON.parse(mainInfo),
  contexts: contextSummaries,
  selectedCacheContext: cacheContext && {
    id: cacheContext.id,
    name: cacheContext.name,
    origin: cacheContext.origin,
  },
  cacheDiagnostics: cacheDiagnostics ? JSON.parse(cacheDiagnostics) : null,
  cacheReport,
  prefetchResult,
  cacheReportAfter,
}, null, 2));

cdp.ws.close();
