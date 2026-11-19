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
    let isSpotlight = localStorage.getItem('bili_cleaner_spotlight') === 'true';
    let isFilterSticky = localStorage.getItem('bili_cleaner_sticky_filter') === 'true';
    let isWaterfall = localStorage.getItem('bili_cleaner_waterfall') === 'true';
    let spotlightMenuId = null;
    let filterStickyMenuId = null;
    let waterfallMenuId = null;

    function registerMenu() {
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

        const filterStickyLabel = `⚓ 搜索筛选常驻: ${isFilterSticky ? '✅ 已开启' : '❌ 已关闭'}`;
        filterStickyMenuId = GM_registerMenuCommand(filterStickyLabel, toggleFilterSticky);

        const spotlightLabel = `🔦 聚光灯高亮模式: ${isSpotlight ? '✅ 已开启' : '❌ 已关闭'}`;
        spotlightMenuId = GM_registerMenuCommand(spotlightLabel, toggleSpotlight);

        const waterfallLabel = `🌊 无缝瀑布流: ${isWaterfall ? '✅ 已开启' : '❌ 已关闭'}`;
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

    function toggleWaterfall() {
        isWaterfall = !isWaterfall;
        localStorage.setItem('bili_cleaner_waterfall', String(isWaterfall));
        registerMenu();

        // 1. 优先触发官方分页组件的「第 1 页」按钮，通知 B 站内部路由与状态回到首页
        try {
            const firstPageBtn = document.querySelector('button.vui_pagenation--btn-num[aria-label^="第 1 页"]');
            if (firstPageBtn) {
                firstPageBtn.click();
                
            }
        } catch (e) {}

        // 2. 强制重置瀑布流核心状态到第 1 页
        currentRequestedPage = 1;
        seenBvidMap.clear();
        isAllLoaded = false;
        isPaging = false;

        // 3. 延迟执行跳转或刷新，为分页按钮点击事件及内部路由更新预留响应时间
        setTimeout(() => {
            const url = new URL(window.location.href);
            const hasNonFirstPage = (url.searchParams.has('page') && url.searchParams.get('page') !== '1') ||
                                    (url.searchParams.has('o') && url.searchParams.get('o') !== '0');
            if (hasNonFirstPage) {
                url.searchParams.delete('page');
                url.searchParams.delete('o');
                window.location.href = url.toString();
                return;
            }

            // 4. 处于第 1 页时直接刷新使瀑布流生命周期生效
            window.location.reload();
        }, 50);
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

    function applyWaterfallState() {
        if (typeof syncWaterfallLifecycle === 'function') {
            syncWaterfallLifecycle();
        }
    }

    registerMenu();
    applyFilterStickyState();
 
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
        html.bili-waterfall-enabled .vui_pagenation,
        html.bili-waterfall-enabled .vui_pagenation--btns {
            visibility: hidden !important;
            position: relative !important;
        }
        .bili-waterfall-loader {
            display: none;
            align-items: center;
            justify-content: center;
            width: fit-content;
            max-width: 100%;
            margin: 0 auto;
            color: #00aeec;
            font-size: 14px;
            font-weight: 500;
            padding: 0 !important;
            position: relative;
        }
        .bili-waterfall-loader.active {
            display: flex !important;
        }
        .bili-waterfall-loader.ended {
            color: #9499a0;
            font-size: 13px;
            padding: 0 !important;
            user-select: none;
        }
        .bili-waterfall-loader.ended .bili-waterfall-spinner {
            display: none !important;
        }
        .bili-waterfall-loader.ended::before,
        .bili-waterfall-loader.ended::after {
            content: '';
            display: inline-block;
            width: 48px;
            height: 1px;
            background: rgba(148, 153, 160, 0.25);
            vertical-align: middle;
            margin: 0 14px;
        }
        .bili-waterfall-back-to-top {
            color: #00aeec;
            cursor: pointer;
            text-decoration: none;
            margin-left: 6px;
            font-weight: 500;
            transition: color 0.2s ease;
        }
        .bili-waterfall-back-to-top:hover {
            color: #008ac5;
            text-decoration: underline;
        }
        .bili-waterfall-spinner {
            width: 20px;
            height: 20px;
            border: 3px solid rgba(0, 174, 236, 0.2);
            border-top-color: #00aeec;
            border-radius: 50%;
            animation: bili-wf-spin 0.8s linear infinite;
            margin-right: 8px;
        }
        @keyframes bili-wf-spin {
            to { transform: rotate(360deg); }
        }
        #bili-waterfall-badge {
            position: fixed;
            left: 24px;
            bottom: 24px;
            background: rgba(255, 255, 255, 0.96);
            border: 1px solid rgba(0, 174, 236, 0.35);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
            color: #18191c;
            padding: 7px 14px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            user-select: none;
            z-index: 99999;
            backdrop-filter: blur(8px);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #bili-waterfall-badge:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 18px rgba(0, 174, 236, 0.25);
            border-color: #00aeec;
        }
        #bili-waterfall-badge.paused {
            background: rgba(245, 246, 247, 0.96);
            border-color: rgba(148, 153, 160, 0.35);
            color: #61666d;
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
    });
    window.addEventListener('load', () => {
        scanInitialState();
        filterDOMElements();
        bindStickyObserver();
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

                // 官方搜索响应握手：当检测到 B 站发起官方搜索（非瀑布流内部翻页请求）并返回数据时，
                // 延时等待 Vue 将新搜索首屏结果与新分页器渲染挂载到 DOM 树，再唤醒瀑布流状态同步
                if (!isInternalPaging && !isPaging && isWaterfall) {
                    setTimeout(() => {
                        if (typeof onOfficialSearchMounted === 'function') {
                            onOfficialSearchMounted();
                        }
                    }, 120);
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
            // 分页器节点存活与换新自愈检测：
            // B 站 Vue 在单页切换结果时会直接销毁旧分页器并创建新节点，
            // 此时旧 IntersectionObserver 会停留在脱离文档流的孤立节点上导致失效，
            // 通过监测活跃节点的 isConnected 状态与引用一致性，实现无感自愈重绑
            if (isWaterfall && typeof bindWaterfallObserver === 'function') {
                const currentPager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
                if (currentPager && (!currentObservedPager || currentObservedPager !== currentPager || !currentObservedPager.isConnected)) {
                    bindWaterfallObserver();
                }
            }
            if (typeof checkSearchChange === 'function') {
                checkSearchChange();
            }
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

    // ==========================================
    // 10. 无缝瀑布流独立模块（Wbi API 驱动）
    // ==========================================
    let isWaterfallPaused = false;
    let isPaging = false;
    let isAllLoaded = false;
    let currentRequestedPage = 1;
    let maxWaterfallPage = 34;
    let waterfallObserver = null;
    let currentObservedPager = null;
    let isInternalPaging = false;
    const seenBvidMap = new Set();
    let cachedWbiKeys = null;

    // 内联轻量 MD5 实现（自研自包含，无外部依赖）
    function computeMd5(string) {
        function rotL(val, bits) { return (val << bits) | (val >>> (32 - bits)); }
        function addU(x, y) {
            var x8 = (x & 0x80000000), y8 = (y & 0x80000000);
            var x4 = (x & 0x40000000), y4 = (y & 0x40000000);
            var res = (x & 0x3FFFFFFF) + (y & 0x3FFFFFFF);
            if (x4 & y4) return (res ^ 0x80000000 ^ x8 ^ y8);
            if (x4 | y4) {
                if (res & 0x40000000) return (res ^ 0xC0000000 ^ x8 ^ y8);
                else return (res ^ 0x40000000 ^ x8 ^ y8);
            } else { return (res ^ x8 ^ y8); }
        }
        function F(x, y, z) { return (x & y) | ((~x) & z); }
        function G(x, y, z) { return (x & z) | (y & (~z)); }
        function H(x, y, z) { return (x ^ y ^ z); }
        function I(x, y, z) { return (y ^ (x | (~z))); }
        function FF(a,b,c,d,x,s,ac) { return addU(rotL(addU(addU(a, F(b,c,d)), addU(x, ac)), s), b); }
        function GG(a,b,c,d,x,s,ac) { return addU(rotL(addU(addU(a, G(b,c,d)), addU(x, ac)), s), b); }
        function HH(a,b,c,d,x,s,ac) { return addU(rotL(addU(addU(a, H(b,c,d)), addU(x, ac)), s), b); }
        function II(a,b,c,d,x,s,ac) { return addU(rotL(addU(addU(a, I(b,c,d)), addU(x, ac)), s), b); }
        var str = unescape(encodeURIComponent(string));
        var len = str.length;
        var words = Array(((len + 8 - ((len + 8) % 64)) / 64 + 1) * 16 - 1);
        for (var i = 0; i < len; i++) {
            var idx = (i - (i % 4)) / 4;
            words[idx] = (words[idx] | (str.charCodeAt(i) << ((i % 4) * 8)));
        }
        var endIdx = (len - (len % 4)) / 4;
        words[endIdx] = words[endIdx] | (0x80 << ((len % 4) * 8));
        words[words.length - 2] = len << 3;
        words[words.length - 1] = len >>> 29;
        var a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
        for (var k = 0; k < words.length; k += 16) {
            var AA = a, BB = b, CC = c, DD = d;
            a = FF(a,b,c,d,words[k+0], 7,0xD76AA478); d = FF(d,a,b,c,words[k+1], 12,0xE8C7B756); c = FF(c,d,a,b,words[k+2], 17,0x242070DB); b = FF(b,c,d,a,words[k+3], 22,0xC1BDCEEE);
            a = FF(a,b,c,d,words[k+4], 7,0xF57C0FAF); d = FF(d,a,b,c,words[k+5], 12,0x4787C62A); c = FF(c,d,a,b,words[k+6], 17,0xA8304613); b = FF(b,c,d,a,words[k+7], 22,0xFD469501);
            a = FF(a,b,c,d,words[k+8], 7,0x698098D8); d = FF(d,a,b,c,words[k+9], 12,0x8B44F7AF); c = FF(c,d,a,b,words[k+10],17,0xFFFF5BB1); b = FF(b,c,d,a,words[k+11],22,0x895CD7BE);
            a = FF(a,b,c,d,words[k+12],7,0x6B901122); d = FF(d,a,b,c,words[k+13],12,0xFD987193); c = FF(c,d,a,b,words[k+14],17,0xA679438E); b = FF(b,c,d,a,words[k+15],22,0x49B40821);
            a = GG(a,b,c,d,words[k+1], 5,0xF61E2562); d = GG(d,a,b,c,words[k+6], 9,0xC040B340); c = GG(c,d,a,b,words[k+11],14,0x265E5A51); b = GG(b,c,d,a,words[k+0], 20,0xE9B6C7AA);
            a = GG(a,b,c,d,words[k+5], 5,0xD62F105D); d = GG(d,a,b,c,words[k+10],9,0x02441453); c = GG(c,d,a,b,words[k+15],14,0xD8A1E681); b = GG(b,c,d,a,words[k+4], 20,0xE7D3FBC8);
            a = GG(a,b,c,d,words[k+9], 5,0x21E1CDE6); d = GG(d,a,b,c,words[k+14],9,0xC33707D6); c = GG(c,d,a,b,words[k+3], 14,0xF4D50D87); b = GG(b,c,d,a,words[k+8], 20,0x455A14ED);
            a = GG(a,b,c,d,words[k+13],5,0xA9E3E905); d = GG(d,a,b,c,words[k+2], 9,0xFCEFA3F8); c = GG(c,d,a,b,words[k+7], 14,0x676F02D9); b = GG(b,c,d,a,words[k+12],20,0x8D2A4C8A);
            a = HH(a,b,c,d,words[k+5], 4,0xFFFA3942); d = HH(d,a,b,c,words[k+8], 11,0x8771F681); c = HH(c,d,a,b,words[k+11],16,0x6D9D6122); b = HH(b,c,d,a,words[k+14],23,0xFDE5380C);
            a = HH(a,b,c,d,words[k+1], 4,0xA4BEEA44); d = HH(d,a,b,c,words[k+4], 11,0x4BDECFA9); c = HH(c,d,a,b,words[k+7], 16,0xF6BB4B60); b = HH(b,c,d,a,words[k+10],23,0xBEBFBC70);
            a = HH(a,b,c,d,words[k+13],4,0x289B7EC6); d = HH(d,a,b,c,words[k+0], 11,0xEAA127FA); c = HH(c,d,a,b,words[k+3], 16,0xD4EF3085); b = HH(b,c,d,a,words[k+6], 23,0x04881D05);
            a = HH(a,b,c,d,words[k+9], 4,0xD9D4D039); d = HH(d,a,b,c,words[k+12],11,0xE6DB99E5); c = HH(c,d,a,b,words[k+15],16,0x1FA27CF8); b = HH(b,c,d,a,words[k+2], 23,0xC4AC5665);
            a = II(a,b,c,d,words[k+0], 6,0xF4292244); d = II(d,a,b,c,words[k+7], 10,0x432AFF97); c = II(c,d,a,b,words[k+14],15,0xAB9423A7); b = II(b,c,d,a,words[k+5], 21,0xFC93A039);
            a = II(a,b,c,d,words[k+12],6,0x655B59C3); d = II(d,a,b,c,words[k+3], 10,0x8F0CCC92); c = II(c,d,a,b,words[k+10],15,0xFFEFF47D); b = II(b,c,d,a,words[k+1], 21,0x85845DD1);
            a = II(a,b,c,d,words[k+8], 6,0x6FA87E4F); d = II(d,a,b,c,words[k+15],10,0xFE2CE6E0); c = II(c,d,a,b,words[k+6], 15,0xA3014314); b = II(b,c,d,a,words[k+13],21,0x4E0811A1);
            a = II(a,b,c,d,words[k+4], 6,0xF7537E82); d = II(d,a,b,c,words[k+11],10,0xBD3AF235); c = II(c,d,a,b,words[k+2], 15,0x2AD7D2BB); b = II(b,c,d,a,words[k+9], 21,0xEB86D391);
            a = addU(a, AA); b = addU(b, BB); c = addU(c, CC); d = addU(d, DD);
        }
        function toHex(val) {
            var h = '';
            for (var m = 0; m <= 3; m++) {
                var byte = (val >>> (m * 8)) & 255;
                h += ('0' + byte.toString(16)).slice(-2);
            }
            return h;
        }
        return (toHex(a) + toHex(b) + toHex(c) + toHex(d)).toLowerCase();
    }

    const mixinKeyEncTab = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
        33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
        61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
        36, 20, 34, 44, 52
    ];

    function getMixinKey(orig) {
        let temp = '';
        mixinKeyEncTab.forEach(n => { temp += orig[n] || ''; });
        return temp.slice(0, 32);
    }

    async function getWbiKeys() {
        if (cachedWbiKeys) return cachedWbiKeys;
        try {
            const state = targetWindow.__INITIAL_STATE__;
            if (state?.wbi_img?.img_url && state?.wbi_img?.sub_url) {
                const img_url = state.wbi_img.img_url;
                const sub_url = state.wbi_img.sub_url;
                const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
                const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
                cachedWbiKeys = { img_key, sub_key };
                return cachedWbiKeys;
            }
            const navRes = await targetWindow.fetch('https://api.bilibili.com/x/web-interface/nav');
            const navData = await navRes.json();
            if (navData?.data?.wbi_img) {
                const img_url = navData.data.wbi_img.img_url;
                const sub_url = navData.data.wbi_img.sub_url;
                const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
                const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
                cachedWbiKeys = { img_key, sub_key };
                return cachedWbiKeys;
            }
        } catch (e) {}
        return null;
    }

    function signWbi(params, img_key, sub_key) {
        const mixin_key = getMixinKey(img_key + sub_key);
        const curr_time = Math.round(Date.now() / 1000);
        const chr_filter = /[!'()*]/g;
        const query = [];
        const signedObj = { ...params, wts: curr_time };
        Object.keys(signedObj).sort().forEach(k => {
            const val = String(signedObj[k]).replace(chr_filter, '');
            query.push(`${encodeURIComponent(k)}=${encodeURIComponent(val)}`);
        });
        const query_str = query.join('&');
        const w_rid = computeMd5(query_str + mixin_key);
        return query_str + '&w_rid=' + w_rid;
    }

    function getMainListContainer(root = document) {
        // 兼容首屏综合列表 (.search-all-list) 与后续页/纯视频列表 (.search-page-video) 的主视频容器
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

    function getOrCreateBadge() {
        if (!isWaterfall) return null;
        let badge = document.getElementById('bili-waterfall-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'bili-waterfall-badge';
            badge.title = '左键点击：暂停 / 继续瀑布流\n右键点击：平滑回到顶部';
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
            document.body.appendChild(badge);
        }
        return badge;
    }

    function updateBadge() {
        const badge = getOrCreateBadge();
        if (!badge) return;
        if (isWaterfallPaused) {
            badge.innerHTML = `<span>🌊 已暂停: 第 ${currentRequestedPage} 页</span>`;
            badge.classList.add('paused');
        } else {
            badge.innerHTML = `<span>🌊 瀑布流: 第 ${currentRequestedPage} 页</span>`;
            badge.classList.remove('paused');
        }
    }

    // 动态计算 position: relative 左右居中偏移量：将 loader 水平中轴线精准对齐至主列表容器中轴线，上下高度完全不干预
    function adjustLoaderCentering() {
        const loader = document.getElementById('bili-waterfall-loader');
        if (!loader) return;
        loader.style.position = 'relative';
        loader.style.removeProperty('top');

        const mainContainer = getMainListContainer(document) || document.querySelector('.search-page-video, .video.i_wrapper') || document.body;
        const targetRect = mainContainer ? mainContainer.getBoundingClientRect() : { left: 0, width: window.innerWidth };
        const targetCenterX = targetRect.left + targetRect.width / 2;

        const currentLeft = parseFloat(loader.style.left) || 0;
        const loaderRect = loader.getBoundingClientRect();
        const rawLoaderCenterX = loaderRect.left - currentLeft + loaderRect.width / 2;

        const offsetLeft = Math.round(targetCenterX - rawLoaderCenterX);
        loader.style.left = `${offsetLeft}px`;
    }

    // 维护加载器位置：保证 loader 节点始终插在当前活跃分页器的正前方（避免因 Vue 重新渲染导致 loader 脱落或位移）
    function ensureLoaderPosition(pager) {
        if (!isWaterfall) return null;
        let loader = document.getElementById('bili-waterfall-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'bili-waterfall-loader';
            loader.className = 'bili-waterfall-loader';
            loader.innerHTML = `
                <div class="bili-waterfall-spinner"></div>
                <span class="bili-waterfall-loader-text">正在加载下一页视频...</span>
            `;
            loader.addEventListener('click', (e) => {
                const btn = e.target.closest('.bili-waterfall-back-to-top');
                if (btn) {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        }
        const targetPager = pager || document.querySelector('.vui_pagenation, .vui_pagenation--btns');
        if (targetPager && targetPager.parentNode && loader.nextSibling !== targetPager) {
            targetPager.parentNode.insertBefore(loader, targetPager);
        } else if (!targetPager) {
            // 无分页组件场景（例如单页搜索结果）：安全挂载于主视频列表容器下方
            const mainSection = document.querySelector('div.video.i_wrapper.search-all-list, div.search-page-video.i_wrapper, div.video.i_wrapper') || getMainListContainer();
            if (mainSection && mainSection.parentNode && loader.parentNode !== mainSection.parentNode) {
                mainSection.parentNode.insertBefore(loader, mainSection.nextSibling);
            }
        }
        adjustLoaderCentering();
        return loader;
    }

    function getOrCreateLoader() {
        const pager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
        return ensureLoaderPosition(pager);
    }

    // 动态提取当前搜索结果最大页码：
    // 1. 若无 .vui_pagenation 分页组件，说明搜索结果仅有 1 页，首屏即为末页
    // 2. 存在分页器时，定位「下一页」侧边按钮的前序数字按钮，读取其标号即为最大页数
    function getDynamicMaxPage() {
        const pager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
        if (!pager) {
            return 1;
        }

        const nextBtn = pager.querySelector('button.vui_pagenation--btn[aria-label="下一页"], button.vui_pagenation--btn-side[aria-label="下一页"]');
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

        // 兜底：从所有数字按钮中提取最后一个标号
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
            maxWaterfallPage = p;
        }
        return maxWaterfallPage;
    }

    // 根据最后一页最大页数自适应原生每页容量（4/5/6/7列 × 6行）：
    // - 饱和态（1008总量）：42页->24条, 34页->30条, 28页->36条, 24页->42条；
    // - 非饱和态（搜索结果总量小于1000条，最大分页数非上述固定档位）：原生默认按30条步长请求。
    function getDynamicPageSize() {
        switch (maxWaterfallPage) {
            case 42:
                return 24;
            case 34:
                return 30;
            case 28:
                return 36;
            case 24:
                return 42;
            default:
                return 30;
        }
    }

    // 生成终态文案（方案 B+C 融合：客观归因区分真实到底与系统检索上限，并内置行动闭环入口）
    // 依据 B 站 1000 条检索截断与不同屏幕列宽（4/5/6/7 列 × 6 行），自适应四档系统检索饱和上限：
    // 4 列(24/页) -> 42 页 | 5 列(30/页) -> 34 页 | 6 列(36/页) -> 28 页 | 7 列(42/页) -> 24 页
    function getEndedTipHtml() {
        const SYSTEM_MAX_PAGES = new Set([24, 28, 34, 42]);
        const isMaxLimit = SYSTEM_MAX_PAGES.has(currentRequestedPage) || currentRequestedPage >= 34;
        const reasonText = isMaxLimit 
            ? `已达系统检索上限（共 ${currentRequestedPage} 页）` 
            : `已展示全部相关视频（共 ${currentRequestedPage} 页）`;
        return `<span>${reasonText}</span><span style="margin: 0 4px; opacity: 0.5;">·</span><a class="bili-waterfall-back-to-top" role="button">⬆ 回到顶部</a>`;
    }

    // 更新加载状态条：展示加载动画或平滑隐藏
    function updateLoader(show, text = '正在加载下一页视频...') {
        const loader = getOrCreateLoader();
        if (!loader) return;
        const txtEl = loader.querySelector('.bili-waterfall-loader-text');
        if (show) {
            loader.classList.add('active');
            loader.classList.remove('ended');
            adjustLoaderCentering();
            if (txtEl) {
                txtEl.textContent = text;
            }
        } else {
            if (txtEl && !isAllLoaded) {
                txtEl.textContent = '正在加载下一页视频...';
            }
            if (!isAllLoaded) {
                loader.classList.remove('active', 'ended');
            }
        }
    }

    // 专属终态展示：调用 getEndedTipHtml() 渲染客观终态提示（已展示全部相关视频 / 已达系统检索上限）
    function showEndedLoader() {
        const loader = getOrCreateLoader();
        if (!loader) return;
        loader.classList.add('active', 'ended');
        adjustLoaderCentering();
        const txtEl = loader.querySelector('.bili-waterfall-loader-text');
        if (txtEl) {
            txtEl.innerHTML = getEndedTipHtml();
        }
    }

    function createCardElement(item) {
        function formatStat(n) {
            if (!n && n !== 0) return '';
            if (typeof n === 'string' && (n.includes('万') || n.includes('亿'))) return n;
            const num = Number(n);
            if (isNaN(num)) return String(n);
            if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
            if (num >= 10000) return (num / 10000).toFixed(1) + '万';
            return String(num);
        }

        function formatDuration(val) {
            if (!val && val !== 0) return '';
            const str = String(val).trim();
            if (!str) return '';

            // 纯数字秒数（如 66 -> "01:06"）
            if (/^\d+$/.test(str)) {
                const totalSeconds = parseInt(str, 10);
                const h = Math.floor(totalSeconds / 3600);
                const m = Math.floor((totalSeconds % 3600) / 60);
                const s = totalSeconds % 60;
                const mm = String(m).padStart(2, '0');
                const ss = String(s).padStart(2, '0');
                if (h > 0) {
                    const hh = String(h).padStart(2, '0');
                    return `${hh}:${mm}:${ss}`;
                }
                return `${mm}:${ss}`;
            }

            // 冒号分隔格式（解决 B 站 API 返回未补零的 "1:6" 或 "3:1" -> 对齐官方规范 "01:06" 或 "03:01"）
            if (str.includes(':')) {
                const parts = str.split(':').map(p => p.trim());
                return parts.map(p => p.padStart(2, '0')).join(':');
            }

            return str;
        }

        const durationText = formatDuration(item.duration);

        // 优先从已定位的主容器中精准提取真实普通视频卡片作为克隆范本，严格排除直播间、课堂与番剧等干扰卡片
        const mainContainer = getMainListContainer(document);
        const sampleCol = mainContainer ? (
            mainContainer.querySelector(
                'div[class*="col_"]:has(a[href*="/video/"]):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living)), ' +
                '.video-list-item:has(a[href*="/video/"]):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living)), ' +
                'div[class*="col_"]:has(.bili-video-card):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living))'
            ) || mainContainer.querySelector('.video-list-item, div[class*="col_"]:has(.bili-video-card)')
        ) : null;
        let col;
        const cleanTit = (item.title || '').replace(/<[^>]+>/g, '');
        const coverUrl = item.pic ? (item.pic.startsWith('http') ? item.pic : 'https:' + item.pic) : '';

        if (sampleCol) {
            col = sampleCol.cloneNode(true);
            delete col.dataset.purifiedQuery;
            col.classList.remove('bili-cleaner-highlighted', 'bili-cleaner-dimmed');

            // 彻底清理直播专属节点（内联直播播放器、直播中状态标等）及残留的活动播放器
            col.querySelectorAll('.v-inline-live-player, .bili-video-card__info--living, .v-inline-player, .bpx-docker, video').forEach(el => el.remove());

            // 统一将卡片内部所有主链接（视频/直播/课程遗留）重定向为当前视频地址
            col.querySelectorAll('a[href*="/video/"], a[href*="live.bilibili.com"], a[href*="/cheese/"]').forEach(a => {
                a.href = `//www.bilibili.com/video/${item.bvid}`;
            });

            const titEl = col.querySelector('.bili-video-card__info--tit, h3');
            if (titEl) {
                titEl.innerHTML = item.title;
                titEl.setAttribute('title', cleanTit);
                titEl.title = cleanTit;
                const parentA = titEl.closest('a');
                if (parentA) {
                    parentA.setAttribute('title', cleanTit);
                    parentA.title = cleanTit;
                    parentA.href = `//www.bilibili.com/video/${item.bvid}`;
                }
            }

            // 同步卡片 bvid 属性
            col.querySelectorAll('[data-bsb-bvid]').forEach(el => {
                el.setAttribute('data-bsb-bvid', item.bvid);
            });

            // 替换封面图片：彻底清除 picture 内部所有遗留的旧 source 标签，并重建全新的 img 元素，
            // 杜绝浏览器继承母卡已解码的图片内存位图导致在新封面载入前闪现母卡封面的问题
            const pictureEl = col.querySelector('picture');
            if (pictureEl) {
                pictureEl.querySelectorAll('source').forEach(s => s.remove());
            }

            const oldImg = col.querySelector('.bili-video-card__cover img, picture img, img');
            if (oldImg) {
                const finalPic = coverUrl ? (coverUrl + '@672w_378h_1c_!web-search-common-cover.webp') : '';
                const newImg = document.createElement('img');
                // 继承母卡图片的作用域样式属性与 class，排除 src、srcset 及母卡旧加载事件
                for (const attr of oldImg.attributes) {
                    const name = attr.name.toLowerCase();
                    if (name !== 'src' && name !== 'srcset' && !name.startsWith('on')) {
                        newImg.setAttribute(attr.name, attr.value);
                    }
                }
                newImg.alt = cleanTit;
                newImg.loading = 'lazy';
                newImg.src = finalPic;
                oldImg.replaceWith(newImg);
            }

            // 替换作者与发布时间
            const ownerA = col.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--owner');
            if (ownerA) {
                ownerA.href = `//space.bilibili.com/${item.mid}`;
                const authorSpan = ownerA.querySelector('.bili-video-card__info--author, .bili-video-card__info--author-name');
                if (authorSpan) {
                    authorSpan.textContent = item.author;
                } else {
                    const textNode = Array.from(ownerA.childNodes).find(n => n.nodeType === 3);
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

            // 替换播放量与弹幕数统计
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
            // 现代化兜底卡片构建（确保无真实母本时依然能渲染出与原站一致的响应式结构）
            col = document.createElement('div');
            col.className = 'col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40 video-list-item';
            const dateText = item.pubdate ? ` · ${new Date(item.pubdate * 1000).getMonth() + 1}月${new Date(item.pubdate * 1000).getDate()}日` : '';
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
        return col;
    }

    function appendCards(items) {
        if (!Array.isArray(items) || items.length === 0) return 0;
        const mainContainer = getMainListContainer(document);
        if (!mainContainer) return 0;

        const fragment = document.createDocumentFragment();
        let addedCount = 0;

        for (const item of items) {
            if (!item.bvid) continue;
            const bvidLower = item.bvid.toLowerCase();
            if (seenBvidMap.has(bvidLower)) continue;
            seenBvidMap.add(bvidLower);

            // 存入标签字典供后续规则使用
            const rawTagText = [item.tag, item.keywords, item.tags, item.typename].filter(Boolean).join(',');
            if (rawTagText) {
                videoTagMap.set(item.bvid, cleanText(rawTagText));
                if (item.aid) {
                    videoTagMap.set(String(item.aid), cleanText(rawTagText));
                    videoTagMap.set('av' + item.aid, cleanText(rawTagText));
                }
            }

            // 直接构建卡片，不在此处筛选，留给后续安检模块
            const cardNode = createCardElement(item);
            fragment.appendChild(cardNode);
            addedCount++;
        }

        if (addedCount > 0) {
            mainContainer.appendChild(fragment);
            filterDOMElements();
        }
        return addedCount;
    }

    async function triggerLoadNextPage() {
        if (!isWaterfall || isWaterfallPaused || isPaging || isAllLoaded) return;
        updateDynamicMaxPage();
        if (currentRequestedPage >= maxWaterfallPage) {
            isAllLoaded = true;
            updateBadge();
            showEndedLoader();
            return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const rawKeyword = urlParams.get('keyword');
        if (!rawKeyword) return;

        const nextPage = currentRequestedPage + 1;
        isPaging = true;
        updateBadge();
        updateLoader(true, `正在加载第 ${nextPage} 页视频...`);

        try {
            const keys = await getWbiKeys();
            if (!keys) {
                finishPaging(false);
                return;
            }

            // 统一采用 B 站官方网页翻页专用的 /search/type 纯视频接口，单页步长动态自适应对齐官方原生规格
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
                'x-bili-device-req-json': JSON.stringify({ platform: 'web', device: 'pc', spmid: '333.337', mobi_app: 'web_cn' }),
                'x-bili-locale-json': JSON.stringify({ c_locale: { language: 'zh', script: 'Hans' }, always_translate: false })
            };

            const signedQs = signWbi(queryObj, keys.img_key, keys.sub_key);
            const res = await targetWindow.fetch(`${apiBase}?${signedQs}`, {
                headers: { 'Referer': 'https://search.bilibili.com/' }
            });
            const data = await res.json();

            let videoItems = [];
            if (data?.data?.result) {
                if (Array.isArray(data.data.result)) {
                    videoItems = data.data.result;
                }
            }

            if (videoItems.length > 0) {
                appendCards(videoItems);
                currentRequestedPage = nextPage;

                // 达到末页时标记为已全部加载完毕
                updateDynamicMaxPage();
                if (currentRequestedPage >= maxWaterfallPage) {
                    isAllLoaded = true;
                }
            } else {
                // 接口返回空数据（数据已自然到底），校准最大页数与实际已展示页数一致
                maxWaterfallPage = currentRequestedPage;
                isAllLoaded = true;
            }
        } catch (e) {
            console.error('[Bilibili 搜索净化] 瀑布流加载下一页失败:', e);
        } finally {
            finishPaging(true);
        }
    }

    // 判定当前是否满足触发下一页加载的条件（视口进入预加载缓冲带且尚未全部加载完毕）
    function isPagingConditionMet() {
        if (!isWaterfall || isWaterfallPaused || isAllLoaded) return false;
        if (currentRequestedPage >= maxWaterfallPage) return false;
        const target = document.querySelector('.vui_pagenation, .vui_pagenation--btns') || document.getElementById('bili-waterfall-loader');
        if (!target) return false;
        const rect = target.getBoundingClientRect();
        return rect.top < (window.innerHeight + 1000) && rect.bottom > -100;
    }

    function finishPaging(success = true) {
        isPaging = false;
        updateBadge();

        if (isAllLoaded) {
            showEndedLoader();
            return;
        }

        // 核心优化：若添加视频后依然符合已有的「加载下一页」视口判定，则不移除 active 类，保持连贯加载
        if (success && !isWaterfallPaused && isPagingConditionMet()) {
            updateLoader(true, `正在加载第 ${currentRequestedPage + 1} 页视频...`);
            setTimeout(() => {
                if (!isPaging && !isAllLoaded && !isWaterfallPaused && isPagingConditionMet()) {
                    triggerLoadNextPage();
                }
            }, 60);
        } else {
            // 已推移至预加载缓冲带之外，平滑收起加载状态条
            updateLoader(false);
            if (success && !isAllLoaded && !isWaterfallPaused) {
                setTimeout(checkAndTriggerPaging, 300);
            }
        }
    }

    // 重新扫描首屏卡片提取已有视频 BV 号，用于增量去重防抖
    function refreshSeenBvidsFromDOM() {
        seenBvidMap.clear();
        document.querySelectorAll('a[href*="/video/"]').forEach(a => {
            const m = a.href.match(/\/video\/([A-Za-z0-9]+)/);
            if (m) seenBvidMap.add(m[1].toLowerCase());
        });
    }

    // 视口相交检测与分页拉取触发器：兼备监听器离线脱落自愈功能
    function checkAndTriggerPaging() {
        if (!isWaterfall || isWaterfallPaused || isPaging || isAllLoaded) return;
        const pager = document.querySelector('.vui_pagenation, .vui_pagenation--btns') || document.getElementById('bili-waterfall-loader');
        if (!pager) return;

        // 若发现当前监听对象已脱离 DOM 树（如 Vue 切换组件后销毁原节点），自愈重新绑定
        if (currentObservedPager !== pager || !pager.isConnected) {
            bindWaterfallObserver();
        }

        if (isPagingConditionMet()) {
            triggerLoadNextPage();
        }
    }

    // 绑定瀑布流交叉观察者（IntersectionObserver）：
    // 监听分页器触底可见性，并严格维护单例与活跃节点引用，杜绝在孤立脱轨节点上无效监听
    function bindWaterfallObserver() {
        if (!isWaterfall) return;

        const pager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
        if (!pager) return;

        // 若当前已经正在监听同一个且仍然挂载在 DOM 树上的有效分页器，无需重复创建
        if (currentObservedPager === pager && pager.isConnected && waterfallObserver) {
            ensureLoaderPosition(pager);
            return;
        }

        if (waterfallObserver) {
            waterfallObserver.disconnect();
            waterfallObserver = null;
        }

        currentObservedPager = pager;
        ensureLoaderPosition(pager);

        waterfallObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry && entry.isIntersecting) {
                triggerLoadNextPage();
            }
        }, {
            root: null,
            rootMargin: '1000px 0px',
            threshold: 0
        });

        waterfallObserver.observe(pager);
    }

    let lastSearchSign = '';
    // 提取当前搜索上下文唯一特征（路径、关键词、排序规则、时长、时间区间、分类与分区筛选）
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
            p.get('category_id') || ''
        ].join('||');
    }

    // 深度重置瀑布流状态：
    // 1. isNewSearch = true 时，彻底解除旧搜索（如 34 页）的所有已加载完状态，归零到第 1 页并清洗 URL 参数
    // 2. 外部切页时同步校准当前页数并刷新去重字典
    function resetWaterfallForNewSearch(isNewSearch = false) {
        const currentSign = getSearchSignature();
        const signChanged = !lastSearchSign || currentSign !== lastSearchSign;
        lastSearchSign = currentSign;

        const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
        const urlPage = isNaN(p) ? 1 : p;

        if (signChanged || isNewSearch) {
            // 新搜索场景：强制回到第 1 页并解除已全部加载完毕的状态
            currentRequestedPage = 1;
            isAllLoaded = false;
            updateDynamicMaxPage();

            // 若 URL 中残留之前搜索的非首页 page 或 o 参数（如第 34 页或分类页 o=30），强制清洗 URL
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
                    isInternalPaging = true;
                    window.history.replaceState(null, '', u.toString());
                    setTimeout(() => { isInternalPaging = false; }, 100);
                }
            } catch (e) {
                isInternalPaging = false;
            }
        } else {
            currentRequestedPage = urlPage;
            updateDynamicMaxPage();
            isAllLoaded = currentRequestedPage >= maxWaterfallPage;
        }

        isPaging = false;
        refreshSeenBvidsFromDOM();
        updateBadge();

        if (isAllLoaded) {
            showEndedLoader();
        } else {
            updateLoader(false);
            // 重置完成后若首屏内容未占满预加载缓冲带（1000px），提前静默预载下一页
            setTimeout(checkAndTriggerPaging, 300);
        }

        bindWaterfallObserver();
    }

    // B 站官方搜索响应首屏渲染完成钩子：重新采样 DOM 首屏卡片并接管新挂载的分页器
    function onOfficialSearchMounted() {
        if (!isWaterfall) return;
        updateDynamicMaxPage();
        const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
        const urlPage = isNaN(p) ? 1 : p;
        if (urlPage === 1) {
            currentRequestedPage = 1;
            isAllLoaded = maxWaterfallPage <= 1;
        }
        isPaging = false;
        refreshSeenBvidsFromDOM();
        bindWaterfallObserver();
        updateBadge();
        if (isAllLoaded) {
            showEndedLoader();
        } else {
            updateLoader(false);
            // 重置完成后若首屏内容未占满预加载缓冲带（1000px），提前静默预载下一页
            setTimeout(checkAndTriggerPaging, 300);
        }
    }

    // 侦测当前搜索或页码变化并智能分流分发重置逻辑
    function checkSearchChange() {
        if (!isWaterfall) return;
        if (isInternalPaging) return;

        const currentSign = getSearchSignature();
        const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
        const urlPage = isNaN(p) ? 1 : p;

        const signChanged = lastSearchSign && currentSign !== lastSearchSign;
        // 瀑布流保持单页流式体验（URL 不随滚动递增页码），仅当搜索特征变化或 URL 显式带入非首页页码时触发重置
        const pageChanged = urlPage > 1 && urlPage !== currentRequestedPage;

        if (signChanged) {
            resetWaterfallForNewSearch(true);
        } else if (pageChanged) {
            resetWaterfallForNewSearch(false);
        } else if (!lastSearchSign) {
            lastSearchSign = currentSign;
        }
    }

    // 劫持单页路由变更，确保重新搜索或外部切页时立即重置瀑布流状态
    try {
        const originPushState = targetWindow.history.pushState;
        if (originPushState) {
            targetWindow.history.pushState = function(...args) {
                const res = originPushState.apply(this, args);
                setTimeout(checkSearchChange, 50);
                return res;
            };
        }
        const originReplaceState = targetWindow.history.replaceState;
        if (originReplaceState) {
            targetWindow.history.replaceState = function(...args) {
                const res = originReplaceState.apply(this, args);
                setTimeout(checkSearchChange, 50);
                return res;
            };
        }
        targetWindow.addEventListener('popstate', () => {
            setTimeout(checkSearchChange, 50);
        });

        // 委托监听分页按钮点击，单页切页时实时校准瀑布流页码
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button.vui_pagenation--btn, button.vui_pagenation--btn-num');
            if (btn) {
                setTimeout(checkSearchChange, 80);
            }
        }, true);

        // 监听搜索框回车与搜索按钮点击，前置触发瀑布流状态复位
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.classList.contains('search-input'))) {
                    setTimeout(() => {
                        resetWaterfallForNewSearch(true);
                    }, 100);
                }
            }
        }, true);

        document.addEventListener('click', (e) => {
            const searchBtn = e.target.closest('.search-button, .search-btn, .nav-search-btn, button[class*="search"]');
            if (searchBtn) {
                setTimeout(() => {
                    resetWaterfallForNewSearch(true);
                }, 100);
            }
        }, true);

        // 视口滚动兜底监听：在观察者偶发失效或极端快速滚动时，确保触底能正常触发增量拉取
        window.addEventListener('scroll', () => {
            if (!isWaterfall || isWaterfallPaused || isPaging || isAllLoaded) return;
            checkAndTriggerPaging();
        }, { passive: true });

        // 视口尺寸变化监听（响应式栅格切换自适应）：
        // 当用户缩放窗口、最大化或跨屏拖拽时，B 站栅格列数将在 4/5/6/7 列间响应式切换，
        // 官方分页器上的总页码（42/34/28/24）亦会联动重绘。
        // 此处引入 200ms 防抖，为 B 站 Vue 组件重新渲染分页器 DOM 预留充分的响应时间：
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (!isWaterfall) return;

            // 1. 实时校准加载器位置，确保其水平中轴线始终对齐主视频列表
            adjustLoaderCentering();

            // 2. 防抖重采样最新最大页码，并联动校准单页步长（page_size）与终态边界
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                // 重新解析分页器提取当前分辨率下的最新最大页数（42/34/28/24 之一），后续翻页将自动读取新步长
                updateDynamicMaxPage();

                // 3. 动态重校终态边界状态：
                if (!isAllLoaded && currentRequestedPage >= maxWaterfallPage) {
                    // 若窗口缩小导致列数减少、总页数下调，且当前已达新上限：立即转入终态展示
                    isAllLoaded = true;
                    showEndedLoader();
                } else if (isAllLoaded && currentRequestedPage < maxWaterfallPage) {
                    // 若窗口拉宽导致列数增加、总页数放宽，且当前尚未达到新上限：立即解除到底锁定，恢复触底预加载判定
                    isAllLoaded = false;
                    updateLoader(false);
                    checkAndTriggerPaging();
                }
            }, 200);
        }, { passive: true });
    } catch (e) {}

    function syncWaterfallLifecycle() {
        if (!document.body) return;

        if (isWaterfall) {
            // 瀑布流防白屏冷启动保护：若打开或刷新页面的 URL 残留有非第 1 页参数（例如历史记录或从尾页刷新留存的 ?page=34 或分类页 ?o=30），
            // 立即重定向至纯净首页流，杜绝直接渲染尾页导致的前置缺失与空数据白屏
            const currentUrl = new URL(window.location.href);
            const p = parseInt(currentUrl.searchParams.get('page') || '1', 10);
            const o = parseInt(currentUrl.searchParams.get('o') || '0', 10);
            if (p > 1 || o > 0) {
                currentUrl.searchParams.delete('page');
                currentUrl.searchParams.delete('o');
                window.location.replace(currentUrl.toString());
                return;
            }

            document.documentElement.classList.add('bili-waterfall-enabled');

            lastSearchSign = getSearchSignature();
            refreshSeenBvidsFromDOM();

            updateDynamicMaxPage();
            currentRequestedPage = 1;
            isAllLoaded = maxWaterfallPage <= 1;
            isPaging = false;

            getOrCreateBadge();
            updateBadge();
            getOrCreateLoader();
            if (isAllLoaded) {
                showEndedLoader();
            } else {
                updateLoader(false);
            }
            bindWaterfallObserver();
            // 首屏初始化后校验视口高度，若大屏或首屏卡片较少导致缓冲不足，提前静默预载下一页
            setTimeout(checkAndTriggerPaging, 300);
        } else {
            document.documentElement.classList.remove('bili-waterfall-enabled');
            if (waterfallObserver) {
                waterfallObserver.disconnect();
                waterfallObserver = null;
            }
            currentObservedPager = null;
            const badge = document.getElementById('bili-waterfall-badge');
            if (badge) badge.remove();

            const loader = document.getElementById('bili-waterfall-loader');
            if (loader) loader.remove();
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        syncWaterfallLifecycle();
    });
    window.addEventListener('load', () => {
        syncWaterfallLifecycle();
    });

    console.log('[Bilibili 搜索净化] 2.1.0 已启动。');
})();