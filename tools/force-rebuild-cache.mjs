const CDP = 'http://127.0.0.1:9224';

fetch(CDP + '/json/list').then(r => r.json()).then(async targets => {
  const sw = targets.find(t => t.type === 'service_worker' && (t.url || '').includes('hefggjfakpmmmbjghkjkjedhingicknd'));
  if (!sw) { console.log('SW not found'); process.exit(1); }

  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  let id = 0;
  const pend = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m.result); delete pend[m.id]; } };

  ws.onopen = async () => {
    function evalExp(exp) {
      return new Promise(r => {
        const mid = ++id;
        pend[mid] = r;
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: exp, returnByValue: true } }));
      });
    }

    const r1 = await evalExp('activeGroupStart + "|" + activeGroupEnd + "|" + groupSize + "|" + (busy ? "busy" : "idle") + "|" + queuedQuestion');
    console.log('BG state:', r1.result.value);

    const r2 = await evalExp('(async()=>{try{await ensureGroup(4);return "ensureGroup(4) done"}catch(e){return"err:"+e.message}})()');
    console.log('ensureGroup:', r2.result.value);

    await new Promise(r => setTimeout(r, 3000));

    const r3 = await evalExp('activeGroupStart + "|" + activeGroupEnd + "|" + groupSize + "|" + (busy ? "busy" : "idle")');
    console.log('BG after:', r3.result.value);

    ws.close();
    process.exit(0);
  };
}).catch(e => { console.error(e.message); process.exit(1); });
