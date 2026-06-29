(() => {
  'use strict';

  const submitRE = /\/(label|annot|submit|save|answer|mark|review|commit|responses)\b/i;
  let lastInfo = null;
  let lastSent = '';
  let lastConfigSent = '';

  function emit(detail) {
    window.dispatchEvent(new CustomEvent('aminer-monitor:event', { detail }));
  }

  function normalizeToken(value) {
    const token = String(value || '').trim().replace(/^Bearer\s+/i, '');
    return token || '';
  }

  function urlConfig() {
    const taskMatch = location.pathname.match(/\/label_page_feed\/([^/?#]+)/);
    const params = new URLSearchParams(location.search);
    return { taskId: taskMatch ? decodeURIComponent(taskMatch[1]) : '', startDate: params.get('start') || '' };
  }

  function reportConfig(tokenValue) {
    const token = normalizeToken(tokenValue || localStorage.getItem('Access-Token'));
    if (!token) return;
    const config = urlConfig();
    const key = token + '|' + config.taskId + '|' + config.startDate;
    if (key === lastConfigSent) return;
    lastConfigSent = key;
    emit({ type: 'config', token, taskId: config.taskId, startDate: config.startDate });
  }

  function pageInfo() {
    const text = (document.body?.textContent || '').replace(/\s+/g, '');
    const match = text.match(/第(\d+)题\/(\d+)/);
    if (!match) return null;
    return { question: Number(match[1]), total: Number(match[2]) };
  }

  function reportPageInfo(force) {
    const info = pageInfo();
    if (!info) return;
    lastInfo = info;
    const key = info.question + '/' + info.total;
    if (force || key !== lastSent) {
      lastSent = key;
      emit(info);
    }
  }

  function reportSubmission() {
    const info = pageInfo() || lastInfo || {};
    emit({ type: 'submission', question: info.question, total: info.total });
    setTimeout(() => reportPageInfo(true), 1200);
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__aminerMethod = String(method || '').toUpperCase();
    this.__aminerURL = String(url || '');
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (String(name || '').toLowerCase() === 'authorization') {
      reportConfig(value);
    }
    return xhrSetRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('loadend', () => {
      const method = this.__aminerMethod || '';
      const url = this.__aminerURL || '';
      if (this.status >= 200 && this.status < 300 &&
          (method === 'POST' || method === 'PUT' || method === 'PATCH') &&
          submitRE.test(url)) {
        reportSubmission();
      }
    });
    return xhrSend.apply(this, arguments);
  };

  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || input?.headers || {});
      const authorization = headers.get('authorization');
      if (authorization) reportConfig(authorization);
      return nativeFetch.apply(this, arguments).then((response) => {
        if (response.ok &&
            (method === 'POST' || method === 'PUT' || method === 'PATCH') &&
            submitRE.test(url)) {
          reportSubmission();
        }
        return response;
      });
    };
  }

  const observer = new MutationObserver(() => reportPageInfo(false));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.addEventListener('beforeunload', () => { emit({ type: 'cleanup' }); });

  console.log('[Monitor main] loaded');
  reportConfig();
  reportPageInfo(true);
  setInterval(() => reportConfig(), 30000);
  setInterval(() => reportPageInfo(false), 3000);
})();
