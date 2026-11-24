import { state, targetWindow, videoTagMap, videoStatMap, seenBvidMap } from '../core/state.js';
import { cleanText, formatStat, formatDuration } from '../core/text.js';
import { getCleanApiKeyword } from './syntax.js';
import { getWbiKeys, signWbi } from './wbi.js';

const ICON_WAVE_SVG =
  '<svg viewBox="0 0 32 32" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><path d="M18.7303 8.60911V6.06653H7.03174V26.9651H26.0109V20.3841C25.4929 20.8941 24.42 21.809 22.704 22.3834C21.7762 22.6939 20.6231 22.8701 19.3753 22.9286C19.1503 22.9499 18.9223 22.9607 18.6917 22.9607C14.7286 22.9607 11.5159 19.748 11.5159 15.7849C11.5159 11.8218 14.7286 8.60901 18.6917 8.60901C18.7046 8.60901 18.7175 8.60904 18.7303 8.60911Z" fill="#26C9FC"/><path d="M2.00391 15.154L2.00394 28.9922C2.00394 29.5445 2.45165 29.9922 3.00394 29.9922H28.9937C29.546 29.9922 29.9937 29.5445 29.9937 28.9922L29.9937 17.8442C27.5057 18.7649 25.9825 20.5075 24.1129 22.0289C22.3405 23.4712 20.1514 24.7191 17.0031 24.7191C12.7544 24.7191 7.80713 20.8973 7.80713 15.8858C7.80713 9.86697 12.9891 7.30096 15.8417 7.30096C16.99 7.30096 17.4804 7.54554 17.6761 7.66783L18.8867 9.31877H23.0691V8.3649C22.3965 6.46938 19.5251 2.67834 13.4203 2.67834C7.80713 2.67834 2.00391 8.3649 2.00391 15.154Z" fill="#00A6ED"/><path d="M22.1939 5.86245C22.1939 6.49073 21.6846 7.00005 21.0563 7.00005C20.428 7.00005 19.9187 6.49073 19.9187 5.86245C19.9187 5.23417 20.428 4.72485 21.0563 4.72485C21.6846 4.72485 22.1939 5.23417 22.1939 5.86245Z" fill="#B4F6FC"/><path d="M27.9251 10.2761C28.5534 10.2761 29.0627 9.76673 29.0627 9.13845C29.0627 8.51017 28.5534 8.00085 27.9251 8.00085C27.2968 8.00085 26.7875 8.51017 26.7875 9.13845C26.7875 9.76673 27.2968 10.2761 27.9251 10.2761Z" fill="#B4F6FC"/><path d="M27.9251 16.1137C28.5534 16.1137 29.0627 15.6044 29.0627 14.9761C29.0627 14.3478 28.5534 13.8385 27.9251 13.8385C27.2968 13.8385 26.7875 14.3478 26.7875 14.9761C26.7875 15.6044 27.2968 16.1137 27.9251 16.1137Z" fill="#B4F6FC"/><path d="M19.1854 14.1376C19.1854 14.7659 18.676 15.2752 18.0478 15.2752C17.4195 15.2752 16.9102 14.7659 16.9102 14.1376C16.9102 13.5093 17.4195 13 18.0478 13C18.676 13 19.1854 13.5093 19.1854 14.1376Z" fill="#B4F6FC"/><path d="M25.023 13.1946C25.6513 13.1946 26.1606 12.6853 26.1606 12.057C26.1606 11.6134 25.9066 11.229 25.5361 11.0415C25.8288 10.6142 26 10.0971 26 9.54011C26 8.07111 24.8092 6.88025 23.3402 6.88025C22.4254 6.88025 21.6184 7.34206 21.1398 8.04526C20.6611 7.34206 19.8542 6.88025 18.9394 6.88025C18.1349 6.88025 17.4139 7.23738 16.9262 7.80174C16.4384 7.23738 15.7174 6.88025 14.9129 6.88025C13.4439 6.88025 12.2531 8.07111 12.2531 9.54011C12.2531 11.0091 13.4439 12.2 14.9129 12.2C15.7174 12.2 16.4384 11.8428 16.9262 11.2785C17.4139 11.8428 18.1349 12.2 18.9394 12.2C19.8542 12.2 20.6611 11.7382 21.1398 11.035C21.6184 11.7382 22.4254 12.2 23.3402 12.2C23.5282 12.2 23.7116 12.1805 23.8886 12.1434C23.9327 12.7313 24.4237 13.1946 25.023 13.1946Z" fill="#B4F6FC"/></svg>';

const wfHandlers = {
  filterDOMElements: () => {},
  renderBadgeColumn: () => {},
};

export function setWaterfallHandlers(nextHandlers) {
  Object.assign(wfHandlers, nextHandlers);
}

export function getMainListContainer(root = document) {
  const videoSection = root.querySelector(
    'div.video.i_wrapper.search-all-list, ' +
      '.video.i_wrapper.search-all-list, ' +
      'div.search-page-video.i_wrapper, ' +
      '.search-page-video, ' +
      'div.video.i_wrapper'
  );
  if (videoSection) {
    return videoSection.querySelector('.video-list.row, .video-list, .row') || videoSection;
  }
  return null;
}

