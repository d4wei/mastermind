(() => {
  if (window !== window.top || !location.pathname.endsWith('/desktop.html')) return;
  let pending = false;
  let finished = false;
  let retry = false;
  const candidate = () => {
    const selected = document.querySelector('.native-documents select');
    const article = document.querySelector('article.md-root');
    const option = selected?.selectedOptions[0];
    if (!article || !article.isConnected || !selected?.value ||
        option?.textContent !== readinessConfig.target ||
        article.querySelector('h1')?.textContent !== readinessConfig.heading ||
        article.querySelector('p')?.textContent !== readinessConfig.body ||
        document.visibilityState !== 'visible' || document.querySelector('[role="dialog"]')) return null;
    const bounds = article.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return { article, id: selected.value };
  };
  const attempt = async () => {
    if (pending || finished) return;
    const before = candidate();
    if (!before) return;
    pending = true;
    try {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = candidate();
      if (!after || before.article !== after.article || before.id !== after.id) return;
      await window.__TAURI__.core.invoke('report_readiness', {
        nonce: readinessConfig.nonce, sessionId: after.id,
      });
      finished = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', observe);
    } finally {
      pending = false;
      if (retry && !finished) {
        retry = false;
        observe();
      }
    }
  };
  const observe = () => {
    if (pending) { retry = true; return; }
    void attempt().catch(() => {});
  };
  const observer = new MutationObserver(observe);
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
  document.addEventListener('visibilitychange', observe);
  observe();
})();
