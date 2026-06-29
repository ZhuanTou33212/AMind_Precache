(() => {
  'use strict';

  console.log('[Monitor main] loaded v2');

  const submitRE = /\/(label|annot|submit|save|answer|mark|review|commit|responses)\b/i;
  const taskRE = /\/v1\/annotations\/annot\/prompts\/task\/(\d+)\/date\/(\d+)\/v2/;
  let lastInfo = null;
  let lastSent = '';
  let lastConfigSent = '';
  let detectedTaskId = '';
  let detectedStartDate = '';
  let domChecking = false;
  let lastMappedQuestion = 0;

  function emit(detail) {
    window.dispatchEvent(new CustomEvent('aminer-monitor:event', { detail }));
  }

  function normalizeToken(value) {
    const token = String(value || '').trim().replace(/^Bearer\s+/i, '');
    return token || '';
  }

  // Extract real taskId/startDate from KB-SDK API call URLs (overrides URL-based values)
  function captureTaskFromURL(url) {
    const m = url.match(taskRE);
    if (m) { detectedTaskId = m[1]; detectedStartDate = m[2]; }
  }

  function urlConfig() {
    return {
      taskId: detectedTaskId || (location.pathname.match(/\/label_page_feed\/([^/?#]+)/)||[])[1] || '',
      startDate: detectedStartDate || new URLSearchParams(location.search).get('start') || ''
    };
  }

  // Capture KB-SDK postMessage auth token & task context
  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    // KB-SDK auth token
    if (e.data.type === 'auth' && e.data.token) reportConfig(e.data.token);
    // KB-SDK task context — extract taskId and startDate
    if (e.data.type === 'task' && e.data.id) {
      detectedTaskId = String(e.data.id);
      if (e.data.startDate) detectedStartDate = String(e.data.startDate);
    }
    if (e.data.type === 'task-context' && e.data.taskId) {
      detectedTaskId = String(e.data.taskId);
      if (e.data.startDate) detectedStartDate = String(e.data.startDate);
    }
  });

  // Capture KB-SDK iframe postMessage — intercept sending TO iframe
  try {
    const observer2 = new MutationObserver(function() {
      for (const iframe of document.querySelectorAll('iframe')) {
        if (iframe.__patched) continue;
        iframe.__patched = true;
        try {
          const cw = iframe.contentWindow;
          if (!cw || !cw.postMessage) continue;
          const origPM = cw.postMessage;
          cw.postMessage = function(data, targetOrigin, transfer) {
            try {
              if (data && typeof data === 'object') {
                if (data.token) reportConfig(data.token);
                if (data.id) detectedTaskId = String(data.id);
                if (data.startDate) detectedStartDate = String(data.startDate);
                if (data.taskId) detectedTaskId = String(data.taskId);
              }
            } catch(e) {}
            return origPM.call(cw, data, targetOrigin, transfer);
          };
        } catch(e) {}
      }
    });
    observer2.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) { /* observer may fail on some pages */ }

  // Send platform URL immediately on load — do NOT wait for token
  emit({ type: 'platform-init', platformUrl: location.origin });

  function reportConfig(tokenValue) {
    const token = normalizeToken(tokenValue || localStorage.getItem('Access-Token'));
    if (!token) return;
    const config = urlConfig();
    const platformUrl = location.origin;
    const key = token + '|' + platformUrl + '|' + config.taskId + '|' + config.startDate;
    if (key === lastConfigSent) return;
    lastConfigSent = key;
    emit({ type: 'config', token, taskId: config.taskId, startDate: config.startDate, platformUrl });
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

  const LABEL_TEXTS = ['惊艳', '好看', '一般', '不堪', '带水印'];

  function isDOMSelected() {
    var all = document.querySelectorAll('button, [role="button"], span, div, label, a, input');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var text = (el.textContent || '').trim();
      // Check if this is an annotation label element
      var match = false;
      for (var t = 0; t < LABEL_TEXTS.length; t++) {
        if (text.indexOf(LABEL_TEXTS[t]) >= 0) { match = true; break; }
      }
      if (!match) continue;
      // Verify element is in selected/checked state (not just exist)
      var node = el;
      for (var d = 0; d < 4 && node; d++) {
        var cls = (node.className && typeof node.className === 'string') ? node.className : '';
        if (/(checked|selected|active|ant-radio-button-checked|ant-checkbox-checked)/i.test(cls)) return true;
        if (node.tagName === 'INPUT' && (node.type === 'radio' || node.type === 'checkbox') && node.checked) return true;
        node = node.parentElement;
      }
    }
    return false;
  }

  async function waitForDOMButtons() {
    var totalRetries = 0;
    var maxRetries = 8;

    while (totalRetries < maxRetries) {
      // Phase 1: 判断 → 检查DOM是否被选中
      var selected = isDOMSelected();
      while (!selected && totalRetries < maxRetries) {
        totalRetries++;
        console.log('[Monitor main] 判断: DOM未选中 (retry ' + totalRetries + '/' + maxRetries + ')');
        if (totalRetries >= maxRetries) break;
        await new Promise(function(r) { setTimeout(r, 300); });
        selected = isDOMSelected();
      }
      if (!selected) {
        console.log('[Monitor main] 抓取失败, 超过最大重试');
        return false;
      }

      console.log('[Monitor main] DOM已选中');

      // Extra: 强制80ms后额外判断, 防止误判空放
      await new Promise(function(r) { setTimeout(r, 80); });
      if (!isDOMSelected()) {
        console.log('[Monitor main] 额外判断: 选中已失效, 重新抓取');
        totalRetries++;
        continue;
      }
      console.log('[Monitor main] 额外判断: 选中有效');

      // Phase 2: 等待300ms后二次判断, 防止选中状态被页面重置
      await new Promise(function(r) { setTimeout(r, 300); });
      totalRetries++;
      if (isDOMSelected()) {
        console.log('[Monitor main] 判断: 选中状态稳定');
        return true;
      }

      console.log('[Monitor main] 判断: 选中状态变化, 重新抓取');
      // Loop back to Phase 1
    }

    console.log('[Monitor main] 重试耗尽, 放弃');
    return false;
  }

  function dispatchKey(target, key, init) {
    const eventInit = { key, code: key, bubbles: true, cancelable: true, ...init };
    target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  function simulateKeyMapping() {
    const target = document.activeElement || document.body;
    dispatchKey(target, 'Enter', { ctrlKey: true });
    setTimeout(function() {
      dispatchKey(target, 'Enter', {});
    }, 500);
    console.log('[Monitor main] key mapping: Ctrl+Enter -> Enter');
  }

  async function reportSubmission() {
    if (domChecking) return;
    domChecking = true;
    try {
      const info = pageInfo() || lastInfo || {};
      const q = info.question || 0;

      // Prevent re-mapping for the same question
      // (key mapping triggers page submission → new XHR → reportSubmission again)
      if (q > 0 && q === lastMappedQuestion) {
        console.log('[Monitor main] already mapped for Q' + q + ', skipping');
        return;
      }

      // Skip if quicklabel already handled submission (monitor-quicklabel.js ← ISOLATED world)
      var lastQuickSubmit = parseInt(document.documentElement.getAttribute('data-aminer-last-submit') || '0', 10);
      if (Date.now() - lastQuickSubmit < 3000) {
        console.log('[Monitor main] quicklabel submitted recently, skipping key mapping');
        return;
      }

      console.log('[Monitor main] Phase 1: 判断+抓取按钮 (Q' + q + ')');
      const domReady = await waitForDOMButtons();
      if (!domReady) {
        console.log('[Monitor main] Phase 2: 判断失败, skipping question', q);
        return;
      }

      console.log('[Monitor main] Phase 2: 判断通过');
      lastMappedQuestion = q;
      console.log('[Monitor main] Phase 3: 键位映射');
      simulateKeyMapping();

      emit({ type: 'submission', question: q, total: info.total });
      setTimeout(function() { reportPageInfo(true); }, 1200);
    } finally {
      domChecking = false;
    }
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
      captureTaskFromURL(this.__aminerURL || '');
      reportConfig(value);
    }
    return xhrSetRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('loadend', () => {
      const method = this.__aminerMethod || '';
      const url = this.__aminerURL || '';
      captureTaskFromURL(url);
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
      captureTaskFromURL(url);
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
