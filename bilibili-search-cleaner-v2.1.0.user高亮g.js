// ==UserScript==
// @name         Bilibili 去掉搜索无关视频 2.1 发布版g
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 @UP主 定向筛选、-排除词 与 #Tag 专项筛选，彻底净化搜索体验。（支持简繁）
// @author       Kirosca
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/umd/t2cn.js
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

/* global OpenCC */

(function() {
    'use strict';

    // =========================================================================
    // 0. 基础环境配置与环境安全指针
    // =========================================================================
    const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // =========================================================================
    // 1. 单个油猴菜单管理（聚光灯高亮模式 状态：✅ / ❌）
    // =========================================================================
    let isSpotlight = localStorage.getItem('bili_cleaner_spotlight') === 'true';
    let menuCommandId = null;

    function registerPluginMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        if (typeof GM_unregisterMenuCommand === 'function' && menuCommandId !== null) {
            try { GM_unregisterMenuCommand(menuCommandId); } catch (e) {}
            menuCommandId = null;
        }

        const label = `聚光灯高亮模式: ${isSpotlight ? '✅' : '❌'}`;
        try {
            menuCommandId = GM_registerMenuCommand(label, toggleSpotlightMode);
        } catch (e) {
            console.error('[Bilibili 搜索净化] 菜单注册异常:', e);
        }
    }

    function toggleSpotlightMode() {
        isSpotlight = !isSpotlight;
        localStorage.setItem('bili_cleaner_spotlight', String(isSpotlight));
        registerPluginMenus();

        document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card').forEach(c => {
            delete c.dataset.purifiedQuery;
        });

        filterDOMElements();
    }

    registerPluginMenus();

    // =========================================================================
    // 2. OpenCC 单例繁简转换器 (带 LRU 内存缓存)
    // =========================================================================
    let sConverter = null;
    function toSimplified(text) {
        if (!text) return '';
        try {
            if (typeof OpenCC !== 'undefined') {
                if (!sConverter) {
                    sConverter = OpenCC.Converter({ from: 't', to: 'cn' });
                }
                return sConverter(text);
            }
        } catch {}
        return text;
    }

    const cleanTextCache = new Map();
    const MAX_CLEAN_CACHE_SIZE = 1000;

    function cleanText(str) {
        if (!str) return '';
        if (cleanTextCache.has(str)) {
            return cleanTextCache.get(str);
        }

        const simplified = toSimplified(str);
        const result = simplified
            .replace(/&#x27;|&#39;|&apos;/g, '')
            .replace(/&quot;/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/[\u2018\u2019\u201A\u201B\uFF07`']/g, '')
            .replace(/[\u201C\u201D\uFF02"]/g, '')
            .replace(/[\uFF5C|]/g, ' ')
            .trim()
            .toLowerCase();

        if (cleanTextCache.size >= MAX_CLEAN_CACHE_SIZE) {
            const firstKey = cleanTextCache.keys().next().value;
            cleanTextCache.delete(firstKey);
        }
        cleanTextCache.set(str, result);

        return result;
    }

    // =========================================================================
    // 3. 安全样式注入与首屏可见性抑制
    // =========================================================================
    let pendingTimeoutTimer = null;

    function setPendingState(enabled) {
        if (pendingTimeoutTimer) {
            clearTimeout(pendingTimeoutTimer);
            pendingTimeoutTimer = null;
        }

        if (document.documentElement) {
            if (enabled) {
                document.documentElement.classList.add('bili-cleaner-pending');
                // 安全阀：若 1.5 秒内未收到网络响应，自动解除隐藏防止页面永久白屏
                pendingTimeoutTimer = setTimeout(() => {
                    document.documentElement.classList.remove('bili-cleaner-pending');
                }, 1500);
            } else {
                document.documentElement.classList.remove('bili-cleaner-pending');
            }
        }
    }

    if (document.documentElement) {
        setPendingState(true);
    } else {
        const rootWatcher = setInterval(() => {
            if (document.documentElement) {
                setPendingState(true);
                clearInterval(rootWatcher);
            }
        }, 10);
    }

    const styleElement = document.createElement('style');
    styleElement.textContent = `
        /* 仅在未点击搜索且未拿到净化流前，精准隐藏视频网格，严禁隐藏父级大容器 */
        html.bili-cleaner-pending .video-list,
        html.bili-cleaner-pending div.video-list.row,
        html.bili-cleaner-pending .video-list-item,
        html.bili-cleaner-pending .bili-video-card,
        html.bili-cleaner-pending div[class*="col_"]:has(.bili-video-card) {
            visibility: hidden !important;
        }

        /* 显式保护分页组件与底栏，永远保持正常展示 */
        .vui_pagenation,
        .vui_pagenation--btn,
        .vui_pagenation--btn-num,
        .search-bottom {
            visibility: visible !important;
        }

        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }
        .bili-cleaner-dimmed {
            opacity: 0.16 !important;
            filter: grayscale(85%) contrast(85%) !important;
            transition: opacity 0.25s ease, filter 0.25s ease, transform 0.25s ease !important;
        }
        .bili-cleaner-dimmed:hover {
            opacity: 1 !important;
            filter: none !important;
            transform: translateY(-2px);
            z-index: 10;
        }
        .bili-cleaner-highlighted {
            opacity: 1 !important;
            filter: none !important;
            position: relative;
            border-radius: 8px;
            box-shadow: 0 0 0 2px #00aeec, 0 8px 24px rgba(0, 174, 236, 0.22) !important;
            transition: box-shadow 0.25s ease, transform 0.25s ease !important;
        }
        .bili-cleaner-highlighted::before {
            content: "🎯 目标匹配";
            position: absolute;
            top: 6px;
            right: 6px;
            background: linear-gradient(135deg, #00aeec, #008ac5);
            color: #fff;
            font-size: 11px;
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 4px;
            z-index: 10;
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
            pointer-events: none;
        }
    `;

    function injectStyle() {
        const target = document.head || document.documentElement;
        if (target) {
            target.appendChild(styleElement);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                (document.head || document.documentElement).appendChild(styleElement);
            }, { once: true });
        }
    }
    injectStyle();

    function applyCardFilterVisual(card, isMatch) {
        if (isSpotlight) {
            card.style.removeProperty('display');
            if (isMatch) {
                card.classList.add('bili-cleaner-highlighted');
                card.classList.remove('bili-cleaner-dimmed');
            } else {
                card.classList.add('bili-cleaner-dimmed');
                card.classList.remove('bili-cleaner-highlighted');
            }
        } else {
            card.classList.remove('bili-cleaner-highlighted', 'bili-cleaner-dimmed');
            if (isMatch) {
                card.style.removeProperty('display');
            } else {
                card.style.setProperty('display', 'none', 'important');
            }
        }
    }

    // =========================================================================
    // 4. 语法解析引擎（严格以生效 URL 为准）
    // =========================================================================
    function getRawSearchKeyword() {
        let kw = '';

        const params = new URLSearchParams(window.location.search);
        const searchKeyword = params.get('keyword');
        if (searchKeyword !== null) {
            kw = searchKeyword;
        }

        if (window.location.hash) {
            const hash = window.location.hash;
            if (hash.includes('keyword=')) {
                try {
                    const hashParams = new URLSearchParams(hash.slice(hash.indexOf('?')));
                    const val = hashParams.get('keyword');
                    if (val) kw = val;
                } catch (e) {}
            } else if (!hash.startsWith('#/') && !hash.startsWith('#?')) {
                const tagFragment = decodeURIComponent(hash.slice(1)).trim();
                if (tagFragment) {
                    if (kw) {
                        kw = decodeURIComponent(kw.replace(/\+/g, ' ')) + ' #' + tagFragment;
                    } else {
                        kw = '#' + tagFragment;
                    }
                }
            }
        }

        try {
            return decodeURIComponent(kw.replace(/\+/g, ' ')).trim();
        } catch (e) {
            return kw.replace(/\+/g, ' ').trim();
        }
    }

    let lastKnownKeyword = getRawSearchKeyword();

    function getSearchKeywords() {
        const rawKeyword = cleanText(getRawSearchKeyword());
        if (!rawKeyword) return { normal: [], exclude: [], tags: [], ups: [], hasRules: false };

        const list = rawKeyword.split(/\s+/);
        const normal = [];
        const exclude = [];
        const tags = [];
        const ups = [];

        for (let k of list) {
            k = k.replace(/^[\*＊]+/, '')
                 .replace(/^[\#＃]/, '#')
                 .replace(/^[\@＠]/, '@')
                 .replace(/^[\-－]/, '-');

            if (k === '#' || k === '@' || k === '-' || !k) {
                continue;
            }

            if (k.startsWith('-') && k.length > 1) {
                exclude.push(k.substring(1));
            } else if (k.startsWith('#') && k.length > 1) {
                tags.push(k.substring(1));
            } else if (k.startsWith('@') && k.length > 1) {
                ups.push(k.substring(1));
            } else {
                normal.push(k);
            }
        }

        const hasRules = Boolean(normal.length || exclude.length || tags.length || ups.length);
        return { normal, exclude, tags, ups, hasRules };
    }

    // =========================================================================
    // 5. 网络层安全拦截：捕获搜索请求并填充 Tag 字典
    // =========================================================================
    const videoTagMap = new Map();
    const MAX_TAG_MAP_SIZE = 1000;
    let isTagDictionaryReady = false;

    function saveTag(id, tags) {
        if (!id || !tags) return;
        if (videoTagMap.size >= MAX_TAG_MAP_SIZE) {
            const firstKey = videoTagMap.keys().next().value;
            videoTagMap.delete(firstKey);
        }
        const sId = String(id);
        videoTagMap.set(sId, tags);
        videoTagMap.set(sId.toLowerCase(), tags);
        videoTagMap.set(sId.toUpperCase(), tags);
    }

    function cleanAdsOnly(list) {
        if (!Array.isArray(list)) return list;
        return list.filter(v => {
            if (!v || typeof v !== 'object') return true;
            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = cleanText(v.tag || v.keywords || v.tags || '');
            if (rawTags) {
                if (id) saveTag(id, rawTags);
                if (v.bvid) saveTag(v.bvid, rawTags);
                if (v.aid) saveTag(v.aid, rawTags);
            }
            if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;
            return true;
        });
    }

    function parseSearchResponse(responseText) {
        let hasData = false;
        try {
            const data = JSON.parse(responseText);
            if (data?.data?.result) {
                if (Array.isArray(data.data.result)) {
                    if (data.data.result.length > 0 && data.data.result[0].data && Array.isArray(data.data.result[0].data)) {
                        for (const cat of data.data.result) {
                            if (cat.result_type === 'video' || cat.result_type === 'live_room' || !cat.result_type) {
                                cleanAdsOnly(cat.data);
                                hasData = true;
                            }
                        }
                    } else {
                        cleanAdsOnly(data.data.result);
                        hasData = true;
                    }
                }
            }
        } catch (e) {}

        if (hasData) {
            isTagDictionaryReady = true;
        }

        document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card').forEach(c => {
            delete c.dataset.purifiedQuery;
        });

        setPendingState(false);
        scheduleFilter();
    }

    const originFetch = targetWin.fetch || window.fetch;
    const customFetch = async function(...args) {
        let urlStr = '';
        if (typeof args[0] === 'string') urlStr = args[0];
        else if (args[0] && typeof args[0] === 'object') urlStr = args[0].url || '';

        const isSearchReq = urlStr.includes('/wbi/search') || urlStr.includes('/search/type') || urlStr.includes('/search/all');
        const response = await originFetch.apply(this, args);
        if (!isSearchReq) return response;

        try {
            const clone = response.clone();
            const text = await clone.text();
            parseSearchResponse(text);
        } catch {}

        return response;
    };
    targetWin.fetch = customFetch;
    try { if (window !== targetWin) window.fetch = customFetch; } catch (e) {}

    const originXHR = targetWin.XMLHttpRequest || window.XMLHttpRequest;
    function CustomXHR() {
        const xhr = new originXHR();
        let requestUrl = '';

        const origOpen = xhr.open;
        xhr.open = function(method, url, ...rest) {
            requestUrl = String(url || '');
            return origOpen.call(this, method, url, ...rest);
        };

        xhr.addEventListener('load', function() {
            const isSearch = requestUrl.includes('/wbi/search') || requestUrl.includes('/search/type') || requestUrl.includes('/search/all');
            if (isSearch && xhr.responseText) {
                parseSearchResponse(xhr.responseText);
            }
        });

        return xhr;
    }
    CustomXHR.prototype = originXHR.prototype;
    Object.keys(originXHR).forEach(k => {
        try { CustomXHR[k] = originXHR[k]; } catch (e) {}
    });
    targetWin.XMLHttpRequest = CustomXHR;
    try { if (window !== targetWin) window.XMLHttpRequest = CustomXHR; } catch (e) {}

    // =========================================================================
    // 6. 核心判定器与 DOM 层安检
    // =========================================================================
    function checkVideoMatch(titleRaw, tagsRaw, authorRaw, filters) {
        const title = cleanText(titleRaw);
        const tags = cleanText(tagsRaw);
        const author = cleanText((authorRaw || '').trim().replace(/\s*[·•]\s*(?:\d+[-/年\.]|\d+\s*(?:天|小时|分钟|秒)前).*$/, '').trim());

        const { normal, exclude, tags: filterTags, ups } = filters;

        // 1. 排除词一票否决
        if (exclude.some(k => title.includes(k))) return false;

        // 2. 普通词：严格包含 (AND)
        if (normal.length && !normal.every(k => title.includes(k))) return false;

        // 3. 标签匹配：严格比对 Tag 字典
        if (filterTags.length) {
            if (!tags || tags.length === 0) return false;
            const hasTagMatch = filterTags.every(k => tags.includes(k));
            if (!hasTagMatch) return false;
        }

        // 4. UP主匹配
        if (ups.length && !ups.some(k => author.includes(k))) return false;

        return true;
    }

    let isProcessing = false;

    function filterDOMElements() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const filters = getSearchKeywords();

            // 无规则或清空搜索词时：解除抑制并还原所有卡片显示状态
            if (!filters.hasRules && !filters.normal.length) {
                setPendingState(false);
                document.querySelectorAll('.bili-cleaner-highlighted, .bili-cleaner-dimmed, [data-purified-query]').forEach(el => {
                    el.classList.remove('bili-cleaner-highlighted', 'bili-cleaner-dimmed');
                    if (el.style.display === 'none') {
                        el.style.removeProperty('display');
                    }
                    delete el.dataset.purifiedQuery;
                });
                return;
            }

            const currentSearchQuery = getRawSearchKeyword() + '_' + (isSpotlight ? 'spotlight' : 'hide');
            let cards = document.querySelectorAll('.video-list-item, div.video-list > div[class*="col_"], .bili-live-card');
            if (!cards || cards.length === 0) {
                cards = document.querySelectorAll('.bili-video-card');
            }

            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];

                if (card.dataset.purifiedQuery !== currentSearchQuery) {
                    const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                    if (!linkEl) continue;

                    const titleEl = card.querySelector('h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3');
                    if (!titleEl) continue;

                    const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
                    if (!rawTitle.trim()) continue;

                    const authorEl = card.querySelector('.bili-video-card__info--author, .bili-video-card__info--author-name, .up-name, .bili-live-card__info--uname, a[href*="space.bilibili.com"]');
                    const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';

                    if (filters.ups.length && !rawAuthor.trim()) {
                        continue;
                    }

                    const link = linkEl.href || '';
                    let id = '';
                    const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
                    const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
                    if (matchVideo) id = matchVideo[1];
                    else if (matchLive) id = matchLive[1];

                    const rawTags = videoTagMap.get(id) || videoTagMap.get(id.toLowerCase()) || card.dataset.tags || '';

                    // 字典未到位前不打标记缓存，保持暗化/隐藏等待用户点击搜索
                    if (filters.tags.length && !rawTags && !isTagDictionaryReady) {
                        applyCardFilterVisual(card, false);
                        continue;
                    }

                    card.dataset.purifiedQuery = currentSearchQuery;

                    const isMatch = checkVideoMatch(rawTitle, rawTags, rawAuthor, filters);
                    applyCardFilterVisual(card, isMatch);
                }
            }
        } finally {
            isProcessing = false;
        }
    }

    // =========================================================================
    // 7. 节点监听与路由劫持（加入关键词变更比对防线）
    // =========================================================================
    let rafId = null;

    function scheduleFilter() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(filterDOMElements);
    }

    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            if (m.type === 'childList') {
                const nodes = m.addedNodes;
                for (let j = 0; j < nodes.length; j++) {
                    const node = nodes[j];
                    if (node.nodeType === 1) {
                        const cl = node.classList;
                        if (
                            (cl && (
                                cl.contains('bili-video-card') ||
                                cl.contains('video-list-item') ||
                                cl.contains('video-list') ||
                                cl.contains('bili-live-card')
                            )) ||
                            (node.querySelector && node.querySelector('.bili-video-card, .video-list-item'))
                        ) {
                            shouldUpdate = true;
                            break;
                        }
                    }
                }
            }
            if (shouldUpdate) break;
        }

        if (shouldUpdate) {
            scheduleFilter();
        }
    });

    function startObserver() {
        if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                observer.observe(document.documentElement, { childList: true, subtree: true });
            }, { once: true });
        }
    }
    startObserver();

    // 核心防线：严格比对关键词实质变动，杜绝埋点 replaceState 误触发隐藏
    function handleLocationChange() {
        const currentKeyword = getRawSearchKeyword();
        if (currentKeyword === lastKnownKeyword) {
            return; // 关键词未变（仅埋点参数更新），直接忽略
        }

        lastKnownKeyword = currentKeyword;
        isTagDictionaryReady = false;
        setPendingState(true);

        document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card').forEach(c => {
            delete c.dataset.purifiedQuery;
        });

        setTimeout(scheduleFilter, 150);
    }

    const rawPushState = targetWin.history.pushState;
    if (rawPushState) {
        targetWin.history.pushState = function(...args) {
            const ret = rawPushState.apply(this, args);
            handleLocationChange();
            return ret;
        };
    }

    const rawReplaceState = targetWin.history.replaceState;
    if (rawReplaceState) {
        targetWin.history.replaceState = function(...args) {
            const ret = rawReplaceState.apply(this, args);
            handleLocationChange();
            return ret;
        };
    }

    targetWin.addEventListener('popstate', handleLocationChange);
    targetWin.addEventListener('hashchange', handleLocationChange);

    document.addEventListener('DOMContentLoaded', () => {
        registerPluginMenus();
    });

    console.log('[Bilibili 搜索净化] 2.1.0 运行就绪，埋点误触与超时防护已加固。');
})();