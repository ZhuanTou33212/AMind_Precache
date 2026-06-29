(() => {
  'use strict';

  let port = chrome.runtime.connect({ name: 'quicklabel' });
  let config = null;
  let hotkeys = new Map();
  let labelsByQuestion = new Map();
  let recordsByQuestion = new Map();
  let submitBusy = false;

  var traceEnabled = true;

  function trace(tag, data) {
    if (!traceEnabled) return;
    var ts = new Date().toISOString().slice(11, 23);
    if (data !== undefined) {
      console.log('[TRACE ' + ts + '] ' + tag, data);
    } else {
      console.log('[TRACE ' + ts + '] ' + tag);
    }
  }

  function traceGroup(label, fn) {
    if (!traceEnabled) return fn();
    console.groupCollapsed('[TRACE] ' + label);
    try {
      return fn();
    } finally {
      console.groupEnd();
    }
  }

  function send(msg) {
    try {
      port.postMessage(msg);
    } catch (e) {
      port = chrome.runtime.connect({ name: 'quicklabel' });
      port.postMessage(msg);
    }
  }

  function editableTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function readQuestionNum() {
    // Strategy 1: scan individual leaf DOM elements (more reliable than body text)
    var els=document.querySelectorAll('span,div,p,li,td,th,strong,b,h1,h2,h3');
    for(var i=0;i<els.length;i++){
      var el=els[i];if(el.children.length>0)continue;
      var t=(el.textContent||'').replace(/\s+/g,'');
      var m=t.match(/第(\d+)题\/(\d+)/)||t.match(/第(\d+)题/);
      if(m)return Number(m[1]);
    }
    // Strategy 2: fallback to full body text regex
    const text = (document.body?.textContent || '').replace(/\s+/g, '');
    const patterns = [
      /第(\d+)题/,
      /第(\d+)題/,
      /题号[:：]?(\d+)/,
      /題號[:：]?(\d+)/,
      /当前第?(\d+)/,
      /(\d+)题\/\d+/,
      /(\d+)題\/\d+/,
      /(\d+)\/\d+/,
      /Question(\d+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
    return 0;
  }

  function normalizeShortcutKey(event) {
    const key = String(event.key || '').toUpperCase();
    if (key === ' ' || key === 'SPACEBAR') return 'SPACE';
    if (key.length === 1) return key;
    if (/^F\d{1,2}$/.test(key)) return key;
    const allowed = ['ENTER', 'TAB', 'BACKSPACE', 'DELETE', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'];
    return allowed.includes(key) ? key : '';
  }

  function cloneLabels(labels) {
    const next = {};
    for (const [groupId, values] of Object.entries(labels || {})) {
      if (Array.isArray(values) && values.length) next[groupId] = values.slice();
    }
    return next;
  }

  function labelsForQuestion(questionNum) {
    if (!labelsByQuestion.has(questionNum)) labelsByQuestion.set(questionNum, {});
    return labelsByQuestion.get(questionNum);
  }

  function rebuildHotkeys() {
    hotkeys = new Map();
    for (const group of config?.groups || []) {
      for (const option of group.options || []) {
        const key = String(option.hotkey || '').toUpperCase();
        if (!key) continue;
        hotkeys.set(key, { group, option });
      }
    }
  }

  function updateLabels(questionNum, group, option) {
    const labels = labelsForQuestion(questionNum);
    const current = Array.isArray(labels[group.id]) ? labels[group.id].slice() : [];
    if (group.mode === 'multi') {
      const exists = current.includes(option.label);
      labels[group.id] = exists ? current.filter(x => x !== option.label) : current.concat(option.label);
      if (!labels[group.id].length) delete labels[group.id];
    } else {
      labels[group.id] = [option.label];
    }
  }

  function labelText(labels) {
    const parts = [];
    for (const group of config?.groups || []) {
      for (const value of labels[group.id] || []) parts.push(value);
    }
    return parts.join('_');
  }

  function showToast(text) {
    let node = document.getElementById('aminer-quicklabel-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'aminer-quicklabel-toast';
      node.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111827;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:8px 12px;font:13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.25)';
      document.documentElement.appendChild(node);
    }
    node.textContent = text;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => node.remove(), 1800);
  }

  function saveCurrentLabels(questionNum) {
    if (!questionNum) {
      showToast('未识别到当前题号');
      return;
    }
    const labels = cloneLabels(labelsForQuestion(questionNum));
    send({ type: 'image-labels', questionNum, labels });
    showToast('Q' + questionNum + ': ' + (labelText(labels) || '已清空'));
  }

  function norm(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
  }

  function fuzzyMatch(alias, text) {
    var ai = 0;
    for (var ti = 0; ti < text.length && ai < alias.length; ti++) {
      if (text[ti] === alias[ai]) ai++;
    }
    return ai === alias.length;
  }

  function matchScore(alias, text) {
    if (text.includes(alias)) return 100 + alias.length;
    if (fuzzyMatch(alias, text)) return 50 + alias.length;
    return 0;
  }

  function optionAliases(groupId, value) {
    const aliases = [value];
    const group = (config?.groups || []).find(g => g.id === groupId);
    const option = (group?.options || []).find(opt => opt.label === value || opt.id === value);
    if (option) aliases.push(...(option.aliases || []), option.label, option.id);
    return Array.from(new Set(aliases.map(norm).filter(Boolean)));
  }

  function labelValues(labels) {
    const values = [];
    for (const group of config?.groups || []) {
      for (const value of labels[group.id] || []) values.push({ groupId: group.id, value });
    }
    for (const [groupId, groupValues] of Object.entries(labels || {})) {
      if ((config?.groups || []).some(group => group.id === groupId)) continue;
      for (const value of groupValues || []) values.push({ groupId, value });
    }
    return values;
  }

  function clickableFor(node) {
    if (!node) return null;
    if (node.id) {
      const byFor = document.querySelector('label[for="' + CSS.escape(node.id) + '"]');
      if (byFor) return byFor;
    }
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (tag === 'input' && (node.type === 'radio' || node.type === 'checkbox')) {
      const antWrapper = node.closest('.ant-radio-wrapper, .ant-checkbox-wrapper, [class*="radio-wrapper"], [class*="checkbox-wrapper"]');
      if (antWrapper) return antWrapper;
    }
    return node.closest('label,button,[role="button"],[role="radio"],[role="checkbox"],.ant-radio-wrapper,.ant-checkbox-wrapper') || node;
  }

  function scanOptions() {
    const selector = [
      'label',
      'button',
      '[role="button"]',
      '[role="radio"]',
      '[role="checkbox"]',
      '.ant-radio-wrapper',
      '.ant-checkbox-wrapper',
      '.ant-radio',
      '.ant-checkbox',
      '.ant-btn',
      '[class*="radio-wrapper"]',
      '[class*="checkbox-wrapper"]',
      'input[type="radio"]',
      'input[type="checkbox"]',
    ].join(',');

    const seen = new Set();
    const results = [];

    for (const node of document.querySelectorAll(selector)) {
      const clickable = clickableFor(node);
      if (!clickable) continue;
      const text = norm(node.innerText || node.textContent || node.getAttribute('aria-label') || node.value || '');
      if (!text) continue;

      const key = text + '|' + (clickable.outerHTML || '').slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        node,
        clickable,
        text,
        tagName: node.tagName,
        className: (node.className && typeof node.className === 'string') ? node.className : '',
        clickableTagName: clickable.tagName,
      });
    }
    trace('scanOptions 扫描到 ' + results.length + ' 个可点击选项，文本: ' + results.map(function(r){return r.text;}).join(' | '));
    return results;
  }

  function clickOptionFor(groupId, value) {
    const aliases = optionAliases(groupId, value);
    const options = scanOptions();
    trace('clickOptionFor group=' + groupId + ' value=' + value + ' aliases=' + JSON.stringify(aliases) + ' options.count=' + options.length);
    if (!options.length) return false;

    let best = null;
    let bestScore = 0;
    let bestAlias = '';

    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      for (var j = 0; j < aliases.length; j++) {
        var alias = aliases[j];
        var score = matchScore(alias, opt.text);
        if (score > bestScore) {
          bestScore = score;
          best = opt;
          bestAlias = alias;
        }
      }
    }

    if (!best || bestScore === 0) {
      trace('clickOptionFor FAILED 未匹配到网页选项，aliases=' + JSON.stringify(aliases) + ' scannedTexts=' + options.map(function(o) { return o.text; }).join(' | '));
      console.warn('[quicklabel] 找不到网页选项 "' + value + '"，别名: ' + JSON.stringify(aliases) + '，扫描到: ' + options.map(function(o) { return o.text; }).join(', '));
      // Dump detailed DOM snapshot for debugging
      console.groupCollapsed('[quicklabel] DOM 快照（共 ' + options.length + ' 个选项）');
      console.table(options.map(function(o){return{text:o.text,tag:o.tagName,cls:(o.className||'').slice(0,50),clickable:o.clickableTagName}}));
      console.groupEnd();
      return false;
    }

    trace('clickOptionFor MATCHED text="' + best.text + '" alias="' + bestAlias + '" score=' + bestScore + ' tag=' + best.tagName + ' clickable=' + best.clickableTagName);
    console.log('[quicklabel] 点击选项: "' + best.text + '" (匹配别名: "' + bestAlias + '", 分数: ' + bestScore + ')');
    best.clickable.click();
    highlightElement(best.clickable);
    return true;
  }

  function highlightElement(el) {
    var orig = el.style.outline;
    el.style.outline = '2px solid #14b8a6';
    setTimeout(function() { el.style.outline = orig; }, 200);
  }

  async function applyLabelsToPage(labels) {
    var values = labelValues(labels);
    trace('applyLabelsToPage 开始，待点击 ' + values.length + ' 个标签: ' + JSON.stringify(values));
    const missing = [];
    for (const item of values) {
      var ok = clickOptionFor(item.groupId, item.value);
      if (!ok) missing.push(item.value);
      else trace('applyLabelsToPage 已点击 ' + item.groupId + '/' + item.value);
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    if (missing.length) {
      trace('applyLabelsToPage FAILED 未找到选项: ' + missing.join(', '));
      throw new Error('找不到网页选项: ' + missing.join('_'));
    }
    trace('applyLabelsToPage 完成，全部 ' + values.length + ' 个标签点击成功');
  }

  function clickSubmitButton() {
    const words = ['提交', '确认', '确定', '保存', 'Submit', 'OK'];
    const candidates = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'));
    const hit = candidates.find(node => {
      const text = String(node.innerText || node.textContent || node.value || node.getAttribute('aria-label') || '');
      return words.some(word => text.includes(word));
    });
    if (!hit) return false;
    hit.click();
    return true;
  }

  function dispatchKey(target, key, init) {
    const eventInit = { key, code: key, bubbles: true, cancelable: true, ...init };
    target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  async function submitPage() {
    const clicked = clickSubmitButton();
    if (!clicked) {
      dispatchKey(document.activeElement || document.body, 'Enter', { ctrlKey: true });
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    clickSubmitButton();
    dispatchKey(document.activeElement || document.body, 'Enter', {});
  }

  async function handleSubmitRequests() {
    if (submitBusy) return;
    const questionNum = readQuestionNum();
    if (!questionNum) return;
    const record = recordsByQuestion.get(questionNum);
    if (!record || record.labelStatus !== 'submit_requested') return;
    trace('handleSubmitRequests 开始 Q' + questionNum + ' labels=' + JSON.stringify(record.labels) + ' status=' + record.labelStatus);
    submitBusy = true;
    try {
      await applyLabelsToPage(cloneLabels(record.labels));
      await submitPage();
      send({ type: 'image-label-status', hash: record.hash, promptId: record.promptId, questionNum, status: 'cloud_submitted', message: 'web submit requested' });
      trace('handleSubmitRequests 成功 Q' + questionNum + ' -> cloud_submitted');
      showToast('Q' + questionNum + ' 已请求网页提交');
    } catch (e) {
      trace('handleSubmitRequests 失败 Q' + questionNum + ' error=' + (e.message || String(e)));
      send({ type: 'image-label-status', hash: record.hash, promptId: record.promptId, questionNum, status: 'submit_failed', message: e.message || String(e) });
      showToast('Q' + questionNum + ' 提交失败: ' + (e.message || String(e)));
    } finally {
      setTimeout(() => { submitBusy = false; }, 1200);
    }
  }

  port.onMessage.addListener((msg) => {
    if (msg.type === 'labels-config') {
      config = msg.config || {};
      rebuildHotkeys();
      trace('labels-config 加载完成，快捷键: ' + Array.from(hotkeys.keys()).join(', '));
      showToast('标签快捷键已加载');
    }
    if (msg.type === 'cache-list' && Array.isArray(msg.images)) {
      recordsByQuestion = new Map();
      for (const img of msg.images) {
        if (!img.questionNum) continue;
        recordsByQuestion.set(Number(img.questionNum), img);
        if (img.labels) labelsByQuestion.set(Number(img.questionNum), cloneLabels(img.labels));
      }
      var submitRequested = (msg.images || []).filter(function(img) { return img.labelStatus === 'submit_requested'; });
      trace('cache-list 收到 ' + msg.images.length + ' 条记录, submit_requested=' + submitRequested.length);
      handleSubmitRequests();
    }
    if (msg.type === 'quicklabel-error') {
      trace('quicklabel-error: ' + msg.message);
      showToast('标签保存失败: ' + msg.message);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (editableTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
    const questionNum = readQuestionNum();
    const key = normalizeShortcutKey(event);
    if (!key) return;
    if (key === 'BACKSPACE') {
      labelsByQuestion.set(questionNum, {});
      saveCurrentLabels(questionNum);
      event.preventDefault();
      return;
    }
    const entry = hotkeys.get(key);
    if (!entry) return;
    updateLabels(questionNum, entry.group, entry.option);
    saveCurrentLabels(questionNum);
    event.preventDefault();
  }, true);

  send({ type: 'get-labels-config' });
  send({ type: 'get-cache-list' });
  setInterval(() => send({ type: 'get-labels-config' }), 30000);
  setInterval(() => send({ type: 'get-cache-list' }), 5000);
  setInterval(handleSubmitRequests, 1500);

  window.__aminerQuickLabel = {
    traceOn() { traceEnabled = true; console.log('[quicklabel] 追踪已开启'); },
    traceOff() { traceEnabled = false; console.log('[quicklabel] 追踪已关闭'); },
    traceReport() {
      var qn = readQuestionNum();
      var opts = scanOptions();
      var rec = recordsByQuestion.get(qn) || null;
      console.group('[QUICKLABEL TRACE REPORT]');
      console.log('当前题号:', qn);
      console.log('标签配置:', config ? '已加载(' + (config.groups || []).length + '组)' : '未加载');
      console.log('快捷键:', Array.from(hotkeys.keys()).join(', ') || '无');
      console.log('本地标签:', JSON.stringify(cloneLabels(labelsForQuestion(qn))));
      if (rec) console.log('当前题缓存记录:', { hash: rec.hash, questionNum: rec.questionNum, labelText: rec.labelText, labelStatus: rec.labelStatus, promptId: rec.promptId });
      else console.log('当前题缓存记录: 无');
      console.log('扫描到网页选项 (' + opts.length + '个):');
      console.table(opts.map(function(o) { return { text: o.text.slice(0,40), tag: o.tagName, cls: (o.className||'').slice(0, 40), clickable: o.clickableTagName }; }));
      console.groupEnd();
      return { questionNum: qn, scannedCount: opts.length, scannedOptions: opts, record: rec, labels: cloneLabels(labelsForQuestion(qn)), config: !!config };
    },
    debug() {
      const questionNum = readQuestionNum();
      const scannedOptions = scanOptions();
      return {
        questionNum,
        hotkeys: Array.from(hotkeys.keys()),
        labels: cloneLabels(labelsForQuestion(questionNum)),
        record: recordsByQuestion.get(questionNum) || null,
        configLoaded: !!config,
        scannedCount: scannedOptions.length,
        scannedOptions: scannedOptions.map(function(o) { return { text: o.text, tag: o.tagName, cls: o.className, clickableTag: o.clickableTagName }; }),
      };
    },
    debugScan(filterText) {
      var all = scanOptions();
      var filtered = filterText ? all.filter(function(o) { return o.text.includes(filterText); }) : all;
      console.table(filtered.map(function(o) { return { text: o.text, tagName: o.tagName, className: o.className.slice(0, 60), clickable: o.clickableTagName }; }));
      return filtered;
    },
    scanOptions,
    applyLabelsToPage,
    submitPage,
    readQuestionNum,
    saveCurrentLabels,
  };
})();
