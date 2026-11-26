import { unsafeWindow } from '$';

/**
 * 突破油猴沙箱隔离：锁定宿主真实 window 对象
 */
export const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

/**
 * 全局共享配置与运行时状态
 */
export const state = {
  isDimmed: localStorage.getItem('bili_cleaner_dimmed') === 'true',
  isFilterSticky: localStorage.getItem('bili_cleaner_sticky_filter') !== 'false',
  isWaterfall: localStorage.getItem('bili_cleaner_waterfall') === 'true',
  isEvaluationBadge: localStorage.getItem('bili_cleaner_eval_badge') !== 'false',
  isEvalFullMode: localStorage.getItem('bili_cleaner_eval_full_mode') === 'true',
  isSyntaxFilter: localStorage.getItem('bili_cleaner_syntax_filter') !== 'false',

  // 选中的品质标签筛选集合（多选，空集合代表全部/不限）
  activeQualityFilters: new Set(),
  lastQualityAnchorKey: null,

  // 瀑布流运行状态
  isWaterfallPaused: false,
  isPaging: false,
  currentPagingPromise: null,
  pagingAbortController: null,
  pagingSessionSeq: 0,
  isAllLoaded: false,
  currentRequestedPage: 1,
  currentViewportPage: 1,
  totalViewportPages: 1,
  maxWaterfallPage: 34,
  waterfallObserver: null,
  currentObservedPager: null,
  isInternalPaging: false,
  totalRequestedVideos: 0,
  cachedWbiKeys: null,
  cachedCardTemplate: null,
  lastSearchSign: '',
};

try {
  const savedFilters = JSON.parse(localStorage.getItem('bili_cleaner_active_quality_filters') || '[]');
  if (Array.isArray(savedFilters) && state.isEvaluationBadge) {
    savedFilters.forEach((k) => {
      if (k && k !== 'exclude_warning') state.activeQualityFilters.add(k);
    });
  }
} catch {}

/**
 * 共享数据字典：Tag 字典、统计指标字典、瀑布流去重 BV 集合
 */
export const videoTagMap = new Map();
export const videoStatMap = new Map();
export const seenBvidMap = new Set();

/**
 * 清除所有卡片的安检缓存标记
 */
export function clearPurifiedMarks(selector = '[data-purified-query]') {
  document.querySelectorAll(selector).forEach((el) => {
    const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
    delete card.dataset.purifiedQuery;
  });
}
