import { state, videoTagMap, videoStatMap, clearPurifiedMarks } from '../core/state.js';
import { cleanText } from '../core/text.js';
import { getSearchKeywords } from './syntax.js';
import { scanInitialState } from './network.js';

let isProcessing = false;

const domHandlers = {
  extractStatFromCard: () => ({ play: 0, like: 0, favorites: 0, danmaku: 0, duration: '', review: 0, isPartial: true }),
  getQualityQuadrant: () => null,
  renderBadgeColumn: () => {},
  injectQualityFilterRow: () => {},
  updateQualityFilterCounts: () => {},
  updateViewportPage: () => {},
  bindWaterfallObserver: () => {},
  checkSearchChange: () => {},
  getCurrentObservedPager: () => null,
  toggleSyntaxFilter: () => {},
};

/**
 * 注入品质与瀑布流外部依赖回调
 */
export function setDomFilterHandlers(nextHandlers) {
  Object.assign(domHandlers, nextHandlers);
}

/**
 * 遍历匹配 DOM 卡片元素并执行多维度安检过滤
 */
export function filterDOMElements(target = document) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const onFallbackLoaded = () => {
      clearPurifiedMarks();
      filterDOMElements();
    };
    const { normal, exclude, tags, ups } = getSearchKeywords(onFallbackLoaded);
    if (!normal.length && !exclude.length && !tags.length && !ups.length) return;

    if (tags.length && videoTagMap.size === 0) {
      scanInitialState();
    }

    const currentSearchQuery = window.location.search;
    const qualityFilterKey = Array.from(state.activeQualityFilters).sort().join(',');
    const currentQueryKey =
      currentSearchQuery + '_' + (state.isSyntaxFilter ? 'syn1' : 'syn0') + '_' + qualityFilterKey;

    let elements = [];
    if (Array.isArray(target)) {
      elements = target;
    } else if (target && target.nodeType) {
      elements = target.querySelectorAll
        ? target.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card')
        : [target];
    } else {
      elements = document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card');
    }

    elements.forEach((el) => {
      const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;

      if (card.closest('.activity-game-list, .activity-card, .activity-game-list-item')) return;
      if (card.querySelector('.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]'))
        return;
      if (card.dataset.purifiedQuery === currentQueryKey) return;

      const linkEl = card.querySelector(
        'a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]'
      );
      if (!linkEl) return;

      const titleEl = card.querySelector(
        'h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3'
      );
      if (!titleEl) return;

      const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
      const title = cleanText(rawTitle, onFallbackLoaded);

      const link = linkEl.href || '';
      let id = '';
      const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
      const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
      if (matchVideo) id = matchVideo[1];
      else if (matchLive) id = matchLive[1];

      const videoTags = cleanText(videoTagMap.get(id) || '', onFallbackLoaded);

      const authorEl = card.querySelector(
        'a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname'
      );
      const rawAuthor = authorEl ? authorEl.getAttribute('title') || authorEl.textContent || '' : '';
      const author = cleanText(rawAuthor.replace(/[\s·•].*$/, ''), onFallbackLoaded);

      let isSyntaxFail = false;

      if (state.isSyntaxFilter) {
        if (exclude.some((k) => title.includes(k))) {
          isSyntaxFail = true;
        } else if (normal.length && !normal.every((k) => title.includes(k))) {
          isSyntaxFail = true;
        } else if (tags.length && !tags.every((k) => videoTags.includes(k))) {
          isSyntaxFail = true;
        } else if (ups.length && !ups.some((k) => author.includes(k))) {
          isSyntaxFail = true;
        }
      }

      let quadrant = null;
      let hasFullStat = false;
      const isLiveCard =
        card.matches('.bili-live-card') ||
        Boolean(matchLive) ||
        Boolean(card.querySelector('.bili-video-card__info--living, .v-inline-live-player'));
      const coverEl = card.querySelector('.v-img.bili-video-card__cover, .bili-video-card__cover');
      if (coverEl && !isLiveCard) {
        let stat = id ? videoStatMap.get(id.toLowerCase()) || videoStatMap.get(id) : null;
        if (stat) {
          hasFullStat = true;
        } else {
          stat = domHandlers.extractStatFromCard(card);
        }
        quadrant = domHandlers.getQualityQuadrant(stat);
        domHandlers.renderBadgeColumn(coverEl, stat);
      } else if (isLiveCard) {
        hasFullStat = true;
        if (coverEl) {
          const existingBadge = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
          if (existingBadge) existingBadge.remove();
        }
      }

      const isTagReady = !tags.length || videoTagMap.size > 0 || !state.isSyntaxFilter;
      const isStatReady = !state.isEvaluationBadge || hasFullStat;
      if (card.dataset.externalHidden === undefined && card.style.display !== 'none') {
        card.dataset.externalHidden = getComputedStyle(card).display === 'none' ? '1' : '0';
      }
      card.dataset.isLive = isLiveCard ? '1' : '0';
      card.dataset.syntaxPass = isSyntaxFail ? '0' : '1';
      card.dataset.qualityClass = quadrant?.className || '';
      if (isTagReady && isStatReady) {
        card.dataset.purifiedQuery = currentQueryKey;
      }

      let isQualityFail = false;
      if (state.isEvaluationBadge && state.activeQualityFilters.size > 0) {
        const qClass = quadrant?.className;
        if (!qClass || !state.activeQualityFilters.has(qClass)) {
          isQualityFail = true;
        }
      }

      const innerCard = card.querySelector('.bili-video-card, .bili-live-card') || card;
      card.classList.remove('bili-cleaner-dimmed');

      if (isQualityFail) {
        innerCard.classList.remove('bili-cleaner-dimmed');
        card.style.setProperty('display', 'none', 'important');
      } else {
        card.style.removeProperty('display');
        innerCard.classList.toggle('bili-cleaner-dimmed', isSyntaxFail);
      }
    });

    if (state.isEvaluationBadge) {
      domHandlers.updateQualityFilterCounts();
    }
    if (state.isWaterfall) {
      domHandlers.updateViewportPage();
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * 维持筛选条件面板展开状态
 */
export function enforceConditions(element) {
  if (!state.isFilterSticky || !element) return;

  if (element.classList.contains('ov_hidden')) {
    element.classList.remove('ov_hidden');
  }
  if (element.classList.contains('hide')) {
    element.classList.remove('hide');
  }
  if (element.style.height !== 'auto') {
    element.style.setProperty('height', 'auto', 'important');
  }
}

/**
 * 关闭常驻时恢复默认折叠隐藏状态
 */
export function resetConditions(element) {
  if (!element) return;
  element.classList.add('ov_hidden');
  element.classList.add('hide');
  element.style.removeProperty('height');
}

const stickyObserver = new MutationObserver((mutations) => {
  if (!state.isFilterSticky) return;
  for (const m of mutations) {
    if (m.target && m.target.classList && m.target.classList.contains('more-conditions')) {
      enforceConditions(m.target);
    }
  }
});

/**
 * 监听筛选条件面板 DOM 变动并注入品质药丸筛选行
 */
export function bindStickyObserver() {
  const targets = document.querySelectorAll('div.more-conditions');
  targets.forEach((el) => {
    if (state.isFilterSticky) {
      if (!el.dataset.stickyObserved) {
        el.dataset.stickyObserved = 'true';
        stickyObserver.observe(el, {
          attributes: true,
          attributeFilter: ['class', 'style'],
        });
      }
      enforceConditions(el);
    }
    const oldExtraRows = el.querySelectorAll('.bili-cleaner-dimmed-filter-row, .bili-cleaner-syntax-filter-row');
    oldExtraRows.forEach((r) => r.remove());

    domHandlers.injectQualityFilterRow(el);
  });
}

/**
 * 帧级节流监听：使用 requestAnimationFrame 防抖驱动 DOM 过滤与状态自愈
 */
export function initDomObserver() {
  let rafId = null;
  const observer = new MutationObserver(() => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      filterDOMElements();
      bindStickyObserver();
      if (state.isWaterfall) {
        const currentPager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
        const observedPager = domHandlers.getCurrentObservedPager();
        if (currentPager && (!observedPager || observedPager !== currentPager || !observedPager.isConnected)) {
          domHandlers.bindWaterfallObserver();
        }
      }
      domHandlers.checkSearchChange();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/**
 * 快捷键支持：'/' 快速聚焦搜索框；'Alt+Q' 切换搜索语法过滤并展示轻量 Toast
 */
export function initSearchShortcut() {
  let toastTimer = null;
  function showCleanerToast(msg) {
    if (!document.body) return;
    let toast = document.getElementById('bili-cleaner-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bili-cleaner-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    void toast.offsetWidth;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 1500);
  }

  function getSearchInput() {
    return (
      document.querySelector('input.search-input-el') ||
      document.querySelector('input.search-input') ||
      document.querySelector('.search-input-wrap input') ||
      document.querySelector('.search-bar input') ||
      document.querySelector('input[type="text"]')
    );
  }

  document.addEventListener('keydown', function (e) {
    const active = document.activeElement;
    const isEditing =
      active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

    if ((e.key === '/' || e.code === 'Slash') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (!isEditing) {
        const input = getSearchInput();
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
      return;
    }

    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      (e.code === 'KeyQ' || (e.key && e.key.toLowerCase() === 'q'))
    ) {
      if (!isEditing) {
        e.preventDefault();
        domHandlers.toggleSyntaxFilter();
        showCleanerToast(`🗝️ 搜索语法过滤：${state.isSyntaxFilter ? '已开启' : '已关闭'}`);
      }
    }
  });
}
