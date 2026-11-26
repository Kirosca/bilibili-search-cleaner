import cleanerCss from './styles/cleaner.css?raw';
import { state, clearPurifiedMarks } from './core/state.js';
import {
  registerMenu,
  setMenuHandlers,
  applyDimmedState,
  applyFilterStickyState,
  applyEvaluationBadgeState,
  toggleSyntaxFilter,
} from './core/menu.js';
import { initNetworkHooks, scanInitialState } from './modules/network.js';
import {
  filterDOMElements,
  bindStickyObserver,
  resetConditions,
  initDomObserver,
  initSearchShortcut,
  setDomFilterHandlers,
} from './modules/domFilter.js';
import {
  setWaterfallHandlers,
  getMainListContainer,
  updateViewportPage,
  bindWaterfallObserver,
  checkSearchChange,
  onOfficialSearchMounted,
  syncWaterfallLifecycle,
  initWaterfallListeners,
  checkWaterfallFillScreen,
} from './modules/waterfall.js';
import {
  setQualityHandlers,
  injectQualityFilterRow,
  updateQualityFilterCounts,
  extractStatFromCard,
  getQualityQuadrant,
  renderBadgeColumn,
} from './modules/quality.js';

function bootstrap() {
  // 0. 窗口隔离：仅限顶层窗口（Top Window）执行
  if (window.self !== window.top) {
    return;
  }

  // 1. 注入全局样式
  const styleElement = document.createElement('style');
  styleElement.textContent = cleanerCss;
  (document.head || document.documentElement).appendChild(styleElement);

  // 2. 组装模块间依赖回调
  setMenuHandlers({
    filterDOMElements,
    bindStickyObserver,
    resetConditions,
    syncWaterfallLifecycle,
    updateQualityFilterCounts,
    updateViewportPage,
  });

  setDomFilterHandlers({
    extractStatFromCard,
    getQualityQuadrant,
    renderBadgeColumn,
    injectQualityFilterRow,
    updateQualityFilterCounts,
    updateViewportPage,
    bindWaterfallObserver,
    checkSearchChange,
    getCurrentObservedPager: () => state.currentObservedPager,
    toggleSyntaxFilter,
  });

  setWaterfallHandlers({
    filterDOMElements,
    renderBadgeColumn,
    updateQualityFilterCounts,
  });

  setQualityHandlers({
    filterDOMElements,
    checkWaterfallFillScreen,
    getMainListContainer,
  });

  // 3. 初始化菜单、全局状态、网络劫持与监听器
  registerMenu();
  applyDimmedState();
  applyFilterStickyState();
  applyEvaluationBadgeState();

  initNetworkHooks({
    filterDOMElements,
    onOfficialSearchMounted,
  });

  initDomObserver();
  initSearchShortcut();
  initWaterfallListeners();

  const onReady = () => {
    applyEvaluationBadgeState();
    if (scanInitialState()) {
      clearPurifiedMarks();
    }
    filterDOMElements();
    bindStickyObserver();
    syncWaterfallLifecycle();
  };

  window.addEventListener('DOMContentLoaded', onReady);
  window.addEventListener('load', onReady);

  console.log('[Bilibili 搜索净化] 3.0.0 (模块化架构) 已启动。');
}

bootstrap();
