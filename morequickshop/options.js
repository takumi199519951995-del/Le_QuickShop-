const DEFAULTS = {
  unknownDisplay: 'gray',
  deficitDisplay: 'colored',
  feeErrorDisplay: 'warning',
  spClientId: '',
  spClientSecret: '',
  spRefreshToken: '',
  spSellerId: ''
};

document.addEventListener('DOMContentLoaded', () => {
  const unknownEl = document.getElementById('unknownDisplay');
  const deficitEl = document.getElementById('deficitDisplay');
  const feeErrorEl = document.getElementById('feeErrorDisplay');
  const spClientIdEl = document.getElementById('spClientId');
  const spClientSecretEl = document.getElementById('spClientSecret');
  const spRefreshTokenEl = document.getElementById('spRefreshToken');
  const spSellerIdEl = document.getElementById('spSellerId');
  const savedMsg = document.getElementById('savedMsg');

  // 現在の設定を読み込み
  chrome.storage.sync.get(DEFAULTS, (items) => {
    unknownEl.value = items.unknownDisplay;
    deficitEl.value = items.deficitDisplay;
    feeErrorEl.value = items.feeErrorDisplay;
    spClientIdEl.value = items.spClientId || '';
    spClientSecretEl.value = items.spClientSecret || '';
    spRefreshTokenEl.value = items.spRefreshToken || '';
    spSellerIdEl.value = items.spSellerId || '';
  });

  function save() {
    chrome.storage.sync.set({
      unknownDisplay: unknownEl.value,
      deficitDisplay: deficitEl.value,
      feeErrorDisplay: feeErrorEl.value,
      spClientId: spClientIdEl.value.trim(),
      spClientSecret: spClientSecretEl.value.trim(),
      spRefreshToken: spRefreshTokenEl.value.trim(),
      spSellerId: spSellerIdEl.value.trim()
    }, () => {
      savedMsg.classList.add('show');
      setTimeout(() => savedMsg.classList.remove('show'), 1500);
    });
  }

  unknownEl.addEventListener('change', save);
  deficitEl.addEventListener('change', save);
  feeErrorEl.addEventListener('change', save);
  spClientIdEl.addEventListener('change', save);
  spClientSecretEl.addEventListener('change', save);
  spRefreshTokenEl.addEventListener('change', save);
  spSellerIdEl.addEventListener('change', save);
});
