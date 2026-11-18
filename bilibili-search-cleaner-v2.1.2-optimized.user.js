// ==UserScript==
// @name         Bilibili 去掉搜索无关视频 2.1.2 (极速无闪烁版)
// @namespace    http://tampermonkey.net/
// @version      2.1.2
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 @UP主 定向筛选、-排除词 与 #Tag 专项筛选。融合零开销守卫、数据源头拦截（网络层与InitialState）与瞬时防闪样式，彻底消除卡顿与刷新闪烁。
// @author       Kirosca
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/* global OpenCC */

(function() {
    'use strict';

    // ================= 0. 零开销快速守卫（Zero-Cost Guard） =================
    // 关键优化：若当前非搜索结果页（无有效 keyword 参数），脚本即刻完全退出，零 CPU 占用，不影响任何正常页面加载
    function hasActiveKeyword() {
        try {
            const params = new URLSearchParams(window.location.search);
            const kw = params.get('keyword');
            return kw && kw.trim().length > 0;
        } catch {
            return false;
        }
    }

    if (!hasActiveKeyword()) {
        return;
    }

    // ================= 1. 简繁转换单例与轻量 LRU 缓存 =================
    let sConverter = null;
    const ccCache = new Map();
    const MAX_CACHE_SIZE = 1500;

    function toSimplified(text) {
        if (!text) return '';
        if (ccCache.has(text)) return ccCache.get(text);

        let res = text;
        try {
            if (typeof OpenCC !== 'undefined') {
                if (!sConverter) {
                    sConverter = OpenCC.Converter({ from: 't', to: 'cn' });
                }
                res = sConverter(text);
            }
        } catch {}

        if (ccCache.size >= MAX_CACHE_SIZE) {
            const firstKey = ccCache.keys().next().value;
            ccCache.delete(firstKey);
        }
        ccCache.set(text, res);
        return res;
    }

    function cleanText(str) {
        if (!str) return '';
        const simplified = toSimplified(str);
        return simplified
            .replace(/&#x27;|&#39;|&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/[\u2018\u2019\u201A\u201B\uFF07`]/g, "'")
            .trim()
            .toLowerCase();
    }

    // ================= 2. 预注入 CSS 样式（广告秒杀与瞬时防闪） =================
    // 关键防闪机制：未完成安检的卡片默认透明，经判定合规后瞬间淡入，彻底杜绝“先出现再消失”的闪烁感
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }
        .bili-video-card:not([data-cleaner-checked]) {
            opacity: 0 !important;
        }
        .bili-video-card[data-cleaner-checked] {
            opacity: 1 !important;
            transition: opacity 0.12s ease-in;
        }
    `;
    (document.head || document.documentElement).appendChild(styleElement);

    // ================= 3. 搜索规则解析与 URL 参数缓存 =================
    let cachedSearchQuery = null;
    let cachedKeywords = null;

    function getSearchKeywords() {
        const currentSearch = window.location.search;
        if (cachedSearchQuery === currentSearch && cachedKeywords) {
            return cachedKeywords;
        }

        const params = new URLSearchParams(currentSearch);
        const rawParam = params.get('keyword') || '';
        const rawKeyword = cleanText(decodeURIComponent(rawParam.replace(/\+/g, ' ')));

        if (!rawKeyword) {
            cachedSearchQuery = currentSearch;
            cachedKeywords = { normal: [], exclude: [], tags: [], ups: [], hasRules: false };
            return cachedKeywords;
        }

        const list = rawKeyword.split(/\s+/);
        const normal = [];
        const exclude = [];
        const tags = [];
        const ups = [];

        for (const k of list) {
            if (k.startsWith('-') && k.length > 1) {
                exclude.push(k.substring(1));
            } else if (k.startsWith('#') && k.length > 1) {
                tags.push(k.substring(1));
            } else if (k.startsWith('@') && k.length > 1) {
                ups.push(k.substring(1));
            } else if (k) {
                normal.push(k);
            }
        }

        const hasRules = (normal.length > 0 || exclude.length > 0 || tags.length > 0 || ups.length > 0);
        cachedSearchQuery = currentSearch;
        cachedKeywords = { normal, exclude, tags, ups, hasRules };
        return cachedKeywords;
    }

    function getCleanApiKeyword() {
        const params = new URLSearchParams(window.location.search);
        const rawParam = params.get('keyword') || '';
        const rawKeyword = decodeURIComponent(rawParam.replace(/\+/g, ' ')).trim();
        if (!rawKeyword) return '';

        const list = rawKeyword.split(/\s+/);
        const searchTerms = [];
        for (const k of list) {
            if (k.startsWith('-')) {
                continue;
            } else if (k.startsWith('@') || k.startsWith('#')) {
                if (k.length > 1) searchTerms.push(k.substring(1));
            } else if (k) {
                searchTerms.push(k);
            }
        }
        return toSimplified(searchTerms.join(' '));
    }

    // ================= 4. 数据层规则过滤与源头拦截（消灭闪烁的根本） =================
    const videoTagMap = new Map();

    function storeTagsFromList(list) {
        if (!Array.isArray(list)) return;
        for (const v of list) {
            if (!v || typeof v !== 'object') continue;
            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = cleanText(v.tag || v.keywords || v.tags || '');
            if (id && rawTags) {
                videoTagMap.set(String(id), rawTags);
            }
        }
    }

    function filterVideoItemData(item, { normal, exclude, tags, ups }) {
        if (!item || typeof item !== 'object') return false;
        if (item.is_ad_loc || item.is_promoted || item.goto === 'ad' || item.type === 'ad') return false;

        const id = item.bvid || item.aid || item.id || item.season_id || item.roomid;
        const rawTitle = (item.title || '').replace(/<[^>]+>/g, '').replace(/&[a-z0-9#]+;/gi, '');
        const title = cleanText(rawTitle);

        const rawAuthor = (item.author || (item.owner && item.owner.name) || '').replace(/\s*[·•].*$/, '');
        const author = cleanText(rawAuthor);

        const rawTags = cleanText(item.tag || item.keywords || item.tags || (id ? videoTagMap.get(String(id)) : '') || '');

        // 1. 排除词判定
        if (exclude.length && exclude.some(k => title.includes(k) || (rawTags && rawTags.includes(k)))) {
            return false;
        }

        // 2. UP 主定向判定
        if (ups.length && !ups.some(k => author.includes(k))) {
            return false;
        }

        // 3. Tag 专项判定
        if (tags.length) {
            if (rawTags) {
                if (!tags.every(k => rawTags.includes(k))) return false;
            } else {
                if (!tags.some(k => title.includes(k))) return false;
            }
        }

        // 4. 标题核心关键词判定
        if (normal.length && !normal.every(k => title.includes(k))) {
            return false;
        }

        return true;
    }

    function cleanAdsOnly(list) {
        if (!Array.isArray(list)) return list;
        storeTagsFromList(list);
        return list.filter(v => {
            if (!v || typeof v !== 'object') return true;
            return !(v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad');
        });
    }

    // 首屏静态注入数据拦截清洗（在 Vue 水合前剔除无效数据）
    function sanitizeInitialState() {
        try {
            const keywords = getSearchKeywords();
            if (!keywords.hasRules) return;

            const res = window.__INITIAL_STATE__?.flowData?.result;
            if (Array.isArray(res)) {
                for (const cat of res) {
                    if (Array.isArray(cat?.data)) {
                        storeTagsFromList(cat.data);
                        cat.data = cat.data.filter(item => filterVideoItemData(item, keywords));
                    }
                }
            }
        } catch {}
    }

    // 监听 __INITIAL_STATE__ 属性注入
    let _initialState = window.__INITIAL_STATE__;
    try {
        Object.defineProperty(window, '__INITIAL_STATE__', {
            get() { return _initialState; },
            set(val) {
                _initialState = val;
                sanitizeInitialState();
            },
            configurable: true
        });
    } catch {
        sanitizeInitialState();
    }

    // 网络层即时过滤（返回给前端框架的数据已完成清洗，视图层直接渲染纯净列表）
    const originFetch = window.fetch;
    window.fetch = async function(...args) {
        let urlStr = '';
        if (typeof args[0] === 'string') {
            urlStr = args[0];
        } else if (args[0] && typeof args[0] === 'object') {
            urlStr = args[0].url || '';
        }

        const isSearchReq = urlStr.includes('/wbi/search') || urlStr.includes('/search/type') || urlStr.includes('/search/all');
        if (isSearchReq) {
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
                const keywords = getSearchKeywords();
                if (keywords.hasRules) {
                    if (Array.isArray(data.data.result)) {
                        if (data.data.result.length > 0 && data.data.result[0].data && Array.isArray(data.data.result[0].data)) {
                            for (const cat of data.data.result) {
                                if (cat.result_type === 'video' || cat.result_type === 'live_room' || !cat.result_type) {
                                    storeTagsFromList(cat.data);
                                    cat.data = cat.data.filter(item => filterVideoItemData(item, keywords));
                                }
                            }
                        } else {
                            storeTagsFromList(data.data.result);
                            data.data.result = data.data.result.filter(item => filterVideoItemData(item, keywords));
                        }
                    }
                } else {
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
                }

                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch {}

        return response;
    };

    // ================= 5. DOM 极速精准安检 =================
    let isProcessing = false;

    function filterDOMElements() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            sanitizeInitialState();
            const { normal, exclude, tags, ups, hasRules } = getSearchKeywords();
            if (!hasRules) return;

            const cardElements = document.querySelectorAll('.bili-video-card:not([data-cleaner-checked]), .video-list-item:not([data-cleaner-checked]), .bili-live-card:not([data-cleaner-checked])');
            if (cardElements.length === 0) return;

            cardElements.forEach(card => {
                const container = card.closest('div[class*="col_"]') || card;

                const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                if (!linkEl) return;

                const titleEl = card.querySelector('.bili-video-card__info--tit, .bili-live-card__info--tit, h3');
                if (!titleEl) return;

                const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
                const title = cleanText(rawTitle);
                if (!title) return;

                const link = linkEl.href || '';
                let id = '';
                const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
                const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
                if (matchVideo) id = matchVideo[1];
                else if (matchLive) id = matchLive[1];

                const videoTags = cleanText(videoTagMap.get(id) || '');

                const authorEl = card.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname');
                const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';
                const author = cleanText(rawAuthor.replace(/[\s·•].*$/, ''));

                let shouldHide = false;

                // 1. 排除词判定
                if (exclude.length && exclude.some(k => title.includes(k) || (videoTags && videoTags.includes(k)))) {
                    shouldHide = true;
                }

                // 2. UP 主定向判定
                if (!shouldHide && ups.length && !ups.some(k => author.includes(k))) {
                    shouldHide = true;
                }

                // 3. Tag 专项判定
                if (!shouldHide && tags.length) {
                    if (videoTags) {
                        if (!tags.every(k => videoTags.includes(k))) shouldHide = true;
                    } else {
                        if (!tags.some(k => title.includes(k))) shouldHide = true;
                    }
                }

                // 4. 标题核心关键词判定
                if (!shouldHide && normal.length && !normal.every(k => title.includes(k))) {
                    shouldHide = true;
                }

                // 判定完成打标，合规卡片瞬间恢复可见度
                card.setAttribute('data-cleaner-checked', 'true');

                if (shouldHide) {
                    container.style.setProperty('display', 'none', 'important');
                } else {
                    container.style.removeProperty('display');
                }
            });
        } finally {
            isProcessing = false;
        }
    }

    // ================= 6. 首次零延时执行 + 后续 120ms 防抖节流 =================
    let hasInitialFiltered = false;
    let debounceTimer = null;

    function scheduleFilter() {
        // 关键防闪：首次发现卡片节点时立即无延时同步清洗，绝不等待 120ms
        if (!hasInitialFiltered) {
            hasInitialFiltered = true;
            filterDOMElements();
            return;
        }

        // 后续的长效节点变动才走 120ms 防抖
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            filterDOMElements();
        }, 120);
    }

    let hasScopedObserver = false;
    function tryAttachScopedObserver() {
        const targetContainer = document.querySelector('.search-page, .search-all-list, .video-list, #i_ce芝士');
        if (targetContainer && !hasScopedObserver) {
            hasScopedObserver = true;
            const scopedObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.addedNodes.length > 0) {
                        scheduleFilter();
                        break;
                    }
                }
            });
            scopedObserver.observe(targetContainer, { childList: true, subtree: true });
        }
    }

    const globalObserver = new MutationObserver((mutations) => {
        tryAttachScopedObserver();
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                scheduleFilter();
                break;
            }
        }
    });

    globalObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            tryAttachScopedObserver();
            filterDOMElements();
        });
    } else {
        tryAttachScopedObserver();
        filterDOMElements();
    }

    window.addEventListener('load', () => {
        tryAttachScopedObserver();
        filterDOMElements();
    });

    window.addEventListener('popstate', () => {
        cachedSearchQuery = null;
        cachedKeywords = null;
        hasInitialFiltered = false;
        document.querySelectorAll('[data-cleaner-checked]').forEach(el => el.removeAttribute('data-cleaner-checked'));
        scheduleFilter();
    });

    console.log('[Bilibili 搜索净化] 2.1.2 (极速无闪烁版) 已启动。');
})();
