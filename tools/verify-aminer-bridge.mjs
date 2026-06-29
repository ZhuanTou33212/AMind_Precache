const CDP_PORT = 9222;
const AMINER_URL = 'https://annot.aminer.cn/project/label_page_feed/181903?start=1781830800';

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.result?.value;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollImages() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const images = await getJson('http://127.0.0.1:9800/api/images').catch((error) => ({ error: error.message }));
    if (Array.isArray(images) && images.length) return images;
    await wait(2500);
  }
  return await getJson('http://127.0.0.1:9800/api/images').catch((error) => ({ error: error.message }));
}

const tabs = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const tab = tabs.find((item) => item.type === 'page' && item.url.includes('annot.aminer.cn'));
if (!tab) throw new Error('No annot.aminer.cn tab found on debug port');

const cdp = connect(tab.webSocketDebuggerUrl);
await cdp.opened;
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url: AMINER_URL });
await wait(15000);

const pageInfo = JSON.parse(await evaluate(
  cdp.send,
  `JSON.stringify({
    href: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 300),
    hasAccessToken: Boolean(localStorage.getItem('Access-Token')),
    imageSrcs: Array.from(document.querySelectorAll('img[src], source[srcset]')).map((node) => node.getAttribute('src') || node.getAttribute('srcset') || '').slice(0, 20)
  })`,
));

const contexts = cdp.contexts.map((context) => ({
  name: context.name,
  origin: context.origin,
  isDefault: Boolean(context.auxData?.isDefault),
  type: context.auxData?.type || '',
}));

const config = await getJson('http://127.0.0.1:9800/api/config').catch((error) => ({ error: error.message }));
const prompts = await fetch('http://127.0.0.1:9800/api/prompts?page=1')
  .then(async (response) => ({ ok: response.ok, status: response.status, body: await response.text() }))
  .catch((error) => ({ ok: false, error: error.message }));
const images = await pollImages();

const sanitizedConfig = config && typeof config === 'object'
  ? {
      hasToken: Boolean(config.token),
      tokenPrefix: config.token ? String(config.token).slice(0, 12) + '...' : '',
      taskId: config.taskId,
      startDate: config.startDate,
      cacheSize: config.cacheSize,
    }
  : config;

console.log(JSON.stringify({
  pageInfo,
  extensionContexts: contexts.filter((context) => /AMiner|Hotkeys|Cache|Monitor/i.test(`${context.name} ${context.origin}`)),
  config: sanitizedConfig,
  prompts: {
    ok: prompts.ok,
    status: prompts.status,
    bodyStart: String(prompts.body || prompts.error || '').slice(0, 300),
  },
  images: Array.isArray(images)
    ? {
        count: images.length,
        first: images[0],
        last: images[images.length - 1],
      }
    : images,
}, null, 2));

cdp.ws.close();
