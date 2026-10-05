// ==UserScript==
// @name         Bilibili 去掉搜索无关视频（fuse.js）
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 Fuse.js 模糊匹配、@UP主 定向筛选、-排除词 与 #Tag 专项筛选，彻底净化搜索体验。（支持简繁）
// @author       Kirosca
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js
// @require      https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.basic.min.js
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/* global OpenCC, Fuse */

(function() {
    'use strict';

    // 0. 接入 OpenCC 单例转换器（由 @require 本地持久化驱动）
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

    // 1. 通用文本清洗：繁简归一化、HTML实体反转义与标点规范化
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

    // 2. 预注入 CSS 规则：秒杀视频流中的商业推广与小火箭广告卡片
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }
    `;
    (document.head || document.documentElement).appendChild(styleElement);

    // 3. 解析当前 URL 中的关键词分类 (普通词 / -排除词 / #Tag词 / @UP主词)
    function getSearchKeywords() {
        const params = new URLSearchParams(window.location.search);
        const rawParam = params.get('keyword') || '';
        const rawKeyword = cleanText(decodeURIComponent(rawParam.replace(/\+/g, ' ')));
        if (!rawKeyword) return { normal: [], exclude: [], tags: [], ups: [] };

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
        return { normal, exclude, tags, ups };
    }

    // 4. 提取发给 B 站接口的搜索词（智能脱壳与繁简归一化）
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

    // 5. 网络层拦截：存储 Tag 字典 + 接口层物理剔除广告
    const videoTagMap = new Map();

    function cleanAdsOnly(list) {
        if (!Array.isArray(list)) return list;

        return list.filter(v => {
            if (!v || typeof v !== 'object') return true;

            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = cleanText(v.tag || v.keywords || v.tags || '');
            if (id) videoTagMap.set(String(id), rawTags);

            if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;

            return true;
        });
    }

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

                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch {}

        return response;
    };

    // 6. 模糊匹配辅助工厂：优先快速包含，未命中时按需实例化 Fuse.js 进行模糊容错
    function createMatcher(targetText) {
        let fuseInstance = null;
        return function(queryKeyword) {
            if (!targetText || !queryKeyword) return false;
            // 优先严格子串包含判定（无额外开销）
            if (targetText.includes(queryKeyword)) return true;
            // 严格未命中时，引入 Fuse.js 模糊距离检索
            if (typeof Fuse !== 'undefined') {
                try {
                    if (!fuseInstance) {
                        fuseInstance = new Fuse([targetText], {
                            threshold: 0.5,
                            ignoreLocation: true
                        });
                    }
                    return fuseInstance.search(queryKeyword).length > 0;
                } catch {
                    return false;
                }
            }
            return false;
        };
    }

    // 7. DOM 层执行安检：支持高性能状态缓存、繁简归一化与模糊匹配
    let isProcessing = false;

    function filterDOMElements() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const { normal, exclude, tags, ups } = getSearchKeywords();
            if (!normal.length && !exclude.length && !tags.length && !ups.length) return;

            const currentSearchQuery = window.location.search;
            const elements = document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card');

            elements.forEach(el => {
                const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;

                // 性能缓存：当前卡片在本次搜索词下若已判定过，直接跳过，零重复计算
                if (card.dataset.purifiedQuery === currentSearchQuery) return;

                const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                if (!linkEl) return;

                const titleEl = card.querySelector('h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3');
                if (!titleEl) return;

                // 标记已安检完成
                card.dataset.purifiedQuery = currentSearchQuery;

                // 提取标题并进行反转义与标点规范化
                const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
                const title = cleanText(rawTitle);

                const link = linkEl.href || '';
                let id = '';
                const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
                const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
                if (matchVideo) id = matchVideo[1];
                else if (matchLive) id = matchLive[1];

                const videoTags = cleanText(videoTagMap.get(id) || '');

                // 纯净提取作者名字（提取第一署名作者）
                const authorEl = card.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname');
                const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';
                const author = cleanText(rawAuthor.replace(/[\s·•].*$/, ''));

                const matchTitle = createMatcher(title);
                const matchTags = createMatcher(videoTags);
                const matchAuthor = createMatcher(author);

                let shouldHide = false;

                // 四道安检关卡（排除词保持严格判定，普通词/标签/作者支持模糊容错）
                if (exclude.some(k => title.includes(k))) {
                    shouldHide = true;
                } else if (normal.length && !normal.every(k => matchTitle(k))) {
                    shouldHide = true;
                } else if (tags.length && !tags.every(k => matchTags(k))) {
                    shouldHide = true;
                } else if (ups.length && !ups.some(k => matchAuthor(k))) {
                    shouldHide = true;
                }

                if (shouldHide) {
                    card.style.setProperty('display', 'none', 'important');
                } else {
                    card.style.removeProperty('display');
                }
            });
        } finally {
            isProcessing = false;
        }
    }

    // 8. 帧级节流监听：使用 requestAnimationFrame 防抖
    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(filterDOMElements);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    console.log('[Bilibili 搜索净化] 2.1.0 (Fuse.js 模糊匹配) 已启动。');
})();
