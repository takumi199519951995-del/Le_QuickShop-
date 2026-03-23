const DEFAULTS = {
  unknownDisplay: 'gray',
  deficitDisplay: 'colored',
  feeErrorDisplay: 'warning'
};

document.addEventListener('DOMContentLoaded', () => {
  const unknownEl = document.getElementById('unknownDisplay');
  const deficitEl = document.getElementById('deficitDisplay');
  const feeErrorEl = document.getElementById('feeErrorDisplay');
  const savedMsg = document.getElementById('savedMsg');

  // 現在の設定を読み込み
  chrome.storage.sync.get(DEFAULTS, (items) => {
    unknownEl.value = items.unknownDisplay;
    deficitEl.value = items.deficitDisplay;
    feeErrorEl.value = items.feeErrorDisplay;
  });

  function save() {
    chrome.storage.sync.set({
      unknownDisplay: unknownEl.value,
      deficitDisplay: deficitEl.value,
      feeErrorDisplay: feeErrorEl.value
    }, () => {
      savedMsg.classList.add('show');
      setTimeout(() => savedMsg.classList.remove('show'), 1500);
    });
  }

  unknownEl.addEventListener('change', save);
  deficitEl.addEventListener('change', save);
  feeErrorEl.addEventListener('change', save);
});
