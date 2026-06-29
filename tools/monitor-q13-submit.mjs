const CDP = 'http://127.0.0.1:9224';
const EXE = 'http://127.0.0.1:9800';

async function getJson(url) { const r = await fetch(url); return r.json(); }

// Poll cache for Q13 changes
let lastQ13 = null;

async function checkQ13() {
  try {
    const images = await getJson(EXE + '/api/images');
    const q13 = (images || []).find(img => Number(img.questionNum) === 13);
    if (!q13) { if (lastQ13 !== null) console.log('\n>>> Q13 EVICTED from cache!'); lastQ13 = null; return; }
    
    const label = q13.labelText || '(empty)';
    const status = q13.labelStatus;
    const labels = JSON.stringify(q13.labels);
    
    if (!lastQ13 || lastQ13.labelText !== label || lastQ13.labelStatus !== status) {
      console.log('');
      console.log('>>> Q13 LABEL CHANGE <<<');
      console.log('    labelText: "' + label + '"');
      console.log('    status:    ' + status);
      console.log('    labels:    ' + labels);
      console.log('    submittedAt: ' + q13.submittedAt);
      console.log('');
      
      if (status === 'submit_requested') {
        console.log('!!! SUBMIT REQUESTED - watching for DOM interactions !!!');
      }
      if (status === 'cloud_submitted') {
        console.log('!!! CLOUD SUBMITTED SUCCESS !!!');
      }
      if (status === 'submit_failed') {
        console.log('XXX SUBMIT FAILED: ' + (q13.labelMessage || ''));
      }
    }
    lastQ13 = { labelText: label, labelStatus: status };
  } catch(e) {}
}

// Monitor DOM via CDP
async function setupCDP() {
  try {
    const targets = await getJson(CDP + '/json/list');
    const page = targets.find(t => t.type === 'page' && (t.url || '').includes('label_page_feed'));
    if (!page) { console.log('No label page for CDP monitor'); return; }

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params?.args || []).map(a => {
          if (a.type === 'object' && a.preview) return a.preview.description || '[obj]';
          return a.value || a.description || '';
        }).join(' ');
        if (args.includes('[TRACE') || args.includes('[quicklabel') || args.includes('scanOptions') || args.includes('clickOptionFor') || args.includes('applyLabelsToPage') || args.includes('handleSubmit')) {
          console.log('  CDP:', args);
        }
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Console.enable' }));
    };

    ws.onerror = () => {};
    ws.onclose = () => { console.log('CDP disconnected, retrying...'); setTimeout(setupCDP, 3000); };
  } catch(e) { setTimeout(setupCDP, 3000); }
}

console.log('=== Q13 MONITOR STARTED ===');
console.log('Watching for:');
console.log('  1) Label changes to Q13 (labelText/labelStatus)');
console.log('  2) DOM scanOptions/clickOptionFor/applyLabelsToPage');
console.log('');

setupCDP();
// Poll every 2 seconds
checkQ13();
setInterval(checkQ13, 2000);
