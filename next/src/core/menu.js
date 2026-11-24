import { GM_registerMenuCommand, GM_unregisterMenuCommand } from '$';
import { state, seenBvidMap, clearPurifiedMarks } from './state.js';

let toggleAllMenuId = null;
let filterStickyMenuId = null;
let dimmedMenuId = null;
let waterfallMenuId = null;
let evalBadgeMenuId = null;
let evalModeMenuId = null;

// 外部模块注入的回调钩子，避免循环依赖
const handlers = {
  filterDOMElements: () => {},
  bindStickyObserver: () => {},
  resetConditions: () => {},
  syncWaterfallLifecycle: () => {},
};

/**
 * 注册菜单动作所需的外部模块回调
 */
export function setMenuHandlers(nextHandlers) {
  Object.assign(handlers, nextHandlers);
}

/**
 * 应用视频评价体系的 CSS 根类名
 */
export function applyEvaluationBadgeState() {
  if (document.documentElement) {
    document.documentElement.classList.toggle('bili-eval-badge-enabled', state.isEvaluationBadge);
  }
}

/**
 * 应用搜索筛选常驻的 CSS 类名并绑定变动观察者
 */
export function applyFilterStickyState() {
  if (document.documentElement) {
    document.documentElement.classList.toggle('bili-filter-sticky-enabled', state.isFilterSticky);
  }
  if (state.isFilterSticky) {
    handlers.bindStickyObserver();
  } else {
    document.querySelectorAll('div.more-conditions').forEach(handlers.resetConditions);
  }
}

/**
 * 同步并应用瀑布流当前生命周期状态
 */
export function applyWaterfallState() {
  handlers.syncWaterfallLifecycle();
}

/**
 * 切换评价体系显示范围（仅精选 vs 全部展示）
 */
export function toggleEvalMode() {
  state.isEvalFullMode = !state.isEvalFullMode;
  localStorage.setItem('bili_cleaner_eval_full_mode', String(state.isEvalFullMode));
  registerMenu();

  clearPurifiedMarks();
  handlers.filterDOMElements();
}

/**
 * 切换视频评价体系显示状态并持久化配置（默认关闭）
 */
export function toggleEvaluationBadge() {
  state.isEvaluationBadge = !state.isEvaluationBadge;
  localStorage.setItem('bili_cleaner_eval_badge', String(state.isEvaluationBadge));
  registerMenu();
  applyEvaluationBadgeState();

  if (state.isEvaluationBadge) {
    handlers.bindStickyObserver();
  } else {
    state.activeQualityFilters.clear();
    try {
      localStorage.removeItem('bili_cleaner_active_quality_filters');
    } catch {}
    state.lastQualityAnchorKey = null;

    document.querySelectorAll('.bili-cleaner-quality-filter-row').forEach((el) => el.remove());
    document.querySelectorAll('.bili-cleaner-badge-col').forEach((el) => el.remove());
  }

  clearPurifiedMarks('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card');
  handlers.filterDOMElements();
}

/**
 * 切换虚化显示模糊内容状态并持久化配置
 */
export function toggleDimmed() {
  state.isDimmed = !state.isDimmed;
  localStorage.setItem('bili_cleaner_dimmed', String(state.isDimmed));
  registerMenu();

  clearPurifiedMarks();
  handlers.filterDOMElements();
}

/**
 * 切换搜索筛选常驻状态并更新样式
 */
export function toggleFilterSticky() {
  state.isFilterSticky = !state.isFilterSticky;
  localStorage.setItem('bili_cleaner_sticky_filter', String(state.isFilterSticky));
  registerMenu();
  applyFilterStickyState();
}

/**
 * 切换瀑布流状态并在复位后刷新或跳转至第 1 页
 */
