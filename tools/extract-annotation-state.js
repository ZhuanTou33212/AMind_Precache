// Paste this in AMiner page console to extract annotation state
(function() {
  const result = {};

  // 1. Search for tagger_id in common places
  result.tagger_id = '';
  for (const key of ['tagger_id', 'taggerId', 'user_id', 'userId', 'account_id']) {
    const v = window[key] || localStorage.getItem(key) || sessionStorage.getItem(key);
    if (v) { result.tagger_id = String(v); break; }
  }

  // 2. Search window.__xxx for anything containing tagger
  for (const key of Object.keys(window)) {
    if (/tagger/i.test(key) && typeof window[key] === 'string') {
      result['window_' + key] = window[key];
    }
  }

  // 3. Search all localStorage/sessionStorage keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key);
    if (/tagger|account|user/i.test(key)) result['ls_' + key] = val.substring(0, 200);
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    const val = sessionStorage.getItem(key);
    if (/tagger|account|user/i.test(key)) result['ss_' + key] = val.substring(0, 200);
  }

  // 4. Try React fiber to find annotation data
  try {
    const root = document.getElementById('root') || document.body;
    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fiberKey) {
      let node = root[fiberKey];
      const depth = 0;
      // Walk fiber tree looking for data
      function walkFiber(fiber, depth) {
        if (!fiber || depth > 30) return;
        if (fiber.memoizedState) {
          try {
            const s = JSON.stringify(fiber.memoizedState);
            if (/tagger_id|assignment_id|resp_id|payload/i.test(s) && s.length < 500) {
              result['react_memoizedState'] = result['react_memoizedState'] || fiber.memoizedState;
            }
          } catch(e) {}
        }
        if (fiber.memoizedProps) {
          try {
            const p = JSON.stringify(fiber.memoizedProps);
            if (/tagger_id|assignment_id|resp_id|response/i.test(p) && p.length < 500) {
              result['react_memoizedProps'] = result['react_memoizedProps'] || fiber.memoizedProps;
            }
          } catch(e) {}
        }
        walkFiber(fiber.child, depth + 1);
        walkFiber(fiber.sibling, depth + 1);
      }
      walkFiber(node, 0);
    }
  } catch(e) {}

  // 5. Search for UUID-like tagger_id in page scripts
  const scripts = document.querySelectorAll('script');
  for (const s of scripts) {
    const text = s.textContent || '';
    const m = text.match(/tagger_id["\s:=]+(["']?)([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\1/i);
    if (m) { result['script_tagger_id'] = m[2]; }
  }

  // 6. Capture KB-SDK postMessage traffic (last 5 seconds)
  result.postMessages = [];
  const origHandler = window.onmessage;
  window.addEventListener('message', function capture(e) {
    if (e.data && typeof e.data === 'object') {
      result.postMessages.push({
        type: e.data.type,
        keys: Object.keys(e.data).join(',')
      });
      if (result.postMessages.length > 10) {
        window.removeEventListener('message', capture, true);
      }
    }
  }, true);

  // 7. Capture all intercepted XHR data from our extension
  result.extensionState = {
    lastMappedQuestion: window.__aminerLastMappedQuestion || 'N/A',
    detectedTaskId: 'N/A'
  };

  console.table(result);
  return result;
})();
