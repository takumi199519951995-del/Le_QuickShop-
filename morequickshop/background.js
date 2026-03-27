/**
 * Le Marchand - Background Service Worker
 * chrome.identity と Sheets API の処理を担当する
 */

'use strict';

const SPREADSHEET_ID = '1pdfvNqtR-1iUh27OarBRLlHffx1NahkNGWoPOV4L1bQ';
const SHEET_NAME = 'リサーチ＆リピートリスト';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'APPEND_TO_SHEET') {
    appendToSheet(message.rowData)
      .then((success) => sendResponse({ success }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CHECK_RESTRICTIONS') {
    checkRestrictions(message.asin)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ restricted: null, error: err.message }));
    return true;
  }
});

/**
 * SP-APIのアクセストークンを取得する
 */
async function getSpApiToken(clientId, clientSecret, refreshToken) {
  const response = await fetch('https://api.amazon.co.jp/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = await response.json();
  if (!data.access_token) throw new Error('アクセストークンの取得に失敗しました');
  return data.access_token;
}

/**
 * ASINの出品制限を確認する
 */
async function checkRestrictions(asin) {
  try {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(['spClientId', 'spClientSecret', 'spRefreshToken', 'spSellerId'], resolve);
    });

    const { spClientId, spClientSecret, spRefreshToken, spSellerId } = settings;

    if (!spClientId || !spClientSecret || !spRefreshToken || !spSellerId) {
      return { restricted: null, error: 'SP-APIの設定が未入力です' };
    }

    const token = await getSpApiToken(spClientId, spClientSecret, spRefreshToken);

    const url = 'https://sellingpartnerapi-fe.amazon.com/listings/2021-08-01/restrictions'
      + '?asin=' + asin
      + '&sellerId=' + spSellerId
      + '&marketplaceIds=A1VC38T7YXB528';

    const response = await fetch(url, {
      headers: {
        'x-amz-access-token': token,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    console.log('[Le Marchand] 出品制限チェック:', JSON.stringify(data));

    // restrictionsが空でなければ制限あり
    const restricted = data.restrictions && data.restrictions.length > 0;
    return { restricted };

  } catch (err) {
    console.error('[Le Marchand] 出品制限チェックエラー:', err);
    return { restricted: null, error: err.message };
  }
}

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function appendToSheet(rowData) {
  try {
    const token = await getAuthToken();

    // K列の現在のデータを取得して最終行を調べる
    const getRange = encodeURIComponent(SHEET_NAME + '!J:J');
    const getUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID + '/values/' + getRange;
    const getResponse = await fetch(getUrl, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const getJson = await getResponse.json();

    // K列で最初に空白になっている行を探す（最低10行目から）
    const values = getJson.values || [];
    let nextRow = 10;
    for (let i = 9; i < values.length; i++) {
      // values[i]が空、またはK列のセルが空文字の場合
      if (!values[i] || !values[i][0] || values[i][0].toString().trim() === '') {
        nextRow = i + 1; // 配列は0始まり、行番号は1始まり
        break;
      }
      // ループ終了まで空きがなければ末尾の次の行
      nextRow = values.length + 1;
    }
    nextRow = Math.max(nextRow, 10);

    console.log('[Le Marchand] 書き込み先行:', nextRow);

    // 指定行のK〜R列に書き込む
    const writeRange = encodeURIComponent(SHEET_NAME + '!J' + nextRow + ':R' + nextRow);
    const writeUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID + '/values/' + writeRange + '?valueInputOption=USER_ENTERED';

    const response = await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [rowData] })
    });

    const resJson = await response.json();
    console.log('[Le Marchand] Sheets API レスポンス:', JSON.stringify(resJson));

    if (!response.ok) {
      throw new Error('Sheets API エラー: ' + response.status + ' ' + JSON.stringify(resJson));
    }

    return true;
  } catch (err) {
    console.error('[Le Marchand] 転記エラー:', err);
    throw err;
  }
}