export function getOrCreateBadge() {
  if (!state.isWaterfall) return null;
  let badge = document.getElementById('bili-waterfall-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'bili-waterfall-badge';
    badge.title = '左键点击：暂停 / 继续瀑布流\n右键点击：平滑回到顶部';
    badge.addEventListener('click', () => {
      state.isWaterfallPaused = !state.isWaterfallPaused;
      updateBadge();
      if (!state.isWaterfallPaused) {
        checkAndTriggerPaging();
      }
    });
    badge.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(badge);
  }
  return badge;
}

export function updateBadge() {
  const badge = getOrCreateBadge();
  if (!badge) return;
  if (state.isWaterfallPaused) {
    badge.innerHTML = `${ICON_WAVE_SVG}<span>已暂停: 第 ${state.currentViewportPage} 页</span>`;
    badge.classList.add('paused');
  } else {
    badge.innerHTML = `${ICON_WAVE_SVG}<span>瀑布流: 第 ${state.currentViewportPage} 页</span>`;
    badge.classList.remove('paused');
  }
}

export function updateViewportPage() {
  if (!state.isWaterfall) return;
  const mainContainer = getMainListContainer(document);
  if (!mainContainer) return;

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const children = mainContainer.children;
  const len = children.length;
  if (!len) return;

  let currentRow = 0;
  let lastTop = -9999;
  const inViewPages = [];
  let lastPassedPage = 1;

  for (let i = 0; i < len; i++) {
    const el = children[i];
    if (el.id === 'bili-waterfall-loader' || el.classList.contains('flex_center')) continue;
    if (el.offsetHeight === 0) continue;

    const isCard =
      el.classList.contains('video-list-item') ||
      el.matches('div[class*="col_"]') ||
      el.querySelector('.bili-video-card');
    if (!isCard) continue;

    const top = el.offsetTop;
    if (Math.abs(top - lastTop) > 6) {
      currentRow++;
      lastTop = top;
    }

    const cardPage = Math.floor((currentRow - 1) / 6) + 1;
    const rect = el.getBoundingClientRect();
    if (rect.top < viewportHeight && rect.bottom > 0) {
      inViewPages.push(cardPage);
    }
    if (rect.top < viewportHeight) {
      if (cardPage > lastPassedPage) {
        lastPassedPage = cardPage;
      }
    } else if (rect.top >= viewportHeight + 100) {
      break;
    }
  }

  let newPage = state.currentViewportPage;
  if (inViewPages.length > 0) {
    newPage = Math.max(...inViewPages);
  } else if (currentRow > 0) {
    newPage = lastPassedPage;
  }

  if (newPage !== state.currentViewportPage) {
    state.currentViewportPage = newPage;
    updateBadge();
  }
}

function adjustLoaderCentering() {
  const loader = document.getElementById('bili-waterfall-loader');
  if (loader && loader.style.left) {
    loader.style.removeProperty('left');
    loader.style.removeProperty('position');
    loader.style.removeProperty('top');
  }
}

function ensureLoaderPosition(pager) {
  if (!state.isWaterfall) return null;
  let loader = document.getElementById('bili-waterfall-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'bili-waterfall-loader';
    loader.className = 'bili-waterfall-loader';
    loader.innerHTML = `
      <div class="bili-waterfall-spinner"></div>
      <span class="bili-waterfall-loader-text">正在筛选...</span>
    `;
  }
  const targetPager = pager || document.querySelector('.vui_pagenation, .vui_pagenation--btns');
  if (targetPager && targetPager.parentNode && loader.nextSibling !== targetPager) {
    targetPager.parentNode.insertBefore(loader, targetPager);
  } else if (!targetPager) {
    const mainSection =
      document.querySelector('div.video.i_wrapper.search-all-list, div.search-page-video.i_wrapper, div.video.i_wrapper') ||
      getMainListContainer();
    if (mainSection) {
      let wrapper = loader.parentElement;
      if (!wrapper || !wrapper.classList.contains('flex_center') || wrapper.parentElement !== mainSection) {
        wrapper = document.createElement('div');
        wrapper.className = 'flex_center mt_x50 mb_lg';
        mainSection.appendChild(wrapper);
        wrapper.appendChild(loader);
      } else if (mainSection.lastElementChild !== wrapper) {
        mainSection.appendChild(wrapper);
      }
    }
  }
  adjustLoaderCentering();
  return loader;
}

function getOrCreateLoader() {
  const pager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
  return ensureLoaderPosition(pager);
}

