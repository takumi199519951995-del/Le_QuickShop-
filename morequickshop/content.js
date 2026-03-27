/**
 * Le Marchand
 * - 利益の自動計算・Yahoo商品カードの色分け表示
 * - ASIN不明の商品はグレーアウトする
 * - Googleスプレッドシートへの転記機能
 *
 * Yahoo Shopping の要素クラスは末尾にランダムな英数字が付くため、
 * 部分一致セレクタ(^= や *= )で対応する
 */

(function () {
  'use strict';

  // ===== 定数 =====
  const SCAN_INTERVAL_MS = 2000;
  const PROCESSED_ATTR = 'data-qse-processed';
  const LOGGED_ATTR = 'data-qse-logged';

  // ===== スプレッドシート設定 =====
  const SPREADSHEET_ID = '1pdfvNqtR-1iUh27OarBRLlHffx1NahkNGWoPOV4L1bQ';
  const SHEET_NAME = 'シート1';

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
   */
  function getSearchResultItems() {
    return document.querySelectorAll('div[class*="SearchResult_SearchResultItem__"]:not([class*="SearchResult_SearchResultItem__image"]):not([class*="SearchResult_SearchResultItem__contents"]):not([class*="SearchResult_SearchResultItem__price"]):not([class*="SearchResult_SearchResultItem__detail"]):not([class*="SearchResult_SearchResultItem__quick"]):not([class*="SearchResult_SearchResultItem__point"]):not([class*="SearchResult_SearchResultItem__review"]):not([class*="SearchResult_SearchResultItem__store"]):not([class*="SearchResult_SearchResultItem__button"]):not([class*="SearchResult_SearchResultItem__cheapest"]):not([class*="SearchResult_SearchResultItem__storeBadges"])');
  }

  /**
   * qsp-containerからデータを抽出する
   */
  function extractQspData(qspContainer) {
    const data = {};

    const asinEl = qspContainer.querySelector('.qsp-asin');
    data.asin = asinEl ? asinEl.textContent.trim() : '不明';

    const rankingEl = qspContainer.querySelector('.qsp-ranking');
    data.ranking = rankingEl ? rankingEl.textContent.trim() : '不明';

    const sizeEl = qspContainer.querySelector('.qsp-size');
    data.size = sizeEl ? sizeEl.textContent.trim() : '不明';

    const weightEl = qspContainer.querySelector('.qsp-weight');
    data.weight = weightEl ? weightEl.textContent.trim() : '不明';

    const sellerCntEl = qspContainer.querySelector('.qsp-new-seller-cnt');
    data.sellerCnt = sellerCntEl ? sellerCntEl.textContent.trim() : '不明';

    const profitWithPEl = qspContainer.querySelector('.qsp-profit-yen-with-p');
    data.profitWithP = profitWithPEl ? parseNumber(profitWithPEl.textContent) : NaN;

    const profitYenEl = qspContainer.querySelector('.qsp-profit-yen');
    data.profitYen = profitYenEl ? parseNumber(profitYenEl.textContent) : NaN;

    const roiWithPEl = qspContainer.querySelector('.qsp-roi-rate-with-p');
    data.roiWithP = roiWithPEl ? parseNumber(roiWithPEl.textContent) : NaN;

    const itemPriceEl = qspContainer.querySelector('.qsp-item-price');
    data.itemPrice = itemPriceEl ? parseNumber(itemPriceEl.value) : NaN;

    const amazonPriceEl = qspContainer.querySelector('.qsp-amazon-price');
    data.amazonPrice = amazonPriceEl ? parseNumber(amazonPriceEl.value) : NaN;

    return data;
  }

  /**
   * 検索結果アイテムから仕入れ価格（Yahoo側の表示価格）を取得
   */
  function getYahooPrice(resultItem) {
    const priceEls = resultItem.querySelectorAll('span[class*="ItemPrice_ItemPrice__"]:not([class*="unit"])');
    for (const el of priceEls) {
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
   */
  function getPaypayRate(resultItem) {
    // XPathベース: button > p > span:first-child > span:nth-child(2)
    const paypayEl = resultItem.querySelector('button > p > span:first-child > span:nth-child(2)');
    if (paypayEl) {
      const text = paypayEl.textContent.trim();
      const match = text.match(/([\d.]+)/);
      if (match) return parseFloat(match[1]);
    }
    // フォールバック: クラス名で探す
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
   */
  function getCouponDiscount(resultItem) {
    const beaconEls = resultItem.querySelectorAll('span[data-coupon-beacon]');
    for (const el of beaconEls) {
      const text = el.textContent.trim();
      const match = text.match(/([\d,]+)円OFF/);
      if (match) {
        return parseNumber(match[1]);
      }
    }
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
   */
  function isUnknownProduct(data) {
    return !data.asin || data.asin === '不明' || data.asin === '-' || data.asin === '';
  }

  /**
   * 手数料エラーかどうかを判定
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

  /**
   * サイズ区分を判定する
   */
  function judgeSizeCategory(sizeStr, weightStr) {
    const sizeMatch = sizeStr && sizeStr.match(/([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
    if (!sizeMatch) return '不明';

    const dims = [
      parseFloat(sizeMatch[1]),
      parseFloat(sizeMatch[2]),
      parseFloat(sizeMatch[3])
    ].sort(function(a, b) { return b - a; });

    const weightMatch = weightStr && weightStr.match(/([\d.]+)/);
    const weight = weightMatch ? parseFloat(weightMatch[1]) : NaN;
    const weightKg = weightStr && weightStr.indexOf('kg') === -1 && weightStr.indexOf('g') !== -1
      ? weight / 1000
      : weight;

    const isStandardSize = dims[0] <= 45 && dims[1] <= 35 && dims[2] <= 20;
    const isStandardWeight = isNaN(weightKg) || weightKg < 9;

    if (isStandardSize && isStandardWeight) return '標準';
    return '大型';
  }

  /**
   * サイズ区分バッジを商品カードに表示する
   */
  function updateSizeBadge(resultItem, sizeStr, weightStr) {
    let badge = resultItem.querySelector('.qse-size-badge');

    if (!sizeStr || sizeStr === '不明') {
      if (badge) badge.remove();
      return;
    }

    const category = judgeSizeCategory(sizeStr, weightStr);

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'qse-size-badge';

      // 商品画像エリアの右上に表示
      const imageEl = resultItem.querySelector('[class*="SearchResult_SearchResultItem__image"]');
      if (imageEl) {
        imageEl.style.position = 'relative';
        imageEl.appendChild(badge);
      } else {
        const contentsEl = resultItem.querySelector('[class*="SearchResult_SearchResultItem__contents"]');
        if (contentsEl) contentsEl.appendChild(badge);
      }
    }

    badge.textContent = '📦 ' + category;
    badge.className = 'qse-size-badge ' + (category === '標準' ? 'qse-size-standard' : 'qse-size-large');
  }

  /**
   * 出品制限バッジを商品画像に表示する
   */
  function updateRestrictionBadge(resultItem, restricted) {
    let badge = resultItem.querySelector('.qse-restriction-badge');

    // nullは未確認状態なので表示しない
    if (restricted === null || restricted === undefined) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'qse-restriction-badge';

      // 画像エリアの右上・サイズバッジの下に表示
      const imageEl = resultItem.querySelector('[class*="SearchResult_SearchResultItem__image"]');
      if (imageEl) {
        imageEl.style.position = 'relative';
        imageEl.appendChild(badge);
      }
    }

    if (restricted) {
      badge.textContent = '🚫 制限あり';
      badge.className = 'qse-restriction-badge qse-restriction-yes';
    } else {
      badge.textContent = '✅ 制限なし';
      badge.className = 'qse-restriction-badge qse-restriction-no';
    }
  }

  /**
   * 出品制限をチェックしてバッジを更新する
   */
  function checkAndShowRestriction(resultItem, asin) {
    if (!asin || asin === '不明' || asin === '-' || asin === '') return;

    // すでにチェック済みならスキップ
    if (resultItem.querySelector('.qse-restriction-badge')) return;

    chrome.runtime.sendMessage(
      { type: 'CHECK_RESTRICTIONS', asin },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response) {
          updateRestrictionBadge(resultItem, response.restricted);
        }
      }
    );
  }

  const ALL_STYLE_CLASSES = ['qse-item-colored', 'qse-item-unknown', 'qse-item-blackout', 'qse-item-hidden', 'qse-item-fee-error'];

  function clearItemStyles(resultItem) {
    resultItem.classList.remove(...ALL_STYLE_CLASSES);
    resultItem.style.removeProperty('--qse-bg-color');
    resultItem.style.removeProperty('--qse-border-color');
  }

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

  function applyStyles(resultItem, color, isUnknown, isFeeError, adjustedProfit, asin) {
    if (!resultItem) return;

    clearItemStyles(resultItem);

    if (isFeeError && !isUnknown) {
      const mode = settings.feeErrorDisplay;
      if (mode === 'normal') {
        // 通常表示
      } else {
        applyDisplayMode(resultItem, mode, 'qse-item-fee-error');
        updateProfitBadge(resultItem, mode !== 'hidden' && mode !== 'blackout' ? adjustedProfit : null);
        updateKeepaGraph(resultItem, mode !== 'hidden' && mode !== 'blackout' ? asin : null);
        return;
      }
    }

    if (isUnknown) {
      const mode = settings.unknownDisplay;
      if (mode === 'normal') {
        // 通常表示
      } else if (mode === 'gray') {
        resultItem.classList.add('qse-item-unknown');
      } else {
        applyDisplayMode(resultItem, mode, null);
      }
      updateProfitBadge(resultItem, null);
      updateKeepaGraph(resultItem, null);
      return;
    }

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
        if (color) {
          resultItem.style.setProperty('--qse-bg-color', color.bg);
          resultItem.style.setProperty('--qse-border-color', color.border);
          resultItem.classList.add('qse-item-colored');
        }
      }
    } else if (color) {
      resultItem.style.setProperty('--qse-bg-color', color.bg);
      resultItem.style.setProperty('--qse-border-color', color.border);
      resultItem.classList.add('qse-item-colored');
    }

    updateProfitBadge(resultItem, adjustedProfit);
    updateKeepaGraph(resultItem, asin);
  }

  /**
   * 利益バッジを表示/更新する
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
      const reviewEl = resultItem.querySelector('[class*="ItemReview_SearchResultItemReview__"]');
      if (reviewEl) {
        reviewEl.parentNode.insertBefore(badge, reviewEl.nextSibling);
      } else {
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
   * Keepaグラフを表示/更新する
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

      const badge = resultItem.querySelector('.qse-profit-badge');
      if (badge) {
        badge.parentNode.insertBefore(graph, badge.nextSibling);
      } else {
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

  // ===== スプレッドシート転記機能 =====

  /**
   * background.jsにメッセージを送ってスプレッドシートに追記する
   */
  function appendToSheet(rowData) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'APPEND_TO_SHEET', rowData },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Le Marchand] 転記エラー:', chrome.runtime.lastError.message);
            resolve(false);
          } else {
            resolve(response && response.success);
          }
        }
      );
    });
  }

  /**
   * 転記ボタンを商品画像の上に追加する
   */
  function updateTransferButton(resultItem, data, yahooPrice, paypayRate, couponDiscount) {
    // すでにボタンがあればスキップ
    if (resultItem.querySelector('.qse-transfer-btn')) return;

    // 商品画像エリアを探す
    const imageEl = resultItem.querySelector('[class*="SearchResult_SearchResultItem__image"]');
    if (!imageEl) return;

    // ボタンを作成
    const btn = document.createElement('button');
    btn.className = 'qse-transfer-btn';
    btn.textContent = '📋 転記';
    btn.title = 'Googleスプレッドシートに転記する';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      btn.textContent = '⏳ 転記中...';
      btn.disabled = true;

      // YahooのURL（商品タイトルのリンクから取得）
      const yahooLinkEl = resultItem.querySelector('[class*="ItemTitle_SearchResultItemTitle__"]')
        ? resultItem.querySelector('[class*="ItemTitle_SearchResultItemTitle__"]').closest('a')
        : resultItem.querySelector('a[href*="store.shopping.yahoo.co.jp"], a[href*="shopping.yahoo.co.jp"]');
      const yahooUrl = yahooLinkEl ? yahooLinkEl.href : window.location.href;

      // AmazonのURL
      const amazonUrl = data.asin && data.asin !== '不明'
        ? `https://www.amazon.co.jp/dp/${data.asin}`
        : '';

      // 商品名を取得（ItemTitle_SearchResultItemTitle__ クラスの span）
      const titleEl = resultItem.querySelector('[class*="ItemTitle_SearchResultItemTitle__"]');
      const productName = titleEl ? titleEl.textContent.trim() : '';

      // 本日の日付を取得
      const today = new Date();
      const dateStr = today.getFullYear() + '/' + (today.getMonth() + 1) + '/' + today.getDate();

      // 転記データを組み立てる（J列〜R列）
      const rowData = [
        dateStr,                                         // J列: 転記日付
        yahooUrl,                                        // K列: YahooURL
        amazonUrl,                                       // L列: AmazonURL
        productName,                                     // M列: 商品名
        '',                                              // N列: 空き
        isNaN(yahooPrice) ? '' : yahooPrice,            // O列: Yahoo購入価格
        isNaN(couponDiscount) ? '' : couponDiscount,    // P列: 割引額
        '',                                              // Q列: 空き
        paypayRate > 0 ? paypayRate : ''                // R列: ポイント倍率
      ];

      console.log('[Le Marchand] 転記データ:', JSON.stringify(rowData));
      const success = await appendToSheet(rowData);

      if (success) {
        btn.textContent = '✅ 転記完了';
        btn.classList.add('qse-transfer-btn--success');
        setTimeout(() => {
          btn.textContent = '📋 転記';
          btn.classList.remove('qse-transfer-btn--success');
          btn.disabled = false;
        }, 2000);
      } else {
        btn.textContent = '❌ エラー';
        btn.classList.add('qse-transfer-btn--error');
        setTimeout(() => {
          btn.textContent = '📋 転記';
          btn.classList.remove('qse-transfer-btn--error');
          btn.disabled = false;
        }, 2000);
      }
    });

    // 画像エリアの先頭にボタンを挿入
    imageEl.style.position = 'relative';
    imageEl.insertBefore(btn, imageEl.firstChild);
  }

  /**
   * 全アイテムをスキャンして色分けする
   */
  function scanAndColorize() {
    const qspContainers = document.querySelectorAll('.qsp-container');

    qspContainers.forEach((qspContainer) => {
      const lastProcessed = qspContainer.getAttribute(PROCESSED_ATTR);
      const now = Date.now();
      if (lastProcessed && (now - parseInt(lastProcessed)) < 5000) {
        return;
      }

      const data = extractQspData(qspContainer);

      if (isLoading(data)) {
        return;
      }

      let resultItem = null;
      let el = qspContainer.parentElement;
      while (el && el !== document.body) {
        if (el.tagName === 'DIV' && el.className) {
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
        resultItem = qspContainer.parentElement;
      }

      const yahooPrice = resultItem ? getYahooPrice(resultItem) : NaN;
      const paypayRate = resultItem ? getPaypayRate(resultItem) : 0;
      const couponDiscount = resultItem ? getCouponDiscount(resultItem) : 0;

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

      const itemPriceInput = qspContainer.querySelector('.qsp-item-price');
      if (itemPriceInput && !itemPriceInput.value && !isNaN(yahooPrice) && yahooPrice > 0) {
        itemPriceInput.value = yahooPrice;
        itemPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
        itemPriceInput.dispatchEvent(new Event('change', { bubbles: true }));
        qspContainer.removeAttribute(PROCESSED_ATTR);
        setTimeout(() => scanAndColorize(), 600);
        return;
      }

      const unknown = isUnknownProduct(data);
      const feeError = hasFeeError(qspContainer);

      if (unknown) {
        applyStyles(resultItem, null, true, false, null, null);
      } else {
        const color = getColorByProfit(data, yahooPrice, paypayRate, couponDiscount);
        const adjusted = calcAdjustedProfit(data, yahooPrice, paypayRate, couponDiscount);
        applyStyles(resultItem, color, false, feeError, adjusted, data.asin);
      }

      // サイズ区分バッジを追加
      if (resultItem) {
        updateSizeBadge(resultItem, data.size, data.weight);
      }

      // 出品制限チェック
      if (resultItem && !isUnknownProduct(data)) {
        checkAndShowRestriction(resultItem, data.asin);
      }

      // 転記ボタンを追加
      if (resultItem) {
        updateTransferButton(resultItem, data, yahooPrice, paypayRate, couponDiscount);
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
        const container = target.closest('.qsp-container');
        if (container) {
          container.removeAttribute(PROCESSED_ATTR);
        }
        setTimeout(scanAndColorize, 500);
      }
    }, true);

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
    loadSettings(() => {
      setTimeout(scanAndColorize, 1500);
      setInterval(scanAndColorize, SCAN_INTERVAL_MS);
      watchInputChanges();
      observeDOM();
      console.log('[Le Marchand] Initialized');
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(changes)) {
        if (key in SETTING_DEFAULTS) {
          settings[key] = changes[key].newValue;
        }
      }
      resetAllProcessed();
      scanAndColorize();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