export function toggleWaterfall() {
  state.isWaterfall = !state.isWaterfall;
  localStorage.setItem('bili_cleaner_waterfall', String(state.isWaterfall));
  registerMenu();

  try {
    const firstPageBtn = document.querySelector('button.vui_pagenation--btn-num[aria-label^="第 1 页"]');
    if (firstPageBtn) {
      firstPageBtn.click();
    }
  } catch {}

  state.currentRequestedPage = 1;
  seenBvidMap.clear();
  state.totalRequestedVideos = 0;
  state.cachedCardTemplate = null;
  state.isAllLoaded = false;
  state.isPaging = false;

  setTimeout(() => {
    const url = new URL(window.location.href);
    const hasNonFirstPage =
      (url.searchParams.has('page') && url.searchParams.get('page') !== '1') ||
      (url.searchParams.has('o') && url.searchParams.get('o') !== '0');
    if (hasNonFirstPage) {
      url.searchParams.delete('page');
      url.searchParams.delete('o');
      window.location.href = url.toString();
      return;
    }

    window.location.reload();
  }, 50);
}

/**
 * 一键全开 / 全关所有功能（最后开关【无缝瀑布流】以安全处理页面重载）
 */
export function toggleAllFeatures() {
  const isAllEnabled = state.isFilterSticky && state.isDimmed && state.isWaterfall && state.isEvaluationBadge;
  const targetState = !isAllEnabled;

  if (state.isFilterSticky !== targetState) toggleFilterSticky();
  if (state.isDimmed !== targetState) toggleDimmed();
  if (state.isEvaluationBadge !== targetState) toggleEvaluationBadge();

  if (state.isWaterfall !== targetState) {
    toggleWaterfall();
  } else {
    registerMenu();
  }
}

/**
 * 注册与更新油猴菜单命令
 */
export function registerMenu() {
  if (typeof GM_registerMenuCommand !== 'function') return;

  if (typeof GM_unregisterMenuCommand === 'function') {
    const ids = [toggleAllMenuId, filterStickyMenuId, dimmedMenuId, waterfallMenuId, evalBadgeMenuId, evalModeMenuId];
    ids.forEach((id) => {
      if (id !== null) {
        try {
          GM_unregisterMenuCommand(id);
        } catch {}
      }
    });
    evalModeMenuId = null;
  }

  const isAllEnabled = state.isFilterSticky && state.isDimmed && state.isWaterfall && state.isEvaluationBadge;
  const isAllDisabled = !state.isFilterSticky && !state.isDimmed && !state.isWaterfall && !state.isEvaluationBadge;
  const toggleAllStatus = isAllEnabled ? '✅ 已开启' : isAllDisabled ? '❌ 已关闭' : '🌓 部分开启';
  toggleAllMenuId = GM_registerMenuCommand(`⚡ 一键全开/全关: ${toggleAllStatus}`, toggleAllFeatures);

  filterStickyMenuId = GM_registerMenuCommand(
    `⚓ 搜索筛选常驻: ${state.isFilterSticky ? '✅ 已开启' : '❌ 已关闭'}`,
    toggleFilterSticky
  );
  dimmedMenuId = GM_registerMenuCommand(
    `🌫️ 虚化显示模糊内容: ${state.isDimmed ? '✅ 已开启' : '❌ 已关闭'}`,
    toggleDimmed
  );
  waterfallMenuId = GM_registerMenuCommand(
    `🌊 无缝瀑布流: ${state.isWaterfall ? '✅ 已开启' : '❌ 已关闭'}`,
    toggleWaterfall
  );
  evalBadgeMenuId = GM_registerMenuCommand(
    `🏷️ 视频品质标签: ${state.isEvaluationBadge ? '✅ 已开启' : '❌ 已关闭'}`,
    toggleEvaluationBadge
  );

  if (state.isEvaluationBadge) {
    evalModeMenuId = GM_registerMenuCommand(
      `  └─ 标签可见范围: ${state.isEvalFullMode ? '📑 全部展示' : '✨ 仅精选'}`,
      toggleEvalMode
    );
  }
}
