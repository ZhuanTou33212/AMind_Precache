var EXE = 'http://127.0.0.1:9800';
var CDP = 'http://127.0.0.1:9224';
var targets = [15, 16, 17, 18, 19, 20];
var last = {};

function fmt() { return new Date().toISOString().slice(11, 23); }

async function check() {
  try {
    var r = await fetch(EXE + '/api/images');
    var imgs = await r.json();
    for (var i = 0; i < targets.length; i++) {
      var qn = targets[i];
      var q = (imgs || []).find(function(x) { return Number(x.questionNum) === qn; });
      if (!q) { if (last[qn]) { console.log(fmt() + ' Q' + qn + ' EVICTED'); last[qn] = null; } continue; }
      var t = q.labelText || '(empty)';
      var s = q.labelStatus;
      var prev = last[qn];
      if (!prev || prev.text !== t || prev.status !== s) {
        console.log('');
        console.log('>>> Q' + qn + ' @ ' + fmt() + ': ' + JSON.stringify(t) + ' | ' + s + ' | labels=' + JSON.stringify(q.labels));
        if (s === 'submit_requested') console.log('    [SUBMIT_REQUESTED]');
        if (s === 'cloud_submitted') console.log('    [CLOUD_SUBMITTED OK]');
        if (s === 'submit_failed') console.log('    [FAILED: ' + (q.labelMessage || '') + ']');
      }
      last[qn] = { text: t, status: s };
    }
  } catch(e) {}
}

try {
  var t = await fetch(CDP + '/json/list').then(function(r) { return r.json(); });
  var page = t.find(function(x) { return x.type === 'page' && (x.url || '').includes('label_page_feed'); });
  if (page) {
    var ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onmessage = function(e) {
      var m = JSON.parse(e.data);
      if (m.method === 'Runtime.consoleAPICalled') {
        var a = (m.params.args || []).map(function(x) { return x.value || x.description || ''; }).join(' ');
        if (a.includes('scanOptions') || a.includes('clickOptionFor') || a.includes('applyLabelsToP') || a.includes('handleSubmit') || a.includes('submit_requested') || a.includes('cloud_submitted') || a.includes('submit_failed')) {
          console.log('  DOM ' + fmt() + ': ' + a);
        }
      }
    };
    ws.onopen = function() { ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' })); ws.send(JSON.stringify({ id: 2, method: 'Console.enable' })); };
  }
} catch(e) {}

console.log('=== MONITOR Q15-Q20 @ ' + fmt() + ' ===');
console.log('Waiting for label/sumbit on: ' + targets.join(', '));
console.log('');
check();
setInterval(check, 2000);
