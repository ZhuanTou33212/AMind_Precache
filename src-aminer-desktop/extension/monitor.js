(() => {
  'use strict';

  const SERVER = 'http://127.0.0.1:9800';
  const OSS_HOST = 'mm-group-image.oss-cn-beijing.aliyuncs.com';

  let port = chrome.runtime.connect({ name: 'monitor' });
  let cacheByObject = new Map();

  function send(msg) {
    try {
      port.postMessage(msg);
    } catch (e) {
      try {
        port = chrome.runtime.connect({ name: 'monitor' });
        port.postMessage(msg);
      } catch (ex) {}
    }
  }

  function objectKey(rawURL) {
    try {
      const url = new URL(rawURL, location.href);
      if (url.hostname !== OSS_HOST) return '';
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
      if (current.includes(OSS_HOST) && current !== original) original = current;
      const next = replaceSrcSet(original);
      if (next !== current) {
        node.dataset.aminerOriginalSrcset = original;
        node.setAttribute('srcset', next);
      }
    }

    for (const node of document.querySelectorAll('[style*="' + OSS_HOST + '"]')) {
      const current = node.getAttribute('style') || '';
      let original = node.dataset.aminerOriginalStyle || current;
      if (current.includes(OSS_HOST) && current !== original) original = current;
      const next = replaceStyleURLs(original);
      if (next !== current) {
        node.dataset.aminerOriginalStyle = original;
        node.setAttribute('style', next);
      }
    }
  }

  port.onMessage.addListener((msg) => {
    if (msg.type === 'cache-list' && msg.images) {
      const next = new Map();
      for (const image of msg.images) {
        const key = objectKey(image.url || '');
        if (key && image.hash) next.set(key, image);
      }
      cacheByObject = next;
      replaceImages();
    }
  });

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
