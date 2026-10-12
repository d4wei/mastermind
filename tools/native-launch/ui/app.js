async function refresh() {
  try {
    const state = await window.__TAURI__.core.invoke('snapshot');
    document.querySelector('#status').textContent = `Host ${state.pid}: ${state.files.length} documents accepted`;
    document.querySelector('#files').replaceChildren(...state.files.map(path => {
      const item = document.createElement('li');
      item.textContent = path;
      return item;
    }));
  } catch (error) {
    document.querySelector('#status').textContent = String(error);
  }
}
refresh();
setInterval(refresh, 500);
