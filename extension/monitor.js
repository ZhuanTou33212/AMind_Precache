(() => {
  'use strict';

  const SERVER = 'http://127.0.0.1:9800';

  let port = null;
  let reconnectDelay = 2000;
  let cacheByObject = new Map();
  let ossHost = 'mm-group-image.oss-cn-beijing.aliyuncs.com';

  function connectPort() {
    try {
      port = chrome.runtime.connect({ name: 'monitor' });
      reconnectDelay = 2000;
      port.onDisconnect.addListener(onDisconnect);
      port.onMessage.addListener(handleMessage);
      return true;
    } catch(e) {
      return false;
    }
  }

  function onDisconnect() {
    setTimeout(() => {
      connectPort();
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }, reconnectDelay);
  }

  connectPort();

  function send(msg) {
    if (!port) { connectPort(); if (!port) return; }
    try { port.postMessage(msg); } catch(e) { onDisconnect(); }
  }

  // Auto-detect token & config from page localStorage (injected into MAIN world)
  function injectConfigSniffer() {
    try {
      const scr = document.createElement('script');
      scr.textContent = `(function(){
  if (!localStorage) return;
  try {
    var token = localStorage.getItem('Access-Token');
    var origin = location.origin;
    var m = location.pathname.match(/label_page_feed\\/([^\\/?#]+)/);
    var taskId = m ? m[1] : '';
    var params = new URLSearchParams(location.search);
    var startDate = params.get('start') || '';
    if (token && taskId) {
      var key = token.substring(0,20) + '|' + origin + '|' + taskId + '|' + startDate;
      if (key !== window.__aminerLastKey) {
        window.__aminerLastKey = key;
        document.dispatchEvent(new CustomEvent('aminer-config', {detail:{type:'config',token:token,taskId:taskId,startDate:startDate,platformUrl:origin}}));
      }
    }
    if (origin !== window.__aminerLastPlatform) {
      window.__aminerLastPlatform = origin;
      document.dispatchEvent(new CustomEvent('aminer-config', {detail:{type:'platform-init',platformUrl:origin}}));
    }
  } catch(e){}
})()`;
      (document.head || document.body || document.documentElement).appendChild(scr);
      scr.remove();
    } catch(e) {}
  }

  document.addEventListener('aminer-config', function(event) {
    if (event.detail && event.detail.token) send(event.detail);
    if (event.detail && event.detail.type === 'platform-init') send(event.detail);
  });

  injectConfigSniffer();
  setInterval(injectConfigSniffer, 8000);

  console.log('[Monitor bridge] loaded');

  function handleMessage(msg) {
    if (msg.ossHost) ossHost = msg.ossHost;
    if (msg.type === 'cache-list' && msg.images) {
      const next = new Map();
      for (const image of msg.images) {
        const key = objectKey(image.url || '');
        if (key && image.hash) next.set(key, image);
      }
      cacheByObject = next;
      replaceImages();
    }
  }

  function objectKey(rawURL) {
    try {
      const url = new URL(rawURL, location.href);
      if (url.hostname !== ossHost) return '';
      return url.origin + url.pathname;
    } catch (e) {
      return '';
    }
  }

  function localImageURL(record) {
    return SERVER + '/api/image/' + encodeURIComponent(record.hash);
  }

  function replaceURL(rawURL) {
    const key = objectKey(rawURL);
    const record = key ? cacheByObject.get(key) : null;
    return record ? localImageURL(record) : rawURL;
  }

  function replaceSrcSet(value) {
    return String(value || '').split(',').map((part) => {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return part;
      bits[0] = replaceURL(bits[0]);
      return bits.join(' ');
    }).join(', ');
  }

  function replaceStyleURLs(style) {
    return String(style || '').replace(/url\((['"]?)(.*?)\1\)/g, (match, quote, url) => {
      const next = replaceURL(url);
      return next === url ? match : 'url("' + next + '")';
    });
  }

  function replaceImages() {
    if (!cacheByObject.size) return;

    for (const img of document.querySelectorAll('img[src]')) {
      const current = img.getAttribute('src') || '';
      let original = img.dataset.aminerOriginalSrc || current;
      if (objectKey(current) && current !== original) original = current;
      const next = replaceURL(original);
      if (next !== current) {
        img.dataset.aminerOriginalSrc = original;
        img.setAttribute('src', next);
      }
    }

    for (const node of document.querySelectorAll('source[srcset], img[srcset]')) {
      const current = node.getAttribute('srcset') || '';
      let original = node.dataset.aminerOriginalSrcset || current;
      if (current.includes(ossHost) && current !== original) original = current;
      const next = replaceSrcSet(original);
      if (next !== current) {
        node.dataset.aminerOriginalSrcset = original;
        node.setAttribute('srcset', next);
      }
    }

    for (const node of document.querySelectorAll('[style*="' + ossHost + '"]')) {
      const current = node.getAttribute('style') || '';
      let original = node.dataset.aminerOriginalStyle || current;
      if (current.includes(ossHost) && current !== original) original = current;
      const next = replaceStyleURLs(original);
      if (next !== current) {
        node.dataset.aminerOriginalStyle = original;
        node.setAttribute('style', next);
      }
    }
  }

  function readPageInfo() {
    const text = (document.body?.textContent || '').replace(/\s+/g, '');
    const match = text.match(/第?(\d+)题\/(\d+)/) || text.match(/(\d+)题\/(\d+)/);
    if (!match) return null;
    return { question: Number(match[1]), total: Number(match[2]) };
  }

  function reportPageInfo() {
    const info = readPageInfo();
    if (info) send(info);
  }

  window.addEventListener('aminer-monitor:event', (event) => {
    if (event.detail && typeof event.detail === 'object') send(event.detail);
  });

  console.log('[Monitor bridge] loaded');
  reportPageInfo();
  setInterval(reportPageInfo, 3000);

  const observer = new MutationObserver(() => replaceImages());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'style'],
  });
})();
