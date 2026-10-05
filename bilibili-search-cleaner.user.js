// ==UserScript==
// @name         Bilibili 去掉搜索无关视频（fuse.js）
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持官方搜索联想与相关词扩展、Fuse.js 模糊匹配与 bge-small-zh 本地语义向量模型、@UP主 定向筛选、-排除词 与 #Tag 专项筛选，彻底净化搜索体验。（支持简繁与测试模式预览）
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

        /* 测试模式：语义放行卡片（绿框与相似度徽标） */
        html.bili-show-filtered-mode [data-purified-semantic="rescued"] {
            position: relative !important;
            outline: 2px dashed #10ac84 !important;
            outline-offset: -2px !important;
        }

        html.bili-show-filtered-mode [data-purified-semantic="rescued"]::after {
            content: attr(data-purified-note);
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(16, 172, 132, 0.92);
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

        .bili-filter-toggle-pill.downloading {
            background: #fa8c16 !important;
            box-shadow: 0 4px 12px rgba(250, 140, 22, 0.35) !important;
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

    // 5. 数据层：首屏 Pinia 状态扫描 + 翻页网络拦截 + 搜索响应嗅探（存储 标签 + 全级分区，严格不匹配简介）
    const videoTagMap = new Map();
    let hasScannedInitial = false;

    function scanInitialState() {
        if (hasScannedInitial && videoTagMap.size > 0) return;
        try {
            const pinia = window.__pinia;
            if (pinia && typeof pinia === 'object') {
                const prevSize = videoTagMap.size;
                const piniaExtractedTerms = [];
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
                        if (typeof node.suggest_keyword === 'string' && node.suggest_keyword.trim()) {
                            piniaExtractedTerms.push(cleanText(node.suggest_keyword));
                        }
                        if (Array.isArray(node.rq)) {
                            for (const rqItem of node.rq) {
                                const t = typeof rqItem === 'string' ? rqItem : (rqItem?.keyword || '');
                                if (t) piniaExtractedTerms.push(cleanText(t));
                            }
                        }
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
                if (piniaExtractedTerms.length > 0) {
                    ingestTermsFromList(piniaExtractedTerms);
                }
                refreshCoOccurringTags();
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
            if (data?.data) {
                ingestSearchResponseIntelligence(data.data);
            }
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

                refreshCoOccurringTags();

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

    // 7. 方案 A：B站官方实时搜索联想与相关词嗅探扩展引擎 (Query Expansion Engine)
    // 专治网络黑话/隐喻（如“大肥鱼”->“DeepSeek”）、跨领域关联（如“侏罗纪”->“恐龙”）、专有角色全名（如“崔斯特”->“英雄联盟/卡牌大师”）
    // 多路嗅探机制：
    // ① B站官方 Suggest 实时联想接口（毫秒级提取推荐短语与专有实体词）
    // ② 官方检索结果高频共现视频标签深度嗅探（Top Co-occurring Tags）
    // ③ 翻页/检索网络响应中的纠错词 (suggest_keyword) 与相关搜索 (rq)
    // ④ DOM 渲染的“大家还在搜 / 相关搜索”微件嗅探
    const queryExpansionCache = new Map(); // queryText -> Set<string>
    let currentExpandedWords = new Set();
    let isExpandingQuery = false;
    let lastExpandedQuery = '';

    const EXPANSION_STOPWORDS = new Set([
        // 代词与人称
        '我', '你', '他', '她', '它', '我们', '你们', '他们', '咱们', '自己', '人家', '大家', '别人',
        // 连词与介词
        '因为', '所以', '如果', '但是', '然后', '而且', '并且', '或者', '关于', '对于', '从', '向', '到', '到底',
        // 语气与情态动词
        '不是', '就是', '没有', '没了', '太高', '太强', '不行', '可以', '应该', '必须', '能够', '可能', '觉得', '以为', '知道',
        '为什么', '怎么', '怎样', '什么', '哪里', '谁是', '如何', '多少', '哪个', '是否',
        // 通用媒体与视频制作格式词
        '视频', '动画', '电影', '电视剧', '纪录片', '短片', '剪辑', '录播', '实况', '官方', '预告', '花絮', '片段', '合集',
        '全集', '原声', '音乐', '歌曲', '广播剧', '漫画', '解说', '教学', '介绍', '盘点', '吐槽', '反应', '攻略', '测评',
        '评测', '分享', '记录', '自制', '搬运', '搬运工', '推荐', '杂谈', '讨论', '观看', '播放', '体验', '挑战', '好看',
        '精彩', '搞笑', '经典', '最新', '最新版', '完整版', '高清', '超清', '画质', '免费', '简单', '轻松', '详细', '顶级',
        '第一', '最好', '最强', '纯享', '买前必看', '开箱', '活动',
        // 泛化领域大词与平台名
        'b站', '哔哩哔哩', 'bilibili', '微博', '抖音', '快手', '贴吧', '知乎', '小红书', '游戏', '日常', '生活', '娱乐',
        '综合', '现场', '新闻', '热点', '资讯', '知识', '科学', '学习', '校园', '职业', '时代', '世界', '历史', '中国', '全国', '个人'
    ]);

    function extractTopCoOccurringTags(queryText) {
        if (videoTagMap.size === 0) return [];
        const tagCount = new Map();
        let totalSamples = 0;

        for (const rawTags of videoTagMap.values()) {
            totalSamples++;
            const tokens = rawTags.split(/[\s,，、]+/).map(t => cleanText(t)).filter(t => t.length >= 2);
            const uniqueTokens = new Set(tokens);
            for (const tok of uniqueTokens) {
                if (!tok) continue;
                if (tok === queryText || tok.includes(queryText) || queryText.includes(tok)) continue;
                if (EXPANSION_STOPWORDS.has(tok)) continue;
                if (/^\d+$/.test(tok)) continue;
                tagCount.set(tok, (tagCount.get(tok) || 0) + 1);
            }
        }

        if (totalSamples < 3) return [];

        // 筛选出现频次 >= 2 且在样本中占比 >= 15% 的高置信度共现标签，最多取前 4 个
        const sorted = Array.from(tagCount.entries())
            .filter(([_, count]) => count >= 2 && (count / totalSamples) >= 0.15)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([tag]) => tag);

        return sorted;
    }

    function scanDOMRelatedSearches() {
        const list = [];
        try {
            const elements = document.querySelectorAll(
                '.search-bottom-related a, .bili-search-related a, .related-search a, [class*="related"] a, [class*="recommend"] a, [class*="suggest"] a'
            );
            for (const el of elements) {
                const text = cleanText(el.textContent);
                if (text && text.length >= 2 && text.length <= 16 && !EXPANSION_STOPWORDS.has(text)) {
                    list.push(text);
                }
            }
        } catch {}
        return list;
    }

    function ingestTermsFromList(terms) {
        const currentQuery = getCleanApiKeyword();
        if (!currentQuery || !Array.isArray(terms)) return;

        let cached = queryExpansionCache.get(currentQuery);
        if (!cached) {
            cached = new Set();
            queryExpansionCache.set(currentQuery, cached);
        }

        let addedCount = 0;
        for (const t of terms) {
            const clean = cleanText(t);
            if (clean && clean !== currentQuery && clean.length >= 2 && !EXPANSION_STOPWORDS.has(clean)) {
                if (!cached.has(clean)) {
                    cached.add(clean);
                    addedCount++;
                }
            }
        }

        if (addedCount > 0) {
            currentExpandedWords = cached;
            document.querySelectorAll('.bili-purified-hidden[data-purified-query]').forEach(el => {
                delete el.dataset.purifiedQuery;
            });
            filterDOMElements();
        }
    }

    function ingestSearchResponseIntelligence(data) {
        if (!data || typeof data !== 'object') return;
        const currentQuery = getCleanApiKeyword();
        if (!currentQuery) return;

        const newTerms = [];
        if (data.suggest_keyword && typeof data.suggest_keyword === 'string') {
            newTerms.push(cleanText(data.suggest_keyword));
        }
        if (Array.isArray(data.rq)) {
            for (const item of data.rq) {
                const text = typeof item === 'string' ? item : (item?.keyword || item?.word || '');
                if (text) newTerms.push(cleanText(text));
            }
        }
        if (Array.isArray(data.exp_list)) {
            for (const exp of data.exp_list) {
                if (exp && typeof exp.word === 'string') {
                    newTerms.push(cleanText(exp.word));
                }
            }
        }
        if (newTerms.length > 0) {
            ingestTermsFromList(newTerms);
        }
    }

    function refreshCoOccurringTags() {
        const currentQuery = getCleanApiKeyword();
        if (!currentQuery) return;
        const topTags = extractTopCoOccurringTags(currentQuery);
        if (topTags.length > 0) {
            ingestTermsFromList(topTags);
        }
    }

    async function scheduleQueryExpansion(queryText) {
        if (!queryText || isExpandingQuery) return;
        if (lastExpandedQuery === queryText && currentExpandedWords.size > 0) return;

        if (queryExpansionCache.has(queryText)) {
            currentExpandedWords = queryExpansionCache.get(queryText);
            lastExpandedQuery = queryText;
            filterDOMElements();
            return;
        }

        isExpandingQuery = true;
        lastExpandedQuery = queryText;

        try {
            const expansions = new Set();

            // 1. 嗅探 B 站官方 Suggest 联想接口
            try {
                const suggestUrl = `https://s.search.bilibili.com/main/suggest?func=suggest&suggest_type=accurate&sub_type=tag&main_ver=v1&highlight=&term=${encodeURIComponent(queryText)}`;
                const res = await originFetch(suggestUrl);
                if (res.ok) {
                    const data = await res.json();
                    const tags = data?.result?.tag || [];
                    for (const item of tags) {
                        const rawVal = (item.value || item.term || '').trim();
                        const val = cleanText(rawVal);
                        if (!val) continue;

                        // 保留结构完整的精炼联想短语（如 侏罗纪世界, 侏罗纪公园, deepseek大肥鱼, 太空律动小小崔斯特）
                        if (val.length >= 3 && val.length <= 15 && !/[\s,，。！!？?、]/.test(val) && val !== queryText) {
                            expansions.add(val);
                        }

                        // 独立提取英文/数字专有名词实体（如 deepseek, lol, r1）
                        const enTokens = val.match(/[A-Za-z0-9_]{2,}/g) || [];
                        for (const en of enTokens) {
                            const cleanEn = cleanText(en);
                            if (cleanEn !== queryText && !EXPANSION_STOPWORDS.has(cleanEn) && !/^\d+$/.test(cleanEn)) {
                                expansions.add(cleanEn);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[Bilibili 搜索净化] 联想接口嗅探异常：', e);
            }

            // 2. 嗅探当前页面结果高频共现视频标签（Top Co-occurring Tags）
            try {
                const coOccurring = extractTopCoOccurringTags(queryText);
                for (const tag of coOccurring) {
                    expansions.add(tag);
                }
            } catch (e) {
                console.warn('[Bilibili 搜索净化] 标签共现嗅探异常：', e);
            }

            // 3. 嗅探页面 DOM 中的相关搜索链接（大家还在搜）
            try {
                const domRelated = scanDOMRelatedSearches();
                for (const term of domRelated) {
                    if (term !== queryText && !EXPANSION_STOPWORDS.has(term)) {
                        expansions.add(term);
                    }
                }
            } catch (e) {}

            // 控制扩词集上限，精选前 12 个强关联词条
            const validExpansions = new Set();
            for (const word of expansions) {
                if (word && word.length >= 2 && !EXPANSION_STOPWORDS.has(word)) {
                    validExpansions.add(word);
                    if (validExpansions.size >= 12) break;
                }
            }

            currentExpandedWords = validExpansions;
            queryExpansionCache.set(queryText, validExpansions);

            if (validExpansions.size > 0) {
                console.log(`[Bilibili 搜索净化] 方案 A 实时扩展词已就绪 [${queryText}] ->`, Array.from(validExpansions));
                // 扩词就绪后，重置未放行卡片的判定标记并立即触发一轮筛选
                document.querySelectorAll('.bili-purified-hidden[data-purified-query]').forEach(el => {
                    delete el.dataset.purifiedQuery;
                });
                filterDOMElements();
            }
        } finally {
            isExpandingQuery = false;
        }
    }

    // 8. 本地 AI 语义向量引擎（基于 Transformers.js + bge-small-zh-v1.5 模型）
    const SEMANTIC_THRESHOLD = 0.60;
    const CHUNK_EVAL_MIN_THRESHOLD = 0.48; // 边缘临界区下界：高于此分的未命中长标题触发局部最大池化细算
    const BGE_QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';
    const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';

    // 标题降噪分段抽取器：将长标题切分成具有独立特征的语义片段
    function splitTitleChunks(title) {
        if (!title || title.length < 8) return [];
        const rawChunks = title.split(/[\s\[\]【】()（）|:：,，_—#\-·/]+/)
                               .map(t => t.trim())
                               .filter(t => t.length >= 3 && !/^\d+$/.test(t));
        if (rawChunks.length <= 1 && rawChunks[0] === title) return [];
        return rawChunks.slice(0, 3);
    }

    // 基于 IndexedDB 的持久化模型缓存（彻底解决浏览器 Cache API 跨域限制与重新下载问题）
    const IDB_NAME = 'bili_semantic_cache';
    const IDB_VERSION = 1;
    const IDB_STORE = 'models';

    function openIDB() {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                return reject(new Error('IndexedDB not supported'));
            }
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbGet(key) {
        try {
            const db = await openIDB();
            return new Promise((resolve) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const store = tx.objectStore(IDB_STORE);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(undefined);
            });
        } catch {
            return undefined;
        }
    }

    async function idbSet(key, value) {
        try {
            const db = await openIDB();
            return new Promise((resolve) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                store.put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {}
    }

    // 实现 Web Cache API 标准的 customCache 适配器，向 Transformers.js 提供持久化读写
    const customCache = {
        async match(url) {
            const urlStr = typeof url === 'string' ? url : (url?.url || '');
            if (!urlStr) return undefined;

            // 1. 优先读取 IndexedDB 本地持久化缓存
            const record = await idbGet(urlStr);
            if (record && record.buffer) {
                return new Response(record.buffer.slice(0), {
                    status: 200,
                    headers: record.headers || {}
                });
            }

            // 2. 兼容读取浏览器 Cache Storage 并在命中时迁移至 IndexedDB
            if (typeof caches !== 'undefined') {
                try {
                    const c = await caches.open('transformers-cache');
                    const matched = await c.match(urlStr);
                    if (matched) {
                        const clone = matched.clone();
                        const buffer = await clone.arrayBuffer();
                        const headers = {};
                        if (matched.headers) {
                            for (const [k, v] of matched.headers.entries()) headers[k] = v;
                        }
                        idbSet(urlStr, { buffer, headers });
                        return matched;
                    }
                } catch {}
            }

            return undefined;
        },

        async put(url, response) {
            const urlStr = typeof url === 'string' ? url : (url?.url || '');
            if (!urlStr || !response) return;

            try {
                const clone = response.clone();
                const buffer = await clone.arrayBuffer();
                const headers = {};
                if (response.headers) {
                    for (const [k, v] of response.headers.entries()) {
                        headers[k] = v;
                    }
                }
                // 持久写入 IndexedDB，不受任何网络跨域或 HTTP Cache-Control 限制
                await idbSet(urlStr, { buffer, headers });

                // 同步尝试备份至 Cache Storage
                if (typeof caches !== 'undefined') {
                    try {
                        const c = await caches.open('transformers-cache');
                        await c.put(urlStr, new Response(buffer.slice(0), { headers }));
                    } catch {}
                }
            } catch (e) {
                console.warn('[Bilibili 搜索净化] 模型缓存持久化异常：', urlStr, e);
            }
        }
    };

    async function isModelCached() {
        const onnxKey = `https://huggingface.co/${MODEL_NAME}/resolve/main/onnx/model_quantized.onnx`;
        const idbRecord = await idbGet(onnxKey);
        if (idbRecord && idbRecord.buffer && idbRecord.buffer.byteLength > 10000000) {
            return true;
        }
        if (typeof caches !== 'undefined') {
            try {
                const c = await caches.open('transformers-cache');
                const matched = await c.match(onnxKey);
                if (matched) return true;
            } catch {}
        }
        return false;
    }

    let semanticStage = 'idle'; // 'idle' | 'downloading' | 'loading_cache' | 'ready' | 'error'
    let isLocalLoading = false;
    let semanticProgress = 0;
    let lastRenderedProgress = -1;
    let pipelineInstance = null;
    let currentQueryEmbedding = null;
    let currentQueryKey = '';

    const fileProgressMap = new Map();
    const titleEmbeddingCache = new Map();

    function cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    function onModelProgress(data) {
        if (!data) return;
        if (data.status === 'initiate') {
            if (!isLocalLoading && semanticStage !== 'downloading') {
                semanticStage = 'downloading';
                renderTogglePill();
            } else if (isLocalLoading && semanticStage !== 'loading_cache') {
                semanticStage = 'loading_cache';
                renderTogglePill();
            }
        } else if (data.status === 'progress' && data.file) {
            semanticStage = isLocalLoading ? 'loading_cache' : 'downloading';
            fileProgressMap.set(data.file, {
                loaded: data.loaded || 0,
                total: data.total || 0,
                progress: typeof data.progress === 'number' ? data.progress : 0
            });

            let totalLoaded = 0;
            let totalBytes = 0;
            for (const item of fileProgressMap.values()) {
                if (item.total > 0) {
                    totalLoaded += item.loaded;
                    totalBytes += item.total;
                }
            }

            let nextProgress = 0;
            if (totalBytes > 0) {
                nextProgress = Math.min(99, Math.floor((totalLoaded / totalBytes) * 100));
            } else if (typeof data.progress === 'number') {
                nextProgress = Math.min(99, Math.floor(data.progress));
            }

            if (nextProgress !== lastRenderedProgress) {
                lastRenderedProgress = nextProgress;
                semanticProgress = nextProgress;
                renderTogglePill();
            }
        } else if (data.status === 'done') {
            if (data.file && fileProgressMap.has(data.file)) {
                const item = fileProgressMap.get(data.file);
                item.progress = 100;
                if (item.total > 0) item.loaded = item.total;
            }
        } else if (data.status === 'ready') {
            semanticStage = 'ready';
            semanticProgress = 100;
            isLocalLoading = true;
            renderTogglePill();
        }
    }

    async function initSemanticEngine() {
        try {
            const cached = await isModelCached();
            isLocalLoading = cached;
            semanticStage = cached ? 'loading_cache' : 'downloading';
            renderTogglePill();

            const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
            env.allowLocalModels = false;
            env.useBrowserCache = false;
            env.useCustomCache = true;
            env.customCache = customCache;
            if (env.backends?.onnx?.wasm) {
                env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
                env.backends.onnx.wasm.numThreads = 1;
            }

            pipelineInstance = await pipeline('feature-extraction', MODEL_NAME, {
                quantized: true,
                progress_callback: onModelProgress
            });

            semanticStage = 'ready';
            semanticProgress = 100;
            isLocalLoading = true;
            renderTogglePill();

            // 模型就绪后立即触发一轮语义评估
            scheduleSemanticEvaluation();
        } catch (err) {
            semanticStage = 'error';
            renderTogglePill();
            console.warn('[Bilibili 搜索净化] bge-small-zh 语义模型载入失败，平滑降级至纯词法匹配模式：', err);
        }
    }

    async function getQueryEmbedding(queryStr) {
        if (!pipelineInstance || !queryStr) return null;
        if (currentQueryKey === queryStr && currentQueryEmbedding) {
            return currentQueryEmbedding;
        }
        try {
            // 使用 BGE 官方非对称检索 Prompt 增强特征对齐
            const prompt = `${BGE_QUERY_PREFIX}${queryStr}`;
            const output = await pipelineInstance(prompt, { pooling: 'mean', normalize: true });
            if (output && output.data) {
                currentQueryEmbedding = new Float32Array(output.data);
                currentQueryKey = queryStr;
                return currentQueryEmbedding;
            }
        } catch (e) {
            console.warn('[Bilibili 搜索净化] 检索词向量计算失败：', queryStr, e);
        }
        return null;
    }

    let isSemanticEvaluating = false;
    let pendingSemanticRun = false;

    async function scheduleSemanticEvaluation() {
        if (!pipelineInstance || semanticStage !== 'ready') return;
        if (isSemanticEvaluating) {
            pendingSemanticRun = true;
            return;
        }
        isSemanticEvaluating = true;
        try {
            await evaluatePendingCards();
        } finally {
            isSemanticEvaluating = false;
            if (pendingSemanticRun) {
                pendingSemanticRun = false;
                scheduleSemanticEvaluation();
            }
        }
    }

    async function evaluatePendingCards() {
        const { normal } = getSearchKeywords();
        if (!normal.length) return;
        const queryText = getCleanApiKeyword() || normal.join(' ');
        if (!queryText) return;

        const currentSearchQuery = window.location.search;
        const queryVec = await getQueryEmbedding(queryText);
        if (!queryVec) return;

        // 获取所有因“未命中关键词”被过滤且尚未进行当前搜索词语义判定的卡片
        const hiddenCards = Array.from(document.querySelectorAll('.bili-purified-hidden')).filter(card => {
            const reason = card.getAttribute('data-purified-reason') || '';
            const isLexicalMismatch = reason === '未命中任一关键词或标签' || reason.startsWith('未命中关键词 (语义相似度:');
            const notYetEvaluated = card.dataset.purifiedSemanticQuery !== currentSearchQuery;
            return isLexicalMismatch && notYetEvaluated;
        });

        if (hiddenCards.length === 0) return;

        for (const card of hiddenCards) {
            if (window.location.search !== currentSearchQuery) break;

            const titleEl = card.querySelector('h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3');
            if (!titleEl) continue;
            const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
            const title = cleanText(rawTitle);
            if (!title) continue;

            // 若卡片在排队期间命中了新到达的联想扩展词，直接放行，免去模型推理
            if (currentExpandedWords.size > 0) {
                const matchTitle = createMatcher(title);
                let hitExp = '';
                for (const expWord of currentExpandedWords) {
                    if (matchTitle(expWord)) {
                        hitExp = expWord;
                        break;
                    }
                }
                if (hitExp) {
                    card.classList.remove('bili-purified-hidden');
                    card.removeAttribute('data-purified-reason');
                    card.dataset.purifiedSemantic = 'rescued';
                    card.dataset.purifiedNote = `联想放行 [${hitExp}]`;
                    card.dataset.purifiedSemanticQuery = currentSearchQuery;
                    renderTogglePill();
                    continue;
                }
            }

            try {
                // 1. 先计算整句标题的语义向量
                let titleVec = titleEmbeddingCache.get(title);
                if (!titleVec) {
                    const output = await pipelineInstance(title, { pooling: 'mean', normalize: true });
                    if (output && output.data) {
                        titleVec = new Float32Array(output.data);
                        if (titleEmbeddingCache.size > 2000) titleEmbeddingCache.clear();
                        titleEmbeddingCache.set(title, titleVec);
                    }
                }

                if (titleVec) {
                    let bestSim = cosineSimilarity(queryVec, titleVec);
                    let bestChunk = '';

                    // 2. 局部最大池化策略（仅在整句处于边缘临界区时触发子片段细算）
                    if (bestSim >= CHUNK_EVAL_MIN_THRESHOLD && bestSim < SEMANTIC_THRESHOLD) {
                        const chunks = splitTitleChunks(title);
                        for (const chunk of chunks) {
                            let chunkVec = titleEmbeddingCache.get(chunk);
                            if (!chunkVec) {
                                const chunkOutput = await pipelineInstance(chunk, { pooling: 'mean', normalize: true });
                                if (chunkOutput && chunkOutput.data) {
                                    chunkVec = new Float32Array(chunkOutput.data);
                                    if (titleEmbeddingCache.size > 2000) titleEmbeddingCache.clear();
                                    titleEmbeddingCache.set(chunk, chunkVec);
                                }
                            }
                            if (chunkVec) {
                                const chunkSim = cosineSimilarity(queryVec, chunkVec);
                                if (chunkSim > bestSim) {
                                    bestSim = chunkSim;
                                    bestChunk = chunk;
                                }
                                if (bestSim >= SEMANTIC_THRESHOLD) break;
                            }
                        }
                    }

                    card.dataset.purifiedSemanticQuery = currentSearchQuery;
                    card.dataset.purifiedSimilarity = bestSim.toFixed(2);

                    if (bestSim >= SEMANTIC_THRESHOLD) {
                        card.classList.remove('bili-purified-hidden');
                        card.removeAttribute('data-purified-reason');
                        card.dataset.purifiedSemantic = 'rescued';
                        card.dataset.purifiedNote = bestChunk ? `语义放行 [${bestChunk}] (${bestSim.toFixed(2)})` : `语义放行 (${bestSim.toFixed(2)})`;
                        renderTogglePill();
                    } else {
                        card.setAttribute('data-purified-reason', `未命中关键词 (语义相似度: ${bestSim.toFixed(2)})`);
                        card.dataset.purifiedSemantic = 'filtered';
                    }
                }
            } catch (err) {
                console.warn('[Bilibili 搜索净化] 标题向量计算失败：', title, err);
            }

            // 保持微任务切片，防止连续推理造成主线程丢帧
            await new Promise(r => setTimeout(r, 10));
        }

        renderTogglePill();
    }

    // 8. 测试模式浮动控制栏管理
    let showFilteredMode = false;
    let togglePillEl = null;

    function renderTogglePill() {
        if (!togglePillEl) {
            togglePillEl = document.createElement('div');
            togglePillEl.className = 'bili-filter-toggle-pill';
            togglePillEl.addEventListener('click', () => {
                const count = document.querySelectorAll('.bili-purified-hidden').length;
                if (count === 0 && !showFilteredMode) return;
                showFilteredMode = !showFilteredMode;
                document.documentElement.classList.toggle('bili-show-filtered-mode', showFilteredMode);
                togglePillEl.classList.toggle('active', showFilteredMode);
                renderTogglePill();
            });
            (document.body || document.documentElement).appendChild(togglePillEl);
        }

        let prefix = '';
        if (semanticStage === 'downloading') {
            prefix = `[模型下载 ${semanticProgress}%] `;
            togglePillEl.classList.add('downloading');
        } else if (semanticStage === 'loading_cache') {
            prefix = `[本地载入 ${semanticProgress}%] `;
            togglePillEl.classList.remove('downloading');
        } else {
            togglePillEl.classList.remove('downloading');
            if (semanticStage === 'ready') {
                prefix = `[语义就绪] `;
            } else if (semanticStage === 'error') {
                prefix = `[词法模式] `;
            }
        }

        const count = document.querySelectorAll('.bili-purified-hidden').length;
        if (count > 0) {
            togglePillEl.classList.remove('zero');
            if (showFilteredMode) {
                togglePillEl.classList.add('active');
                togglePillEl.textContent = `${prefix}已显示过滤视频 (${count}) · 点击隐藏`;
            } else {
                togglePillEl.classList.remove('active');
                togglePillEl.textContent = `${prefix}已过滤视频 (${count}) · 点击查看`;
            }
        } else {
            togglePillEl.classList.remove('active');
            togglePillEl.classList.add('zero');
            togglePillEl.textContent = `${prefix}净化生效中 · 已过滤 0 项`;
        }
    }

    // 10. DOM 层执行安检：支持高性能状态缓存、繁简归一化、联想词放行与语义相似度多级漏斗
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
                    let prefix = '';
                    if (semanticStage === 'downloading') prefix = `[模型下载 ${semanticProgress}%] `;
                    else if (semanticStage === 'loading_cache') prefix = `[本地载入 ${semanticProgress}%] `;
                    else if (semanticStage === 'ready') prefix = `[语义就绪] `;
                    else if (semanticStage === 'error') prefix = `[词法模式] `;
                    togglePillEl.textContent = `${prefix}净化已就绪 · 未设关键词`;
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

            // 调度方案 A 实时搜索联想与相关词扩展
            const queryText = getCleanApiKeyword() || normal.join(' ');
            if (queryText && (!lastExpandedQuery || lastExpandedQuery !== queryText || currentExpandedWords.size === 0)) {
                scheduleQueryExpansion(queryText);
            }

            elements.forEach(el => {
                // 放行特例：div.b-user-video-card 下的子元素 .video-list 内部展示的视频，直接保留不予过滤
                if (el.closest('.b-user-video-card, div[class*="b-user-video-card"]')?.querySelector('.video-list')?.contains(el) ||
                    el.closest('.b-user-video-card .video-list, div[class*="b-user-video-card"] .video-list')) {
                    return;
                }

                const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;

                // 若之前已被语义判定放行，且属于当前搜索词，直接保留不予重新过滤
                if (card.dataset.purifiedSemantic === 'rescued' && card.dataset.purifiedSemanticQuery === currentSearchQuery) {
                    card.dataset.purifiedQuery = currentSearchQuery;
                    card.classList.remove('bili-purified-hidden');
                    card.removeAttribute('data-purified-reason');
                    return;
                }

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
                // 3. 方案 A 实时扩展词放行（命中 B 站联想词、高频共现标签或相关搜索即放行）
                // 4. 标签与 UP 主保持严格约束（指定标签须全部满足，指定作者须符合）
                let filterReason = '';
                const matchedExclude = exclude.find(k => title.includes(k));

                // UP 主名字命中判定：UP 主名字包含搜索文字时也放行
                const authorHasMatched = !!(author && (
                    queryWordList.some(w => author.includes(w)) ||
                    normal.some(k => author.includes(k) || k.includes(author))
                ));

                const hasNormalMatched = hasEmKeyword || hasTagMatched || authorHasMatched || normal.some(k => matchTitle(k));

                let matchedExpWord = '';
                if (!hasNormalMatched && currentExpandedWords.size > 0) {
                    for (const expWord of currentExpandedWords) {
                        if (matchTitle(expWord) || (allVideoTags && allVideoTags.includes(expWord))) {
                            matchedExpWord = expWord;
                            break;
                        }
                    }
                }

                if (matchedExclude) {
                    filterReason = `排除词: -${matchedExclude}`;
                } else if (normal.length && !hasNormalMatched) {
                    if (matchedExpWord) {
                        // 命中方案 A 联想扩展词放行
                        card.dataset.purifiedSemantic = 'rescued';
                        card.dataset.purifiedNote = `联想放行 [${matchedExpWord}]`;
                        card.dataset.purifiedSemanticQuery = currentSearchQuery;
                    } else if (currentQueryEmbedding && titleEmbeddingCache.has(title)) {
                        const cachedVec = titleEmbeddingCache.get(title);
                        const sim = cosineSimilarity(currentQueryEmbedding, cachedVec);
                        card.dataset.purifiedSemanticQuery = currentSearchQuery;
                        card.dataset.purifiedSimilarity = sim.toFixed(2);
                        if (sim >= SEMANTIC_THRESHOLD) {
                            card.dataset.purifiedSemantic = 'rescued';
                            card.dataset.purifiedNote = `语义放行 (${sim.toFixed(2)})`;
                        } else if (sim < CHUNK_EVAL_MIN_THRESHOLD) {
                            card.dataset.purifiedSemantic = 'filtered';
                            filterReason = `未命中关键词 (语义相似度: ${sim.toFixed(2)})`;
                        } else {
                            filterReason = '未命中任一关键词或标签';
                        }
                    } else {
                        filterReason = '未命中任一关键词或标签';
                    }
                }

                // 若上述普通词与联想词/语义判定通过，仍须满足用户显式指定的 #Tag 与 @UP主 条件
                if (!filterReason) {
                    if (tags.length && !tags.every(k => matchTags(k))) {
                        filterReason = '未匹配标签';
                    } else if (ups.length && !ups.some(k => matchAuthor(k))) {
                        filterReason = '非目标UP主';
                    }
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

            // 若语义引擎已就绪，调度后台异步评估队列
            if (semanticStage === 'ready') {
                scheduleSemanticEvaluation();
            }
        } finally {
            isProcessing = false;
        }
    }

    // 11. 帧级节流监听：使用 requestAnimationFrame 防抖
    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(filterDOMElements);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanInitialState();
    renderTogglePill();
    initSemanticEngine();
    console.log('[Bilibili 搜索净化] 2.1.0 (Fuse.js + bge-small-zh + 搜索联想扩展) 已启动。');
})();