function getDynamicMaxPage() {
  const pager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
  if (!pager) return 1;

  const nextBtn = pager.querySelector(
    'button.vui_pagenation--btn[aria-label="下一页"], button.vui_pagenation--btn-side[aria-label="下一页"]'
  );
  if (nextBtn) {
    let prev = nextBtn.previousElementSibling;
    while (prev && prev.tagName !== 'BUTTON') {
      prev = prev.previousElementSibling;
    }
    if (prev) {
      const label = prev.getAttribute('aria-label') || '';
      const m = label.match(/(\d+)/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (!isNaN(num) && num > 0) return num;
      }
      const txt = parseInt(prev.textContent.trim(), 10);
      if (!isNaN(txt) && txt > 0) return txt;
    }
  }

  const numBtns = pager.querySelectorAll('button.vui_pagenation--btn-num');
  if (numBtns.length > 0) {
    const lastNumBtn = numBtns[numBtns.length - 1];
    const label = lastNumBtn.getAttribute('aria-label') || '';
    const m = label.match(/(\d+)/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }
    const txt = parseInt(lastNumBtn.textContent.trim(), 10);
    if (!isNaN(txt) && txt > 0) return txt;
  }

  return 34;
}

function updateDynamicMaxPage() {
  const p = getDynamicMaxPage();
  if (p > 0) {
    state.maxWaterfallPage = p;
  }
  return state.maxWaterfallPage;
}

function getGridColumnCount() {
  const mainContainer = getMainListContainer(document);
  if (!mainContainer) return 5;

  const firstCard = mainContainer.querySelector(
    '.video-list-item, div[class*="col_"]:has(.bili-video-card), div[class*="col_"]'
  );
  if (!firstCard || firstCard.offsetWidth === 0) return 5;

  let row1Count = 0;
  let row2Count = 0;
  let row1Top = null;
  let row2Top = null;

  const children = mainContainer.children;
  const len = children.length;
  for (let i = 0; i < len; i++) {
    const card = children[i];
    if (!card || card.id === 'bili-waterfall-loader' || card.classList.contains('flex_center')) continue;
    if (card.offsetHeight === 0) continue;
    const isCard =
      card.classList.contains('video-list-item') ||
      card.matches('div[class*="col_"]') ||
      Boolean(card.querySelector('.bili-video-card'));
    if (!isCard) continue;

    const top = card.offsetTop;
    if (row1Top === null) {
      row1Top = top;
      row1Count = 1;
    } else if (Math.abs(top - row1Top) <= 6) {
      row1Count++;
    } else if (row2Top === null) {
      row2Top = top;
      row2Count = 1;
    } else if (Math.abs(top - row2Top) <= 6) {
      row2Count++;
    } else {
      break;
    }
  }

  const maxMeasured = Math.max(row1Count, row2Count);
  if (maxMeasured >= 4 && maxMeasured <= 7) {
    return maxMeasured;
  }

  const containerWidth = mainContainer.clientWidth;
  const cardWidth = firstCard.offsetWidth;
  if (containerWidth > 0 && cardWidth > 0) {
    const cols = Math.round(containerWidth / cardWidth);
    if (cols >= 4 && cols <= 7) return cols;
    if (cols > 7) return 7;
    if (cols < 4 && cols > 0) return 4;
  }

  return 5;
}

function getDynamicPageSize() {
  return getGridColumnCount() * 6;
}

function getLoaderText(customText) {
  if (customText) return customText;
  return state.totalRequestedVideos > 0
    ? `正在筛选... (已检索 ${state.totalRequestedVideos} 条)`
    : '正在筛选...';
}

function updateLoader(show, text = null) {
  const loader = getOrCreateLoader();
  if (!loader) return;
  const txtEl = loader.querySelector('.bili-waterfall-loader-text');
  const spinner = loader.querySelector('.bili-waterfall-spinner');
  const displayText = getLoaderText(text);
  if (show) {
    loader.classList.add('active');
    loader.classList.remove('ended');
    if (spinner) spinner.style.removeProperty('display');
    adjustLoaderCentering();
    if (txtEl) txtEl.textContent = displayText;
  } else {
    if (txtEl && !state.isAllLoaded) txtEl.textContent = displayText;
    if (!state.isAllLoaded) loader.classList.remove('active', 'ended');
  }
}

function showEndedLoader() {
  const loader = getOrCreateLoader();
  if (!loader) return;
  loader.classList.add('active', 'ended');
  adjustLoaderCentering();
  const txtEl = loader.querySelector('.bili-waterfall-loader-text');
  if (txtEl) {
    txtEl.innerHTML = '<span>已展示全部匹配视频</span>';
  }
}

function showErrorLoader(customMsg = '⚠️ 加载失败，点击重试') {
  const loader = getOrCreateLoader();
  if (!loader) return;
  loader.classList.add('active');
  loader.classList.remove('ended');
  const txtEl = loader.querySelector('.bili-waterfall-loader-text');
  if (txtEl) {
    txtEl.innerHTML = `<span class="bili-waterfall-retry-btn" style="cursor: pointer; color: #ff6699; font-weight: 500;">${customMsg}</span>`;
  }
  const spinner = loader.querySelector('.bili-waterfall-spinner');
  if (spinner) spinner.style.display = 'none';

  const onRetryClick = (e) => {
    const btn = e.target.closest('.bili-waterfall-retry-btn');
    if (btn) {
      loader.removeEventListener('click', onRetryClick);
      if (spinner) spinner.style.removeProperty('display');
      updateLoader(true);
      triggerLoadNextPage();
    }
  };
  loader.addEventListener('click', onRetryClick);
}

