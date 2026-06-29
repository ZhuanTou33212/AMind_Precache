(() => {
  'use strict';
  if (window.__aminerMonitor) return;
  window.__aminerMonitor = true;

  const WS = 'ws://127.0.0.1:9800/ws';
  let ws, reconnect;

  function connect() {
    if (ws) try { ws.close(); } catch(e) {}
    ws = new WebSocket(WS);
    ws.onopen = () => { console.log('[Monitor] connected'); sendPageInfo(); };
    ws.onclose = () => { clearTimeout(reconnect); reconnect = setTimeout(connect, 3000); };

    // Intercept XHR to detect submissions
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('loadend', function() {
        if (this.status >= 200 && this.status < 300) {
          const m = (this.__monMethod || '').toUpperCase();
          if ((m === 'POST' || m === 'PUT' || m === 'PATCH') &&
              /\/(label|annot|submit|save|answer|mark|review|commit|responses)\b/i.test(this.__monUrl || '')) {
            send({ type: 'submission' });
            setTimeout(sendPageInfo, 1000);
          }
        }
      });
      return _send.apply(this, arguments);
    };

    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url) {
      this.__monMethod = m;
      this.__monUrl = String(url||'');
      return _open.apply(this, arguments);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function sendPageInfo() {
    const t = (document.body?.textContent||'').replace(/\s+/g,'');
    const m = t.match(/第(\d+)题\/(\d+)/);
    send({ type: 'pageInfo', question: m?Number(m[1]):0, total: m?Number(m[2]):0 });
  }

  connect();
  setInterval(sendPageInfo, 3000);
})();
