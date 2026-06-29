const CDP = 'http://127.0.0.1:9224';

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

let currentPage = null;
let ws = null;
let msgId = 0;

function connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  msgId = 0;

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Console.messageAdded') {
      const entry = msg.params?.message || msg.params;
      const text = entry?.text || '';
      if (!text) {
        const args = entry?.args || [];
        for (const arg of args) {
          if (arg.type === 'string' && arg.value) {
            if (arg.value.includes('[TRACE') || arg.value.includes('[quicklabel') || arg.value.includes('scan')) {
              console.log('  ' + arg.value);
            }
          }
        }
        return;
      }
      if (text.includes('[TRACE') || text.includes('[quicklabel') || text.includes('scan')) {
        console.log('  ' + text);
      }
    }
    if (msg.result && msg.id) {
      const val = msg.result?.result?.value;
      if (val) console.log('  >> ' + String(val).slice(0, 200));
    }
  };

  ws.onopen = () => {
    ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({ id: ++msgId, method: 'Console.enable' }));
    // Try running traceReport
    setTimeout(() => {
      try {
        ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.evaluate', params: {
          expression: "window.__aminerQuickLabel && window.__aminerQuickLabel.traceReport ? '[quicklabel] traceReport 可用' : '[quicklabel] 未加载'",
          returnByValue: true
        }}));
      } catch(e) {}
    }, 3000);
  };

  ws.onclose = () => { console.log('\nPage disconnected, re-polling...'); ws = null; setTimeout(pollTargets, 1000); };
  ws.onerror = () => { ws = null; setTimeout(pollTargets, 1000); };
}

async function pollTargets() {
  try {
    const targets = await getJson(CDP + '/json/list');
    const pages = targets.filter(t => t.type === 'page' && (t.url || '').includes('annot.aminer.cn'));
    if (pages.length) {
      const page = pages[0];
      if (!currentPage || currentPage.id !== page.id) {
        if (ws) { try { ws.close(); } catch(e) {} }
        currentPage = page;
        console.log('\nConnected: ' + page.title + '\nURL: ' + (page.url || '').slice(0, 120));
        connect(page.webSocketDebuggerUrl);
      }
    } else {
      console.log('Waiting for annot.aminer.cn page...');
    }
  } catch(e) {
    console.error('Poll error:', e.message);
  }
}

console.log('Monitor started. Waiting for AMiner page activity...');
setInterval(pollTargets, 3000);
pollTargets();

setTimeout(() => { console.log('\nMonitor timeout'); process.exit(0); }, 300000);
