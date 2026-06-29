// Run in AMiner page console to find tagger_id and resp_ids
(function() {
  const results = [];

  // 1. Search all React fiber trees
  function walkFiber(fiber, path, depth) {
    if (!fiber || depth > 50) return;
    try {
      if (fiber.memoizedState && typeof fiber.memoizedState === 'object') {
        const s = JSON.stringify(fiber.memoizedState);
        if (s.includes('tagger_id')) {
          results.push(['react-state', path.join('>'), s.substring(0, 1000)]);
        }
        if (s.includes('resp_id')) {
          results.push(['react-state-resp', path.join('>'), s.substring(0, 2000)]);
        }
        // Walk state linked list
        let state = fiber.memoizedState;
        while (state) {
          if (state.memoizedState && typeof state.memoizedState === 'object') {
            const ss = JSON.stringify(state.memoizedState);
            if (ss.includes('tagger_id') || ss.includes('assignment_id')) {
              results.push(['react-hook', '', ss.substring(0, 1000)]);
            }
          }
          state = state.next;
        }
      }
      if (fiber.memoizedProps && typeof fiber.memoizedProps === 'object') {
        const p = JSON.stringify(fiber.memoizedProps);
        if (p.includes('tagger_id') || p.includes('resp_id')) {
          results.push(['react-props', path.join('>'), p.substring(0, 1000)]);
        }
      }
    } catch(e) {}
    walkFiber(fiber.child, path.concat('child'), depth + 1);
    walkFiber(fiber.sibling, path.concat('sib'), depth + 1);
  }

  const rootEls = document.querySelectorAll('#root, [id^="root"], #app, #__next');
  for (const el of rootEls) {
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fiberKey) walkFiber(el[fiberKey], [el.id || el.tagName], 0);
  }

  // 2. Search all iframes
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      const cw = iframe.contentWindow;
      for (const k of Object.getOwnPropertyNames(cw || {})) {
        try {
          const v = cw[k];
          if (v && typeof v === 'object') {
            const s = JSON.stringify(v);
            if (s.includes('tagger_id') && s.length < 500) results.push(['iframe-window', k, s]);
          }
        } catch(e) {}
      }
    } catch(e) {}
  }

  // 3. Search all script sources for inline data
  if (!results.length) {
    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      const m = text.match(/tagger_id\s*[:=]\s*['"]([^'"]+)['"]/);
      if (m) results.push(['script', '', m[0]]);
    }
  }

  if (results.length) {
    for (const r of results) console.log(r[0], r[1], r[2]);
  } else {
    console.log('NOT FOUND in React fibers, iframes, or scripts');
  }

  // 4. As a fallback, search for any UUID-like string in the dom starting with "76" (the tagger we saw)
  const allText = document.body?.innerHTML || '';
  const taggerMatch = allText.match(/760732ed-2b30-4a64-b345-efe0c1b3fd81/);
  if (taggerMatch) console.log('FOUND in DOM body:', taggerMatch[0]);

  // 5. Check if there's a global store / redux / zustand
  for (const k of Object.getOwnPropertyNames(window)) {
    if (k.includes('store') || k.includes('Store') || k.includes('state')) {
      try {
        const v = window[k];
        if (v && typeof v.getState === 'function') {
          const s = JSON.stringify(v.getState());
          if (s.includes('tagger')) results.push(['global-store', k, s.substring(0, 500)]);
        }
      } catch(e) {}
    }
  }

  return results;
})();
