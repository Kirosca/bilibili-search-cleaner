// ==UserScript==
// @name         Bilibili 去掉搜索无关视频（fuse.js）
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 Fuse.js 模糊匹配、@UP主 定向筛选、-排除词 与 #Tag 专项筛选，彻底净化搜索体验。（支持简繁与测试模式预览）
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

    // 2. 预注入 CSS 规则：广告屏蔽、被过滤卡片状态控制与测试模式浮动栏
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        /* 商业广告卡片与推广流强制隐藏 */
        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }

        /* 正常模式：被过滤卡片隐藏 */
        .bili-purified-hidden {
            display: none !important;
        }

        /* 测试模式：显示被过滤卡片，以虚线红框与半透明状态呈现，并附带过滤原因标识 */
        html.bili-show-filtered-mode .bili-purified-hidden {
            display: block !important;
            opacity: 0.42 !important;
            filter: grayscale(70%) !important;
            position: relative !important;
            outline: 2px dashed #ff4757 !important;
            outline-offset: -2px !important;
            transition: opacity 0.2s ease, filter 0.2s ease;
        }

        html.bili-show-filtered-mode .bili-purified-hidden:hover {
            opacity: 0.95 !important;
            filter: none !important;
        }

        html.bili-show-filtered-mode .bili-purified-hidden::after {
            content: attr(data-purified-reason);
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(255, 71, 87, 0.92);
            color: #ffffff;
            font-size: 11px;
            font-weight: 500;
            line-height: 1.2;
            padding: 3px 7px;
            border-radius: 4px;
            z-index: 999;
            pointer-events: none;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }

        /* 测试模式浮动控制栏 */
        .bili-filter-toggle-pill {
            position: fixed;
            right: 24px;
            bottom: 28px;
            z-index: 100000;
            background: #00aeec;
            color: #ffffff;
            font-size: 12px;
            padding: 6px 14px;
            border-radius: 20px;
            box-shadow: 0 4px 12px rgba(0, 174, 236, 0.35);
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s ease;
            border: 1px solid rgba(255, 255, 255, 0.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        }

        .bili-filter-toggle-pill:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 174, 236, 0.45);
        }

        .bili-filter-toggle-pill.zero {
            background: #10ac84;
            box-shadow: 0 4px 12px rgba(16, 172, 132, 0.35);
        }

        .bili-filter-toggle-pill.active {
            background: #ff4757;
            box-shadow: 0 4px 12px rgba(255, 71, 87, 0.35);
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

    // 5. 数据层：首屏 Pinia 状态扫描 + 翻页网络拦截（存储 标签 + 全级分区，严格不匹配简介）
    const videoTagMap = new Map();
    let hasScannedInitial = false;

    function scanInitialState() {
        if (hasScannedInitial && videoTagMap.size > 0) return;
        try {
            const pinia = window.__pinia;
            if (pinia && typeof pinia === 'object') {
                const prevSize = videoTagMap.size;
                function traverse(node, depth = 0) {
                    if (!node || depth > 8) return;
                    if (Array.isArray(node)) {
                        for (const item of node) {
                            if (item && typeof item === 'object') {
                                const id = item.bvid || item.aid || item.id;
                                if (id) {
                                    const rawTag = item.tag || item.keywords || item.tags || '';
                                    const rawType = [item.parent_area_name, item.typename, item.cate_name].filter(Boolean).join(' ');
                                    const combined = cleanText(`${rawTag} ${rawType}`);
                                    if (combined) {
                                        videoTagMap.set(String(id), combined);
                                    }
                                } else {
                                    traverse(item, depth + 1);
                                }
                            }
                        }
                    } else if (typeof node === 'object') {
                        for (const key of Object.keys(node)) {
                            traverse(node[key], depth + 1);
                        }
                    }
                }
                traverse(pinia);
                if (videoTagMap.size > 0) {
                    hasScannedInitial = true;
                    // 若首屏字典从无到有装载成功，清空之前过早判定的卡片缓存，确保立即重新判定
                    if (prevSize === 0) {
                        document.querySelectorAll('[data-purified-query]').forEach(el => {
                            delete el.dataset.purifiedQuery;
                        });
                    }
                }
            }
        } catch {}
    }

    function cleanAdsOnly(list) {
        if (!Array.isArray(list)) return list;

        return list.filter(v => {
            if (!v || typeof v !== 'object') return true;

            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = v.tag || v.keywords || v.tags || '';
            const rawType = [v.parent_area_name, v.typename, v.cate_name].filter(Boolean).join(' ');
            const combined = cleanText(`${rawTags} ${rawType}`);
            if (id) videoTagMap.set(String(id), combined);

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

    // 6. 浏览器原生分词与 Fuse.js 模糊匹配辅助工厂
    let zhSegmenter = null;
    function segmentText(text) {
        if (!text) return [];
        try {
            if (typeof Intl !== 'undefined' && Intl.Segmenter) {
                if (!zhSegmenter) {
                    zhSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
                }
                return Array.from(zhSegmenter.segment(text))
                    .filter(x => x.isWordLike)
                    .map(x => x.segment.trim())
                    .filter(w => w.length > 0);
            }
        } catch {}
        return [];
    }

    function createMatcher(targetText) {
        let fuseInstance = null;
        return function(queryKeyword) {
            if (!targetText || !queryKeyword) return false;
            // 优先严格子串包含判定（无额外开销）
            if (targetText.includes(queryKeyword)) return true;

            // 严格未命中时，引入中文分词与 Fuse.js 模糊检索
            if (typeof Fuse !== 'undefined') {
                try {
                    if (!fuseInstance) {
                        // 将原始文本与拆词结果共同作为语料喂给 Fuse.js
                        const words = segmentText(targetText);
                        const corpus = Array.from(new Set([targetText, ...words]));
                        fuseInstance = new Fuse(corpus, {
                            threshold: 0.3,
                            ignoreLocation: true
                        });
                    }

                    // 先以完整关键词检索
                    if (fuseInstance.search(queryKeyword).length > 0) return true;

                    // 若完整词未命中且长度大于 2，对其进行分词并逐词喂给 Fuse.js 检索（过滤单字虚词）
                    if (queryKeyword.length > 2) {
                        const queryWords = segmentText(queryKeyword).filter(w => w.length >= 2);
                        if (queryWords.length > 0 && queryWords.some(w => fuseInstance.search(w).length > 0)) {
                            return true;
                        }
                    }
                } catch {
                    return false;
                }
            }
            return false;
        };
    }

    // 7. 测试模式浮动控制栏管理
    let showFilteredMode = false;
    let togglePillEl = null;

    function renderTogglePill() {
        if (!togglePillEl) {
            togglePillEl = document.createElement('div');
            togglePillEl.className = 'bili-filter-toggle-pill';
            togglePillEl.addEventListener('click', () => {
                const count = document.querySelectorAll('.bili-purified-hidden').length;
                if (count === 0) return;
                showFilteredMode = !showFilteredMode;
                document.documentElement.classList.toggle('bili-show-filtered-mode', showFilteredMode);
                togglePillEl.classList.toggle('active', showFilteredMode);
                renderTogglePill();
            });
            (document.body || document.documentElement).appendChild(togglePillEl);
        }

        const count = document.querySelectorAll('.bili-purified-hidden').length;
        if (count > 0) {
            togglePillEl.classList.remove('zero');
            if (showFilteredMode) {
                togglePillEl.classList.add('active');
                togglePillEl.textContent = `已显示过滤视频 (${count}) · 点击隐藏`;
            } else {
                togglePillEl.classList.remove('active');
                togglePillEl.textContent = `已过滤视频 (${count}) · 点击查看`;
            }
        } else {
            togglePillEl.classList.remove('active');
            togglePillEl.classList.add('zero');
            togglePillEl.textContent = `净化生效中 · 已过滤 0 项`;
        }
    }

    // 8. DOM 层执行安检：支持高性能状态缓存、繁简归一化与模糊匹配
    let isProcessing = false;

    function filterDOMElements() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            // 确保首屏 Pinia 状态在 DOM 过滤前完成抽取
            if (!hasScannedInitial) scanInitialState();

            const { normal, exclude, tags, ups } = getSearchKeywords();
            if (!normal.length && !exclude.length && !tags.length && !ups.length) {
                renderTogglePill();
                if (togglePillEl) {
                    togglePillEl.classList.remove('active');
                    togglePillEl.classList.add('zero');
                    togglePillEl.textContent = '净化已就绪 · 未设关键词';
                }
                return;
            }

            const currentSearchQuery = window.location.search;
            const elements = document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card');

            // 预提取普通搜索词及其拆分词集合（过滤单字虚词，保留用户显式单字搜索）
            const allQueryWords = [];
            for (const k of normal) {
                if (!k) continue;
                allQueryWords.push(k);
                if (k.length > 1) {
                    const segs = segmentText(k).filter(w => w.length >= 2);
                    allQueryWords.push(...segs);
                }
            }
            const queryWordList = Array.from(new Set(allQueryWords));

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
                const domTags = Array.from(card.querySelectorAll('.bili-video-card__info--tag, .bili-video-card__badge, .badge, .tag-item')).map(el => cleanText(el.textContent)).join(' ');
                const allVideoTags = cleanText(`${videoTags} ${domTags}`);

                // 双向标签与分区匹配：
                // 1. 标签/分区串包含任一搜索词（如搜索词“绘画”，标签“绘画过程” -> 包含命中）
                // 2. 搜索词包含具体标签/分区（如搜索词“绿龙major”，独立标签“绿龙” -> 包含命中）
                const tagTokens = allVideoTags.split(/[\s,，、]+/).filter(t => t.length >= 2);
                const hasTagMatched = !!(allVideoTags && (
                    queryWordList.some(w => allVideoTags.includes(w)) ||
                    tagTokens.some(tag => queryWordList.some(w => w.includes(tag)))
                ));

                // 纯净提取作者名字（提取第一署名作者）
                const authorEl = card.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname');
                const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';
                const author = cleanText(rawAuthor.replace(/[\s·•].*$/, ''));

                // 检查标题是否包含 B 站官方搜索高亮的 em.keyword 标签
                const hasEmKeyword = !!(titleEl.querySelector('em.keyword, em[class*="keyword"]') || card.querySelector('h3 em.keyword, .bili-video-card__info--tit em.keyword'));

                const matchTitle = createMatcher(title);
                const matchTags = createMatcher(allVideoTags);
                const matchAuthor = createMatcher(author);

                // 四道安检关卡：
                // 1. 排除词保持严格判定（命中任一排除词即刻剔除）
                // 2. 普通关键词采取 OR 逻辑（包含 em.keyword、拆分词匹配视频标签、或命中任一普通词及其 Fuse.js 模糊匹配即视为满足）
                // 3. 标签与 UP 主保持严格约束（指定标签须全部满足，指定作者须符合）
                let filterReason = '';
                const matchedExclude = exclude.find(k => title.includes(k));

                if (matchedExclude) {
                    filterReason = `排除词: -${matchedExclude}`;
                } else if (normal.length && !hasEmKeyword && !hasTagMatched && !normal.some(k => matchTitle(k))) {
                    filterReason = '未命中任一关键词或标签';
                } else if (tags.length && !tags.every(k => matchTags(k))) {
                    filterReason = '未匹配标签';
                } else if (ups.length && !ups.some(k => matchAuthor(k))) {
                    filterReason = '非目标UP主';
                }

                if (filterReason) {
                    card.classList.add('bili-purified-hidden');
                    card.setAttribute('data-purified-reason', filterReason);
                } else {
                    card.classList.remove('bili-purified-hidden');
                    card.removeAttribute('data-purified-reason');
                }
            });

            renderTogglePill();
        } finally {
            isProcessing = false;
        }
    }

    // 9. 帧级节流监听：使用 requestAnimationFrame 防抖
    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(filterDOMElements);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanInitialState();
    renderTogglePill();
    console.log('[Bilibili 搜索净化] 2.1.0 (Fuse.js 模糊匹配) 已启动。');
})();