/**
 * 检测当前屏幕卡片是否充盈，不足时触发瀑布流增补
 */
export function checkWaterfallFillScreen() {
  if (!state.isWaterfall || state.isWaterfallPaused || state.isPaging || state.isAllLoaded) return;
  const mainContainer = getMainListContainer(document);
  if (!mainContainer) return;

  const visibleCards = Array.from(mainContainer.children).filter(
    (c) => c.style.display !== 'none' && !c.classList.contains('flex_center')
  );
  if (visibleCards.length < 10) {
    triggerLoadNextPage();
  }
}

function getCardTemplate() {
  if (state.cachedCardTemplate) return state.cachedCardTemplate;

  const mainContainer = getMainListContainer(document);
  if (!mainContainer) return null;

  const sampleCol =
    mainContainer.querySelector(
      'div[class*="col_"]:has(a[href*="/video/"]):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living)), ' +
        '.video-list-item:has(a[href*="/video/"]):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living)), ' +
        'div[class*="col_"]:has(.bili-video-card):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living))'
    ) || mainContainer.querySelector('.video-list-item, div[class*="col_"]:has(.bili-video-card)');

  if (!sampleCol) return null;

  const tpl = sampleCol.cloneNode(true);
  delete tpl.dataset.purifiedQuery;
  tpl.classList.remove('bili-cleaner-dimmed');
  tpl.querySelectorAll('.bili-cleaner-dimmed').forEach((el) => el.classList.remove('bili-cleaner-dimmed'));
  tpl.querySelectorAll('.bili-cleaner-badge-col').forEach((el) => el.remove());
  tpl
    .querySelectorAll(
      '.v-inline-live-player, .bili-video-card__info--living, .v-inline-player, .bpx-docker, video, .sponsorThumbnailLabel, [class*="sponsorThumbnailLabel"]'
    )
    .forEach((el) => el.remove());

  const pictureEl = tpl.querySelector('picture');
  if (pictureEl) {
    pictureEl.querySelectorAll('source').forEach((s) => s.remove());
  }

  const oldImg = tpl.querySelector('.bili-video-card__cover img, picture img, img');
  if (oldImg) {
    const cleanImg = document.createElement('img');
    for (const attr of oldImg.attributes) {
      const name = attr.name.toLowerCase();
      if (name !== 'src' && name !== 'srcset' && !name.startsWith('on')) {
        cleanImg.setAttribute(attr.name, attr.value);
      }
    }
    cleanImg.loading = 'lazy';
    oldImg.replaceWith(cleanImg);
  }

  state.cachedCardTemplate = tpl;
  return state.cachedCardTemplate;
}

