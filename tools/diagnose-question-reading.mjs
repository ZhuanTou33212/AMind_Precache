const CDP = 'http://127.0.0.1:9224';

fetch(CDP + '/json/list').then(r => r.json()).then(targets => {
  const pages = targets.filter(t => t.type === 'page' && (t.url || '').includes('label_page_feed'));
  if (!pages.length) { console.log('No label page found. Pages:', targets.filter(t=>t.type==='page').map(t=>t.url)); return; }
  const url = pages[0].webSocketDebuggerUrl;
  console.log('Connecting to:', pages[0].title);

  const ws = new WebSocket(url);

  let pending = {};
  let msgId = 1;
  
  function send(method, params) {
    return new Promise(resolve => {
      const id = msgId++;
      pending[id] = resolve;
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (pending[msg.id]) { pending[msg.id](msg.result); delete pending[msg.id]; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const t = msg.params?.args?.[0]?.value;
      if (t) console.log('  CONSOLE:', t.slice(0, 200));
    }
  };

  ws.onopen = async () => {
    await send('Runtime.enable');
    await send('Console.enable');
    
    // Test regex matches
    const r1 = await send('Runtime.evaluate', { expression: `
(function() {
  var t = (document.body && document.body.textContent || '').replace(/\\s+/g, '');
  var re = /第?(\\d+)题\\/(\\d+)/g;
  var out = []; var m;
  while ((m = re.exec(t)) !== null && out.length < 15) out.push('Q' + m[1] + '/' + m[2]);
  return 'monitor.js regex found: ' + (out.length ? out.join(', ') : 'NONE');
})()
    `, returnByValue: true });
    console.log(r1?.result?.value);
    
    const r2 = await send('Runtime.evaluate', { expression: `
(function() {
  var t = (document.body && document.body.textContent || '').replace(/\\s+/g, '');
  var re = /第(\\d+)题\\/(\\d+)/g;
  var out = []; var m;
  while ((m = re.exec(t)) !== null && out.length < 15) out.push('Q' + m[1] + '/' + m[2]);
  return 'monitor-main.js regex found: ' + (out.length ? out.join(', ') : 'NONE');
})()
    `, returnByValue: true });
    console.log(r2?.result?.value);

    const r3 = await send('Runtime.evaluate', { expression: `
(function() {
  try { var q = window.__aminerQuickLabel ? window.__aminerQuickLabel.readQuestionNum() : null; return 'quicklabel: Q' + q; }
  catch(e) { return 'quicklabel error: ' + e.message; }
})()
    `, returnByValue: true });
    console.log(r3?.result?.value);

    // Look at question indicator elements
    const r4 = await send('Runtime.evaluate', { expression: `
(function() {
  var els = document.querySelectorAll('*');
  var out = [];
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (e.children.length > 0) continue;
    var t = (e.textContent || '').trim();
    if (/\\d+题\\/\\d+/.test(t)) out.push(t.slice(0, 60));
  }
  return 'Question elements found (' + out.length + '): ' + out.slice(0, 6).join(' | ');
})()
    `, returnByValue: true });
    console.log(r4?.result?.value);

    ws.close();
    process.exit(0);
  };

  ws.onerror = (e) => { console.error('WS error:', e.message || e); process.exit(1); };
}).catch(e => { console.error(e.message); process.exit(1); });

setTimeout(() => { console.log('timeout'); process.exit(2); }, 10000);
