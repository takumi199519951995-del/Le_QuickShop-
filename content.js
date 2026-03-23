/**
 * Le Marchand
 * - 利益の自動計算・Yahoo商品カードの色分け表示
 * - ASIN不明の商品はグレーアウトする
 *
 * Yahoo Shopping の要素クラスは末尾にランダムな英数字が付くため、
 * 部分一致セレクタ(^= や *= )で対応する
 */

(function () {
  'use strict';

  // ===== 定数 =====
  const SCAN_INTERVAL_MS = 2000;       // DOM監視の間隔
  const PROCESSED_ATTR = 'data-qse-processed'; // 処理済みマーカー
  const LOGGED_ATTR = 'data-qse-logged'; // ログ出力済みマーカー

  // ===== ユーザー設定 =====
  const SETTING_DEFAULTS = {
    unknownDisplay: 'gray',
    deficitDisplay: 'colored',
    feeErrorDisplay: 'warning'
  };
  let settings = { ...SETTING_DEFAULTS };

  // ===== ユーティリティ =====

  /**
   * クラス名が部分一致する要素を親要素内から探す
   * Yahoo Shoppingのクラスは "SearchResultItem__mJ7vY" のように末尾がランダム
   * prefix部分(例: "SearchResultItem__")で前方一致検索する
   */
  function querySelectorByClassPrefix(parent, tagOrWild, classPrefix) {
    return parent.querySelectorAll(
      `${tagOrWild}[class*="${classPrefix}"]`
    );
  }

  /**
   * 数値文字列をパースする（カンマ除去対応）
   */
  function parseNumber(str) {
    if (!str) return NaN;
    return parseFloat(str.replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  }

  /**
   * 各商品アイテムの親要素(SearchResultItem)を取得
   * クラス名末尾がランダムなので部分一致で探す
   */
  function getSearchResultItems() {
    // SearchResult_SearchResultItem__ で始まるクラスを持つdiv（ただし子要素は除外）
    return document.querySelectorAll('div[class*="SearchResult_SearchResultItem__"]:not([class*="SearchResult_SearchResultItem__image"]):not([class*="SearchResult_SearchResultItem__contents"]):not([class*="SearchResult_SearchResultItem__price"]):not([class*="SearchResult_SearchResultItem__detail"]):not([class*="SearchResult_SearchResultItem__quick"]):not([class*="SearchResult_SearchResultItem__point"]):not([class*="SearchResult_SearchResultItem__review"]):not([class*="SearchResult_SearchResultItem__store"]):not([class*="SearchResult_SearchResultItem__button"]):not([class*="SearchResult_SearchResultItem__cheapest"]):not([class*="SearchResult_SearchResultItem__storeBadges"])');
  }

  /**
   * qsp-containerからデータを抽出する
   */
  function extractQspData(qspContainer) {
    const data = {};

    // ASIN
    const asinEl = qspContainer.querySelector('.qsp-asin');
    data.asin = asinEl ? asinEl.textContent.trim() : '不明';

    // ランキング
    const rankingEl = qspContainer.querySelector('.qsp-ranking');
    data.ranking = rankingEl ? rankingEl.textContent.trim() : '不明';

    // サイズ
    const sizeEl = qspContainer.querySelector('.qsp-size');
    data.size = sizeEl ? sizeEl.textContent.trim() : '不明';

    // 重量
    const weightEl = qspContainer.querySelector('.qsp-weight');
    data.weight = weightEl ? weightEl.textContent.trim() : '不明';

    // 出品者数
    const sellerCntEl = qspContainer.querySelector('.qsp-new-seller-cnt');
    data.sellerCnt = sellerCntEl ? sellerCntEl.textContent.trim() : '不明';

    // 粗利益(P込)の金額
    const profitWithPEl = qspContainer.querySelector('.qsp-profit-yen-with-p');
    data.profitWithP = profitWithPEl ? parseNumber(profitWithPEl.textContent) : NaN;

    // 粗利益(現金)の金額
    const profitYenEl = qspContainer.querySelector('.qsp-profit-yen');
    data.profitYen = profitYenEl ? parseNumber(profitYenEl.textContent) : NaN;

    // ROI(P込)
    const roiWithPEl = qspContainer.querySelector('.qsp-roi-rate-with-p');
    data.roiWithP = roiWithPEl ? parseNumber(roiWithPEl.textContent) : NaN;

    // 仕入価格（inputフィールド）
    const itemPriceEl = qspContainer.querySelector('.qsp-item-price');
    data.itemPrice = itemPriceEl ? parseNumber(itemPriceEl.value) : NaN;

    // Amazon最安値（inputフィールド）
    const amazonPriceEl = qspContainer.querySelector('.qsp-amazon-price');
    data.amazonPrice = amazonPriceEl ? parseNumber(amazonPriceEl.value) : NaN;

    return data;
  }

  /**
   * 検索結果アイテムから仕入れ価格（Yahoo側の表示価格）を取得
   * ItemPrice_ItemPrice__ で始まるクラスの span から取得
   */
  function getYahooPrice(resultItem) {
    // ItemPrice_ItemPrice__ を含む span（ただし unit は除外）
    const priceEls = resultItem.querySelectorAll('span[class*="ItemPrice_ItemPrice__"]:not([class*="unit"])');
    for (const el of priceEls) {
      // 子要素のテキストを除外して、直接のテキストノードから数値を取る
      const text = el.textContent.replace(/円/g, '').trim();
      const num = parseNumber(text);
      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
    return NaN;
  }

  /**
   * PayPayポイント倍率を取得
   * ItemPointModal_SearchResultItemPointModal__paypay__ を含む span
   */
  function getPaypayRate(resultItem) {
    const paypayEls = resultItem.querySelectorAll('span[class*="ItemPointModal_SearchResultItemPointModal__paypay"]');
    for (const el of paypayEls) {
      const text = el.textContent.trim();
      const match = text.match(/([\d.]+)/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    return 0;
  }

  /**
   * クーポン割引額を取得
   * ItemCoupon_SearchResultItemCoupon__ を含む要素から "X,XXX円OFF" を抽出
   */
  function getCouponDiscount(resultItem) {
    // data-coupon-beacon属性を持つspanから直接取得（SVG干渉を回避）
    const beaconEls = resultItem.querySelectorAll('span[data-coupon-beacon]');
    for (const el of beaconEls) {
      const text = el.textContent.trim();
      const match = text.match(/([\d,]+)円OFF/);
      if (match) {
        return parseNumber(match[1]);
      }
    }
    // フォールバック: クラス名で探す
    const couponEls = resultItem.querySelectorAll('[class*="ItemCoupon_SearchResultItemCoupon__"]');
    for (const el of couponEls) {
      const text = el.textContent.trim();
      const match = text.match(/([\d,]+)円OFF/);
      if (match) {
        return parseNumber(match[1]);
      }
    }
    return 0;
  }

  /**
   * 商品が「不明」かどうかを判定
   * ASIN が不明 かつ ランキングも不明 → Amazon上に情報なし
   */
  function isUnknownProduct(data) {
    return !data.asin || data.asin === '不明' || data.asin === '-' || data.asin === '';
  }

  /**
   * 手数料エラー（サイズ不明でFBA手数料が不正確）かどうかを判定
   * QuickShopが .tooltip-fee 内に fa-exclamation-circle.red-color を表示する
   */
  function hasFeeError(qspContainer) {
    const feeIcon = qspContainer.querySelector('.tooltip-fee .fa-exclamation-circle.red-color');
    return !!feeIcon;
  }

  /**
   * まだ読み込み中かどうか
   */
  function isLoading(data) {
    return data.asin === '読込中...';
  }

  /**
   * 調整後利益（PayPay＋クーポン込み）を計算する
   * 返り値: { profitVal, profitRate } or null
   */
  function calcAdjustedProfit(data, yahooPrice, paypayRate, couponDiscount) {
    const costPrice = (!isNaN(data.itemPrice) && data.itemPrice > 0)
      ? data.itemPrice
      : yahooPrice;

    if (isNaN(data.amazonPrice) || data.amazonPrice <= 0) return null;
    if (isNaN(costPrice) || costPrice <= 0) return null;

    let profitVal = data.profitWithP;
    if (isNaN(profitVal)) {
      profitVal = !isNaN(data.profitYen) ? data.profitYen : NaN;
    }
    if (isNaN(profitVal)) return null;

    // クーポン適用後の価格にポイント倍率をかける
    const priceAfterCoupon = couponDiscount > 0 ? costPrice - couponDiscount : costPrice;
    if (paypayRate > 0 && !isNaN(priceAfterCoupon)) {
      profitVal += priceAfterCoupon * (paypayRate / 100);
    }
    if (couponDiscount > 0) {
      profitVal += couponDiscount;
    }

    const profitRate = profitVal / data.amazonPrice;
    return { profitVal: Math.round(profitVal), profitRate };
  }

  function getColorByProfit(data, yahooPrice, paypayRate, couponDiscount) {
    const result = calcAdjustedProfit(data, yahooPrice, paypayRate, couponDiscount);
    if (!result) return null;

    const profitRate = result.profitRate;

    // 色グラデーション（利益率ベース・見やすい配色）
    if (profitRate >= 0.30) {
      return { bg: 'rgba(13, 148, 136, 0.22)', border: 'rgba(13, 148, 136, 0.6)' };
    } else if (profitRate >= 0.20) {
      return { bg: 'rgba(20, 184, 166, 0.18)', border: 'rgba(20, 184, 166, 0.55)' };
    } else if (profitRate >= 0.10) {
      return { bg: 'rgba(34, 197, 94, 0.16)', border: 'rgba(34, 197, 94, 0.50)' };
    } else if (profitRate >= 0.05) {
      return { bg: 'rgba(134, 239, 172, 0.18)', border: 'rgba(74, 222, 128, 0.45)' };
    } else if (profitRate >= 0) {
      return { bg: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.40)' };
    } else if (profitRate >= -0.10) {
      return { bg: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.40)' };
    } else {
      return { bg: 'rgba(220, 38, 38, 0.18)', border: 'rgba(220, 38, 38, 0.50)' };
    }
  }

  // 全スタイルクラスをリセットする
  const ALL_STYLE_CLASSES = ['qse-item-colored', 'qse-item-unknown', 'qse-item-blackout', 'qse-item-hidden', 'qse-item-fee-error'];

  function clearItemStyles(resultItem) {
    resultItem.classList.remove(...ALL_STYLE_CLASSES);
    resultItem.style.removeProperty('--qse-bg-color');
    resultItem.style.removeProperty('--qse-border-color');
  }

  /**
   * 表示モードに応じたクラスを適用する
   * @returns {boolean} true=表示される / false=非表示またはブラックアウト
   */
  function applyDisplayMode(resultItem, mode, defaultClass) {
    switch (mode) {
      case 'hidden':
        resultItem.classList.add('qse-item-hidden');
        return false;
      case 'blackout':
        resultItem.classList.add('qse-item-blackout');
        return false;
      default:
        if (defaultClass) resultItem.classList.add(defaultClass);
        return true;
    }
  }

  /**
   * Yahoo側の商品カード（SearchResultItem）にスタイルを適用する
   */
  function applyStyles(resultItem, color, isUnknown, isFeeError, adjustedProfit, asin) {
    if (!resultItem) return;

    clearItemStyles(resultItem);

    // 手数料エラー商品（unknownより優先度低い）
    if (isFeeError && !isUnknown) {
      const mode = settings.feeErrorDisplay;
      if (mode === 'normal') {
        // 通常表示 → 利益色分けもそのまま適用
      } else {
        applyDisplayMode(resultItem, mode, 'qse-item-fee-error');
        updateProfitBadge(resultItem, mode !== 'hidden' && mode !== 'blackout' ? adjustedProfit : null);
        updateKeepaGraph(resultItem, mode !== 'hidden' && mode !== 'blackout' ? asin : null);
        return;
      }
    }

    // 不明商品の処理
    if (isUnknown) {
      const mode = settings.unknownDisplay;
      if (mode === 'normal') {
        // 通常表示: 何もしない
      } else if (mode === 'gray') {
        resultItem.classList.add('qse-item-unknown');
      } else {
        applyDisplayMode(resultItem, mode, null);
      }
      updateProfitBadge(resultItem, null);
      updateKeepaGraph(resultItem, null);
      return;
    }

    // 赤字商品の処理
    if (adjustedProfit && adjustedProfit.profitVal < 0) {
      const mode = settings.deficitDisplay;
      if (mode === 'hidden' || mode === 'blackout') {
        applyDisplayMode(resultItem, mode, null);
        updateProfitBadge(resultItem, null);
        updateKeepaGraph(resultItem, null);
        return;
      }
      if (mode === 'normal') {
        // 色分けなし
      } else {
        // colored: 赤系色を適用
        if (color) {
          resultItem.style.setProperty('--qse-bg-color', color.bg);
          resultItem.style.setProperty('--qse-border-color', color.border);
          resultItem.classList.add('qse-item-colored');
        }
      }
    } else if (color) {
      // 黒字商品: 常に色分け
      resultItem.style.setProperty('--qse-bg-color', color.bg);
      resultItem.style.setProperty('--qse-border-color', color.border);
      resultItem.classList.add('qse-item-colored');
    }

    updateProfitBadge(resultItem, adjustedProfit);
    updateKeepaGraph(resultItem, asin);
  }

  /**
   * Yahoo商品カード上に調整後利益バッジを表示/更新する
   */
  function updateProfitBadge(resultItem, adjustedProfit) {
    let badge = resultItem.querySelector('.qse-profit-badge');

    if (!adjustedProfit) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'qse-profit-badge';
      // レビュー（星）の後ろに挿入
      const reviewEl = resultItem.querySelector('[class*="ItemReview_SearchResultItemReview__"]');
      if (reviewEl) {
        reviewEl.parentNode.insertBefore(badge, reviewEl.nextSibling);
      } else {
        // フォールバック: バッジエリアの後ろ
        const badgesEl = resultItem.querySelector('[class*="ItemBadges_SearchResultItemBadges__"]');
        if (badgesEl) {
          badgesEl.parentNode.insertBefore(badge, badgesEl.nextSibling);
        } else {
          const contentsEl = resultItem.querySelector('[class*="SearchResult_SearchResultItem__contents"]');
          if (contentsEl) {
            contentsEl.appendChild(badge);
          }
        }
      }
    }

    const val = adjustedProfit.profitVal;
    const rate = (adjustedProfit.profitRate * 100).toFixed(1);
    const sign = val >= 0 ? '+' : '';
    const colorClass = val >= 0 ? 'qse-profit-plus' : 'qse-profit-minus';

    badge.className = 'qse-profit-badge ' + colorClass;
    badge.textContent = sign + val.toLocaleString() + '\u5186 (' + sign + rate + '%)';
  }

  /**
   * Keepaグラフを利益バッジの下に表示/更新する
   */
  function updateKeepaGraph(resultItem, asin) {
    let graph = resultItem.querySelector('.qse-keepa-graph');

    if (!asin || asin === '不明' || asin === '-' || asin === '') {
      if (graph) graph.remove();
      return;
    }

    if (!graph) {
      graph = document.createElement('div');
      graph.className = 'qse-keepa-graph';

      const img = document.createElement('img');
      img.className = 'qse-keepa-img';
      img.loading = 'lazy';
      img.alt = 'Keepa';
      graph.appendChild(img);

      // 利益バッジの後ろに挿入
      const badge = resultItem.querySelector('.qse-profit-badge');
      if (badge) {
        badge.parentNode.insertBefore(graph, badge.nextSibling);
      } else {
        // バッジがない場合、レビューの後ろ
        const reviewEl = resultItem.querySelector('[class*="ItemReview_SearchResultItemReview__"]');
        if (reviewEl) {
          reviewEl.parentNode.insertBefore(graph, reviewEl.nextSibling);
        } else {
          const contentsEl = resultItem.querySelector('[class*="SearchResult_SearchResultItem__contents"]');
          if (contentsEl) {
            contentsEl.appendChild(graph);
          }
        }
      }
    }

    const img = graph.querySelector('.qse-keepa-img');
    const expectedSrc = 'https://graph.keepa.com/pricehistory.png?asin=' + asin + '&domain=co.jp&salesrank=1&range=90&width=500&height=160';
    if (img.src !== expectedSrc) {
      img.src = expectedSrc;
    }
  }

  /**
   * 全アイテムをスキャンして色分けする
   */
  function scanAndColorize() {
    const qspContainers = document.querySelectorAll('.qsp-container');

    qspContainers.forEach((qspContainer) => {
      // 処理済みチェック（ただし値の変更に対応するため、定期的に再チェック）
      const lastProcessed = qspContainer.getAttribute(PROCESSED_ATTR);
      const now = Date.now();
      if (lastProcessed && (now - parseInt(lastProcessed)) < 5000) {
        return; // 5秒以内に処理済みならスキップ
      }

      // qsp-containerから商品データを抽出
      const data = extractQspData(qspContainer);

      // 読込中の場合はスキップ（次回スキャンで再処理）
      if (isLoading(data)) {
        return;
      }

      // 親の検索結果アイテム（トップレベル）を探す
      // SearchResult_SearchResultItem__mJ7vY のような形式（サブクラス__image__, __contents__等を除外）
      let resultItem = null;
      let el = qspContainer.parentElement;
      while (el && el !== document.body) {
        if (el.tagName === 'DIV' && el.className) {
          // SearchResult_SearchResultItem__XXXXX の形式で、
          // __(image|contents|price|detail|quick|point|review|store|button|cheapest|storeBadges|coupon|quickView)__ を含まないもの
          const classes = el.className.split(/\s+/);
          const isTopLevel = classes.some(cls =>
            cls.startsWith('SearchResult_SearchResultItem__') &&
            !/__(?:image|contents|price|detail|quick|point|review|store|button|cheapest|storeBadges|coupon|quickView)__/.test(cls)
          );
          if (isTopLevel) {
            resultItem = el;
            break;
          }
        }
        el = el.parentElement;
      }
      if (!resultItem) {
        // フォールバック: 直接の親を辿る
        resultItem = qspContainer.parentElement;
      }

      const yahooPrice = resultItem ? getYahooPrice(resultItem) : NaN;
      const paypayRate = resultItem ? getPaypayRate(resultItem) : 0;
      const couponDiscount = resultItem ? getCouponDiscount(resultItem) : 0;

      // デバッグログ（未ログの商品のみ）
      if (!qspContainer.hasAttribute(LOGGED_ATTR)) {
        qspContainer.setAttribute(LOGGED_ATTR, '1');
        console.log('[QSE]', data.asin,
          'paypay=' + paypayRate,
          'coupon=' + couponDiscount,
          'profitP=' + data.profitWithP,
          'cost=' + data.itemPrice,
          'ama=' + data.amazonPrice,
          'yahoo=' + yahooPrice
        );
      }

      // 仕入れ価格が空の場合、Yahoo表示価格を自動入力する
      const itemPriceInput = qspContainer.querySelector('.qsp-item-price');
      if (itemPriceInput && !itemPriceInput.value && !isNaN(yahooPrice) && yahooPrice > 0) {
        itemPriceInput.value = yahooPrice;
        // QuickShopに変更を通知
        itemPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
        itemPriceInput.dispatchEvent(new Event('change', { bubbles: true }));
        // 値を入れた直後なので少し待ってからスタイル適用
        qspContainer.removeAttribute(PROCESSED_ATTR);
        setTimeout(() => scanAndColorize(), 600);
        return;
      }

      // 不明商品・手数料エラーの判定
      const unknown = isUnknownProduct(data);
      const feeError = hasFeeError(qspContainer);

      if (unknown) {
        applyStyles(resultItem, null, true, false, null, null);
      } else {
        const color = getColorByProfit(data, yahooPrice, paypayRate, couponDiscount);
        const adjusted = calcAdjustedProfit(data, yahooPrice, paypayRate, couponDiscount);
        applyStyles(resultItem, color, false, feeError, adjusted, data.asin);
      }

      qspContainer.setAttribute(PROCESSED_ATTR, now.toString());
    });
  }

  /**
   * input変更を監視して再計算する
   */
  function watchInputChanges() {
    document.addEventListener('input', (e) => {
      const target = e.target;
      if (
        target.classList.contains('qsp-amazon-price') ||
        target.classList.contains('qsp-item-price') ||
        target.classList.contains('qsp-coupon-value') ||
        target.classList.contains('qsp-addtional-point-rate') ||
        target.classList.contains('qsp-purchase-count') ||
        target.classList.contains('qsp-ama-count') ||
        target.classList.contains('qsp-shipping')
      ) {
        // 該当のqsp-containerの処理済みマーカーをリセット
        const container = target.closest('.qsp-container');
        if (container) {
          container.removeAttribute(PROCESSED_ATTR);
        }
        // 少し遅延させて再計算（QuickShopが先に計算を終えるのを待つ）
        setTimeout(scanAndColorize, 500);
      }
    }, true);

    // タブ切り替え（FBA/出品者出荷）も監視
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('tab-item')) {
        const container = target.closest('.qsp-container');
        if (container) {
          container.removeAttribute(PROCESSED_ATTR);
        }
        setTimeout(scanAndColorize, 500);
      }
    }, true);
  }

  /**
   * MutationObserverでDOM変更を監視
   */
  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              // qsp-containerが追加された場合、またはqsp-containerを含む要素が追加された場合
              if (node.classList && node.classList.contains('qsp-container')) {
                shouldScan = true;
                break;
              }
              if (node.querySelector && node.querySelector('.qsp-container')) {
                shouldScan = true;
                break;
              }
            }
          }
        }
        // 属性やテキスト変更の場合
        if (mutation.type === 'characterData' || mutation.type === 'attributes') {
          const target = mutation.target;
          const container = target.nodeType === 1
            ? target.closest('.qsp-container')
            : target.parentElement && target.parentElement.closest('.qsp-container');
          if (container) {
            container.removeAttribute(PROCESSED_ATTR);
            shouldScan = true;
          }
        }
      }
      if (shouldScan) {
        // デバウンス
        clearTimeout(observeDOM._timer);
        observeDOM._timer = setTimeout(scanAndColorize, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['value', 'class']
    });
  }

  // ===== 設定の読み込み =====
  function loadSettings(callback) {
    chrome.storage.sync.get(SETTING_DEFAULTS, (items) => {
      settings = items;
      if (callback) callback();
    });
  }

  function resetAllProcessed() {
    document.querySelectorAll('.qsp-container[data-qse-processed]').forEach((el) => {
      el.removeAttribute(PROCESSED_ATTR);
    });
  }

  // ===== 初期化 =====
  function init() {
    // 設定を読み込んでからスキャン開始
    loadSettings(() => {
      // 初回スキャン（QuickShopの読み込みを待つ）
      setTimeout(scanAndColorize, 1500);

      // 定期スキャン
      setInterval(scanAndColorize, SCAN_INTERVAL_MS);

      // input変更監視
      watchInputChanges();

      // DOM変更監視
      observeDOM();

      console.log('[Le Marchand] Initialized');
    });

    // 設定変更のリアルタイム反映
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(changes)) {
        if (key in SETTING_DEFAULTS) {
          settings[key] = changes[key].newValue;
        }
      }
      // 全商品を再処理
      resetAllProcessed();
      scanAndColorize();
    });
  }

  // ページ読み込み完了後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
