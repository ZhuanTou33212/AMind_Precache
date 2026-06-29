var EXE = 'http://127.0.0.1:9800';
var CDP = 'http://127.0.0.1:9224';
var last = { text: '(empty)', status: 'pending' };

function fmt() { return new Date().toISOString().slice(11, 23); }

async function check() {
  try {
    var r = await fetch(EXE + '/api/images');
    var imgs = await r.json();
    var q14 = (imgs || []).find(function(x) { return Number(x.questionNum) === 14; });
    if (!q14) { console.log(fmt() + ' Q14 EVICTED'); last = null; return; }
    var t = q14.labelText || '(empty)';
    var s = q14.labelStatus;
    if (!last || last.text !== t || last.status !== s) {
      console.log('');
      console.log('>>> Q14 CHANGE @ ' + fmt() + ' <<<');
      console.log('    labelText: ' + JSON.stringify(t));
      console.log('    status:    ' + s);
      console.log('    labels:    ' + JSON.stringify(q14.labels));
      if (s === 'submit_requested') console.log('>>> SUBMIT_REQUESTED - watching DOM <<<');
      if (s === 'cloud_submitted') console.log('>>> CLOUD_SUBMITTED <<<');
      if (s === 'submit_failed') console.log('XXX FAILED: ' + (q14.labelMessage || ''));
    }
    last = { text: t, status: s };
  } catch(e) {}
}

try {
  var targets = await fetch(CDP + '/json/list').then(function(r) { return r.json(); });
  var page = targets.find(function(t) { return t.type === 'page' && (t.url || '').includes('label_page_feed'); });
  if (page) {
    var ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onmessage = function(e) {
      var m = JSON.parse(e.data);
      if (m.method === 'Runtime.consoleAPICalled') {
        var a = (m.params.args || []).map(function(x) { return x.value || x.description || ''; }).join(' ');
        if (a.includes('[TRACE') || a.includes('[quicklabel') || a.includes('scan') || a.includes('click') || a.includes('apply') || a.includes('submit') || a.includes('handleSubmit')) {
          console.log('  CDP ' + fmt() + ': ' + a);
        }
      }
    };
    ws.onopen = function() {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Console.enable' }));
    };
    ws.onclose = function() { console.log('CDP disconnected'); };
  }
} catch(e) {}

console.log('=== Q14 MONITOR @ ' + fmt() + ' ===');
console.log('Waiting for label: 一般');
check();
setInterval(check, 2000);