function createCardElement(item) {
  const durationText = formatDuration(item.duration);
  const cleanTit = (item.title || '').replace(/<[^>]+>/g, '');
  const coverUrl = item.pic ? (item.pic.startsWith('http') ? item.pic : 'https:' + item.pic) : '';
  const videoHref = `//www.bilibili.com/video/${item.bvid}`;

  const sampleCol = getCardTemplate();
  let col;

  if (sampleCol) {
    col = sampleCol.cloneNode(true);

    col.querySelectorAll('a[href*="/video/"], a[href*="live.bilibili.com"], a[href*="/cheese/"]').forEach((a) => {
      a.href = videoHref;
    });
    col.querySelectorAll('.sponsorThumbnailLabel, [class*="sponsorThumbnailLabel"]').forEach((el) => el.remove());

    const titEl = col.querySelector('.bili-video-card__info--tit, h3');
    if (titEl) {
      titEl.innerHTML = item.title;
      titEl.setAttribute('title', cleanTit);
      titEl.title = cleanTit;
      const parentA = titEl.closest('a');
      if (parentA) {
        parentA.setAttribute('title', cleanTit);
        parentA.title = cleanTit;
        parentA.href = videoHref;
      }
    }

    col.querySelectorAll('[data-bsb-bvid]').forEach((el) => {
      el.setAttribute('data-bsb-bvid', item.bvid);
    });

    const imgEl = col.querySelector('.bili-video-card__cover img, picture img, img');
    if (imgEl) {
      imgEl.alt = cleanTit;
      imgEl.src = coverUrl ? coverUrl + '@672w_378h_1c_!web-search-common-cover.webp' : '';
    }

    const ownerA = col.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--owner');
    if (ownerA) {
      ownerA.href = `//space.bilibili.com/${item.mid}`;
      const authorSpan = ownerA.querySelector('.bili-video-card__info--author, .bili-video-card__info--author-name');
      if (authorSpan) {
        authorSpan.textContent = item.author;
      } else {
        const textNode = Array.from(ownerA.childNodes).find((n) => n.nodeType === 3);
        if (textNode) textNode.textContent = item.author;
        else ownerA.textContent = item.author;
      }
      let dateSpan = ownerA.querySelector('.bili-video-card__info--date');
      if (!dateSpan && item.pubdate) {
        dateSpan = document.createElement('span');
        dateSpan.className = 'bili-video-card__info--date';
        ownerA.appendChild(dateSpan);
      }
      if (dateSpan && item.pubdate) {
        const d = new Date(item.pubdate * 1000);
        dateSpan.textContent = ` · ${d.getMonth() + 1}月${d.getDate()}日`;
      }
    }

    const statItems = col.querySelectorAll('.bili-video-card__stats--item');
    if (statItems.length >= 2) {
      const playSpan = statItems[0].querySelector('span');
      if (playSpan && item.play !== undefined) {
        playSpan.textContent = formatStat(item.play);
      }
      const dmSpan = statItems[1].querySelector('span');
      const dmVal = item.danmaku !== undefined ? item.danmaku : item.video_review;
      if (dmSpan && dmVal !== undefined) {
        dmSpan.textContent = formatStat(dmVal);
      }
    }

    let durationEl = col.querySelector('.bili-video-card__stats__duration');
    if (!durationEl && durationText) {
      const targetWrap = col.querySelector('.bili-video-card__stats, .bili-video-card__mask');
      if (targetWrap) {
        durationEl = document.createElement('span');
        durationEl.className = 'bili-video-card__stats__duration';
        targetWrap.appendChild(durationEl);
      }
    }
    if (durationEl && durationText) {
      durationEl.textContent = durationText;
    }
  } else {
    col = document.createElement('div');
    col.className = 'col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40 video-list-item';
    const dateText = item.pubdate
      ? ` · ${new Date(item.pubdate * 1000).getMonth() + 1}月${new Date(item.pubdate * 1000).getDate()}日`
      : '';
    const playText = item.play !== undefined ? formatStat(item.play) : '0';
    const dmVal = item.danmaku !== undefined ? item.danmaku : item.video_review;
    const dmText = dmVal !== undefined ? formatStat(dmVal) : '0';

    col.innerHTML = `
      <div class="bili-video-card" data-bsb-bvid="${item.bvid}">
        <div class="bili-video-card__wrap">
          <a href="//www.bilibili.com/video/${item.bvid}" target="_blank">
            <div class="bili-video-card__image--wrap">
              <picture class="v-img bili-video-card__cover">
                <img src="${coverUrl}@672w_378h_1c_!web-search-common-cover.webp" alt="${cleanTit}" loading="lazy">
              </picture>
              <div class="bili-video-card__mask">
                <div class="bili-video-card__stats">
                  <div class="bili-video-card__stats--left">
                    <span class="bili-video-card__stats--item"><span>${playText}</span></span>
                    <span class="bili-video-card__stats--item"><span>${dmText}</span></span>
                  </div>
                  <span class="bili-video-card__stats__duration">${durationText}</span>
                </div>
              </div>
            </div>
          </a>
          <div class="bili-video-card__info--right">
            <a href="//www.bilibili.com/video/${item.bvid}" target="_blank" title="${cleanTit}">
              <h3 class="bili-video-card__info--tit">${item.title}</h3>
            </a>
            <div class="bili-video-card__info--bottom">
              <a class="bili-video-card__info--author" href="//space.bilibili.com/${item.mid}" target="_blank">
                <span class="bili-video-card__info--author">${item.author}</span>
                <span class="bili-video-card__info--date">${dateText}</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const coverEl = col.querySelector('.v-img.bili-video-card__cover, .bili-video-card__cover');
  if (coverEl) {
    const stat = {
      play: Number(item.play) || 0,
      like: Number(item.like) || 0,
      favorites: Number(item.favorites) || 0,
      danmaku: Number(item.danmaku !== undefined ? item.danmaku : item.video_review) || 0,
      duration: item.duration,
      review: Number(item.review) || 0,
    };
    wfHandlers.renderBadgeColumn(coverEl, stat);
  }

  return col;
}

function appendCards(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const mainContainer = getMainListContainer(document);
  if (!mainContainer) return 0;

  const fragment = document.createDocumentFragment();
  const newCards = [];
  let addedCount = 0;

  for (const item of items) {
    if (!item.bvid) continue;
    const bvidLower = item.bvid.toLowerCase();
    if (seenBvidMap.has(bvidLower)) continue;
    seenBvidMap.add(bvidLower);

    const rawTagText = [item.tag, item.keywords, item.tags, item.typename].filter(Boolean).join(',');
    if (rawTagText) {
      videoTagMap.set(item.bvid, cleanText(rawTagText));
      if (item.aid) {
        videoTagMap.set(String(item.aid), cleanText(rawTagText));
        videoTagMap.set('av' + item.aid, cleanText(rawTagText));
      }
    }

    if (item.bvid) {
      const stat = {
        play: Number(item.play) || 0,
        like: Number(item.like) || 0,
        favorites: Number(item.favorites) || 0,
        danmaku: Number(item.danmaku !== undefined ? item.danmaku : item.video_review) || 0,
        duration: item.duration,
        review: Number(item.review) || 0,
        pubdate: Number(item.pubdate) || 0,
      };
      videoStatMap.set(item.bvid.toLowerCase(), stat);
      if (item.aid) videoStatMap.set(String(item.aid), stat);
    }

    const cardNode = createCardElement(item);
    fragment.appendChild(cardNode);
    newCards.push(cardNode);
    addedCount++;
  }

  if (addedCount > 0) {
    wfHandlers.filterDOMElements(newCards);
    mainContainer.appendChild(fragment);
    updateViewportPage();
  }
  return addedCount;
}

function abortRunningPaging() {
  state.pagingSessionSeq++;
  if (state.pagingAbortController) {
    try {
      state.pagingAbortController.abort();
    } catch {}
    state.pagingAbortController = null;
  }
  state.isPaging = false;
  state.currentPagingPromise = null;
}

function isPagingConditionMet() {
  if (!state.isWaterfall || state.isWaterfallPaused || state.isAllLoaded) return false;
  if (state.currentRequestedPage >= state.maxWaterfallPage) return false;
  const target =
    document.querySelector('.vui_pagenation, .vui_pagenation--btns') || document.getElementById('bili-waterfall-loader');
  if (!target) return false;
  const rect = target.getBoundingClientRect();
  return rect.top < window.innerHeight + 1000 && rect.bottom > -100;
}

function finishPaging(success = true, riskMsg = null) {
  updateBadge();

  if (state.isAllLoaded) {
    showEndedLoader();
    return;
  }

  if (!success) {
    showErrorLoader(riskMsg || undefined);
    return;
  }

  if (!state.isWaterfallPaused && isPagingConditionMet()) {
    updateLoader(true);
    setTimeout(() => {
      if (
        !state.isPaging &&
        !state.currentPagingPromise &&
        !state.isAllLoaded &&
        !state.isWaterfallPaused &&
        isPagingConditionMet()
      ) {
        triggerLoadNextPage();
      }
    }, 60);
  } else {
    updateLoader(false);
    if (!state.isAllLoaded && !state.isWaterfallPaused) {
      setTimeout(checkAndTriggerPaging, 300);
    }
  }
}

export async function triggerLoadNextPage() {
  if (!state.isWaterfall || state.isWaterfallPaused || state.isAllLoaded) return null;
  if (state.currentPagingPromise || state.isPaging) return state.currentPagingPromise;

  updateDynamicMaxPage();
  if (state.currentRequestedPage >= state.maxWaterfallPage) {
    state.isAllLoaded = true;
    updateBadge();
    showEndedLoader();
    return null;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const rawKeyword = urlParams.get('keyword');
  if (!rawKeyword) return null;

  const nextPage = state.currentRequestedPage + 1;
  state.isPaging = true;
  updateBadge();
  updateLoader(true);

  const sessionSeq = state.pagingSessionSeq;
  const controller = new AbortController();
  state.pagingAbortController = controller;

  state.currentPagingPromise = (async () => {
    let success = false;
    let riskMsg = null;
    try {
      const keys = await getWbiKeys();
      if (controller.signal.aborted || sessionSeq !== state.pagingSessionSeq) return;
      if (!keys) return;

      const apiBase = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
      const queryObj = {
        category_id: urlParams.get('category_id') || '',
        search_type: 'video',
        ad_resource: 5654,
        __refresh__: true,
        _extra: '',
        context: '',
        page: nextPage,
        page_size: getDynamicPageSize(),
        order: urlParams.get('order') || 'totalrank',
        pubtime_begin_s: urlParams.get('pubtime_begin_s') || 0,
        pubtime_end_s: urlParams.get('pubtime_end_s') || 0,
        duration: urlParams.get('duration') || '0',
        tids: urlParams.get('tids') || '0',
        from_source: urlParams.get('from_source') || 'web_search',
        from_spmid: '333.337',
        platform: 'pc',
        highlight: 1,
        single_column: 0,
        keyword: getCleanApiKeyword() || decodeURIComponent(rawKeyword.replace(/\+/g, ' ')),
        source_tag: 3,
        gaia_vtoken: '',
        web_location: 1430654,
        'x-bili-device-req-json': JSON.stringify({
          platform: 'web',
          device: 'pc',
          spmid: '333.337',
          mobi_app: 'web_cn',
        }),
        'x-bili-locale-json': JSON.stringify({
          c_locale: { language: 'zh', script: 'Hans' },
          always_translate: false,
        }),
      };

      const signedQs = signWbi(queryObj, keys.img_key, keys.sub_key);
      const res = await targetWindow.fetch(`${apiBase}?${signedQs}`, {
        headers: { Referer: 'https://search.bilibili.com/' },
        signal: controller.signal,
      });
      const data = await res.json();
      if (controller.signal.aborted || sessionSeq !== state.pagingSessionSeq) return;

      // 识别风控熔断码（-412 / -403），避免误判为自然到底
      if (data?.code === -412 || data?.code === -403) {
        riskMsg = `⚠️ 触发风控 (${data.code})，请稍候点击重试`;
        return;
      }

      let videoItems = [];
      if (data?.data?.result && Array.isArray(data.data.result)) {
        videoItems = data.data.result;
      }

      if (videoItems.length > 0) {
        state.totalRequestedVideos += videoItems.length;
        const curLoader = document.getElementById('bili-waterfall-loader');
        const curTxtEl = curLoader?.querySelector('.bili-waterfall-loader-text');
        if (curTxtEl && curLoader.classList.contains('active') && !curLoader.classList.contains('ended')) {
          curTxtEl.textContent = getLoaderText();
        }
        appendCards(videoItems);
        state.currentRequestedPage = nextPage;

        updateDynamicMaxPage();
        if (state.currentRequestedPage >= state.maxWaterfallPage) {
          state.isAllLoaded = true;
        }
      } else {
        state.maxWaterfallPage = state.currentRequestedPage;
        state.isAllLoaded = true;
      }
      success = true;
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[Bilibili 搜索净化] 瀑布流加载下一页失败:', e);
      }
    } finally {
      state.isPaging = false;
      if (state.pagingAbortController === controller) {
        state.pagingAbortController = null;
      }
      state.currentPagingPromise = null;
      if (!controller.signal.aborted && sessionSeq === state.pagingSessionSeq) {
        finishPaging(success, riskMsg);
      }
    }
  })();

  return state.currentPagingPromise;
}

function refreshSeenBvidsFromDOM() {
  seenBvidMap.clear();
  document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
    const m = a.href.match(/\/video\/([A-Za-z0-9]+)/);
    if (m) seenBvidMap.add(m[1].toLowerCase());
  });
  state.totalRequestedVideos = seenBvidMap.size;
}

export function checkAndTriggerPaging() {
  if (!state.isWaterfall || state.isWaterfallPaused || state.isPaging || state.currentPagingPromise || state.isAllLoaded)
    return;
  const pager =
    document.querySelector('.vui_pagenation, .vui_pagenation--btns') || document.getElementById('bili-waterfall-loader');
  if (!pager) return;

  if (state.currentObservedPager !== pager || !pager.isConnected) {
    bindWaterfallObserver();
  }

  if (isPagingConditionMet()) {
    triggerLoadNextPage();
  }
}

export function bindWaterfallObserver() {
  if (!state.isWaterfall) return;

  const pager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
  if (!pager) return;

  if (state.currentObservedPager === pager && pager.isConnected && state.waterfallObserver) {
    ensureLoaderPosition(pager);
    return;
  }

  if (state.waterfallObserver) {
    state.waterfallObserver.disconnect();
    state.waterfallObserver = null;
  }

  state.currentObservedPager = pager;
  ensureLoaderPosition(pager);

  state.waterfallObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry && entry.isIntersecting) {
        if (!state.isPaging && !state.currentPagingPromise) {
          triggerLoadNextPage();
        }
      }
    },
    {
      root: null,
      rootMargin: '1000px 0px',
      threshold: 0,
    }
  );

  state.waterfallObserver.observe(pager);
}

function getSearchSignature() {
  const p = new URLSearchParams(window.location.search);
  return [
    window.location.pathname,
    p.get('keyword') || '',
    p.get('order') || '',
    p.get('duration') || '',
    p.get('tids') || '',
    p.get('pubtime_begin_s') || '',
    p.get('pubtime_end_s') || '',
    p.get('category_id') || '',
  ].join('||');
}

export function resetWaterfallForNewSearch(isNewSearch = false) {
  const currentSign = getSearchSignature();
  const signChanged = !state.lastSearchSign || currentSign !== state.lastSearchSign;
  state.lastSearchSign = currentSign;

  const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
  const urlPage = isNaN(p) ? 1 : p;

  if (signChanged || isNewSearch) {
    abortRunningPaging();
    state.currentRequestedPage = 1;
    state.currentViewportPage = 1;
    state.cachedCardTemplate = null;
    state.isAllLoaded = false;
    updateDynamicMaxPage();

    try {
      const u = new URL(window.location.href);
      let changed = false;
      if (u.searchParams.has('page') && u.searchParams.get('page') !== '1') {
        u.searchParams.delete('page');
        changed = true;
      }
      if (u.searchParams.has('o') && u.searchParams.get('o') !== '0') {
        u.searchParams.delete('o');
        changed = true;
      }
      if (changed) {
        state.isInternalPaging = true;
        window.history.replaceState(null, '', u.toString());
        setTimeout(() => {
          state.isInternalPaging = false;
        }, 100);
      }
    } catch {
      state.isInternalPaging = false;
    }
  } else {
    state.currentRequestedPage = urlPage;
    updateDynamicMaxPage();
    state.isAllLoaded = state.currentRequestedPage >= state.maxWaterfallPage;
  }

  state.isPaging = false;
  refreshSeenBvidsFromDOM();
  updateViewportPage();
  updateBadge();

  if (state.isAllLoaded) {
    showEndedLoader();
  } else {
    updateLoader(false);
    setTimeout(checkAndTriggerPaging, 300);
  }

  bindWaterfallObserver();
}

export function onOfficialSearchMounted() {
  if (!state.isWaterfall) return;
  updateDynamicMaxPage();
  const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
  const urlPage = isNaN(p) ? 1 : p;
  if (urlPage === 1) {
    abortRunningPaging();
    state.currentRequestedPage = 1;
    state.currentViewportPage = 1;
    state.isAllLoaded = state.maxWaterfallPage <= 1;
  }
  state.cachedCardTemplate = null;
  state.isPaging = false;
  refreshSeenBvidsFromDOM();
  updateViewportPage();
  bindWaterfallObserver();
  updateBadge();
  if (state.isAllLoaded) {
    showEndedLoader();
  } else {
    updateLoader(false);
    setTimeout(checkAndTriggerPaging, 300);
  }
}

export function checkSearchChange() {
  if (!state.isWaterfall || state.isInternalPaging) return;

  const currentSign = getSearchSignature();
  const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
  const urlPage = isNaN(p) ? 1 : p;

  const signChanged = state.lastSearchSign && currentSign !== state.lastSearchSign;
  const pageChanged = urlPage > 1 && urlPage !== state.currentRequestedPage;

  if (signChanged) {
    resetWaterfallForNewSearch(true);
  } else if (pageChanged) {
    resetWaterfallForNewSearch(false);
  } else if (!state.lastSearchSign) {
    state.lastSearchSign = currentSign;
  }
}

export function syncWaterfallLifecycle() {
  if (!document.body) return;

  if (state.isWaterfall) {
    const currentUrl = new URL(window.location.href);
    const p = parseInt(currentUrl.searchParams.get('page') || '1', 10);
    const o = parseInt(currentUrl.searchParams.get('o') || '0', 10);
    if (p > 1 || o > 0) {
      currentUrl.searchParams.delete('page');
      currentUrl.searchParams.delete('o');
      window.location.replace(currentUrl.toString());
      return;
    }

    abortRunningPaging();
    document.documentElement.classList.add('bili-waterfall-enabled');

    state.lastSearchSign = getSearchSignature();
    refreshSeenBvidsFromDOM();

    updateDynamicMaxPage();
    state.currentRequestedPage = 1;
    state.currentViewportPage = 1;
    state.isAllLoaded = state.maxWaterfallPage <= 1;
    state.isPaging = false;

    updateViewportPage();
    getOrCreateBadge();
    updateBadge();
    getOrCreateLoader();
    if (state.isAllLoaded) {
      showEndedLoader();
    } else {
      updateLoader(false);
    }
    bindWaterfallObserver();
    setTimeout(checkAndTriggerPaging, 300);
  } else {
    abortRunningPaging();
    document.documentElement.classList.remove('bili-waterfall-enabled');
    if (state.waterfallObserver) {
      state.waterfallObserver.disconnect();
      state.waterfallObserver = null;
    }
    state.currentObservedPager = null;
    const badge = document.getElementById('bili-waterfall-badge');
    if (badge) badge.remove();

    const loader = document.getElementById('bili-waterfall-loader');
    if (loader) loader.remove();
  }
}

/**
 * 绑定路由劫持、滚动与窗口大小自适应监听器
 */
export function initWaterfallListeners() {
  try {
    const originPushState = targetWindow.history.pushState;
    if (originPushState) {
      targetWindow.history.pushState = function (...args) {
        const res = originPushState.apply(this, args);
        setTimeout(checkSearchChange, 50);
        return res;
      };
    }
    const originReplaceState = targetWindow.history.replaceState;
    if (originReplaceState) {
      targetWindow.history.replaceState = function (...args) {
        const res = originReplaceState.apply(this, args);
        setTimeout(checkSearchChange, 50);
        return res;
      };
    }
    targetWindow.addEventListener('popstate', () => {
      setTimeout(checkSearchChange, 50);
    });

    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('button.vui_pagenation--btn, button.vui_pagenation--btn-num');
        if (btn) setTimeout(checkSearchChange, 80);
      },
      true
    );

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter') {
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.classList.contains('search-input'))) {
            setTimeout(() => resetWaterfallForNewSearch(true), 100);
          }
        }
      },
      true
    );

    document.addEventListener(
      'click',
      (e) => {
        const searchBtn = e.target.closest('.search-button, .search-btn, .nav-search-btn, button[class*="search"]');
        if (searchBtn) {
          setTimeout(() => resetWaterfallForNewSearch(true), 100);
        }
      },
      true
    );

    let scrollRafId = null;
    window.addEventListener(
      'scroll',
      () => {
        if (!state.isWaterfall) return;
        if (!scrollRafId) {
          scrollRafId = requestAnimationFrame(() => {
            scrollRafId = null;
            updateViewportPage();
          });
        }
        if (state.isWaterfallPaused || state.isPaging || state.isAllLoaded) return;
        checkAndTriggerPaging();
      },
      { passive: true }
    );

    let resizeTimer = null;
    window.addEventListener(
      'resize',
      () => {
        if (!state.isWaterfall) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          updateViewportPage();
          const curLoader = document.getElementById('bili-waterfall-loader');
          if (curLoader && curLoader.classList.contains('ended')) return;
          updateDynamicMaxPage();
          if (!state.isAllLoaded && state.currentRequestedPage >= state.maxWaterfallPage) {
            state.isAllLoaded = true;
            showEndedLoader();
          }
        }, 150);
      },
      { passive: true }
    );
  } catch {}
}
