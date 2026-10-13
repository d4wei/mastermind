const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const script = fs.readFileSync(`${__dirname}/src/readiness.js`, 'utf8');

function harness(initial = {}) {
  const config = { nonce: 'nonce', target: '/fixture.md', heading: 'Heading', body: 'Body' };
  const frames = [];
  const calls = [];
  let observe;
  let releaseFonts;
  let dialog = null;
  const selected = { value: '0', selectedOptions: [{ textContent: config.target }] };
  let article = {
    isConnected: true,
    querySelector: (selector) => ({ textContent: selector === 'h1' ? config.heading : config.body }),
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
  };
  const document = {
    visibilityState: 'visible',
    fonts: { ready: new Promise((resolve) => { releaseFonts = resolve; }) },
    querySelector: (selector) => selector === '.native-documents select' ? selected :
      selector === 'article.md-root' ? article : dialog,
    addEventListener() {}, removeEventListener() {},
  };
  if (initial.loading || initial.source) article = null;
  if (initial.hidden) document.visibilityState = 'hidden';
  if (initial.zero) article.getBoundingClientRect = () => ({ width: 0, height: 100 });
  if (initial.mismatch) article.querySelector = () => ({ textContent: 'wrong content' });
  const window = { __TAURI__: { core: { invoke: async (...args) => { calls.push(args); } } } };
  window.top = window;
  vm.runInNewContext(script, {
    readinessConfig: config, window, document, location: { pathname: '/native.html' },
    requestAnimationFrame: (callback) => frames.push(callback),
    MutationObserver: class {
      constructor(callback) { observe = callback; }
      observe() {} disconnect() {}
    },
  });
  return { config, selected, document, frames, calls, releaseFonts,
    observe: () => observe(), setDialog: (value) => { dialog = value; },
    replaceArticle: () => { article = { ...article }; observe(); } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function frames(h) {
  await flush();
  assert.equal(h.frames.length, 1);
  h.frames.shift()();
  assert.equal(h.calls.length, 0);
  h.frames.shift()();
  await flush();
}

test('signal waits for fonts and two frames, then emits only once', async () => {
  const h = harness();
  await flush();
  assert.equal(h.frames.length, 0);
  assert.equal(h.calls.length, 0);
  h.releaseFonts();
  await frames(h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'report_readiness');
  assert.equal(h.calls[0][1].sessionId, '0');
  h.observe();
  await flush();
  assert.equal(h.calls.length, 1);
});

test('changed target and dialogs cannot report readiness', async () => {
  const h = harness();
  h.selected.selectedOptions[0].textContent = '/other.md';
  h.releaseFonts();
  await frames(h);
  assert.equal(h.calls.length, 0);
  h.selected.selectedOptions[0].textContent = h.config.target;
  h.setDialog({});
  h.observe();
  await flush();
  assert.equal(h.frames.length, 0);
  h.setDialog(null);
  h.observe();
  await frames(h);
  assert.equal(h.calls.length, 1);
});


test('source, loading, mismatched content, hidden and zero geometry cannot signal', async () => {
  for (const mode of ['source', 'loading', 'mismatch', 'hidden', 'zero']) {
    const h = harness({ [mode]: true });
    h.releaseFonts();
    h.observe();
    await flush();
    assert.equal(h.frames.length, 0, mode);
    assert.equal(h.calls.length, 0, mode);
  }
});

test('replacement during fonts or frames queues a retry without another mutation', async () => {
  for (const stage of ['fonts', 'first frame', 'second frame']) {
    const h = harness();
    if (stage !== 'fonts') {
      h.releaseFonts();
      await flush();
      if (stage === 'second frame') h.frames.shift()();
    }
    h.replaceArticle();
    h.releaseFonts();
    await flush();
    h.frames.shift()();
    if (stage !== 'second frame') h.frames.shift()();
    await flush();
    assert.equal(h.calls.length, 0, stage);
    assert.equal(h.frames.length, 1, stage);
    await frames(h);
    assert.equal(h.calls.length, 1, stage);
  }
});
