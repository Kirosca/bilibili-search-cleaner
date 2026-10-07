// ==UserScript==
// @name         Bilibili 去掉搜索无关视频
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 | 或者条件、@UP主 定向/精确筛选、-排除词 与 #Tag 模糊/精确筛选，彻底净化搜索体验。（支持简繁）
// @author       Kirosca
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js
// @run-at       document-start
// @grant        none
// @license      MIT
// @downloadURL  https://update.greasyfork.org/scripts/585515/Bilibili%20%E5%8E%BB%E6%8E%89%E6%90%9C%E7%B4%A2%E6%97%A0%E5%85%B3%E8%A7%86%E9%A2%91.user.js
// @updateURL    https://update.greasyfork.org/scripts/585515/Bilibili%20%E5%8E%BB%E6%8E%89%E6%90%9C%E7%B4%A2%E6%97%A0%E5%85%B3%E8%A7%86%E9%A2%91.meta.js
// ==/UserScript==

/* global OpenCC */

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

    // 1. 通用文本清洗：繁简归一化、HTML实体反转义与标点规范化（含中文全角标点兼容）
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
            .replace(/[\u201C\u201D\uFF02]/g, '"')
            .replace(/\uFF5C/g, '|')
            .replace(/\uFF03/g, '#')
            .replace(/\uFF20/g, '@')
            .replace(/\uFF0D/g, '-')
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

    // 3. 高级筛选语法解析引擎 (支持 | 或者条件、#"精确Tag"、@"精确UP"、-排除等)
    function splitByTopLevelPipe(str) {
        const branches = [];
        let curr = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            if (inQuote) {
                curr += char;
                if (char === quoteChar) inQuote = false;
            } else {
                if (char === '"' || char === "'") {
                    inQuote = true;
                    quoteChar = char;
                    curr += char;
                } else if (char === '|') {
                    if (curr.trim()) branches.push(curr.trim());
                    curr = '';
                } else {
                    curr += char;
                }
            }
        }
        if (curr.trim()) branches.push(curr.trim());
        return branches;
    }

    function tokenizeBranch(branchStr) {
        const tokens = [];
        let curr = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < branchStr.length; i++) {
            const char = branchStr[i];
            if (inQuote) {
                curr += char;
                if (char === quoteChar) inQuote = false;
            } else {
                if (char === '"' || char === "'") {
                    inQuote = true;
                    quoteChar = char;
                    curr += char;
                } else if (/\s/.test(char)) {
                    if (curr.length > 0) {
                        tokens.push(curr);
                        curr = '';
                    }
                } else {
                    curr += char;
                }
            }
        }
        if (curr.length > 0) tokens.push(curr);
        return tokens;
    }

    function parseToken(rawToken) {
        let t = rawToken.trim();
        if (!t) return null;

        let isNeg = false;
        if (t.startsWith('-')) {
            isNeg = true;
            t = t.substring(1);
        }

        let target = 'title'; // 'title' | 'tag' | 'author'
        if (t.startsWith('#')) {
            target = 'tag';
            t = t.substring(1);
        } else if (t.startsWith('@')) {
            target = 'author';
            t = t.substring(1);
        }

        let isExact = false;
        let val = t;
        if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
            (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
            isExact = true;
            val = val.slice(1, -1);
        }

        const cleanVal = cleanText(val);
        if (!cleanVal) return null;

        return { isNeg, target, isExact, val: cleanVal };
    }

    function parseSearchQuery() {
        const params = new URLSearchParams(window.location.search);
        const rawParam = params.get('keyword') || '';
        if (!rawParam) return { exclusions: [], branches: [], hasRules: false };

        const cleaned = cleanText(decodeURIComponent(rawParam.replace(/\+/g, ' ')));
        const branchStrings = splitByTopLevelPipe(cleaned);

        const exclusions = [];
        const branches = [];

        for (const bStr of branchStrings) {
            const rawTokens = tokenizeBranch(bStr);
            const posTokens = [];

            for (const rt of rawTokens) {
                const parsed = parseToken(rt);
                if (!parsed) continue;
                if (parsed.isNeg) {
                    exclusions.push(parsed);
                } else {
                    posTokens.push(parsed);
                }
            }
            if (posTokens.length > 0) {
                branches.push(posTokens);
            }
        }
        return {
            exclusions,
            branches,
            hasRules: exclusions.length > 0 || branches.length > 0
        };
    }

    // 4. 提取发给 B 站接口的搜索词（智能脱壳与负向规则剥离）
    function getCleanApiKeyword() {
        const parsedQuery = parseSearchQuery();
        if (!parsedQuery.hasRules) return '';

        const positiveTerms = [];
        for (const branch of parsedQuery.branches) {
            for (const cond of branch) {
                if (cond.val) {
                    positiveTerms.push(cond.val);
                }
            }
        }
        return toSimplified(positiveTerms.join(' '));
    }

    // 5. 网络层拦截：存储 Tag 字典 + 接口层物理剔除广告
    const videoTagMap = new Map();

    function cleanAdsOnly(list) {
        if (!Array.isArray(list)) return list;

        return list.filter(v => {
            if (!v || typeof v !== 'object') return true;

            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = cleanText(v.tag || v.keywords || v.tags || '');
            if (id) {
                const tagList = rawTags ? rawTags.split(/[,，、]+/).map(t => t.trim()).filter(Boolean) : [];
                const tagSet = new Set(tagList);
                videoTagMap.set(String(id), { rawTags, tagList, tagSet });
            }

            if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;

            return true;
        });
    }

    function getCardTagData(id) {
        if (id && videoTagMap.has(String(id))) {
            return videoTagMap.get(String(id));
        }
        return { rawTags: '', tagList: [], tagSet: new Set() };
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

    // 6. DOM 层执行安检：支持统一布尔逻辑判定（AND / OR / 排除 / 精确匹配）
    function testCard(parsedQuery, cardInfo) {
        if (!parsedQuery.hasRules) return true;
        const { title, author, tagList, tagSet, rawTags } = cardInfo;

        // 1. 任何一个排除规则命中，直接过滤隐藏
        for (const ex of parsedQuery.exclusions) {
            if (ex.target === 'title') {
                if (title.includes(ex.val)) return false;
            } else if (ex.target === 'author') {
                if (ex.isExact ? (author === ex.val) : author.includes(ex.val)) return false;
            } else if (ex.target === 'tag') {
                if (ex.isExact ? tagSet.has(ex.val) : (tagList.some(t => t.includes(ex.val)) || rawTags.includes(ex.val))) return false;
            }
        }

        // 2. 如果只有排除条件没有正向条件，排除通过即保留
        if (parsedQuery.branches.length === 0) {
            return true;
        }

        // 3. 正向条件：满足任一分支即可通过 (OR 逻辑)
        return parsedQuery.branches.some(branch => {
            // 分支内所有正向条件必须同时满足 (AND 逻辑)
            return branch.every(cond => {
                if (cond.target === 'title') {
                    return title.includes(cond.val);
                } else if (cond.target === 'author') {
                    return cond.isExact ? (author === cond.val) : author.includes(cond.val);
                } else if (cond.target === 'tag') {
                    return cond.isExact ? tagSet.has(cond.val) : (tagList.some(t => t.includes(cond.val)) || rawTags.includes(cond.val));
                }
                return false;
            });
        });
    }

    let isProcessing = false;

    function filterDOMElements() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const parsedQuery = parseSearchQuery();
            if (!parsedQuery.hasRules) return;

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

                const { rawTags, tagList, tagSet } = getCardTagData(id);

                // 纯净提取作者名字（提取第一署名作者）
                const authorEl = card.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname');
                const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';
                const author = cleanText(rawAuthor.replace(/[\s·•].*$/, ''));

                const cardInfo = { title, author, tagList, tagSet, rawTags };
                const isMatch = testCard(parsedQuery, cardInfo);

                if (!isMatch) {
                    card.style.setProperty('display', 'none', 'important');
                } else {
                    card.style.removeProperty('display');
                }
            });
        } finally {
            isProcessing = false;
        }
    }

    // 7. 帧级节流监听：使用 requestAnimationFrame 防抖
    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(filterDOMElements);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    console.log('[Bilibili 搜索净化] 2.2.0 已启动。');
})();
