const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const worker = targets.find((target) =>
  target.type === 'service_worker' &&
  target.url.includes('hefggjfakpmmmbjghkjkjedhingicknd/background.js')
);

if (!worker) throw new Error('AMiner Realtime Monitor Bridge service worker not found');

const ws = new WebSocket(worker.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};

await new Promise((resolve) => {
  ws.onopen = resolve;
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable');

const result = await send('Runtime.evaluate', {
  expression: `Promise.resolve(typeof refreshConfig === 'function' ? refreshConfig() : null).then(() => Promise.all([
    fetch(chrome.runtime.getURL('settings.json')).then((r) => r.text()).catch((e) => 'ERR:' + e.message),
    Promise.resolve(typeof groupSize !== 'undefined' ? groupSize : 'NO_GROUP_SIZE'),
    Promise.resolve(typeof DEFAULT_GROUP_SIZE !== 'undefined' ? DEFAULT_GROUP_SIZE : 'NO_DEFAULT_GROUP_SIZE'),
    Promise.resolve(typeof refreshConfig),
    Promise.resolve(typeof refreshConfig === 'function' ? refreshConfig.toString().slice(0, 500) : '')
  ])).then(([settingsText, groupSizeValue, defaultGroupSize, refreshConfigType, refreshConfigSource]) => JSON.stringify({
    settingsText,
    groupSizeValue,
    defaultGroupSize,
    refreshConfigType,
    refreshConfigSource
  }))`,
  awaitPromise: true,
  returnByValue: true,
});

console.log(result.result.result.value);
ws.close();
