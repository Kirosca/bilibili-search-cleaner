// ==UserScript==
// @name         Bilibili 去掉搜索无关视频 2.1 发布版 => 2.2 手搓
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 @UP主 定向筛选、-排除词 与 #Tag 专项筛选，彻底净化搜索体验。（支持简繁）
// @author       Kirosca
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==
 
/* global OpenCC */
 
(function() {
    'use strict';

    // ==========================================
    // 菜单管理与持久化配置（默认开启聚光灯模式）
    // ==========================================
    let isSpotlight = localStorage.getItem('bili_cleaner_spotlight') !== 'false';
    let menuCommandId = null;

    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        // 注销上一轮菜单，防止重复追加
        if (typeof GM_unregisterMenuCommand === 'function' && menuCommandId !== null) {
            try { GM_unregisterMenuCommand(menuCommandId); } catch (e) {}
        }

        const label = `聚光灯高亮模式: ${isSpotlight ? '✅ 已开启' : '❌ 已关闭（物理隐藏）'}`;
        menuCommandId = GM_registerMenuCommand(label, toggleSpotlight);
    }

    function toggleSpotlight() {
        isSpotlight = !isSpotlight;
        localStorage.setItem('bili_cleaner_spotlight', String(isSpotlight));
        registerMenu();

        // 清空所有卡片的安检缓存标记，并立即触发重新判定
        document.querySelectorAll('[data-purified-query]').forEach(card => {
            delete card.dataset.purifiedQuery;
        });
        filterDOMElements();
    }

    registerMenu();
 
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
 
    // 2. 预注入 CSS 规则：秒杀视频流中的商业推广与小火箭广告卡片，并注入聚光灯高亮与暗化样式
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }

        /* 1. 目标匹配卡片：全彩饱和 + 蓝青发光微框 + 右上角徽章 */
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
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
            pointer-events: none;
        }

        /* 2. 未匹配卡片常态暗化：深度半透明 + 灰度去色 + 占位保留 */
        .bili-cleaner-dimmed {
            opacity: 0.16 !important;
            filter: grayscale(85%) contrast(85%) !important;
            transition: opacity 0.25s ease, filter 0.25s ease, transform 0.25s ease !important;
        }

        /* 3. 暗化卡片悬停临时查验 */
        .bili-cleaner-dimmed:hover {
            opacity: 0.95 !important;
            filter: none !important;
            transform: translateY(-2px);
            z-index: 10;
        }
    `;
    (document.head || document.documentElement).appendChild(styleElement);
 
    // 3. 解析当前 URL 中的关键词分类 (普通词 / -排除词 / #Tag词 / @UP主词)
    function getSearchKeywords() {
        const params = new URLSearchParams(window.location.search);
        let rawParam = params.get('keyword') || '';
        // 兼容处理：若浏览器将未编码的 # 截断至 Hash Fragment，补充拼回
        if (window.location.hash && !rawParam.includes('#')) {
            const hashContent = decodeURIComponent(window.location.hash.replace(/^#/, ''));
            if (hashContent) {
                rawParam += ' #' + hashContent;
            }
        }
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

            const tagText = [v.tag, v.keywords, v.tags, v.typename].filter(Boolean).join(',');
            const rawTags = cleanText(tagText);

            if (v.bvid) videoTagMap.set(String(v.bvid), rawTags);
            if (v.aid) {
                videoTagMap.set(String(v.aid), rawTags);
                videoTagMap.set("av" + v.aid, rawTags);
            }
            if (v.id) videoTagMap.set(String(v.id), rawTags);
            if (v.season_id) videoTagMap.set(String(v.season_id), rawTags);
            if (v.roomid) videoTagMap.set(String(v.roomid), rawTags);

            if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;

            return true;
        });
    }
 
    // 突破油猴沙箱隔离：锁定宿主真实 window 对象
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // 首屏 SSR 初始状态补偿读取（适配现代 Vite + Pinia 架构与旧版 __INITIAL_STATE__）
    function scanInitialState() {
        try {
            const pinia = targetWindow.__pinia;
            if (pinia) {
                // 1. 综合搜索：searchResponse.searchAllResponse.result
                const allRes = pinia.searchResponse?.searchAllResponse?.result;
                if (Array.isArray(allRes)) {
                    for (const cat of allRes) {
                        if (cat.data && Array.isArray(cat.data)) {
                            cleanAdsOnly(cat.data);
                        }
                    }
                }

                // 2. 分类搜索（如 /video）：searchTypeResponse.searchTypeResponse.result
                const typeRes = pinia.searchTypeResponse?.searchTypeResponse?.result;
                if (Array.isArray(typeRes)) {
                    cleanAdsOnly(typeRes);
                }
            }

            // 3. 兜底兼容旧版 SSR 格式
            const state = targetWindow.__INITIAL_STATE__;
            if (state?.flow?.data && Array.isArray(state.flow.data)) {
                cleanAdsOnly(state.flow.data);
            } else if (state?.result && Array.isArray(state.result)) {
                cleanAdsOnly(state.result);
            }
        } catch (e) {}
    }
    scanInitialState();
    window.addEventListener('DOMContentLoaded', () => {
        scanInitialState();
        filterDOMElements();
    });
    window.addEventListener('load', () => {
        scanInitialState();
        filterDOMElements();
    });

    const originFetch = targetWindow.fetch;
    targetWindow.fetch = async function(...args) {
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
 
                // 数据就绪后唤醒重新安检：清除时序过早判定的缓存并重新执行过滤
                setTimeout(() => {
                    document.querySelectorAll('[data-purified-query]').forEach(card => {
                        delete card.dataset.purifiedQuery;
                    });
                    filterDOMElements();
                }, 50);

                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch {}
 
        return response;
    };
 
    // 6. DOM 层执行安检：支持高性能状态缓存与繁简归一化
    let isProcessing = false;
 
    function filterDOMElements() {
        if (isProcessing) return;
        isProcessing = true;
 
        try {
            const { normal, exclude, tags, ups } = getSearchKeywords();
            if (!normal.length && !exclude.length && !tags.length && !ups.length) return;

            // 若包含标签筛选且本地 Tag 字典尚为空，主动扫描首屏状态
            if (tags.length && videoTagMap.size === 0) {
                scanInitialState();
            }
 
            const currentSearchQuery = window.location.search;
            const currentQueryKey = currentSearchQuery + '_' + (isSpotlight ? 'spotlight' : 'hide');
            const elements = document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card');
 
            elements.forEach(el => {
                const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
 
                // 性能缓存：当前卡片在本次搜索词及当前模式下若已判定过，直接跳过，零重复计算
                if (card.dataset.purifiedQuery === currentQueryKey) return;
 
                const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                if (!linkEl) return;
 
                const titleEl = card.querySelector('h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3');
                if (!titleEl) return;
 
                // 只有在不依赖 Tag 或 Tag 数据已就绪时，才记录缓存标记，避免未就绪时被提前锁死
                if (!tags.length || videoTagMap.size > 0) {
                    card.dataset.purifiedQuery = currentQueryKey;
                }
 
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
 
                let shouldHide = false;
 
                // 四道安检关卡
                if (exclude.some(k => title.includes(k))) {
                    shouldHide = true;
                } else if (normal.length && !normal.every(k => title.includes(k))) {
                    shouldHide = true;
                } else if (tags.length && !tags.every(k => videoTags.includes(k))) {
                    shouldHide = true;
                } else if (ups.length && !ups.some(k => author.includes(k))) {
                    shouldHide = true;
                }

                // 聚光灯高亮 vs 传统物理隐藏判定（跟随全局/菜单选项 isSpotlight）
                if (isSpotlight) {
                    card.style.removeProperty('display');
                    if (!shouldHide) {
                        // 目标匹配（命中规则）：全彩高亮 + 蓝青微光 + 右上角微标
                        card.classList.add('bili-cleaner-highlighted');
                        card.classList.remove('bili-cleaner-dimmed');
                    } else {
                        // 未匹配（不符合规则）：常态半透明去色暗化
                        card.classList.add('bili-cleaner-dimmed');
                        card.classList.remove('bili-cleaner-highlighted');
                    }
                } else {
                    card.classList.remove('bili-cleaner-highlighted', 'bili-cleaner-dimmed');
                    if (shouldHide) {
                        card.style.setProperty('display', 'none', 'important');
                    } else {
                        card.style.removeProperty('display');
                    }
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

    console.log('[Bilibili 搜索净化] 2.1.0 已启动。');
})();