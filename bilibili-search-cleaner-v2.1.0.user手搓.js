// ==UserScript==
// @name         Bilibili 去掉搜索无关视频 2.1 发布版 => 2.2 手搓
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

    // 0. 窗口隔离：仅限顶层窗口（Top Window）执行，严禁在瀑布流子 iframe 中重复执行脚本与注册菜单
    if (window.self !== window.top) {
        return;
    }

    // ==========================================
    // 菜单管理与持久化配置（聚光灯模式 & 筛选常驻 & 无缝瀑布流）
    // ==========================================
    let isSpotlight = localStorage.getItem('bili_cleaner_spotlight') !== 'false';
    let isFilterSticky = localStorage.getItem('bili_cleaner_sticky_filter') !== 'false';
    let isWaterfallEnabled = localStorage.getItem('bili_cleaner_waterfall') !== 'false';
    let spotlightMenuId = null;
    let filterStickyMenuId = null;
    let waterfallMenuId = null;

    // 瀑布流模块核心运行状态变量提升声明（规避 TDZ 暂时性死区）
    let isWaterfallPaused = false;
    let isPaging = false;
    let isAllLoaded = false;
    let currentRequestedPage = 1;
    let waterfallIntersectionObserver = null;
    let seenVideoKeyMap = Object.create(null);

    function registerMenu() {
        if (window.self !== window.top) return;
        if (typeof GM_registerMenuCommand !== 'function') return;

        // 注销上一轮菜单，防止重复追加
        if (typeof GM_unregisterMenuCommand === 'function') {
            if (spotlightMenuId !== null) {
                try { GM_unregisterMenuCommand(spotlightMenuId); } catch (e) {}
            }
            if (filterStickyMenuId !== null) {
                try { GM_unregisterMenuCommand(filterStickyMenuId); } catch (e) {}
            }
            if (waterfallMenuId !== null) {
                try { GM_unregisterMenuCommand(waterfallMenuId); } catch (e) {}
            }
        }

        const spotlightLabel = `聚光灯高亮模式: ${isSpotlight ? '✅ 已开启' : '❌ 已关闭'}`;
        spotlightMenuId = GM_registerMenuCommand(spotlightLabel, toggleSpotlight);

        const filterStickyLabel = `搜索筛选常驻: ${isFilterSticky ? '✅ 已开启' : '❌ 已关闭'}`;
        filterStickyMenuId = GM_registerMenuCommand(filterStickyLabel, toggleFilterSticky);

        const waterfallLabel = `无缝瀑布流: ${isWaterfallEnabled ? '✅ 已开启' : '❌ 已关闭'}`;
        waterfallMenuId = GM_registerMenuCommand(waterfallLabel, toggleWaterfall);
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

    function toggleFilterSticky() {
        isFilterSticky = !isFilterSticky;
        localStorage.setItem('bili_cleaner_sticky_filter', String(isFilterSticky));
        registerMenu();
        applyFilterStickyState();
    }

    function applyFilterStickyState() {
        if (document.documentElement) {
            document.documentElement.classList.toggle('bili-filter-sticky-enabled', isFilterSticky);
        }
        if (isFilterSticky) {
            bindStickyObserver();
        } else {
            document.querySelectorAll('div.more-conditions').forEach(resetConditions);
        }
    }

    function toggleWaterfall() {
        isWaterfallEnabled = !isWaterfallEnabled;
        localStorage.setItem('bili_cleaner_waterfall', String(isWaterfallEnabled));
        registerMenu();
        applyWaterfallState();
    }

    function applyWaterfallState() {
        if (document.documentElement) {
            document.documentElement.classList.toggle('bili-waterfall-enabled', isWaterfallEnabled);
        }
        if (isWaterfallEnabled) {
            initWaterfallModule();
        } else {
            destroyWaterfallModule();
        }
    }

    registerMenu();
    applyFilterStickyState();
    applyWaterfallState();
 
    // 0. 接入 OpenCC 单例转换器（由 @require 本地持久化驱动）
    let sConverter = null;
    function toSimplified(text) {
        if (!text) return '';
        try {
            const opencc = typeof OpenCC !== 'undefined' ? OpenCC : (typeof window !== 'undefined' ? window.OpenCC : null);
            if (opencc && typeof opencc.Converter === 'function') {
                if (!sConverter) {
                    sConverter = opencc.Converter({ from: 't', to: 'cn' });
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

        /* 4. 搜索筛选功能常驻相关样式 */
        html.bili-filter-sticky-enabled :has(> div.search-channel-item.mt_sm.ml_sm),
        html.bili-filter-sticky-enabled button.vui_button.vui_button--active-shrink.i_button_more {
            display: none !important;
        }

        /* 5. 瀑布流相关样式 */
        /* 使用 visibility: hidden 隐藏分页组件，保持占位供视口交叠监听 */
        html.bili-waterfall-enabled .search-page-pagination,
        html.bili-waterfall-enabled .vui_pagenation,
        html.bili-waterfall-enabled .vui_pagenation--btns {
            visibility: hidden !important;
        }

        /* 覆盖在分页组件位置的加载动画 */
        .bili-waterfall-loader-wrap {
            display: none;
            align-items: center;
            justify-content: center;
            padding: 28px 0 36px;
            width: 100%;
            color: #00aeec;
            font-size: 14px;
            font-weight: 500;
        }
        .bili-waterfall-loader-wrap.loading {
            display: flex !important;
        }
        .bili-waterfall-spinner {
            width: 22px;
            height: 22px;
            border: 3px solid rgba(0, 174, 236, 0.2);
            border-top-color: #00aeec;
            border-radius: 50%;
            animation: bili-spin 0.8s linear infinite;
            margin-right: 10px;
        }
        @keyframes bili-spin {
            to { transform: rotate(360deg); }
        }

        /* 隐藏沙箱 iframe */
        iframe#bili_waterfall_iframe {
            position: absolute !important;
            top: -9999px !important;
            left: -9999px !important;
            width: 1280px !important;
            height: 800px !important;
            border: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
            z-index: -9999 !important;
        }

        /* 左下角悬浮控制按钮 */
        #bili-waterfall-badge {
            position: fixed;
            left: 20px;
            bottom: 24px;
            z-index: 999999;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid rgba(0, 174, 236, 0.35);
            border-radius: 20px;
            padding: 7px 14px;
            font-size: 12px;
            font-weight: 600;
            color: #18191c;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #bili-waterfall-badge:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 174, 236, 0.28);
            border-color: #00aeec;
        }
        #bili-waterfall-badge.paused {
            color: #9499a0;
            border-color: #d0d3d8;
            background: rgba(246, 247, 248, 0.95);
        }
        #bili-waterfall-badge.loading {
            border-color: #00aeec;
            color: #00aeec;
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
        bindStickyObserver();
        initWaterfallModule();
    });
    window.addEventListener('load', () => {
        scanInitialState();
        filterDOMElements();
        bindStickyObserver();
        initWaterfallModule();
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
 
                // 排除活动、游戏、付费课程等非视频横幅容器
                if (card.closest('.activity-game-list, .activity-card, .activity-game-list-item')) return;

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
        rafId = requestAnimationFrame(() => {
            filterDOMElements();
            bindStickyObserver();
            bindWaterfallObserver();
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 8. 快捷键支持：在搜索结果页按 '/' 快速聚焦并全选搜索框
    function getSearchInput() {
        return document.querySelector('input.search-input-el') ||
               document.querySelector('input.search-input') ||
               document.querySelector('.search-input-wrap input') ||
               document.querySelector('.search-bar input') ||
               document.querySelector('input[type="text"]');
    }

    document.addEventListener('keydown', function(e) {
        // 当按键为 '/' 且未按下 Ctrl / Alt / Meta(Cmd) 组合键时触发
        if ((e.key === '/' || e.code === 'Slash') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const active = document.activeElement;

            // 若当前已聚焦于输入框、文本域或可编辑区域，不拦截正常字符输入
            const isEditing = active && (
                active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA' ||
                active.isContentEditable
            );

            if (!isEditing) {
                const input = getSearchInput();
                if (input) {
                    e.preventDefault(); // 阻止 '/' 字符输入到框内
                    input.focus();
                }
            }
        }
    });

    // 9. 搜索筛选功能常驻：自动展开并维持筛选条件面板展开状态
    function enforceConditions(element) {
        if (!isFilterSticky || !element) return;

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

    // 关闭常驻时恢复默认折叠隐藏状态
    function resetConditions(element) {
        if (!element) return;
        element.classList.add('ov_hidden');
        element.classList.add('hide');
        element.style.removeProperty('height');
    }

    const stickyObserver = new MutationObserver(mutations => {
        if (!isFilterSticky) return;
        for (const m of mutations) {
            if (m.target && m.target.classList && m.target.classList.contains('more-conditions')) {
                enforceConditions(m.target);
            }
        }
    });

    function bindStickyObserver() {
        if (!isFilterSticky) return;
        const targets = document.querySelectorAll('div.more-conditions');
        targets.forEach(el => {
            if (!el.dataset.stickyObserved) {
                el.dataset.stickyObserved = 'true';
                stickyObserver.observe(el, {
                    attributes: true,
                    attributeFilter: ['class', 'style']
                });
            }
            enforceConditions(el);
        });
    }

    // 10. 无缝瀑布流模块（DOM 劫持 + 沙箱 iframe 预拉取拼页）
    // 提取卡片唯一标识（用于去重）
    function getCardKey(card) {
        if (!card) return '';
        const link = card.querySelector('a[href*="/video/"], a[href*="live.bilibili.com"]')?.href || '';
        const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
        if (matchVideo) return matchVideo[1].toLowerCase();
        const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
        if (matchLive) return 'live_' + matchLive[1];

        const titleEl = card.querySelector('h3, [title], .bili-video-card__info--tit');
        const title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '') : '';
        return title ? 'tit_' + cleanText(title) : '';
    }

    // 同步主页面已存在的视频卡片到字典中
    function syncMainPageCards() {
        document.querySelectorAll('.video-list-item, div[class*="col_"], .bili-video-card').forEach(card => {
            const key = getCardKey(card);
            if (key) seenVideoKeyMap[key] = true;
        });
    }

    // 获取主视频列表网格容器
    function getMainListContainer(root = document) {
        return root.querySelector(
            '.video.search-all-list .video-list, ' +
            '.video.i_wrapper .video-list, ' +
            '.search-page-video .video-list, ' +
            '.search-all-list .video-list, ' +
            'div.video-list.row, ' +
            '.video-list, ' +
            '.search-page-list .row, ' +
            '.search-all-list .row'
        );
    }

    // 左下角悬浮控制按钮
    function getOrCreateBadge() {
        if (!isWaterfallEnabled) return null;
        let badge = document.getElementById('bili-waterfall-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'bili-waterfall-badge';
            badge.title = '左键点击：暂停 / 继续瀑布流\n右键点击：平滑返回顶部';
            badge.innerHTML = `
                <span class="bili-waterfall-badge-icon">🌊</span>
                <span class="bili-waterfall-badge-text">瀑布流: 第 1 页</span>
            `;

            badge.addEventListener('click', () => {
                isWaterfallPaused = !isWaterfallPaused;
                updateBadge();
                if (!isWaterfallPaused) {
                    checkAndTriggerPaging();
                }
            });

            badge.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            (document.body || document.documentElement).appendChild(badge);
        }
        return badge;
    }

    function updateBadge() {
        if (!isWaterfallEnabled) return;
        const badge = getOrCreateBadge();
        if (!badge) return;

        badge.classList.toggle('paused', isWaterfallPaused);
        badge.classList.toggle('loading', isPaging);

        const iconEl = badge.querySelector('.bili-waterfall-badge-icon');
        const textEl = badge.querySelector('.bili-waterfall-badge-text');

        if (isAllLoaded) {
            if (iconEl) iconEl.textContent = '🏁';
            if (textEl) textEl.textContent = `已到底 (共 ${currentRequestedPage} 页)`;
        } else if (isPaging) {
            if (iconEl) iconEl.textContent = '⏳';
            if (textEl) textEl.textContent = `加载中 (第 ${currentRequestedPage + 1} 页)...`;
        } else if (isWaterfallPaused) {
            if (iconEl) iconEl.textContent = '⏸️';
            if (textEl) textEl.textContent = `已暂停 (第 ${currentRequestedPage} 页)`;
        } else {
            if (iconEl) iconEl.textContent = '🌊';
            if (textEl) textEl.textContent = `瀑布流: 第 ${currentRequestedPage} 页`;
        }
    }

    // 页面底部分页器上的 Loading 动画容器
    function getOrCreateLoader() {
        if (!isWaterfallEnabled) return null;
        let loader = document.getElementById('bili-waterfall-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'bili-waterfall-loader';
            loader.className = 'bili-waterfall-loader-wrap';
            loader.innerHTML = `
                <div class="bili-waterfall-spinner"></div>
                <span class="bili-waterfall-loader-text">正在加载下一页...</span>
            `;
        }
        const pager = document.querySelector('.search-page-pagination, .vui_pagenation, .vui_pagenation--btns');
        if (pager && loader.parentNode !== pager.parentNode) {
            pager.parentNode.insertBefore(loader, pager);
        }
        return loader;
    }

    function updateLoader(show, text = '') {
        const loader = getOrCreateLoader();
        if (!loader) return;
        loader.classList.toggle('loading', show);
        if (text) {
            const textEl = loader.querySelector('.bili-waterfall-loader-text');
            if (textEl) textEl.textContent = text;
        }
    }

    // 隐藏沙箱 iframe
    function getOrCreateIframe() {
        let iframe = document.getElementById('bili_waterfall_iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'bili_waterfall_iframe';
            (document.body || document.documentElement).appendChild(iframe);
        }
        return iframe;
    }

    // 检查分页器是否存在下一页
    function hasNextPage() {
        const nextSideBtn = document.querySelector('button.vui_pagenation--btn-side:last-child');
        if (nextSideBtn && (nextSideBtn.disabled || nextSideBtn.classList.contains('vui_button--disabled'))) {
            return false;
        }
        return true;
    }

    // 构造下一页地址
    function getNextPageUrl(page) {
        const url = new URL(window.location.href);
        url.searchParams.set('page', String(page));
        return url.href;
    }

    // 执行加载下一页
    function triggerLoadNextPage() {
        if (!isWaterfallEnabled || isWaterfallPaused || isPaging || isAllLoaded) return;

        // 仅在有关键词搜索的页面下触发
        const params = new URLSearchParams(window.location.search);
        if (!params.get('keyword')) return;

        if (!hasNextPage()) {
            isAllLoaded = true;
            updateBadge();
            return;
        }

        const nextPage = currentRequestedPage + 1;
        const nextUrl = getNextPageUrl(nextPage);

        isPaging = true;
        updateBadge();
        updateLoader(true, `正在加载第 ${nextPage} 页视频...`);

        const iframe = getOrCreateIframe();
        iframe.src = nextUrl;

        iframe.onload = () => {
            let attempt = 0;
            const checkTimer = setInterval(() => {
                attempt++;
                const iWin = iframe.contentWindow;
                const iDoc = iframe.contentDocument;

                if (!iWin || !iDoc) {
                    clearInterval(checkTimer);
                    finishPaging();
                    return;
                }

                // 微触发 iframe 滚动以唤醒懒加载
                try {
                    iWin.scrollTo(0, 800);
                } catch (e) {}

                const rawCards = iDoc.querySelectorAll('.video-list-item, div[class*="col_"], .bili-video-card');
                const validCards = Array.from(rawCards).filter(c => {
                    const card = c.closest('[class*="col_"], .video-list-item') || c;
                    if (card.closest('.activity-game-list, .activity-card, .activity-game-list-item')) return false;
                    return card.querySelector('a[href*="/video/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                });

                // 当提取到视频卡片，或者超时（达到 25 次约 1.5 秒）
                if (validCards.length > 0 || attempt > 25) {
                    clearInterval(checkTimer);

                    if (validCards.length > 0) {
                        appendCards(validCards, iDoc, nextPage, nextUrl);
                    } else {
                        isAllLoaded = true;
                    }

                    finishPaging();
                }
            }, 60);
        };
    }

    function appendCards(newCards, iDoc, nextPage, nextUrl) {
        syncMainPageCards();

        const mainContainer = getMainListContainer(document);
        if (!mainContainer) return;

        const toAppend = [];
        for (const card of newCards) {
            const wrapCard = card.closest('[class*="col_"], .video-list-item') || card;
            const key = getCardKey(wrapCard);
            if (key && !seenVideoKeyMap[key]) {
                seenVideoKeyMap[key] = true;
                toAppend.push(document.importNode(wrapCard, true));
            }
        }

        if (toAppend.length > 0) {
            mainContainer.append(...toAppend);
            currentRequestedPage = nextPage;

            // 同步历史 URL 地址
            try {
                window.history.replaceState(null, '', nextUrl);
            } catch (e) {}

            // 更新主页面的分页器 DOM 为 iframe 的分页器状态
            const oldPager = document.querySelector('.search-page-pagination, .vui_pagenation');
            const newPager = iDoc.querySelector('.search-page-pagination, .vui_pagenation');
            if (oldPager && newPager) {
                oldPager.innerHTML = newPager.innerHTML;
            }

            // 触发规则过滤与安检
            filterDOMElements();
        } else {
            // 如果提取到的卡片都已存在，且无更多按钮，标记到底
            if (!hasNextPage()) {
                isAllLoaded = true;
            }
        }
    }

    function finishPaging() {
        isPaging = false;
        updateLoader(false);
        updateBadge();

        // 加载完成后，如果分页组件依然在可见窗口内（如当前页过滤后有效视频较少），且未暂停，继续尝试加载下一页
        setTimeout(() => {
            checkAndTriggerPaging();
        }, 350);
    }

    // 检查分页器是否在可视窗口内
    function checkAndTriggerPaging() {
        if (!isWaterfallEnabled || isWaterfallPaused || isPaging || isAllLoaded) return;
        const pager = document.querySelector('.search-page-pagination, .vui_pagenation, .vui_pagenation--btns');
        if (!pager) return;

        const rect = pager.getBoundingClientRect();
        const inViewport = rect.top < (window.innerHeight + 150) && rect.bottom > -100;
        if (inViewport) {
            triggerLoadNextPage();
        }
    }

    // 设置 IntersectionObserver 监听分页组件
    function bindWaterfallObserver() {
        if (!isWaterfallEnabled) return;

        if (waterfallIntersectionObserver) {
            waterfallIntersectionObserver.disconnect();
        }

        const pager = document.querySelector('.search-page-pagination, .vui_pagenation, .vui_pagenation--btns');
        if (!pager) return;

        waterfallIntersectionObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry && entry.isIntersecting) {
                triggerLoadNextPage();
            }
        }, {
            root: null,
            rootMargin: '120px',
            threshold: 0
        });

        waterfallIntersectionObserver.observe(pager);
    }

    function initWaterfallModule() {
        if (!isWaterfallEnabled) return;
        // 若 body 尚未生成（如脚本在 document-start 执行），等待 DOMContentLoaded 再初始化
        if (!document.body) return;

        // 初始化当前页码
        const params = new URLSearchParams(window.location.search);
        const p = parseInt(params.get('page') || '1', 10);
        currentRequestedPage = isNaN(p) ? 1 : p;
        isAllLoaded = false;
        isPaging = false;

        document.documentElement.classList.add('bili-waterfall-enabled');
        getOrCreateBadge();
        updateBadge();
        bindWaterfallObserver();
    }

    function destroyWaterfallModule() {
        document.documentElement.classList.remove('bili-waterfall-enabled');
        if (waterfallIntersectionObserver) {
            waterfallIntersectionObserver.disconnect();
            waterfallIntersectionObserver = null;
        }
        const badge = document.getElementById('bili-waterfall-badge');
        if (badge) badge.remove();

        const loader = document.getElementById('bili-waterfall-loader');
        if (loader) loader.remove();

        const iframe = document.getElementById('bili_waterfall_iframe');
        if (iframe) iframe.remove();
    }

    console.log('[Bilibili 搜索净化] 2.1.0 已启动。');
})();