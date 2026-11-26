import { state, targetWindow, videoTagMap, videoStatMap, clearPurifiedMarks } from '../core/state.js';
import { cleanText } from '../core/text.js';
import { getCleanApiKeyword } from './syntax.js';

/**
 * 物理剔除数据列表中的商业推广与广告卡片，并提取存储标签字典及量化数据
 */
export function cleanAdsOnly(list) {
  if (!Array.isArray(list)) return list;

  return list.filter((v) => {
    if (!v || typeof v !== 'object') return true;

    const tagText = [v.tag, v.keywords, v.tags, v.typename].filter(Boolean).join(',');
    const rawTags = cleanText(tagText);

    if (v.bvid) videoTagMap.set(String(v.bvid), rawTags);
    if (v.aid) {
      videoTagMap.set(String(v.aid), rawTags);
      videoTagMap.set('av' + v.aid, rawTags);
    }
    if (v.id) videoTagMap.set(String(v.id), rawTags);
    if (v.season_id) videoTagMap.set(String(v.season_id), rawTags);
    if (v.roomid) videoTagMap.set(String(v.roomid), rawTags);

    if ((v.bvid || v.aid || v.id) && v.type !== 'live_room' && !v.roomid) {
      const stat = {
        play: Number(v.play) || 0,
        like: Number(v.like) || 0,
        favorites: Number(v.favorites) || 0,
        danmaku: Number(v.danmaku !== undefined ? v.danmaku : v.video_review) || 0,
        duration: v.duration,
        review: Number(v.review) || 0,
        pubdate: Number(v.pubdate) || 0,
      };
      if (v.bvid) videoStatMap.set(String(v.bvid).toLowerCase(), stat);
      if (v.aid) videoStatMap.set(String(v.aid), stat);
      if (v.id) videoStatMap.set(String(v.id), stat);
    }

    if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;

    return true;
  });
}

/**
 * 首屏 SSR 初始状态补偿读取（适配现代 Vite + Pinia 架构与旧版 __INITIAL_STATE__）
 */
export function scanInitialState() {
  let hasData = false;
  try {
    const pinia = targetWindow.__pinia;
    if (pinia) {
      const allRes = pinia.searchResponse?.searchAllResponse?.result;
      if (Array.isArray(allRes)) {
        for (const cat of allRes) {
          if (cat.data && Array.isArray(cat.data)) {
            cleanAdsOnly(cat.data);
            hasData = true;
          }
        }
      }

      const typeRes = pinia.searchTypeResponse?.searchTypeResponse?.result;
      if (Array.isArray(typeRes)) {
        cleanAdsOnly(typeRes);
        hasData = true;
      }
    }

    const initState = targetWindow.__INITIAL_STATE__;
    if (initState?.flow?.data && Array.isArray(initState.flow.data)) {
      cleanAdsOnly(initState.flow.data);
      hasData = true;
    } else if (initState?.result && Array.isArray(initState.result)) {
      cleanAdsOnly(initState.result);
      hasData = true;
    }
  } catch {}
  return hasData;
}

/**
 * 初始化首屏轮询与全局 fetch 拦截钩子
 */
export function initNetworkHooks({ filterDOMElements, onOfficialSearchMounted }) {
  scanInitialState();

  let initPollCount = 0;
  const initPollTimer = setInterval(() => {
    initPollCount++;
    if (scanInitialState() || initPollCount >= 20) {
      clearInterval(initPollTimer);
      clearPurifiedMarks();
      filterDOMElements();
    }
  }, 80);

  const originFetch = targetWindow.fetch;
  targetWindow.fetch = async function (...args) {
    let urlStr = '';
    if (typeof args[0] === 'string') {
      urlStr = args[0];
    } else if (args[0] && typeof args[0] === 'object') {
      urlStr = args[0].url || '';
    }

    const isSearchReq =
      urlStr.includes('/wbi/search') || urlStr.includes('/search/type') || urlStr.includes('/search/all');

    if (isSearchReq && state.isSyntaxFilter) {
      const apiKeyword = getCleanApiKeyword();
      if (apiKeyword) {
        urlStr = urlStr.replace(/([?&]keyword=)[^&]+/, `$1${encodeURIComponent(apiKeyword)}`);
        if (typeof args[0] === 'string') {
          args[0] = urlStr;
        } else if (args[0] && typeof args[0] === 'object') {
          args[0] = new Request(urlStr, args[0]);
        }
      }
    }

    const response = await originFetch.apply(this, args);
    if (!isSearchReq) return response;

    try {
      const clone = response.clone();
      const data = await clone.json();
      if (data?.data?.result) {
        if (Array.isArray(data.data.result)) {
          if (data.data.result.length > 0 && data.data.result[0].data && Array.isArray(data.data.result[0].data)) {
            for (const cat of data.data.result) {
              if (cat.result_type === 'video' || cat.result_type === 'live_room' || !cat.result_type) {
                cat.data = cleanAdsOnly(cat.data);
              }
            }
          } else {
            data.data.result = cleanAdsOnly(data.data.result);
          }
        }

        if (!state.isPaging) {
          setTimeout(() => {
            clearPurifiedMarks();
            filterDOMElements();
          }, 50);
        }

        if (!state.isInternalPaging && !state.isPaging && state.isWaterfall) {
          setTimeout(() => {
            if (typeof onOfficialSearchMounted === 'function') {
              onOfficialSearchMounted();
            }
          }, 120);
        }

        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } catch {}

    return response;
  };
}
