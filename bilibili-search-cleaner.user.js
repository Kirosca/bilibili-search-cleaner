// ==UserScript==
// @name         Bilibili 去掉搜索无关视频（模糊搜索测试版）
// @namespace    http://tampermonkey.net/
// @version      0.0.5
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持哈工大《同义词词林》纯异素同义词扩展、官方搜索联想与相关词扩展、视频简介匹配、Fuse.js 模糊匹配与 bge-small-zh 本地语义向量模型、@UP主 定向筛选、-排除词 与 #Tag 专项筛选，彻底净化搜索体验。（支持简繁与测试模式预览）
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

        /* 测试模式：同义词放行卡片（青蓝虚线边框与专属徽标） */
        html.bili-show-filtered-mode [data-purified-note^="同义放行"] {
            position: relative !important;
            outline: 2px dashed #0984e3 !important;
            outline-offset: -2px !important;
        }

        html.bili-show-filtered-mode [data-purified-note^="同义放行"]::after {
            content: attr(data-purified-note);
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(9, 132, 227, 0.92) !important;
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

    // 5. 数据层：首屏 Pinia 状态扫描 + 翻页网络拦截 + 搜索响应嗅探（存储 标签 + 全级分区 + 视频简介）
    const videoTagMap = new Map();
    const videoDescMap = new Map();
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
                                    const rawDesc = item.description || item.desc || '';
                                    const cleanDesc = cleanText(rawDesc);
                                    if (cleanDesc) {
                                        videoDescMap.set(String(id), cleanDesc);
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

            const rawDesc = v.description || v.desc || '';
            const cleanDesc = cleanText(rawDesc);
            if (id && cleanDesc) videoDescMap.set(String(id), cleanDesc);

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


    // 7.5. 哈尔滨工业大学《同义词词林（扩展版）》纯异素同义词引擎
    // 专治字面完全无重叠的纯异素同义词（如“西红柿”与“番茄”、“土豆”与“马铃薯”、“自行车”与“单车”）
    const HIT_THESAURUS_COMPACT = "实物=玩意=玩意儿=钱物|专有物=占有物|整体=通体|晶体=晶粒=结晶=结晶体|晶状体=水晶体|绝缘体=非导体|同系物=等价物|附属物=附着物|抽样=样片|王水=硝酸=硝镪水|乙酸=冰醋酸=醋酸|氢氧化钠=火碱=烧碱=苛性钠|大苏打=碳酸钠|硫酸铜=胆矾|明矾=白矾|单晶=单晶硅=多晶硅=硅单晶=结晶硅|干酪素=活质=蛋白胨=蛋白质|正离子=阳离子|古生物=底栖生物=浮游生物=海洋生物=漫游生物=生物体|动物=动物群=百兽|常温动物=温血动物|冷血动物=变温动物|甲壳动物=节肢动物|圆形动物=线形动物|植物=植被|喜光植物=阳性植物|大秋作物=晚秋作物=秋庄稼|越冬作物=过冬作物|微生物=菌物|动植物=野物=飞潜动植|物品=物料|必需品=日用品=日用百货=消费品=用品|给养=补给|摆设=陈设|留念=纪念=纪念品=纪念币=纪念物=表记|什物=杂品=杂物=生财=零七八碎|古物=古玩=老古董=骨董|吉光片羽=手泽=旧物=遗物|信物=证物|假冒伪劣品=假货=冒牌货=赝品=赝鼎|当头=抵押品|危禁品=禁制品=禁品=禁药=违禁品=违禁物品|贼赃=赃物|作件=制件=工件=铸件|元件=构件=部件=预制构件|备件=构配件=配件=附件=零配件|商品=货品=货物|小商品=小百货=广货=日杂=杂货=百货|国产品=国产货=国货|冷冻货=冷货|水货=私货=走私货=黑货|优等品=优质品=原装货|产品=出品=制品=必要产品=成品|半制品=半成品=坯料=毛坯=粗制品|剩余产品=副品=劣质品=处理品=次品=残品=滞销品=等外品|仿制品=复制品|传销商品=展销品=新品=试制品=试用品|出产=物产|水产=海产=渔产|土产=土特产=土特产品=土货|器具=器材=器械=器物=家什=用具|器皿=容器=盛器|酒具=酒器|喷头=莲蓬头|消火栓=消防栓|装具=装备=装置=设备=设施=配备|军品=军资=战略物资=物资=生产资料|材料=材质=生料=质料|原料=原料药=原材料|香料=香精|消费资料=生活必需品=生活资料|柴米油盐=油盐酱醋=油盐酱醋柴|农机具=家具=家电=灶具=燃气具=食具|贺仪=贺礼|千里鹅毛=小意思=薄礼=谢礼|彩礼=聘礼=财礼|祭礼=赙仪|妆奁=嫁妆=陪嫁=陪送|供品=祭品=贡品|宝物=宝贝=无价宝=珍品=珍宝=至宝|吉光片羽=奇珍异宝=宝中之宝=无价之宝=珍玩=财宝=金银财宝=麟角凤觜|宝库=宝藏=富源=矿藏=聚宝盆=资源=金矿|传家宝=家珍|矿产=矿体=矿物=矿物质|担子=挑子=货郎担|包袱=包裹|何事=甚么|块状=疙瘩=硬结|末儿=末子=碎末=粉末=面子=齑粉|一点=星子=点子|微粒=球粒=砟子=豆子=颗粒|坨子=垛子|一小撮=把子|丸子=圆子=圆珠=弹子=珠子|片儿=片子=片片|木屑=纸屑=草屑|筒子=管子|焊丝=焊条|渔钩=鱼钩|发网=台网=大网=网子=网络=罗网|冲击波=平面波=微波=纵波=表面波=音波|先端=尖头=尖子=末流=终端|床头=炕头|低点器底=平底=底层=底色=底边=底部=最底层=标底|尾子=尾巴=屁股=末尾=末梢|四边=斜边=沿儿|一角=棱角=犄角|表面=面上=面子|壳子=外壳|反面=碑阴=背面|南侧=南端|东侧=东端|北侧=北端|外围=外层|架子=骨头架子=骨子=骨架=龙骨|框子=边框|杆子=横杆=竿子|把儿=把子=把手=提手=提梁=耳子=轩辕=靠手|扳手=拉手=摇手|刀把=刀柄|凤爪=发射臂=秧脚=脚底=脚蹼=韵脚|侧翼=副翼=双翼=尾翼=机翼=翅子=翅翼=翅膀|双星=日月星辰=星体=星斗=星星=星球=星辰=繁星|二十八宿=星宿=星座|云汉=天河=星河=河汉=银汉=银河|启明=启明星=太白星=昏星=晨星=金星=长庚|火星=荧惑|岁星=木星|土星=镇星|牛郎星=牵牛=牵牛星|北斗=北斗星=天罡星|北极星=北辰|哈雷彗星=彗星=扫帚星=白虎星|寿星=老人星|客星=流星=贼星=陨星=陨石=陨铁|太阳=日头=红日|旭日=朝日=朝阳|夕阳=斜阳=残阳=落日|丽日=炎日=烈日=烈阳=艳阳=骄阳|太阳黑子=日斑=黑子|新月=朔月|新月=月牙|月轮=望月=满月|明月=皎月=皓月|大明=日月|寰宇=寰球|大洲=大陆=新大陆=次大陆=陆上=陆地|山坞=山坳|低地=低洼地=洼地=淤土地=盆地|沙荒=荒原=荒地=荒野|处女地=生地=生荒|盐碱地=碱地=碱荒=荒碱地|雪原=雪地=雪域=雪峰|原野=旷野=沃野千里=田野=莽原=莽苍=郊野|一马平川=冲积平原=坝子=平原=平地=平川=沙场|甸子=科尔沁=草原=草地=草甸子=草野|水泽=沼泽=沼泽地=泽国=淤地=草泽|大漠=戈壁=沙漠=荒漠|三角洲=沙地=沙洲|摊床=沙嘴=沙滩=滩头|坡岸=对岸=岸上=岸边=彼岸=水边=河沿=近岸|山体=山峰=山脉=山脊=支脉=深山=群山|翠微=苍山=青山|小山=山岳=山陵=崇山峻岭=高山|冈峦=冈陵=土岗=山冈=山包=山岗=岗子=突地|丘岗=土丘=土包=土山=山丘|山下=山嘴=山根=山脚=山麓|半山区=半山腰=山巅=山梁=山脊=山腰|云崖=削壁=山崖=峭壁=悬崖=悬崖峭壁=绝壁=陡壁|沙岭=秃岭=童山=荒岭|山野=山间|北麓=南麓=西北麓|坡坡=斜坡|慢坡=缓坡|荒坡=荒山坡|大洋=大海=汪洋大海=沧海=浅海=海域=海洋=深海|远洋=重洋|洋流=海流|大陆坡=大陆架=陆架=陆棚|内海=内陆海=陆海|海边=濒海=近海|小河=河渠|城壕=城池=城隍=护城河|岔流=汊流=港汊|主流=干流|主河道=河床=河槽=河身=河道|河曲=流觞曲水|巨流=洪流|奔流=急流=激流|伏流=地下水=暗流|小溪=山涧=溪水=溪流=溪涧=细流|干支沟=水沟=沟渠=河沟=浊水溪|海子=湖水=湖泊|咸水湖=盐湖|池塘=池子=池沼|泥坑=泥塘=泥潭|水潭=潭水|湖沼=湖泽|喷泉=飞泉|汤泉=温泉|瀑布=玉龙=飞瀑|废墟=断井颓垣=断垣残壁=断壁残垣=残垣断壁=殷墟=瓦砾|雨幕=雨滴=雨点=雨珠=雨脚|小雨=毛毛雨=烟雨=牛毛雨=细雨=蒙蒙|倾盆大雨=大雨=滂沱大雨=瓢泼大雨=豪雨|冰暴=大暴雨=暴雨=暴风雨=疾风暴雨=雷暴雨=骤雨|过云雨=阵雨=雷阵雨=雷雨|淫雨=苦雨=霖雨|梅雨=霉雨=黄梅雨|及时雨=喜雨=甘雨=甘霖|冰雪=玉龙=白雪=雪片=雪花=飞雪=鹅毛大雪=鹅毛雪|碎雪=粒雪=雪条=雪球|冰雹=雹子=风雹|冰挂=冰柱=冰锥|冰块=冰碴=冰粒|大风=扶风=暴风=狂风=疾风|台风=强台风=强风=飓风|微风=软风=轻风|清风=雄风|和风=暖风=熏风|冷风=寒风=朔风=阴风|热风=焚风|东风=谷风|南风=熏风|大风=西风|凉风=北风=朔风|凉风=西南风|打头风=逆风=顶风|旋风=羊角|信风=贸易风|暴风骤雨=狂风暴雨=疾风暴雨|凄风苦雨=苦雨凄风|穿堂风=过堂风|沙尘暴=沙暴|夜风=晚风|云块=云彩=云朵|彤云=阴云|云霞=彩云=火烧云|庆云=祥云|寒露=露水=露珠|严霜=冷霜|副虹=霓虹|彤云=彩霞|云烟=烟雾|雾气=雾霭|云雾=暮霭=烟霭|惊雷=雷霆=霹雳=霹雷|炸雷=焦雷|电闪=银线=闪电|潮信=潮水=潮汐=潮汛|水流=流水=清流=湍流=白煤|大水=山洪=暴洪=洪峰=洪水=洪流|沥水=积水|凉白开=开水=沸水=滚水=热水=白开水=白水|冷水=凉水=生水|水滴=水珠|培养液=营养液|春水=绿水|汁水=汁液=液汁|浆液=糊糊|水花=沫儿=沫子=泡沫=泡泡=白沫|卵泡=气泡=液泡=血泡|波浪=浪头=浪花|涟漪=鳞波|涡旋=涡流=漩涡|天火=野火|篝火=营火|磷火=鬼火|火头=火柱=火焰=火舌=火花=火苗=灯火|外焰=氧化焰|内焰=焰心=还原焰|大火=活火=火海=烈火=烈焰|微火=星星之火=星火|火树银花=烟火=焰火|兵燹=战火=火网=炮火=烟尘=烽火=烽烟=狼烟|太阳=日光=阳光|晨光=晨晖=晨曦=晨辉=曙光=朝晖|余晖=余辉=夕晖=夕照=斜晖=残照=落照|月光=月华=月色=蟾光|灯光=灯火|白炽=白热|热线=红外光=红外线|紫外=紫外光=紫外线=黑光|偏光=偏振光|影子=投影=暗影=阴影=黑影|人影=人影儿=身形=身影|后影=背影|正电=阳电|负电=阴电|感应电流=感生电流|电波=电磁波|无线电波=高频电波|大气=空气|冷气=冷气团=冷空气=凉气=寒气=寒流=寒潮|暑气=暖气=热气=热流=热浪|氢气=重氢|氨气=阿摩尼亚|二氧化碳=碳酐=碳酸气|沼气=甲烷|乙炔=电石气|毒气=毒瓦斯|水汽=水蒸气=水蒸汽=蒸气=蒸汽|氟利昂=氟化氢|色彩=色泽=色调=颜色|淡色=素色|原色=基色=本色|冷色=寒色|对比色=补色|图案色=广告色|味道=气味=气息=鼻息|味儿=味道=滋味|余味=回味|乐声=乐音|噪声=噪音|回响=回声=回音|国语=国音=标准音=正音|元音=母音=韵头=韵腹|复辅音=子音=辅音|爆发音=破裂音|唇齿音=齿唇音|舌根音=舌面后音|卷舌音=翘舌音|口齿=字音|口音=话音=语音|乡音=口音=土音=方音|音缀=音节|脚步声=足音=跫然|叫好声=喝彩声=赞叹声=赞扬声|爆竹声=礼炮声=鞭炮声|祝福声=问候声|大嗓门=大声=高声|低声=悄声|声腔=声调=腔调=调子=音调|四声=字调|第一声=阴平|第二声=阳平|上声=第三声|去声=第四声|尘土=尘埃=灰土=灰尘=纤尘|浮土=浮尘=浮灰|征尘=风尘|尘烟=烟尘|尘垢=油泥=泥垢|纹理=纹路|皱纹=皱褶=褶子=褶皱|指印=指纹=斗箕=罗纹=螺纹|划痕=印子=印痕=痕迹=皱痕|手印=手模|行踪=行迹=踪迹|脚印=足迹|血印=血渍=血痕=血迹|油渍=油迹|墨迹=字迹=笔迹|汗斑=汗渍=汗碱|斑点=点子|道子=道道|伤疤=伤痕=创痕=疤痕=节子|疤瘌=疮疤=瘢痕|裂璺=裂痕=裂纹|车辙=轨辙|参天大树=大树=小树=树木=花木|果木=果树|林带=树行子|海松=红松=赤松|冷杉=枞树|响杨=毛白杨=白杨|垂杨柳=垂柳=杨柳=柳木=柳树|旱柳=河柳|水曲柳=稻树=过街柳=雪柳|水杨=蒲柳|三春柳=红柳|悬铃木=法国梧桐|枸橼=香橼|苏铁=铁树|椴树=河北杨|柞树=橡树|槲寄生=槲栎|檀木=青檀|棕树=棕榈|三角枫=桠枫|枫树=枫香树|木香=降香|珙桐=空桐树|刺槐=洋槐|枸橘=桔树=越橘=金橘|樟木=樟树|榕树=高山榕|树莓=沙棘=灌丛=灌木=灌木丛|榆叶梅=榆树=榔榆|娑罗双树=娑罗树|古槐=国槐=槐树=法桐=紫穗槐=香樟=龙爪槐|常绿树=常青树=长青树|椰林=椰树林|果木林=果林|幽林=杂花生树=林莽=次生林=残次林=险崖老林|竹子=笋竹=青竹|南竹=毛竹|凤凰竹=观音竹|墨竹=紫竹=黑竹|斑竹=湘妃竹=湘竹|竹篾=篾青|冬笋=春笋=毛笋=竹笋=竹茹|群芳=花儿|国色天香=国花=牡丹=牡丹花|秋菊=菊花=黄花|芙蓉=草芙蓉=荷花=莲花|兰花=兰草=春兰=草兰|珠兰=金粟兰|子午莲=睡莲|剑兰=唐菖蒲|梅花=玉骨冰肌=花魁|满堂红=紫薇|木兰=木笔=辛夷|木芙蓉=木莲=芙蓉|山茶=茶花|合欢=马缨花|仙人掌=仙人球=仙人鞭|腊梅=黄梅|扶桑=朱槿|映山红=杜鹃|月季=月季花=月月红|丁香花=紫丁香|凤仙花=指甲花|凌波仙子=水仙花|凌霄花=紫葳|紫茉莉=草茉莉|喇叭花=牵牛|江西腊=翠菊|大丽花=西番莲|油菜花=黄花|紫藤=藤萝|三色堇=蝴蝶花|天竺葵=洋绣球|花丛=花海=花球=鲜花丛|唐花=花卉=花木=花草|名花异草=奇花异卉=奇花异草|草丛=草甸=草莽|丛杂=杂草=荒草=野草|白茅=茅草|沿阶草=绣墩草=蒲草|鹅冠草=鹅观草|青蒿=香蒿|水萍=浮萍=紫萍=红萍|爬墙虎=爬山虎|水藻=海藻=藻类|昆布=海带|苔藓=苔衣=藓苔=青苔|白木耳=银耳|灵芝=紫芝|香菇=香蕈|冬菇=口蘑=春菇=蘑菇|五谷=庄稼=粮食作物=谷物|水稻=稻子=稻谷=谷子=谷类|旱稻=陆稻|小麦=麦子|冬小麦=冬麦|春小麦=春麦|元麦=稞麦=裸麦=青稞|粟子=谷子|菜蔬=蔬菜|小白菜=青菜|包心菜=卷心菜=圆白菜=洋白菜=结球甘蓝|球茎甘蓝=甘蓝=苤蓝|盖菜=芥菜|花椰菜=花菜=菜花|韭芽=韭菜=韭黄|大葱=小葱=水葱|洋葱=葱头|大蒜=蒜头=青蒜|芫荽=香菜|宝塔菜=甘露=草石蚕|巢菜=野豌豆|金针菜=黄花=黄花菜|金花菜=黄花苜蓿|叶甜菜=牛皮菜|银条菜=银根菜=银苗|香椿头=香椿芽|小萝卜=白萝卜=莱菔=萝卜|红萝卜=胡萝卜|芜菁=蔓菁|笋子=莴笋=莴苣|石刁柏=芦笋=龙须菜|番茄=西红柿|倭瓜=南瓜=番瓜|胡瓜=黄瓜|菜瓜=越瓜|豆子=豆瓣=豆类|大豆=毛豆=黄豆|胡豆=蚕豆|小豆=红小豆=赤小豆=赤豆|相思子=红豆|豆荚=豆角=豆角儿|刀豆=四季豆=芸豆=菜豆|芋头=芋艿|地瓜=山芋=木薯=甘薯=番薯=白薯=红薯=芋头|土豆=山药蛋=洋芋=马铃薯|凉薯=地瓜=苕子=豆薯|洋姜=菊芋|慈姑=茨菰|荷藕=莲菜=莲藕|果品=水果=鲜果|文旦=柚子|桔子=橘子=橘柑=福橘=蜜橘|柑子=柑桔=柑橘=蜜柑=蜜桔=金桔=金橘|广柑=橙子=脐橙=香橙|丹荔=荔枝|橄榄=青果|油橄榄=洋橄榄|软枣=黑枣|杨梅=草果=草莓|凤梨=菠萝=菠萝蜜=黄菠萝|山杏=杏子|杨桃=猕猴桃=羊桃|五敛子=杨桃=羊桃|核桃=胡桃|小胡桃=山核桃|榧子=香榧|扁桃=蟠桃|椰枣=海枣|桂圆=龙眼|柿子=油柿|甘蕉=香蕉|沙果=花红|草果=草豆蔻|肉果=肉豆蔻|白果=银杏|杜梨=棠梨|板栗=栗子|哈密瓜=哈蜜瓜=甜瓜=香瓜|甜枣=蜜枣|中草药=中药材=草药=药材=药草|川芎=当归|萝芙木=蛇根草|仙鹤草=龙牙草|木豆=豆蓉|乌梅=酸梅|川贝=贝母|列当=苁蓉|麦冬=麦门冬|啤酒花=蛇麻=酒花|忍冬=金银花|长寿菜=马齿苋|大黄=将军=川军|古柯=高根|葫蔓藤=野葛=钩吻|吴茱萸=山茱萸=食茱萸|技术作物=经济作物|仁果=水花生=花生=落花生=长生果|向日葵=向阳花=朝阳花=葵花|大麻子=蓖麻|油渣果=油瓜=猪油果|油棕=油椰子|桐油树=油桐|有加利=桉树=玉树=黄金树|八角=八角茴香=大料=大茴香|甜菜=糖萝卜|枣椰=海枣|紫云英=红花草|毛茶=茶树|棉花=草棉|木棉=红棉|大麻=线麻|种麻=苴麻|苘麻=青麻|罗布麻=茶叶花|蕉麻=马尼拉麻|枳机草=芨芨草|白藤=红藤|芦苇=苇子|马兰=马莲=马蔺|蓑衣草=龙须草|国产棉=国棉|上棉=优质棉|白棉=白色棉|彩棉=彩色棉|劣株=病株|棵子=秆子=秫秸|蔓儿=藤子=藤条=藤蔓|树干=树身|画轴=花梗=花茎|蒜苗=蒜薹|秸秆=麦秸=麦茬|主枝=侧枝=枝子=枝干=枝条|丫杈=杈子=枝丫=枝杈=枝桠=树杈=桠杈|疯杈=疯枝|枝头=树冠=树梢=梢头|柳丝=柳枝|树根=根须|叶子=叶片=树叶=桑叶=菜叶=霜叶|枫叶=红叶|朵儿=繁花=花朵|花蕾=花骨朵=蓓蕾=骨朵=骨朵儿|筒状花=管状花|花萼=萼片|花蕊=花轴|画轴=花茎|嫩芽=胚芽|侧芽=腋芽|小苗=幼株=幼苗=栽子=秧子=秧苗=苗子=苗木|母本=母株|果子=果实|梅子=青梅=黄梅|桑果=桑葚|地梨=荸荠=马蹄|中果皮=外果皮|内果皮=核儿|果肉=沙瓤=瓤子|子实=子粒=种子=籽儿=籽粒|松仁=松子|花生仁=花生米|莲子=莲蓬子儿|芡实=鸡头米|草种=草籽|葵花仁=葵花子|三牲=六畜=家畜=牲畜|力畜=役畜|娃子=子畜=幼畜|走兽=野兽|猛兽=豺狼虎豹=貔貅|狼獾=貂熊|海熊=海狗=海狮=腽肭兽|大熊猫=大猫熊=熊猫=猫熊|小熊猫=小猫熊|沙獾=猪獾=猸子|箭猪=豪猪|山猫=狸子=狸猫=豹猫|河狸=海狸鼠|紫貂=黑貂|貔子=黄鼠狼=黄鼬|穿山甲=鲮鲤|兽王=狮子|大虫=老虎|乳虎=幼虎=虎仔=虎子=虎崽|豹子=金钱豹|毛象=猛犸|狗熊=黑熊=黑瞎子|棕熊=马熊|北极熊=白熊|火狐=火狐狸=红狐=赤狐|玄狐=银狐|北极狐=白狐|花面狸=草狐|山魈=猕猴=猢狲=猴子|四不象=麋鹿|水鹿=马鹿|马儿=马匹|母马=牝马=骒马|千里马=千里驹=骏马=高头大马=高足|劣马=驽马|马驹=驹子|毛驴=驴子|公驴=叫驴|马骡=驴骡=骡子|公牛=牡牛=牯牛=犍牛|乳牛=奶牛|犁牛=耕牛|小牛=牛犊|扭角羚=羚羊|羊崽=羊羔=羔子=羔羊|剑羚=羚羊|岩羊=石羊|毛猪=活猪=生猪|仔猪=猪仔=猪娃=猪苗|猎犬=猎狗|叭儿狗=哈巴狗=巴儿狗=狮子狗|野兔=野猫|老鼠=耗子|小家鼠=鼷鼠|大家鼠=沟鼠=褐家鼠|天竺鼠=豚鼠|大眼贼=黄鼠|松鼠=灰鼠|扬子鳄=猪婆龙|海猪=海豚|江猪=江豚|人鱼=儒艮|群蛇=长虫|巨蟒=蚺蛇=蟒蛇|五步蛇=白花蛇|水蛇=青蛇|田鸡=蛤蟆=蝌蚪=青蛙|疥蛤蟆=癞蛤蟆=蟾蜍|四脚蛇=蜥蜴|水獭=海狸|海獭=海龙|兽类=禽兽=飞禽走兽=飞走=鸟兽|小鸟=雏鸟=飞禽=鸟儿=鸟类=鸟群=鸟雀|猛禽=鸷鸟|练鹊=绶带鸟|夜猫子=猫头鹰=鸱鸺|白鹭=鹭鸶|大雁=头雁=鸿雁|山鸡=野鸡|吐绶鸡=火鸡|绿头鸭=野鸭|大天鹅=天鹅=鸿鹄|乌鸦=寒鸦=老鸦=老鸹|家燕=小燕子=燕儿=燕子=雏燕|几维鸟=无翼鸟|淘河=鹈鹕|极乐鸟=风鸟|朱顶=贮点红|八哥=八哥儿=鸲鹆|墨鸦=鱼鹰=鸬鹚|黄莺=黄鹂|绿衣使者=鹦哥=鹦鹉|子规=布谷=杜鹃|山和尚=戴胜|水鸪鸪=鹁鸪|畜禽=禽畜|老鹰=苍鹰=雄鹰=雏鹰|雀鹰=鹞子=鹞鹰|兀鹫=坐山雕=秃鹫|嘉宾=麻雀|金丝雀=黄鸟|家鸽=鹁鸽|原鸽=野鸽|乳鸽=白鸽|丹顶鹤=仙鹤=白鹤|海燕=海鸥|公鸡=雄鸡|母鸡=牝鸡=草鸡|小鸡=角雉=雏鸡|童子鸡=笋鸡|家鸭=鸭子|鱼儿=鱼类=鱼群=鲜鱼|鱼种=鱼秧=鱼秧子=鱼花=鱼苗|河鱼=淡水鱼|青鱼=黑鲩|胖头鱼=鳙鱼|武昌鱼=鳊鱼|乌鱼=乌鳢=黑鱼|鳝鱼=黄鳝|大黄鱼=小黄鱼=石首鱼=黄花鱼=黄鱼|乌贼=墨斗鱼=墨鱼|快鱼=白鳞鱼=鳓鱼|平鱼=银鲳=鲳鱼|柔鱼=鱿鱼|八带鱼=章鱼|偏口鱼=比目鱼|白鳗=白鳝=鳗鱼=鳗鲡|大鲵=娃娃鱼=小鲵|大马哈鱼=大麻哈鱼=鲑鱼|加级鱼=真鲷|燕鱼=蓝点鲅=马鲛鱼|杨枝鱼=海龙|条鳎=舌鳎=鳎目鱼|水族=鱼虾=鳞甲|乌龟=幼龟=王八=金龟|团鱼=王八=田鳖=甲鱼=鳖精=鼋鱼|河蟹=螃蟹|梭子蟹=蝤蛑|寄居蟹=寄生蟹|大虾=对虾=明虾|文蛤=蛤蜊|壳菜=淡菜=贝类=贻贝|海蛎子=牡蛎|瓦垄子=瓦楞子=蚶子|刺参=海参|石决明=鲍鱼|海蜇头=海蜇皮|昆虫=虫子|尾蚴=幼虫=毛蚴=水虿|促织=蛐蛐=蛐蛐儿=蟋蟀|蜚蠊=蟑螂|刀螂=螳螂|花大姐=花媳妇|曲蟮=蚯蚓|蛞蝼=蝼蛄|水鳖子=鲎虫|寒蝉=知了|纸鱼=衣鱼|土蚕=地老虎=地蚕|土蚕=地蚕=核桃虫=蛴螬|水蛭=蚂蟥=马鳖|松毛虫=松虎|叩头虫=磕头虫|蚰蜒=蜈蚣|星毛虫=梨狗|星虫=沙虫|剃枝虫=黏虫|蛀心虫=钻心虫|壁虎=蝎虎|水牛儿=蜗牛|寸白虫=绦虫|肝吸虫=肝蛭|蛏子=蛤蚧|母蜂=蜂王|胡蜂=马蜂=黄蜂|家蚕=桑蚕=蚕宝宝|蚁蚕=蚕蚁|茧子=蚕茧|胡蝶=蝴蝶|蛾子=飞蛾|卷叶虫=卷叶蛾|蛛蛛=蜘蛛|棉红蜘蛛=火龙=红蜘蛛|蚂蚱=蚱蜢=蝗虫|蝗蝻=蝻子=跳蝻|腻虫=蚜虫|家蚊=库蚊|按蚊=疟蚊|伊蚊=黑斑蚊|孑孓=跟头虫|蚊虫=蚊蝇|苍蝇=蝇子|蚂蚁=蚍蜉|壁虱=臭虫|虼蚤=跳虫=跳蚤|水蚤=金鱼虫=鱼虫|固氮菌=根瘤菌|抗体=抗原|菌种=菌苗|毒菌=病原菌=病菌=致病菌|酵母=酵母菌=酿母菌|曲霉=霉菌=黑霉|形体=形骸=躯壳|一身=全身=周身=浑身=满身=通身=遍体|上体=上半身=上身|下体=下半身=下身|尸蜡=木乃伊|丧生者=死者=遇难者|白头=皓首|前额=天庭=天门=脑门=脑门儿=脑门子=额头|光头=秃顶=谢顶|后脑勺=脑勺子|下巴=下巴颏儿=下颌|腮帮子=腮颊|笑窝=笑靥=酒窝|人脑=脑子=脑髓|脑室=脑颅=颅脑=颅腔|松果体=松果腺=脑上体|脑下垂体=脑垂体|大脑皮层=皮层=皮质|双目=双眸=双眼=眸子=眼眸=眼睛=肉眼|秋水=秋波|老花眼=老视眼=花眼|眼珠=眼珠子=眼球=黑眼珠|白眼珠=眼白|眼圈=眼眶=眼窝|眼底=眼里|虹彩=虹膜|结合膜=结膜|眸子=瞳人=瞳仁=瞳孔|泪膜=眼角膜|耳朵=耳根|中耳=鼓室|内耳=迷路|外耳=外耳门=耳孔|耳垂=耳朵垂|外听道=外耳道|耳鼓=鼓膜|耳屏=耳轮=耳郭|鼻头=鼻子|酒渣鼻=酒糟鼻|鼻孔=鼻腔|唇吻=嘴巴=满嘴|口吻=口器=口腕|嘴唇=嘴皮子|兔唇=唇裂=缺嘴=豁嘴|口条=舌头|咽喉=喉咙=喉管=嗓子=嗓子眼=嗓门=声门|喉结=结喉|小舌=悬雍垂|扁桃体=扁桃腺|上颌=上颚|下巴=下颌=下颚|声带=音带|乳齿=奶牙|牙床=牙花=牙龈=齿龈|大牙=板牙=槽牙=臼齿|智牙=智齿|大牙=板牙=门牙=门齿|犬牙=犬齿=虎牙|虫吃牙=虫牙=蛀齿=龋齿|珐琅=珐琅质=釉质|头颈=脖子=颈部=颈项|双肩=肩头=肩胛=肩膀|胸膛=胸臆|胸口=胸脯|怀抱=怀里|心口=心坎=心窝儿=心里=胸口|乳房=奶子=胸部|乳头=奶头|后背=背脊=背部=脊梁=脊背|后腰=腰杆=腰杆子=腰板=腰板儿=腰眼=腰肢=腰部|肚子=肚皮=腹内=腹腔=腹部|小肚子=小腹|屁股=臀尖=臀部|上臂=前臂=膀子=膀臂|胳肢=胳肢窝=腋下=腋窝|手肘=肘子=肘窝=肘部=胳膊肘|两手=双手|巴掌=手掌=手板|手心=手掌心=掌心|手腕=手腕子=胳膊腕子=腕子=臂腕|关上=寸口=尺中|手指=手指头=指头=指尖|大拇指=大指=巨擘=拇指|三拇指=中拇指=中指=将指|小拇指=小指|猪手=猪爪|下肢=后肢|腹股沟=鼠蹊|膝头=膝盖|脚脖子=脚腕子=腿腕子|小脚=金莲|光脚板子=赤脚|爪儿=爪子=爪部=脚爪|小趾=脚指头=脚趾=趾头|后跟=脚后跟=脚跟|脚底板=脚掌=脚板=足掌|脚面=跗面|羚羊角=羚角|卷须=触手=触角=触须=须子|尾巴=尾部|背鳍=脊鳍|外翼=羽翅=翅膀=翎翅=膀子|翅鞘=鞘翅|皮层=皮肤=肌肤|外皮=浮皮=表皮=面皮|眼帘=眼泡=眼皮=眼睑|筋肉=肌肉|横纹肌=随意肌=骨骼肌|不随意肌=平滑肌|筋腱=肌腱=腱子=腱鞘|脂肪=脂膏=膏腴|寒毛=汗毛|毛绒=绒毛=茸毛|马鬃=鬃毛|羽毛=羽绒=翎毛|发丝=头发=毛发|乌发=黑发|发辫=小辫=小辫儿=独辫=辫子|乌云=青丝|两鬓=鬓发=鬓毛=鬓角|华发=宣发=银发|奶毛=胎发=胎毛|眉毛=眼眉|娥眉=柳叶眉=柳眉|印堂=眉心|胡子=胡须|络腮胡子=连鬓胡子|骨头架子=骨骼|头盖骨=头骨=枕骨=顶骨=颅骨|眉棱骨=颧骨|琵琶骨=肩胛骨=胛骨=锁骨|胸椎=颈椎|脊柱=脊梁骨=脊椎=脊索=脊骨|胸骨=腔骨=龙骨|肋巴骨=肋条=肋骨=骨干|胯骨=髋骨|肠骨=髂骨|荐骨=骶骨|膝关节=膝盖骨=髌骨|关节=骨节|椎间盘=腰椎|脚指甲=趾甲|壳子=甲壳=盖子=硬壳|介壳=贝壳|鱼鳞=鳞屑=鳞片|内脏=脏器=脏腑|五中=五内=五脏=五脏六腑|肝脏=肝部|肾盂=肾脏=腰子|胰子=胰岛=胰腺|胆囊=苦胆|鱼胶=鱼鳔|感官=感觉器官|上呼吸道=呼吸道=支气管=气管|食管=食道|尿道=泌尿器=输尿管|肛管=肛道|肺脏=肺部|肚子=胃部|肠胃=胃肠|肠子=肠管=肠道|性器官=生殖器|小便=阴茎|外肾=睾丸=精巢|下体=下身=产道=产门=阴户=阴部=阴门|胎儿=胚胎|紫河车=羊膜=胎膜=胎衣=胞衣=衣胞|胎盘=胚盘|娘胎=胞胎|经络=经脉|血管=血脉|微血管=毛细管=毛细血管|主动脉=大动脉|筋络=筋脉=青筋=静脉|穴位=穴道|脉息=脉搏|神经元=神经原=神经细胞|传出神经=运动神经|传入神经=感觉神经|核子=细胞核|淋巴结=淋巴腺|副肾=肾上腺|前列腺=摄护腺|肋膜=胸膜|活瓣=瓣膜|血水=血流=血液|潜血=隐血|血丝乎拉=血淋淋|抗毒血清=抗菌血清|激素=荷尔蒙|汗水=汗液=汗珠=汗珠子|口水=吐沫=哈喇子=唾沫=唾液=津液=涎水|乳汁=奶品=奶水=母乳|体液=津液=组织液|胃液=胃酸|月经=精血=经血|泪水=泪液=泪珠=泪花=眼泪|耳垢=耳塞=耳屎=耵聍|眼屎=眼眵|头发屑=头皮=头皮屑|大便=大粪=粪便|精液=鱼白|精子=精虫|卵块=卵子=卵细胞|果儿=鸡蛋|鸭子儿=鸭蛋|卵黄=蛋黄=鸡蛋黄|卵白=蛋清=蛋白|五金=大五金=小五金=金属|金子=黄金|纯金=赤金=足金|白金=白银=纹银=足银=银子|铜材=黄铜|紫铜=红铜|铜丝=铜线|铝型材=铝材|钢材=钢铁|矽钢=硅钢|三角铁=角钢=角铁|钢轨=铁轨|钢筋=钢骨=铁筋|钢水=铁水=铁流|生铁=铣铁=铸铁|熟铁=锻铁|灰口铁=灰铁|吸铁石=磁石=磁铁|洋铁=白铁=白铁皮=铁皮=铅铁=镀锌铁|洋铁=铁皮=镀锡铁=马口铁|原木=木头=木料=木材|枕木=道木|栓皮=软木=软硬木|石块=石头=石碴|火石=燧石|氟石=萤石|木化石=木变石|石钟乳=钟乳石|岩层=岩石|巨石=盘石=磐石|岛礁=暗礁=礁石|河卵石=鹅卵石|矸子=矸石|石头子儿=石子=石子儿=砾石|他山之石=他山石=它山之石=山石|土体=土壤=泥土|土堆=土牛|团粒=土块=土疙瘩=坷垃=坷拉|黑土=黑钙土|泥土=熟料=粘土=耐火黏土=黏土|瓷土=陶土=高岭土|烂泥=稀泥|型砂=沙子=沙砾=砂子=砂石=砂砾=砂礓|沙丘=沙包=沙山=沙峰=沙柱|加气水泥=士敏土=水泥=水泥块=水门汀=洋灰|三合土=三和土|灰浆=砂浆|活石灰=煅石灰=生石灰=白灰=石灰|消石灰=熟石灰|土沥青=地沥青=木焦油=柏油=沥青|熟石膏=生石膏|砖块=砖头=砖石|残砖碎瓦=砖头=碎砖|瓦块=瓦片|小青瓦=蝴蝶瓦|瓦垄=瓦楞|板坯=板子=板材|挡板=隔板|图板=画夹=画板|管子=管材|缸管=陶管|乌金=煤炭|无烟煤=白煤=硬煤=红煤|煤砖=蜂窝煤|褐炭=褐煤|草炭=草煤|泥炭=泥煤|干柴=木柴=柴火=柴禾=芦柴|火捻=火煤|明子=松明|洋油=火油=煤油|原油=石油|乙醇=酒精|润滑油=滑润油|凡士林=矿脂|水彩=颜料=颜色|红土=铁丹|蓝靛=靛蓝=靛青|油漆=漆片=漆膜|茧丝=蚕丝|棉纤维=棉纱|化学纤维=化纤|尼龙=锦纶|涤纶=的确良|皮子=皮张=皮革|毛皮=皮桶子=皮毛|乳胶=溶胶=胶乳|鱼胶=鳔胶|洋粉=洋菜=琼脂=石花胶|橡皮=硫化橡胶=胶皮|粘合剂=黏合剂|毛玻璃=磨砂玻璃|不碎玻璃=有机玻璃|釉子=釉料|彩釉=色釉|串珠=珍珠=珠子=真珠|佛珠=念珠|佩玉=玉佩=玉石|宝玉=美玉|金刚石=金刚钻=钻石|假象牙=化学=赛璐珞|吡啶=有机化学|搪瓷=洋瓷|塑料=电木=酚醛=酚醛塑料|化学肥料=化肥|粒肥=肥田粉|基肥=底粪=底肥|厩肥=圈肥|枯饼=油枯=油饼|氢氧化铵=氨水|建筑=建筑物=构筑物|屋宇=房子=房屋=房舍|住宅=住房=宅子=宅邸=宅院=居室=庐舍|城楼=箭楼=角楼|塔楼=谯楼=钟楼=鼓楼|大厦=巨厦=摩天大厦=摩天大楼=摩天楼=高楼=高楼大厦|广厦=深宅大院|亭台楼榭=亭台楼阁=红楼=雕梁画栋|小屋=斗室=蜗居|古堡=故宅=故居=旧宅=旧居=祖居=老宅|商业楼=商住楼=商品房=商客居|家宅=民宅=民居=私宅|住宅房=住宅楼=单元楼=家属楼=居民楼|危房=危旧房=危楼=危陋平房=拆迁房|城堡=城建|茅草房=草房子|别墅=山庄|公馆=宅第=官邸=府第=府邸=私邸|屋子=房室=房间|里屋=里间|外屋=外间|内室=卧室=卧房=寝室=起居室|食堂=餐厅=餐房=饭厅=饭堂|上房=堂屋=正房|包厢=厢房|伙房=厨房=庖厨=灶间|便所=厕所=厕所间=洗手间=茅厕=茅坑=茅房|卫生间=更衣室=盥洗室|传达室=门房|书屋=书房=书斋|教室=讲堂|图书馆=藏书室=藏书楼|录音室=录音棚|地下室=地窖=地窨子|新房=洞房|内宅=深闺=绣房=闺房=闺阁|公堂=大会堂=大堂|会客厅=接待厅|展厅=展室|录像厅=影厅=放像厅=演播厅=电影厅|侧门=旁门=脚门=角门=边门|柴扉=柴门|钌铞儿=门闩|兽环=门环|门坎=门槛|窗子=窗户=窗扇=窗牖|窗台=窗沿|窗框=窗棂|窗门=门窗|门脸=门面|地基=地脚=基础=根基=根脚|天花板=藻井|椽子=檩子|大梁=屋梁=屋脊=房梁=正梁=脊檩|支柱=柱头=柱子=柱身|关厢=城厢=城垛=城垣=城墙=城郭|箭垛子=雉堞|影壁=照墙=照壁=萧墙|夹墙=夹壁墙=夹层墙|山墙=房山|挡风墙=防火墙=风火墙|围墙=围子=墙围子|隔扇=隔断|樊篱=笆篱=篱墙=篱笆=篱落=绿篱=花障=藩篱|栅栏=篱栅|屋檐=房檐=雨搭|天沟=檐沟=水溜=水落管=雨水管|下水道=排水沟=排污沟|明沟=阳沟|暗沟=渗沟=阴沟|凉台=平台=晒台=楼台=阳台|天井=小院=庭院=院子=院落|廊子=甬道=走廊=走道=过道|台阶=坎儿=坎子=踏步=阶级|石坎=石级=石阶=阶石|梯子=楼梯=阶梯|绳梯=软梯|栏杆=阑干|大街=街道=马路|人行道=便路=便道=走道|巷子=弄堂=胡同=街巷=里弄=闾巷|小巷=小街|大桥=桥梁|吊桥=悬索桥=索桥|开合桥=活动桥|天桥=旱桥|过街天桥=过街桥|沃土=沃田=沃野=米粮川=肥田=良田=高产田|休耕地=休闲地=白地|旱地=旱田|水地=水田|承包地=承包田|田里=田间|废耕地=熟荒|埂子=田垄=田埂=阡陌|园圃=园子=园田=庭园=田园|保暖棚=大棚=暖房=暖棚=温室=温室群=温棚=花房|冷床=温床=苗床=阳畦|猪圈=猪舍|马厩=马棚|窝巢=窝窝|蜂巢=蜂窝|鸟巢=鸟窝|陷坑=陷阱|塘坝=塘堰=水库=蓄水池|圩垸=圩子=子埝|斗门=水闸=闸室=闸门|地沟=垄沟=水渠=水道=沟槽=沟渠=渠道=渡槽|千山万壑=沟壑=沟沟坎坎=沟沟壑壑|机井=洋井=管井|斜井=矿井=立井=竖井|坑道=巷道=平巷=矿坑|工作面=掌子|发电厂=发电站=电站|火力发电厂=火电站=热电厂|仓库=仓房=储藏室=堆房=堆栈=库房=栈房=货栈|仓廪=粮仓=粮囤=粮库=谷仓|兵站=兵营=军营=老营=营寨=营房=营盘|地堡=堡垒=壁垒=桥头堡=碉堡=碉楼=礁堡=营垒|掩体=掩护=掩蔽体|鹿砦=鹿角|堑壕=壕沟=战壕|公园=园林=庄园=花园|御花园=御苑|花圃=花坛=花池子|绿地=绿茵=草地=草坪=青草地|宝塔=浮屠|象牙之塔=象牙塔|戏台=舞台|讲台=讲坛|月台=站台|丘墓=坟丘=坟墓=坟茔=墓茔=墓葬=陵墓=青冢|山陵=陵寝|坟头=坟山|墓场=墓道=神道|祖坟=祖茔=祖陵|墓穴=窀穸|石碑=碑石=碑碣|墓碑=墓表=神道碑|宗祠=祠堂|太庙=宗庙|佛殿=殿堂|庙宇=庙舍|圣庙=孔庙|佛寺=寺庙=寺观=寺院=禅寺=禅房=禅林|本寺=该寺|主教堂=天主教堂=教堂=礼拜堂|机具=机器=机械|农机=农机具=农械|汽机=蒸气机=蒸汽机|内燃机=摩托=热机|动力机=发动机=引擎|柴油机=狄塞耳机|电动机=电机=马达|汽机=汽轮机|水轮机=涡轮机=轮机=透平机|吊车=塔吊=起重机=龙门吊|升降机=电梯|天车=行车|钻探机=钻机|凿岩机=电镐=风钻=风镐|水压机=油压机=液压机|机子=机杼=纺机=纺纱机=纺织机=纺车=细纱机=织布机|卷扬机=绞车|挖掘机=掘土机=掘进机=推土机=电铲|康拜因=收割机=联合收割机=联合机|拖拉机=铁牛|铲土机=铲运机|吹风机=抽气机=暖风机=送风机=通风机=鼓风机|压路机=轧机|处理器=微型机=微处理器=微处理机=微机=微电脑=电脑=计算机|输机=输送机|老虎机=赌博机|游戏机=游艺机=电子游戏机|彩电=彩色电视|提款机=柜员机=柜机|烘箱=烤箱|家用电器=家电=小家电|放像机=放映机|家什=工具|抽水机=水泵|气泵=风泵|床子=机床|旋床=车床|冲压机=冲床=压力机|刀具=刃具|器件=机件=组件=零件=零部件|激光器=莱塞|化油器=汽化器|绞盘=辘轳|滑车=滑轮|牙轮=齿轮|滑动轴承=滚动轴承=滚柱轴承=滚珠轴承=滚针轴承=球轴承=空气轴承|滚珠=钢珠|主光轴=主轴|传动带=皮带|锁头=锁链|弹簧=簧片=绷簧|合叶=合页|凡尔=截门=活门=阀门|活塞=活塞环=鞲鞴|轴瓦=轴衬|开口销=销子=销钉|离合器=靠背轮|排挡=风挡|履带=链轨|凸轮轴=滚轴=轮轴=轴心=连轴|螺丝=螺丝钉=螺钉|螺丝母=螺母|螺丝扣=螺纹|地脚螺丝=地脚螺栓|纱锭=纺锭|制动器=刹车|弹簧锁=撞锁=碰簧锁=碰锁|拉链=拉锁=拉锁儿|铁锁链=锒铛|附配件=零备件|元器件=电子元件=电子器件|旋子=转子|步行机=步话机=步谈机|全球通=公用电话=对讲机=有线电话=机子=电话=电话机=话机|唱机=留声机=话匣子|收音机=无线电|受话器=听筒=耳机|发话器=话筒|传声器=喇叭筒=微音器=话筒=送话器=麦克风|喇叭=扩音机=扬声器=组合音响=音箱|拾音器=电唱头|电子管=真空管|替续器=继电器|容电器=电容器|两极管=二极管|初级线圈=原线圈|副线圈=次级线圈|传呼机=寻呼机|大哥大=手机=无线电话=无绳机=无绳电话机=无绳话机=部手机|可视电话=电视电话|电线=电缆|电器=电料|干电池=电池组|电瓶=蓄电池|开关=电钮=电键=电门|插头=插销|电闸=闸刀|光电池=太阳电池|农具=耕具|耘锄=锄头|耙子=耙犁=钉耙=钉齿耙|水车=翻车=龙骨车|扇车=风车|石磙=碌碡=磙子|渔具=钓具=鱼具|浮子=鱼漂|磨子=磨盘|丝锥=螺丝攻|滤器=筛子|滤斗=漏子=漏斗|扳子=扳手|砂布=砂纸|油石=砺石=磨刀石|砂轮=砣子|刀子=刀片|剃刀=剃头刀|剪刀=剪子|斧头=斧子|刀刃=刀口=刀锋=刃儿=刃片=锋刃|榔头=锤子|丁字镐=洋镐=铁镐=鹤嘴镐|凿子=錾子=雕凿|冰镩=镩子|铲刀=铲子|刨刀=刨子|锉刀=锉子|扁锉=板锉|台钳=老虎钳=虎钳|火剪=火钳|改锥=螺丝刀=螺丝起子=赶锥|大棒=梃子=棍儿=棍子=棍棒=棒子=棒槌|火棒=通条|木棍=木棒|铁棍=铁棒|擀杖=擀面杖|杠子=杠棒|扁担=担子|案板=砧板|模具=胎具|模型=模子|坯子=砖坯|模板=模版=沙盘|字样=字模=铜模|卡具=夹具|榫头=榫子|纸型=纸版|版心=页心|套版=套色版|活字版=活版|仪器=仪表|安培计=电流表=电流计|电度表=电表|伏特计=电压计|寒暑表=温度表=温度计|体温表=体温计|南针=司南=指南针=罗盘|天球仪=浑仪=浑天仪=浑象|水准器=水平|圭臬=圭表|探测仪=测试仪|流量表=流量计|尺子=直尺|丁字尺=丁字规|标尺=表尺|三角尺=三角板|曲尺=矩尺=角尺=鲁班尺|台秤=地磅=案秤=磅秤|夯砣=秤砣=秤锤|秤毫=秤纽|火炉=炉子|炉灶=锅灶|高炉=鼓风炉|平炉=马丁炉|火油炉=煤油炉|听筒=听诊器|脱脂棉=药棉|橡皮膏=胶布|双拐=手杖=拄杖=拐杖=拐棍=拐棒|卫生带=月经带|车子=车辆|机车=火车头|列车=火车|卧车=小汽车=小车=小轿车=轿车|单车=脚踏车=自行车=车子|赛车=跑车|棚车=篷车|敞篷车=敞车|闷子车=闷罐车|叉车=铲车=铲运车|东洋车=人力车=洋车=胶皮=黄包车|小车=手推车=手车|大板车=排子车|三轮儿=平板车|拖车=挂斗=挂车|交通车=班车|柩车=殡车=灵车|凤辇=车驾|舟楫=船儿=船只=船舶|划子=小船=小艇=扁舟=舴艋|邮船=邮轮|游船=游艇|快艇=摩托船=汽艇=电船|摆渡=渡船|渡轮=轮渡|救生艇=救难船|三板=舢板|拖船=拖轮|龙舟=龙船|皮划艇=皮艇|铁鸟=飞机=飞行器|飞船=飞艇|彩轿=花轿|冰床=冰橇=爬犁=雪橇|船篷=风帆|桅杆=桅樯|车把=龙头|方向盘=舵轮|车轮=车轱辘=轮子=轱辘|皮带=车带=车胎=轮带=轮胎|外带=外胎|内胎=里带|马掌=马蹄铁|原子武器=核军备=核子武器=核武器|枪支=枪械|大枪=步枪|盒子=盒子枪=驳壳枪|机关枪=机枪|大炮=火炮|无坐力炮=无座力炮|喀秋莎=火箭炮=火箭筒|哑炮=瞎炮|刺刀=枪刺=白刃|子弹=枪子儿=枪弹|烧夷弹=燃烧弹|子母弹=榴霰弹|氢弹=热核武器|群子弹=霰弹|流弹=飞弹|弹丸=弹头|弹壳=药筒|手榴弹=手雷|火药=炸药|梯恩梯=黄色炸药|响箭=鸣镝|暗器=暗箭=毒箭=袖箭|箭头=箭镞|箭垛子=箭靶子=靶子=鹄的|盾牌=藤牌|宝剑=干将=龙泉|匕首=短剑|上方剑=上方宝剑=尚方剑=尚方宝剑|主力舰=战列舰=战斗舰|护卫舰=护航舰|潜水艇=潜艇|护卫艇=炮艇|战斗机=歼击机=驱逐机|主机=长机|装甲车=铁甲车|火箭=运载工具=运载火箭|叶子=纸牌|牙牌=骨牌|麻将=麻雀|色子=骰子|旱烟管=旱烟袋=烟袋=烟袋锅|水烟斗=水烟筒=水烟袋|烟嘴儿=烟斗|刑具=大刑|桎梏=镣铐|亮儿=灯火|日光灯=白炽灯=白炽电灯=荧光灯|台灯=桌灯|保险灯=汽灯|本生灯=煤气灯|桅灯=马灯|风灯=风雨灯|油灯=灯盏=青灯|灯笼=纱灯|手电=手电筒=电棒=电筒|泡子=灯泡=电灯泡|灯伞=灯罩|凹镜=凹面镜|凸镜=凸面镜|凹透镜=发散透镜|会聚透镜=凸透镜=放大镜=火镜|眼镜=镜子|透镜=镜片|墨镜=太阳眼镜=太阳镜=茶镜|千里眼=望远镜|刷子=抿子|扫帚=扫把=笤帚|掸子=掸帚=鸡毛掸子|墩布=拖把|手巾=毛巾|巾帕=手巾=手帕=手绢|头巾=头帕|洋碱=肥皂=胰子|拢子=木梳=梳子=梳篦=篦子|引线=缝衣针=金针=钢针|针眼=针鼻儿|针箍=顶针|丝线=绒线|头绳=毛线=绒头绳=绒线|线桄子=线轴儿|针头线脑=针线|锅子=镬子|一品锅=火锅|压力锅=高压锅|便壶=夜壶|圆笼=屉子=甑子=笼屉=箅子=蒸笼|水瓢=水舀子=舀子|匙子=羹匙=调羹|钵头=钵子|瓦盆=缸盆|浴盆=澡盆|痰桶=痰盂|便桶=恭桶=抽水马桶=粪桶=马子=马桶|保温瓶=冰瓶|保温瓶=暖水瓶=暖瓶=热水瓶|花插=花瓶|吊瓶=输液瓶|杯子=盅子|酒杯=酒盅|罐头=罐子|储存罐=储罐|箱子=箱笼|信筒=信箱=邮筒=邮箱|垃圾桶=垃圾箱=果皮筒=果皮箱|保健箱=急救箱|举报箱=信报箱=信报箱群|匣子=盒子|八音匣子=八音盒|暗盒=黑匣子|提篮=篮子=篮筐|背篓=驮篓|筐子=箩筐|淘箩=淘米箩=筲箕|栲栳=笆斗|畚箕=簸箕|粪筐=粪箕子|手提包=手提袋=提包|麻包=麻袋|沙包=沙袋|皮夹=皮夹子=腰包=钱包|兜儿=兜子=口袋=荷包=袋子|络子=网兜=网袋|纸口袋=纸袋|背搭子=褡裢|套子=封套|书函=书套|被套=被袋|滚轮=虎伏|浪木=浪桥|扩胸器=拉力器=拉簧|乒乓球=台球|克郎球=康乐球|拍子=球拍|台球=弹子|棋子=棋类|围盘=棋盘|乐器=法器|响器=打击乐器|丝弦=弦乐器|七弦琴=古琴|三弦=弦子|二胡=南胡|扬琴=洋琴|六弦琴=吉他|参差=排箫|横笛=笛子|小锣=铴锣|拍板=檀板=鼓板|老弦=里弦|外弦=子弦|帷幕=幕布|录相机=摄像机=摄影机|胶卷=胶片=软片|影片=片子|拷贝=正片|底板=底片=底版|分色片=正色片|文具=文房四宝=笔墨纸砚|印泥=印色|信封=封皮|图钉=摁钉儿|浆糊=糨子=糨糊=面糊|誊写钢版=钢板|毛笔=水笔|水笔=自来水笔=金笔=钢笔|原子笔=圆珠笔|笔套=笔帽|笔心=笔芯=笔铅|墨水=墨汁|纸头=纸张|报纸=新闻纸=白报纸|玉版宣=玉版纸|信笺=信纸|吸墨纸=吸水纸|卫生巾=卫生纸=废纸=手纸=草纸|砚台=砚池|册子=小册子=本子=簿册=簿子=簿籍|笔记本=笔记簿=记录本=记录簿|帐册=帐本=帐簿=簿记=账册=账本|人名册=名册=名单=花名册|户口册=户口本=户口簿|奏折=折子|菜单=菜系=菜谱=食谱|聘书=聘约|保证卡=信用证=信誉卡=承诺卡|名帖=名片=手本=片子|礼帖=请帖=请柬|无名帖=黑帖|单子=单据=契据=契约=字据=票子=票据=票证|借据=借条=左券|收执=收据=收条|存执=存折=存根=票根|发单=发票|保单=保票=包票|保证书=军令状|提单=提货单=货票|入场券=门票|月台票=站台票|往返票=来回票|免票=招待券=红票=赠券|关系=证书=证件=证明=证明书|路条=路签=通行证|文凭=毕业证书|执照=许可证=证照|行车执照=驾照|信物=凭信=凭单=凭据=凭证=证据|兵符=虎符|标志=标示=标记|标牌=牌子|指路牌=站牌=路牌|码子=筹码|封条=封皮|匾额=横匾=牌匾|横幅=横披|桩子=界桩=界石=界碑|令旗=令箭|旌旗=旗子=旗帜|市招=幌子=招子|徽章=证章|帽徽=帽章|臂章=袖标=袖章|火烛=蜡烛|烛台=蜡台|香火=香烛|洋火=火柴=自来火|火把=火炬|扣儿=扣子=纽子=纽扣=衣扣=钮扣|子母扣儿=摁扣儿|纽襻=襻儿|扣子=疙瘩=结儿=结子|活扣=活结|死扣=死结|绳子=绳索=缆索|钢丝绳=钢索=钢缆|链子=链条|带子=绦子|彩带=彩练|腰带=褡包|绑腿=腿带|吊带=吊袜带=袜带|台子=案子=桌子|八仙桌=四仙桌=方桌|圆台=圆桌|一头儿沉=书案=书桌=写字台=办公桌=桌案|梳妆台=镜台|条几=条案=条桌|屉子=抽屉=抽斗|交椅=椅子|圈椅=安乐椅=扶手椅|条凳=长凳|卧榻=床榻=床铺=枕席|帆布床=行军床|木床=板床|病床=病榻|柜子=柜橱=橱柜=箱橱|碗柜=碗橱|衣柜=衣橱|床边柜=床边橱|保险柜=保险箱|拦柜=栏柜|卧具=寝具|被褥=铺垫=铺盖=铺盖卷=铺陈|被卧=被头=被子|棉絮=棉花胎|垫被=褥套=褥子|稿荐=草垫子=草荐|单子=床单=被单=褥单|帐子=蚊帐|凉席=席子=衽席=踅子|席篾=竹席=篾席|席草=芦席=草席|帷子=帷幔=幔帐|帘幕=窗帘=窗帷=窗幔|帐幕=帐篷=帷幄=帷幕=毡包=毡幕=蒙古包|垫子=垫片|护罩=罩子|乳罩=奶罩=胸罩|面纱=面罩|时钟=钟表|台钟=座钟|停表=跑表=马表|怀表=挂表|指针=表针|表盘=表面|漏刻=漏壶=铜壶滴漏|化妆品=脂粉|发乳=发蜡=头油=生发油|口红=唇膏|扑粉=爽身粉=香粉|花露水=香水|什件儿=装饰=装饰品=饰品=饰物|流苏=穗子|发卡=发夹|头面=首饰|戒指=手记=指环=钻戒=镏子|耳坠=耳坠子=耳环=耳针=钳子|项圈=项练=项链|手镯=玉镯=镯子|发簪=玉簪=簪子=簪缨|刺绣=平金=绣品|晴雨伞=阳伞=雨伞|旱伞=遮阳伞=阳伞|芭蕉扇=葵扇|团扇=纨扇|电扇=电风扇=风扇|暖壶=汤壶|手炉=烘笼=烘篮|玩具=玩意儿=玩物=玩艺|弹子=玻璃球|断线风筝=纸鸢=风筝=鹞子|偶人=土偶=托偶=木偶=玩偶|拨浪鼓=波浪鼓|响铃=铃儿=铃铛|哨子=鼻儿|惊堂木=醒木|烟火=烟花=焰火|炮仗=爆竹|二踢脚=双响|棺木=棺材=棺椁|灵柩=灵榇|寿木=寿材|骨灰盒=骨灰箱|冥器=殉葬品|灵位=灵牌=牌位=神位|偶人=兵马俑|银锭=锡箔|布料=料子=衣料=面料|料子=毛料|布头=零头|布匹=布帛=棉布=棉织品|土布=毛布=粗布|羽毛缎=羽缎|卡其=咔叽|夏布=麻布|条绒=灯心绒=灯芯绒|丝织品=丝绸=绫椤绸缎=绸子=绸缎=缎子|小纺=纺绸|柞丝绸=茧绸|拷纱=拷绸=莨绸=香云纱|春绸=线春|呢子=呢绒=毛呢=毛织品|直贡呢=礼服呢|大氅=大衣=棉猴儿=皮猴儿|披风=斗篷|大褂=袍子=袷袢=长衫=长袍|外罩=罩衣=罩衫=罩袍|内衣=小衣裳=小褂|中服=中装=成衣|洋服=洋装=西服=西装|盛服=盛装|大礼服=燕尾服=礼服|朝服=蟒袍|便服=便衣=便装|外套=外衣|夏衣=夏装|冬衣=冬装=寒衣=棉衣|小衣裳=童装|兜兜=兜肚|睡衣=睡袍|法衣=百衲衣=直裰=袈裟=道袍|戏衣=戏装|丧服=孝服=素服=缟素=重孝|百衲衣=鹑衣|上衣=上装=上身=小褂儿=短打=短装=紧身儿=褂子|坎肩=背心=马甲|单褂=马褂|衬衣=衬衫|汗衫=汗褂|卫生衣=绒衣|下身=小衣=裤子|衬裤=裤衩|卫生裤=绒裤|裙子=裙装|套裙=布拉吉=连衣裙|衣领=领口=领子|腰身=裤腰|口袋=囊中=私囊=荷包=衣兜=衣袋|衣袖=袖子=袖筒=袖管|后襟=后身|前襟=前身|冠冕=头盔=帽子=帽盔|斗笠=斗篷=毡笠=箬帽=草帽|小帽=瓜皮帽|乌纱=纱帽|王冠=皇冠|拖鞋=趿拉儿|木屐=趿拉板儿|皮鞋=革履|绣花鞋=绣鞋|套鞋=胶鞋=钉鞋=雨鞋|球鞋=跑鞋=运动鞋=钉鞋|头巾=网巾|围巾=围脖=围脖儿|手套=拳套|粮食=菽粟=食粮|干粮=糇粮|粗粮=糙粮|大米=白米=稻米=精白米|机米=籼米|江米=糯米|秫米=高粱米|米粒=饭粒|米粉=米面|白面=面粉|棒子面=玉米面|麸子=麸皮|草料=饲料=饲草|粮秣=粮草|钓饵=饵料=鱼饵|食品=食物|饭菜=饭食|烟火=烟火食=熟食|零嘴=零食|肉制品=肉品=肉食品|白玉=白米饭=白饭=米饭|盖浇饭=盖饭|份儿饭=份饭=客饭|稀饭=米汤|锅巴=锅贴|汤面=面汤|抻面=拉面|卷子=花卷|包子=饽饽=馍馍=馒头|饼子=饽饽|杂粮=粗粮|下饭=小菜=菜肴=菜蔬|酒菜=酒食=酒饭|佳肴=佳肴珍馐=珍馐=美味=美食=美食佳肴|山珍=山珍海味=水陆=生猛海鲜|粗茶淡饭=糟糠|冷盘=小吃=拼盘|浇头=菜码儿|大鱼=油腻=荤腥=荤菜|一品锅=全家福|海鲜=鱼鲜|排骨=肉排|肉丝=肉末=肉松|狮子头=肉丸|咸肉=腊肉|爪尖儿=猪蹄=蹄子|米粉肉=粉蒸肉|白肉=肥肉|上水=下水=杂碎|圈子=肠儿=肥肠|海米=虾皮=虾米|干贝=江珧柱|翅子=鱼翅|咸鱼=鲍鱼|变蛋=松花=松花蛋=皮蛋|肉片=肉类|生肉=鲜肉|素菜=素餐|千张=豆腐皮|豆腐干=香干|腐乳=豆乳=豆腐乳=酱豆腐|豆腐皮=豆腐衣|豆芽儿=豆芽菜|佐料=作料=调味品=调料|八角=大料=茴香|味精=味素|小粉=淀粉|动物淀粉=糖原|清油=素油|大油=猪油=荤油|清油=菜子油=菜油|清油=茶油|芝麻油=香油=麻油|板油=脂油|氯化钠=盐巴=盐类=盐粒=积雪=食盐|岩盐=矿盐|果子酱=果酱|白醋=苦酒=陈醋|糖料=糖类=食糖|点心=茶食|甜品=甜点=甜食=糖食|糕点=饽饽|果饵=糕饼|烙饼=饼子|大饼=火烧=烧饼|油条=油炸鬼|元宵=圆子=汤团=汤圆|团子=饭团|抄手=馄饨|江米酒=酒酿=醪糟|糖块=糖果|糖饴=饴糖=麦芽糖|果脯=桃脯=蜜饯|果仁儿=果料=果料儿|心子=馅料儿|酵子=鲜酵母|发粉=起子|酒曲=酒母=酒药|发面=面肥|饮品=饮料|豆乳=豆汁=豆浆|咖啡茶=雀巢咖啡|冰棍=冰棍儿=冰棒=冰糕=棒冰=雪条|冰淇淋=冰激凌|冰糕=雪糕|砖茶=茶砖|花茶=香片|茶卤=茶晶|杯中物=酒浆|佳酿=名酒=玉液琼浆=琼浆=琼浆玉露=美酒=醇酒=醇醪|绍兴酒=绍酒=老酒=花雕=陈酒=黄酒|烧酒=白干儿=白酒|水酒=清酒=酒水|药味=药品=药料=药物=药石|中医药=中药=中药材=国药|丸剂=丸药=药丸|散剂=药粉=药面|膏药=药膏|口服液=汤剂=汤药=药水=药液|引子=药引子=药捻子=药饵|试剂=试药|冲剂=浸剂|蒙药=麻药=麻醉剂|坐药=栓剂=药栓|制剂=药剂|圣药=妙药=灵丹=灵丹妙药=特效药=苦口良药|地霉素=青霉素|结核菌素=结素|催眠药=安眠药|汞溴红=红汞=红药水|甲紫=紫药水=龙胆紫|奎宁=金鸡纳霜|阿胶=驴皮胶|槐花蜜=王浆=花蜜=花露=蜂乳=蜂王浆=蜂王精=蜂皇精|蜂蜜=蜜糖|卫生丸=樟脑丸|六六六=敌敌畏=敌杀死=敌百虫=滴滴涕|避孕片=避孕药|咖啡因=茶精=茶素|显影液=造影剂|维他命=维生素|烟酸=维生素|保鲜剂=防腐剂|去污剂=清洁剂|毒品=毒物=毒药=毒饵|毒酒=鸩毒=鸩酒|海洛因=白粉=白面儿|耗子药=鼠药|大烟=烟土=阿片=鸦片|信石=白砒=砒霜=红矾=红砒|烟卷=烟卷儿=纸烟=香烟|卷烟=吕宋烟=雪茄|斗烟丝=烟斗丝|烟头=烟屁股=烟蒂|事体=事儿=事务=事宜=碴儿|事项=须知|两回事=两码事|事实=史实=实事=实际=现实|国事=国务=国家大事|政事=政务|外事=外务=洋务|大事=盛事=要事|公事=公务=公干=差事|急事=缓急|危险=奇险|苦事=难事=难题|新闻=时事=时务|佳话=趣事|佳话=好事=好人好事=幸事=美谈|乐事=快事=赏心乐事|喜事=好事=美事=雅事|亲事=喜事=大喜事=天作之合=婚事=婚姻=终身大事|丧事=后事=横事=白事|红白事=红白喜事|佛事=功德=水陆=法事=道场=香火|恨事=憾事=遗恨|世事=尘世=尘事|佚事=轶事=逸事|咄咄怪事=奇事=怪事=特事=跷蹊=蹊跷|事迹=史事=纪事=遗事|雅事=韵事=风流韵事|家事=家务=家务事=家政|奥秘=秘事=秘密=阴私=隐私=隐秘|事机=军机=天机=机关=机密|亏心事=缺德事|劣迹=勾当=坏事=坏人坏事|丑事=丑闻=秽闻|一鳞半爪=片断=鳞爪|傻事=蠢事|私事=非公务|万事=事事=诸事|新人新事=新鲜事|事件=事变=轩然大波=风波|惨案=血案|事故=事端=岔子|枝节=疙瘩=纠纷=麻烦|万一=三长两短=不虞=好歹=差错=意外=长短=闪失|事变=变动=变化=变故=平地风波=晴天霹雳=风吹草动|一波三折=几经周折=历经沧桑=反复=曲折=波折=饱经沧桑|沧桑=沧海桑田=翻天复地|动乱=变乱=扰动=骚动=骚扰|十年动乱=十年浩劫|大潮=浪潮=风潮|旋涡=水涡=涡流=漩流|人民战争=群众运动|工人运动=工潮=工运|热潮=狂潮|事例=例子=例证|举例=举例来说=比喻=比方=譬喻|先例=先河=判例=前例=成例=成规=旧案|公案=案件=案子|凶杀案=命案=杀人案=血案=谋杀案|悬案=无头案=疑案|假案=冤假错案=冤案=冤狱=错案|投诉案=诉讼案|本案=此案=该案|大案要案=大要案|嫌疑=瓜田李下|历程=经过=过程=进程=长河|开天辟地=破天荒=第一遭|新年伊始=新春伊始|经历=资历=阅世=阅历|浪漫史=罗曼史=艳史|病历=病史=病案|古代史=古史|科学史=科技史|建筑史=建设史|政策史=谋略史|军史=战争史=战史|医史=医学史|前景=前程=前途=奔头儿=未来=鹏程|争气=出息|境遇=景遇=身世=遭遇=遭际=际遇|大风大浪=风浪=风雨=风霜|仕途=宦途|冷板凳=冷眼=冷遇|凄风苦雨=惨境|冷暖=炎凉=甜酸苦辣=酸甜苦辣|佳境=顺境|下坡=下坡路=逆境|吉人天相=天幸=幸运=红运|苦命=薄命|厄运=灾星=背运|时气=时运|幸福=洪福=福分=福气=福祉=造化=鸿福|三灾八难=不幸=劫数=天灾人祸=灾殃=灾祸=灾难|成灾=灾害=灾患=灾荒|万劫不复=劫难=天灾人祸=洪水猛兽=浩劫=灭顶之灾|无妄之灾=横事=横祸=飞来横祸=飞灾|祸根=祸端=祸胎|兵乱=兵燹=战乱=战祸|匪患=匪祸|外患=外祸=敌害|后患=遗祸|天灾=灾荒=自然灾害=荒灾|内涝=涝害=涝灾|水害=水患=水灾=洪灾|火灾=火警|亢旱=大旱=旱灾|粮荒=饥荒=饥馑|海事=海难|地动=地震=震害|虫害=虫灾|风害=风灾|休戚=吉凶=安危祸福=旦夕祸福=祸福|困苦=疾苦=痛痒|千磨百折=千难万险=折磨=磨难|困难=难关=难处=难点=难题|失利=失败=挫折|冤屈=冤枉|不白之冤=沉冤=覆盆之冤|大德=大恩大德=泽及后人=洪恩|小恩小惠=甜头|再生之恩=救命之恩=活命之恩|仇怨=仇恨=冤仇=睚眦|切骨之仇=深仇大恨=苦大仇深=血仇=血债=血海深仇|世仇=宿仇=旧恶|恩仇=恩怨=恩恩怨怨|分歧=矛盾=龃龉|光彩=光荣=桂冠=殊荣=荣幸=荣耀=荣誉=骄傲|侮辱=奇耻大辱=屈辱=污辱=羞辱=耻辱|污点=秽迹|劳绩=大成=实绩=成就=成法=成绩=造就|新绩=纪录|佳绩=功劳=功德=功绩=劳绩=贡献=赫赫功绩|一等功=头功=头等功|功勋=勋业=勋劳=勋绩|业绩=事功=功业=功绩|奇勋=殊勋|军功=战功=战绩=武功=汗马功劳=胜绩|丰功伟绩=伟业=伟绩=奇功伟业|丰功=功在千秋=功在当代=大功=奇功=居功至伟|功罪=功过|一差二错=言差语错=误会=阴差阳错=阴错阳差|尾巴=漏子=漏洞=狐狸尾巴=破绽=纰漏=罅漏=马脚|体会=体验=心得=感受=经验|以史为鉴=前车之鉴=后车之鉴=教训=殷鉴=覆辙=鉴戒|借鉴=龟鉴|印象=记忆|人命=性命=民命=活命=生命|存亡=死活=生死=生死存亡=生老病死=阴阳|人寿=寿命=寿数|长命=长寿|余生=劫后余生=残生=虎口余生|光景=光阴=小日子=日子=生活|家常=家长里短=寝食=柴米油盐=衣食=衣食住行|云雨=人道=性生活=性行为=房事|戎马一生=戎马生涯|心身=身心|活计=生涯=生计=生路|伙食=口腹=膳食=茶饭=餐饮=饭食=饮食|大菜=西餐|便酌=便饭=家常便饭=家常饭|早餐=早饭|中饭=午宴=午餐=午饭|夜餐=夜饭=晚餐=晚饭|包伙=包饭|快讯=情报=新闻=消息=讯息=谍报=资讯|声气=风声|佳音=喜讯=捷报=福音|凶信=凶耗=噩耗=死信=死讯|妄言=无稽之谈=谣传=谣言|桃色新闻=绯闻|信息=消息=音信=音尘=音息=音讯=音问|现势=现局=现状|危亡=危局=死棋=败局|全局=大局|时务=时势=时局|和局=和棋=平局=平手|升势=增势=涨势=生势=走势=长势|下坡路=低谷=颓势|事实=实况=实情=实际=真情=真相=谜底|来历=来头=来路|端详=详情|光景=境况=境遇=手下=手头=手边|晚景=老境|家境=家道|病况=病情=病状|商海=市场=市面|世面=场景=场面|实处=实景|地步=境地=境域=处境=情境=田地|人间地狱=地狱=惨境=活地狱=渊海=火坑=炼狱=苦海|万丈深渊=无可挽回=死地=深渊=绝地=绝境|危境=险境|化境=地步=境地=境域=境界=程度|意境=意象|佳境=梦境|梦乡=梦境|条件=环境|气氛=氛围=空气|流星雨=陨石雨|形迹=征候=征象=蛛丝马迹=行色=迹象|意思=苗头=苗子|病征=病症=病象=症候=症状|兆头=先兆=前兆=征兆=预兆|吉兆=彩头=祥瑞|不祥之兆=凶兆=恶兆|下落=垂落=归着=着落=落子|来踪去迹=踪影=踪迹|行止=行踪=行迹|天候=天气=天道=气候=气象|时令=月令=节令|季风气候=小气候|收成=收获|年光=年成=年景|大秋=秋景|丰年=大年=熟年|常年=平年|凶年=歉岁=歉年=荒年|用场=用处=用途|实效=证验|特效=神效|副作用=负效应|反响=反射=反应=反馈=影响=感应|反作用=反动|信誉=名声=名气=名誉=声价=声名=声望=声誉|名望=美誉|久负盛名=享有盛誉=大名=小有名气=盛名=美名|人望=众望=得人心|恶名=秽闻=骂名|浮名=虚名|声威=威信=威名=威望|人情=情面=老脸=老面子=老面皮=脸皮=脸面=面子|体面=大面儿=脸面=面子=面目=颜面|威武=权势|恶势力=腐恶=铁蹄=魔手=魔爪|威严=威势=威风=虎威=雄威=雄风|势焰=声势=气势=气焰=气魄|凶气=凶焰=敌焰=气焰|笔力=风骨=骨气|对象=目标=靶子|导火线=缘起=起因|事出有因=事由=情有可原=情由|病因=病根=病源|下文=产物=分晓=名堂=后果=究竟=结局=结果|因果=报应|兰因絮果=恶果=苦果|源头=源流|来源=泉源=源泉|水头=水源|信物=凭据=凭证=左证=证据|信据=实据=明证=有根有据=有理有据=真凭实据=确证=铁证|依据=凭依=根据|实证=立据=论据=论证|南针=指南针=指针|理由=说头儿=说辞|小辫子=把柄=榫头=辫子|笑料=笑柄=笑谈|口实=话把=话柄|典故=古典=掌故|出典=出处|目的=鹄的|主旨=大旨=宏旨=宗旨=弘旨=旨要=要旨|公例=公理=公设=原理=常理=法则=规律|定律=定理|经济法则=经济规律|自然法则=自然规律|论理=逻辑|事理=所以然=理路=道理|义理=大义=大道理|真理=真知=真谛|公理=正理|歪理=邪说|公道=正义|天理=天道|佛法=教义=福音|堂奥=玄机=禅机|大体=情理=物理|世情=人情=人情世故|一面儿理=死理|含义=意义=意思|定义=概念=界说|意蕴=蕴意|内涵=内蕴|初见端倪=头绪=头脑=有眉目=眉目=端倪=端绪=线索|伦次=条理=条贯=板眼=理路=眉目=系统=脉络|思路=构思=笔录|笔势=笔法=笔路|立场=立脚点=立足点|出发点=着眼点=落脚点=观点=视角=角度|就业观=择业观|套套=常规=常轨=框框|兵法=战法=阵法=韬略|掩眼法=遮眼法=障眼法|反证法=归谬法|茶艺=茶道|手续=步子=步调=步骤|关系=干涉=干系=瓜葛|人头=人缘=人缘儿=群众关系|交情=交谊=友情=友谊=情分=情谊|故交=旧交=老交情|忘年之交=忘年交=忘年情=深交=至交=莫逆之交|私交=私情|国交=邦交|因缘=姻缘=情缘=机缘=缘分|形制=形态=形状=形象=样子=模样=状貌=造型|奇形怪状=怪模怪样=怪相|地势=地形=地貌=山势=形势|体形=体态=身材=身条=身段|带状=条形=线形|多角形=多边形|三角=三角形=三边=三边形|口形=斜角=菱形|正多角形=正多边形|几何图形=空间图形|台式=棱台=棱锥台|圆台=圆锥=圆锥台|圆圈=圆形=圈子=环子=线圈|时式=时样|排偶=排比|惨状=惨象=痛苦状|密闭式=封闭式|装璜=装饰|春光=春暖花开=春色=蜃景=韶光=韶华|秋景=秋色|夜景=夜色=晚景=暮色=曙色=野景|旧景=旧貌|清山秀水=青山秀水|名胜古迹=胜迹|幻像=幻境=幻影=幻景=幻梦=春梦=镜花水月|新景观=新气象=新貌|功架=姿势=姿态=式子=架势=架子=架式|英姿=雄姿=飒爽英姿|多彩多姿=婀娜多姿=摇曳多姿|步伐=步子=步履=脚步|后步=退步|八字步=四方步=方步|妆饰=打扮=扮相=装束|浓妆艳抹=艳妆=靓妆|人品=仪容=仪态=仪表=仪观|神情=神气=神色=神采=表情|千姿百态=姿态=态势=态度=情态=神态|言谈=辞色|眼神=眼色|目光=眼光=眼波=眼神=秋波|声色=气色=眉眼高低=眉高眼低=脸色=面色|一颦一笑=笑容=笑影=笑脸=笑貌=笑颜|喜气=喜色|忧容=愁云=愁容=愁眉苦脸=苦相|怒容=怒气=怒色=脸子|凶相=杀气=煞气|惊魂=惧色|酒意=醉意|女色=媚骨=美色|侠骨=傲骨=铁骨=风骨=骨气|气慨=浩气=英气=豪气|傲气=骄气|书卷气=书生气|习性=属性=性能=性质=总体性=机械性能=特性=通性|慕光性=趋光性|准头=准确性|音品=音色=音质|业务性=生产经营性=营业性|伸缩性=压缩性=紧缩性|前瞻性=预见性|广泛性=普及性|不确定性=可变性|诱导性=诱惑性|开拓性=批判性=探索性=革命性|指令性=指导性|背光性=背日性|流动性=流通性|实验性=试错性=试验性|紧迫性=迫切性|敏感性=过敏性|趋利性=趋向性|条理性=逻辑性|礼节性=象征性|拉动性=鼓动性|可持续性=延续性|自主性=自营性|永久性=永恒性|区域性=局部性|亮点=优点=助益=可取=强点=独到之处=长处=长项|各有所长=学有所长|大幅让利=渔人之利=渔翁得利=现成饭|单利=小便宜=微利=蝇头微利|坏处=害处=弊病=弊端=时弊=流弊|宿弊=无私有弊=积弊|切身利益=既得利益|优缺点=利害=利弊=得失=成败利钝|性状=特征=特性=特点=特色=表征=风味|三六九等=上下=优劣=天壤=好坏=高低|天壤之别=相去甚远=霄壤之别|存小异=存异|圈圈=局面=层面=框框=范围=范畴=规模|势力范围=地盘=租界|手心=手掌=手掌心=掌心=樊笼=牢笼=魔掌|省内=省里|火力圈=火力网|全文=全篇=满篇=通篇|管区=辖区|上头=上面=方面|各方=处处|世界=园地=圈子=天地=小圈子=领域|战线=系统|多头=多方=多方面=多边=大举=大端=绝大部分|官场=宦海=政界|文坛=文学界=文苑|文艺界=艺坛=艺林=艺界=艺苑|书坛=诗坛|学术界=学界=教育界=文化界=知识界=科学界=科技教育界|借方=收方|戏曲界=梨园|买方=付方=借贷方=贷方|着力处=着力点|前端=前者|负面=阴暗面|商业界=商界|汽车业界=汽车界|各界=各行各业|工商企业界=工商界|社会科学界=社科界|体系=系统|血统=血缘=血脉|分系统=子系统|协作网=合作网|监测网=观测网|互联网=计算机网|管网=管道网|此类=该类|雌雄同体=雌雄同株|雌雄异体=雌雄异株|低高型=高低型|研究型=科研型|布局=构造=组织=结构|架子=班子=领导班子|梯级=梯队|体制=建制=编制|主次=先后=先来后到=次序=次第=程序=顺序|词序=语序=语次=音序|位次=坐次=席次=座次|层次=层系|排名=排名榜=排行=横排|工艺流程=流水线=流程|头一回=首度=首次=首轮|下一场=接下来=然后|本次=此次|日班=白班|序列=行列=队列|一人班=一条龙=一溜儿=一行=单排|雁行=雁阵|工薪层=工薪阶层|外表=外部=大面儿=表面|伪装=假相=假面具=外衣=画皮=糖衣=门脸儿=门面|内核=基业=基本=基石=基础=木本=根本=水源|地心=地核|中枢=命脉=心脏=灵魂|元素=因素=要素|成份=成分|水分=潮气|养分=滋养=肥分=营养|信条=准则=圭臬=格言=楷则|好榜样=楷范=模范=表率|为人师表=师范=师表|典型=垂范|品质=成色=质地=质量=身分|品位=档次=水准=水平=程度|质量上乘=高质|分界=分野=壁垒=界线=界限=边境线=鸿沟|只限=限于|下线=底线|极了=极致|负极=阴极|正极=阳极|分寸=大大小小=大小=尺寸=深浅=轻重=轻重缓急=高低|分量=斤两|力气=劲头=巧劲=气力=马力|傻劲儿=劲儿=后劲=忙乎劲儿=死力=死劲儿=牛劲|体力=膂力|脚力=脚劲=腿脚|人力=人工=力士|大力=量力=鼎立|余力=犬马之劳=绵薄=鸿蒙|全劳动力=劳力=劳动力=半劳动力=壮劳力|目力=眼力=眼神=视力|物力=财力=资力|兵力=军力=武力|强力=暴力=武力=淫威|佛法=法力|反作用力=反冲力=后坐力=坐力|附着力=黏着力|吸力=吸引力=引力|地力=地心引力=地磁力=磁力=重力|张力=拉力|上压力=下压力=侧压力=旁压力|内聚力=凝聚力|笔力=骨力|勃勃生机=蓬勃生机|加力=载力=运力|位能=势能|汽化热=潜热=热能=热量|核子能=核能|名号=名目=名称=称号=称呼=称谓|徽号=美名=美称=英名=雅号|大号=尊称|亲爱的=爱称|别称=又称|俗名=俗称|名堂=名目|幌子=招牌=旗号=牌子=金字招牌|商标=招牌=标记=牌号=牌子|曲牌=牌子=词牌=诗牌|标题=题名=题目|副标题=副题|帽子=罪名|人名=全名=姓名=现名=真名|姓氏=百家姓|双姓=复姓|尊姓=贵姓|大名=芳名|乳名=奶名=小名|假名=化名|别号=别名=别字|外号=绰号=诨号=诨名|外姓=客姓=异姓|十二属=十二属相=十二生肖=属相=生肖|原籍=祖籍=老家|户口=户籍|资格=身价=身份|出身=家世=身家=门户=门第|年辈=行辈=辈分=辈数|同辈=平辈|上辈=先辈=前辈=长辈|下辈=后辈=小字辈=小辈=晚辈|体格=体魄=筋骨=腰板儿=身子骨儿=身板|个性=天性=本性=生性=秉性=赋性|我行我素=牛劲=牛性=牛气=牛脾气|故态=老脾气|孩子气=稚气|为人=人品=人头=人格=品质=格调=灵魂=质地|德艺双馨=诚信=高风亮节|德性=德行=道义=道德|美德=贤德=贤惠|三从四德=妇道|主义=作派=作风=官气=架子=气派=派头|场面=外场=排场=阔气|大锅饭=平均主义=集体主义|个人主义=利己主义|五伦=五常=人伦=伦常=伦理=天伦|孝心=孝道|名节=品节=气节=节操|大德=大节|贞操=贞节|勇气=心胆=胆力=胆子=胆气=胆略=胆量|气魄=胆魄=魄力|血性=血气|洪量=海量=雅量|士气=斗志=气概=骨气|侠骨=铁骨|慧心=智力=智商=智慧=灵性=灵气|天分=天才=天禀=天资=天赋=禀赋=资质|心劲=心窍=悟性=理性|才分=才思=才智=智略=智谋=神智=聪明才智=脑汁|干才=才力=才干=才略=才能=才识=经纶|奇才=雄才=雄才大略|口才=辩才|文才=生花之笔=生花妙笔=笔墨=笔底下|本事=本领=能事=能耐=身手|技巧=技术=技能=技艺=招术|三头六臂=神功=神通|本领=武艺|舞技=舞艺|控球技术=球技=球艺|高技术=高新技术|战技术=战术|力量=能力|耳性=记忆力=记性|慧眼=眼光=眼力=观察力=鉴赏力|功力=功夫=素养=造诣|修养=教养=涵养|心理=思想=思维|价值观=传统=历史观=思想意识=绝对观念=观念|精神=精神上=魂儿|脑海=脑际|匠心=心裁=意匠=机心=机杼|思绪=思路=文思=笔触|上进心=进取心|戒心=警惕心=警惕性|信心=信心百倍=信念=自信心|妒忌心=忌妒心=醋劲儿|感受=感想=感触|恻隐之心=慈心|人心=心肝=灵魂=良心=良知|杂念=私心=私心杂念=私念|妄念=贼心=邪心=邪念=非分之想|二心=外心=异心=贰心|叵测之心=恶心=恶意=祸心=黑心|感性=感觉=知觉=神志|味道=滋味|共鸣=同感|幽情=底情=情丝=情义=情感=情愫=感情=真情实意|人之常情=人情=常情|寸心=心意=情意=意思|原意=本心=本意|善心=善意=好心=好意=爱心=美意|厚意=敬意=深情=深情厚意=盛情=盛意=雅意|谢忱=谢意|假意=敌意=虚情假意|激情=豪情|下情=人心=公意=民心=民心向背=民情=民意=群情|世态=世情=人情=人情世故|亢奋=激奋|情窦初开=春心=春情=春意=色情=醋意=风情|苦口婆心=苦心|忧心=忧愁=忧虑=愁绪=愁肠|心病=隐忧=隐痛|众怒=公愤=民愤|不平=夹板气|哀怒=嫌怨=怨尤=怨恨=怨气=怨艾|幽怨=幽愤|宿怨=积怨|欲念=欲望=私欲|人事=性欲=情欲=肉欲|急需=要求=需求=需要|巴望=希望=想头=指望=盼头=重托|寄意=希望=心愿=意思=意愿=愿望=誓愿|夙愿=宏愿=宿志=宿愿=愿心=真意=素愿|初愿=初衷|企图=作用=意向=意图=打算=来意=用意=表意|心意=意志=意旨=旨在=旨意=法旨|大计=弘图=百年大计=雄图=雄图大略=鸿图|如意算盘=小九九|智术=权术|战略=战略性=韬略|妙策=妙计=巧计=神机妙算=良策=锦囊妙计|万全之策=上策|奸计=狡计=诡计=阴谋=阴谋诡计=鬼胎|恶计=毒计=毒谋|故伎=故智=老一套|绝招=高招|噱头=把戏=花招|怪招=花头=花枪=花样=鬼把戏|冷箭=明枪暗箭=暗箭=阴着儿=鬼蜮伎俩|毒手=辣手=黑手|梦乡=梦境=梦寐=梦幻=梦见=睡乡=睡梦=迷梦|噩梦=恶梦=梦魇|心气=志气=意气=斗志|定性=心志=恒心=意志=毅力|冲劲=劲头=实劲=干劲=拼劲=钻劲=闯劲|兴味=兴趣=志趣=感兴趣=趣味|口味=意气=气味=脾胃|乐趣=异趣=意趣=旨趣=生趣=童趣=野趣|诗兴=诗思|各有所好=喜好=嗜好=爱好=痼癖=癖好=癖性|情韵=气韵=韵味=韵味儿=韵致=风味=风致|余韵=遗韵|主张=主心骨=主意=主见=呼吁=呼声=意见|坏主意=小算盘=花花肠子=馊主意=鬼点子|卓见=卓识=灼见=真知灼见=远见=远见卓识=高见|创意=创见=新意|一定之规=准谱=定盘星=定见|一得之愚=一得之见=拙见=浅见=私见=管见|入主出奴=成见|一孔之见=一般见识=一隅之见=偏见=门户之见|异同=异端=异言=异议=异词=疑念|世界观=人生观=宇宙观|精华=精粹=精髓=菁华|传家宝=国粹=宝物=宝贝=法宝=瑰宝|宝藏=财富=遗产|毫毛=涓滴=秋毫之末=纤毫=鸿毛=鹅毛|蛇足=赘疣=附赘悬疣|嫩苗=幼芽=幼苗=新苗=胚芽=苗子=萌芽|昙花=朝露|泥足巨人=空架子=绣花枕头|大杂烩=杂拌儿=杂烩|拦路虎=绊脚石=阻力=阻碍=障碍|挡风遮雨=遮风挡雨|束缚=枷锁=桎梏=管束=紧箍咒=约束=羁绊|糖弹=糖衣炮弹=诱饵|圈套=牢笼=陷阱=骗局|保护伞=护符=护身符|征程=征途=途程=道路|正路=正轨=正道|坦途=康庄大道=阳关大道|左道旁门=旁门左道=歪路=歪道=歪门邪道=邪路=邪道|后门=方便之门|歧路=歧途=迷津|套数=套路=老路=覆辙|末路=死胡同=死路=穷途末路=绝路|捷径=终南捷径=近路|中途=中道=半路=半途|余地=后手=后路=退路=逃路|台阶=阶梯|垫脚石=敲门砖|富民路=致富线=致富路|仙人=神人=神仙=神明=神灵=神物=神道=菩萨|仙姑=女神=神女|仙女=仙子=天仙|圣母=娘娘|天使=安琪儿|上帝=耶和华|基督=救世主=耶稣|佛爷=佛陀=弥勒佛=强巴阿擦佛=浮屠=阿弥陀佛|王母娘娘=西王母|观世音=观音=送子观音|财神=财神爷=赵公元帅=过路财神|阎王=阎王爷=阎罗=阎罗王|土地爷=土地老|灶君=灶王爷=灶神|异物=死鬼=鬼魂|厉鬼=撒旦=死神=鬼神=鬼魔=魔鬼|恶鬼=魔王|妖怪=妖物=妖精=妖魔=怪物=精怪=精灵=邪魔|异物=异类=狐仙=狐狸精=白骨精|心魂=灵魂=神魄=魂灵=魂魄|亡灵=亡魂=在天之灵=幽灵=幽魂=阴魂=鬼魂|忠魂=英灵=英魂|妖魔鬼怪=鬼怪=鬼蜮=鬼魅=魍魉=魑魅=魔怪|神异=神怪|上天=净土=天国=天堂=极乐世界=西天=西方|天宫=玉宇|月宫=蟾宫|水晶宫=龙宫|九泉=九泉之下=冥府=阴曹=阴间=黄泉|上辈子=前世=前生|下世=下辈子=来世=来生|苍龙=鸟龙=龙身|蛟龙=飞龙|凤凰=百鸟之王=金凤凰|第三世界=第三国际|国家=国度=江山=社稷|举国=举国上下=全国=通国|友邦=同盟国=盟军=盟友=盟国=盟邦=联盟|别国=外国=外域=异国=异域=异邦|邻国=邻邦|万国=列国=国际|列强=大公国=大国=强国=泱泱大国=超级大国|共和国=民主国|君主国=帝国=王国|主权国=独立国=独立国家=独立王国|合众国=联邦=邦联=阿联酋|我国=本国|省份=省区|县份=县城=版纳=试点县|乡乡镇镇=乡镇=民族乡|我省=本省|我县=本县|东洋=东瀛=支那|全州=各州|地县=市县|故都=旧国=旧都|省会=省城=省府=首府|人种=种族|中华民族=全民族=民族=部族|外族=异教=异族|蒙古族=蒙族|亲族=家族=家门|皇室=皇家=皇族=金枝玉叶|王室=王族|世家=世族=名门=望族=朱门=权门=豪门=门阀|大姓=大家族=大户=大族|家门=门户=门楣=门第|人家=家中=家园=家家=家庭|一家子=全家=全家人=合家=本家儿=阖家|书香人家=书香门第=诗书门第=诗礼之家|寒门=柴门=蓬户瓮牖=蓬门荜户|娘家=岳家|人家=婆家|人家=人烟=住家=住户=宅门=居家=村户=每户|农家=农户=农户家=庄户|大户=富户=富裕户=豪富=首富|下家=寒舍=寒门=舍下=舍间|单门独户=独门独户|工人阶级=无产阶级|党政=政党|中共=中国共产党=共产党=国共|政治=法政|党政=国政=大政=宪政=政局=新政=时政=朝政|仁政=德政=王道|暴政=苛政=虐政=霸气=霸道|冒险主义=机会主义|君主专制=帝制|代议制=多党制=议会制|专政=独裁|同化政策=国策=政策=方针=策略|公制=国际公制=国际制=米制|土制=市制=市用制|兵役制=军制=征兵制|募兵制=志愿兵制|国体=所有制|个体户=个体所有制=私人占有制=非公有制|非公有=非国有|公有=国有|体制=单式编制=建制=机制=编制|机构=组织|单位=部门|会计室=帐房=财务科|教研室=教研组|核查组=检查组=调查组|修理班=抢修班=维修班|专修班=研修班=进修班|女童班=春蕾班|补习班=辅导班|培训班=训练班|研习班=研究班=研讨班=讲习班|公关部=关系部|团伙=团体=团组织=团队=组织=集体=集团|同盟=营垒=阵线=阵营|红十字=红新月会|群体=群落=部落|黑帮=黑社会|我社=本社|嫡派=嫡系=正宗=正统派|分支=支派=支系=旁支|左派=左翼|右派=右翼|劲旅=坚甲利兵=天兵=重兵=铁流=雄兵=雄师|貔虎=貔貅|水军=水师=海军|伞兵=空降兵|人民军=国民军=子弟兵|人民解放军=红军=解放军=革命军|八路=八路军=志愿军|义军=义勇军=义师=共和军|先遣队=先锋=前锋=开路先锋|两翼=翼侧|后援=援军=救兵|激战=苦战=鏖兵=鏖战=鏖斗|死战=殊死战=硬仗=血战|堑壕战=壕堑战|闪击战=闪电战|破击战=破袭战|初战=此战=首战|奋战=苦战|内乱=内战|道家=道门|佛教=佛门=禅宗=空门|八卦教=天理教|基督教=新教=耶稣教|天主教=旧教|伊斯兰=伊斯兰教=回教=清真=清真教|印度教=婆罗门教|仪仗=仪式=典礼=庆典=礼仪|国典=大典=盛典|殡仪=繁文缛节|仪节=礼俗=礼数=礼节|多礼=形迹=无礼=礼数=礼貌|俗套=虚文=虚礼|习惯=习气=积习|习尚=新风=风习=风尚=风气|俗尚=时尚|家风=门风|世界=世道=世风=社会风气|不正之风=妖风=歪风=歪风邪气=邪气|位置=地位=身价=身分|要津=要路|上位=要职=青云=高位|名位=名分=排名分|位置=哨位=岗位=职位=职务|职守=职掌|差事=差使=职分|乌纱=乌纱帽=前程=功名=官职|头衔=职称=职衔|设计家=设计师|大宝=帝位|万户侯=侯爵|伟业=大业=宏业|同行业=本行=正业=行业=行当|七十二行=三教九流=三百六十行=九流三教=五行=农工商=各行各业|买卖=商业=商贸=小买卖=小本生意=小本经营=生意=经贸|工事=工程|水利=水利工程=水工=河工|专职=工作=差事=生业=生意=职业=营生=饭碗|专兼职=兼差=兼职|业务=事体=事务=作业=工作=政工|庶务=总务=报务|田野工作=野外工作|体力劳动=劳动=活儿=活计=活路=生活|家事=家务=家务活|手工=手活=细工|农事=农务=农活=庄稼活儿=春事|乌拉=劳役=徭役=徭役地租=苦工=苦差=苦活=赋役|动作=小动作=手脚|招数=招法=着数=路数|一举一动=举动=举措=举止=此举=行动=行径=言谈举止|善举=善事=好事=好斗=孝行|阴功=阴德=阴骘|倒行逆施=恶行|毛病=私弊=藏掖=阴私|一言一行=作为=所作所为=行为=行事=行止=表现|暴举=暴行=横行=横逆|印把子=权位=权力=权杖=权柄=权能=权限|大权=政权=政柄=统治权=领导权|兵权=军权=王权|事权=职权|产权=物权=财产权|专责=义务=总任务=总责=权责=责任|使命=千钧重负=大任=沉重=重任|任务=天职=职分=职掌=职责|己任=本分=本本分分|包袱=担子=负担|三座大山=重担=重负|会议=议会=集会|茶会=茶话会|党代会=党代表大会|代表会=代表大会|便宴=宴会=家宴=歌宴=酒会|国宴=庆功宴=盛宴=鸿门宴|喜宴=喜筵=喜酒=婚宴=满堂吉庆宴|宴席=席面=欢宴=筵宴=筵席=酒宴=酒席|素席=素酒|准则=守则=清规戒律=章法=规例=规则=规约=轨道|典章=条例=条条=章程=规章|规定=规程|绳墨=规矩|分规=定规=常规=成规|陈规=陈规陋习=陋规|公约=条约|协定=协约=协议书=存照=总协定|契约=约据|宣言书=盟约=盟誓|合同=合约|保证=保证书=责任书|条令=条文=条条框框=条款=条目=条规|刑名=法例=法度=法律=法网=法规=王法|法制=法纪=纪纲=纲纪|大法=宪法=根本法|政令=法令=法案=法治|刑事=刑律=刑法|本法=此法|律令=禁例|天条=戒律=戒条=清规戒律|刑罚=徒刑|从刑=附加刑|严刑=大刑=毒刑=酷刑=重刑|极刑=死刑=死缓=死罪|经济=财经=金融|上市=挂牌|价位=价格=价钱=标价|物价指数=盘子=行市=行情|价目=价码=报价|不变价格=可比价格=比较价格|财产=资产|动产=浮财|不动产=恒产|财富=财物|财帛=资财=金钱=钱财=银钱=长物|外财=横财=洋财|不义之财=横财=邪财|民脂民膏=血汗钱|股份=股分=股子=股金|财政资本=货币资本=金融资本|垄断资本=独占资本|红利=花红|净利=纯利|股利=股息|利息=利息率=利钱=子金=收息率|年利=年利率=年息|月利=月利率=月息|印子=印子钱=高利贷|重利=高利|宿债=积欠|货币=通货=钱币|票子=纸币=纸票=钞票|补助货币=辅助货币=辅币|毛票=角票|小钱=铜元=铜币=铜板=铜钱=铜钿|条子=金条=黄鱼|银两=银子|券别=外汇券=汇票|印花=税票|纪念邮票=邮票=邮花|联运票=通票|奖券=彩票|公债券=国债券|捐税=税利=税捐=税收=税款=税赋=税金=花消|田赋=钱粮|苛捐杂税=苛杂|租税=租金|工薪=工资=工钱=薪资|薪俸=薪水=薪给=薪金=薪饷|月工资=月薪|军饷=粮饷|津贴=补贴|待遇=报酬=酬劳=酬金|版税=稿费=稿酬|润笔=润资|佣金=佣钱=回扣=花消|脚力=脚钱|帐目=账目=账面|日记帐=日记账|明细帐=明细账=细帐=细账|头寸=款子=款项|现款=现金=现钞=现钱=码子|收支=进出|余剩=剩余=存栏=存项=盈余=结余=赢余|下欠=亏损=亏空=尾欠=窟窿=赤字|亏耗=伤耗=损耗=消耗|损益=盈亏|公共积累=公积金|罚款=罚金|储蓄=存款|头寸=银根|外快=外水|保证金=保险金=抵押金|补偿费=补偿金=赔偿费=赔偿金|补助费=补助金|工本费=成本费|修理费=维修费|电话费=通话费|代办费=代理费|教育事业费=教育费|家用=日用=生活费|伙食费=膳费=餐费=饭钱|学杂费=学费|邮费=邮资|川资=差旅费=旅差费=旅费=盘缠=路费|交通费=车费=车钱=车马费|运费=运输费|小费=茶资=茶钱=酒钱|喜钱=赏钱|月钱=零用=零用费=零用钱=零花=零花钱=零钱|优抚金=恤金=慰问金=抚恤金|双文明=文化=文明|仰韶文化=彩陶文化|教养=教育|电化教育=电教|兴学=办学|保健=卫生|主义=学说=思想=理论|唯物主义=唯物论|唯心主义=唯心论|形而上学=玄学|达尔文主义=进化论|东方学=中学=国学=旧学|墨水=学术=学问|学识=学问=文化=知识|人文科学=社会科学|论理学=逻辑学|声韵学=音韵学|文法学=语法学|医学=医术=医道|中医学=中医药学=中药学|学科=教程=科目=课程|国语课=语文课|数学课=算术课|理化=生化|外文课=外语课|体操课=体育课|中医=国医|口腔科=牙科|作业=功课=学业=课业|习题=练习|家庭作业=课外作业|考试题=考题=试题=课题|偏题=难题|卷子=考卷=试卷|号子=号码=数码=码子=编号|邮政编码=邮编|条形码=条码|号子=标志=标记=符号=记号|曲谱=谱子|逗号=逗点|惊叹号=感叹号|删节号=省略号|亲笔=文字|中国字=单字=方块字=汉字|俗字=卜辞|古字=古文=古文字|手头字=简体字=简写=简化汉字|数字=数目字|金文=钟鼎文|大篆=籀文|小篆=秦篆|今文=隶书=隶字|楷书=正书=正楷=真书|朱文=阳文|白文=阴文|别字=白字|盲字=盲文|笔划=笔画|假名=字母|书体=字体|正体=正字|篆书=篆体=篆字=篆文|工楷=楷书=楷体=正体=正字=正楷|宋体字=老宋体|草书=草体=草字=行草|小字=小楷|大字=大楷=寸楷|单字=单词=字眼|用语=词语=辞藻|字句=词句|短语=词组|词汇=语汇|褒义词=褒词|贬义词=贬词|措辞=用语|语助词=语气助词|单纯词=单词|句子=文句=语句|佳句=妙句=清词丽句=绝句|名句=座右铭=警句=语录|言语=语言|中文=华语=国文=国语=汉语=汉语言|外国语=外文=外语|土话=土语=地方话=方言=白话|国语=官话=普通话|文学语言=标准语|文学语言=文艺语言|题材=题目|主题=本题=正题|体制=体裁=样式|布局=布置=格局|情调=色彩|格调=笔调=调头=调子|俗套=窠臼=老套子=老调|作风=品格=标格=风格=风骨|文笔=笔势=笔致|歌路=球路|乐律=音律|引得=目录=目次=索引|书录=书目|子目=细目|戏目=戏码=曲目|剧目=节目|内容=始末=情节=本末|底细=细节|字字句句=字里行间|含意=味道=命意=寓意=意味|诗情画意=诗意|口吻=口气=口风=弦外之音=文章=言外之意=话音=语气|中心=中心思想=大要=要义=要点=要端=要领|提要=摘要=撮要|大纲=总纲=提纲=纲要=纲领|出言=措词=谈吐|话锋=谈锋|话头=话锋|只言片语=片言=片言只字=片言只语|至理名言=至理明言|豪言壮语=豪语|侈谈=白话=空头支票=空炮=空论=空话=空谈|大话=漂亮话=牛皮=狂言=高调|实话=心声=由衷之言=真心话=真话=肺腑之言=衷肠|床第之言=知心话=私房话=私话=私语|乡谈=家乡话|口头禅=口头语|套子=套语=客套=客套话=寒暄语=应酬话|官腔=官话=门面话|滥套子=现成话=老套子|俗话=俗语=常言=民间语|古语=老话|宿诺=约言=诺言|誓言=誓词|咒语=符咒|口诀=歌诀|指示=训示=训词=训话|劝告=忠告|忠言=真言=箴言=诤言|古训=遗教=遗言=遗训|耳旁风=耳边风|好话=婉言=婉辞=祝语=软语|好话=感言=铮铮誓言|佳话=美谈|客气话=美言=赞语|口碑=祝词=贺词=颂词|噱头=戏言=玩笑=笑话|高帽儿=高帽子|甜言蜜语=花言巧语=迷魂汤=迷魂药|冷言冷语=微词=怨言=怪话=满腹牢骚=牢骚=闲言闲语=闲话|流言=流言蜚语=风言风语|不经之谈=妄语=瞎话=胡话=谬论|奇谈怪论=怪论=怪话=海外奇谈|假话=弥天大谎=欺人之谈=谎言=谎话=鬼话|闲扯=闲话=闲谈|絮语=车轱辘话|冗词赘句=废话=赘言|下流话=恶言=恶语=猥辞=粗话=脏话|念白=说白=道白|开场白=引子|台词=戏文=戏词=词儿|回信=回话=回音|呓语=梦呓=梦话|急口令=拗口令=绕口令|口号=标语|切口=暗语=隐语=黑话|交代=供词=口供|寡言=寡言少语=少言寡语|一席话=一番话|此言=此话|提法=讲法=说法|发言=言论=议论=谈话|滥调=老生常谈=老调=陈词滥调|论调=调调|讲经说法=论道|评论=评说=评述=述评|公论=舆情=舆论|众说=杂说=街谈巷议=议论|估测=测评=评测|决议案=动议=建议=建议书=提案=提议|下结论=定论=敲定=断案=断语=结论=谈定|决定=决议=定案|勒令=号令=命令|军令=将令|指令=指示=训令=训示|上谕=圣旨=旨意=诏书=谕旨|通报=通牒=通知|告示=布告=文告=榜文=通令=通告|檄书=檄文|启事=告白=字帖=揭帖|喜报=报单|光荣榜=红榜|讣告=讣闻|呈子=呈文=咨文=报告=条陈=汇报=签呈|奏疏=奏章|便条=便笺=条子|回单=回帖=回执=回条|招子=招贴|价签=标价签=标签=浮签=竹签|小抄儿=皮带|处方=方剂=方子=药方=配方|丹方=偏方=单方=土方|成方=验方|仿单=说明=说明书|家书=家信=竹报平安|来信=来函=来鸿|回信=回音=复信=玉音|贺信=贺函|亲笔信=手书|恐吓信=黑信|公函=授信=文牍|信件=信稿=函件|举报信=检举信|感谢信=感谢状=表扬信|邀请书=邀请信=邀请函|上告信=上诉书=信访件=投诉信|加急电报=特急件|材料=素材=资料=骨材|公事=公文=文书=文件=文本=文牍=等因奉此|判决书=判词|悔过书=检查=检讨书|状子=诉状=起诉书|供状=供词=笔供|遗书=遗嘱|修改案=修正案|复印件=影印件=抄件|图形=图样=图片=图籍=图纸=图表|地图=地形图=地质图|主视图=正视图=正面图|侧视图=侧面图|俯视图=顶视图|频带=频谱|报表=表格|目力表=视力表|勘误表=正误表|坐位表=座位表|课程表=课表|作品=创作=撰述=著作=著述|大作品=巨制=巨著=鸿篇巨制|出世作=处女作|拙作=拙稿=拙笔|即兴之作=急就章|绝笔=遗书=遗作=遗墨=遗文=遗稿=遗著|墨迹=手笔=手迹=真迹|断编残简=残篇断简=片纸只字|成文=文章=稿子=笔札=篇章|社论=社评|舆论=论文|八股=八股文=制艺=时文|侧记=摘记=札记=笔记|哀辞=悼词=挽词=挽辞=祭文=祷文|碑志=碑文=碑记|墓碑=神道碑|墓志=墓志铭=铭文|行状=行述|古文=文言=文言文|白话文=语体文|实用文=应用文|叙事文=叙文=记叙文|论说文=说明文|四六文=诗作=骈文|上下文=前后文|词章=辞章|下卷=下篇|稿件=稿子|文稿=算草=草稿|初稿=原文=原稿=未定稿=长编|书稿=底子=底稿=稿本|丛书=丛刊=丛刻=文库|四书=四库=经史子集|历书=故纸=老皇历=通书=黄历|兵书=兵符|古书=古籍=旧书|典籍=大藏经=真经=经书=经典=经卷=经籍|教本=教材=教科书=讲义=读本=课本|画帖=画谱|儿童书=娃娃书=小人书=小人儿书=连环画|书背=书脊|本子=版本|孤本=珍本=秘本=秘籍|样书=样张=样本=模本=范本|原本=底册=底本=正本=蓝本|写本=副本=复本=抄本=摹本=翻刻本|书皮=书面=封皮=封面|报章=报纸|墙报=壁报|刊物=期刊=杂志|周刊=周报|专刊=专号=专栏=专辑=特刊=特辑|报刊=报章杂志|书刊=书报|前言=序文=序言=花序=题词|小引=引言|导言=楔子=绪论|本文=正文=白文|尾声=煞笔=结束语=结语|书后=后记=跋文|序跋=题跋|按语=案语=编者按=编者案|批示=批语=朱批|批注=眉批|引文=引语|注脚=注解=注释|例言=凡例|备注=备考|经典=经文|新约=旧约|文学=文艺|新文学=白话文学|口头文学=民间文学=说唱文学|小说=小说书=闲书|剧本=台本=本子=脚本=院本|散文=散记|漫笔=随笔|事略=传略=传记=文传|侧记=杂志=杂记=笔录=笔记=笔谈|纪录=纪要=记录=记要|报导=报道=简报=通讯|日志=日记|图说=图鉴|剪影=掠影=游记=纪行|访问记=采访记|诗句=诗抄=诗文=诗歌=诗章=诗篇=诗词=诗选|古体诗=古诗=古风|史诗=诗史|旧体诗=旧诗|新诗=白话诗|俚歌=歌谣=民歌=民谣=风谣|儿歌=童谣|赞歌=赞美歌=赞美诗=颂歌|即兴诗=口号|乐章=宋词=歌词=长短句=鼓子词|俳句=散曲|对联=楹联|门对=门联|春联=桃符|下里巴人=民乐|交响乐=交响诗|恋歌=情歌|哀歌=悲歌|号子=夯歌|船夫曲=船歌|乐曲=曲子|前奏曲=序曲=引子=过门儿|尾声=煞尾|小曲=小调|催眠曲=摇篮曲|歌剧=歌舞剧=舞剧|文明戏=话剧|京剧=京戏=大戏|昆剧=昆曲|婺剧=金华戏|绍兴戏=越剧|广东戏=粤剧|河南梆子=豫剧|秦腔=陕西梆子|山西梆子=晋剧|福州戏=闽剧|落子=评剧|沪剧=申曲|江淮戏=淮剧|笑剧=闹剧=闹戏|武剧=武戏|傀儡戏=木偶戏=杖头木偶|影戏=皮影戏=驴皮影|保留剧目=拿手好戏=看家戏|唱段=选段|唱腔=声调=腔调|昆曲=昆腔|二簧=二黄|龙灯=龙舞|大秧歌=跑旱船=采莲船|太平鼓=羊皮鼓|录像=影戏=影片=影视=电影|无声片=默片|动画=动画片=卡通=卡通片=木偶剧|声像=音像|映象=画面=镜头|广角镜头=慢镜头=长镜头|大鼓=鼓书|铁板大鼓=铁皮大鼓|渔鼓=道情|莲花落=落子|评书=评话=说书=说话|弹词=评弹|滑稽戏=独脚戏=独角戏|把戏=杂技=杂耍|幻术=戏法=魔术|国术=把势=把式=拳棒=武工=武术=武艺|柔术=柔道|拳术=拳脚|插图=插画|西洋画=西画|卡通=漫画|宣传画=招贴画|木刻=木版画|书画=册页=墨宝=字画=翰墨|雕像=雕刻|塑像=微雕=泥塑=泥胎|照片=相片=肖像|小影=小照|真影=神像=遗像=遗容=遗照|全家福=合家欢|形象=影像|写真=实像=画像=真影=肖像|毛病=疾患=疾病=病症=病痛=病魔=症候|沉疴=沉痼=痼疾=顽症|急病=急症=暴病|重症=险症|不治之症=死症=绝症|疫疠=疫病=瘟疫|合并症=并发症|内伤=暗伤|痨病=结核=结核病|神经病=精神病|性病=花柳病|杨梅=梅毒|血枯病=贫血|肺病=肺痨=肺结核|肋膜炎=胸膜炎|肝硬化=肝硬变|冷热病=出血热=疟子=疟疾=登革热病=风疹|绞肠痧=虎疫=霍乱|变形虫痢疾=银屑病=阿米巴痢疾|流感=流行性感冒|中暑=日射病|对眼=斗眼|针眼=麦粒肿|内障=青光眼|斑秃=鬼剃头|小儿麻痹症=痹症=麻风|荨麻疹=风疹块|湿气=湿疹|白斑病=白癜风|歇斯底里=癔病|大脑炎=暑瘟=脑炎|癫痫=羊痫风=羊角风|疯瘫=瘫痪|产褥热=月子病|盲肠炎=阑尾炎|丝虫病=粗腿病=血丝虫病|瘰疬=鼠疮|山晕=高山病|小肠串气=疝气|克汀病=呆小症|牙疳=走马疳|不孕=不孕症=不育症|失眠病=失眠症|爱滋病=艾滋病|妇女病=妇科病|旧病=老毛病|烂肠瘟=牛瘟|黑穗病=黑粉病|叶锈病=黄疸=黄锈病|伤口=创伤=外伤=金疮|带伤=有伤|伤口=创口=口子=患处|瘤子=肉瘤=肿瘤|恶性肿瘤=根瘤=毒瘤=癌瘤=癌细胞=癌肿=癌魔|头癣=瘌痢=癞癣=秃疮|汗斑=花斑癣|手癣=鹅掌风|脚气=脚癣|砍头疮=砍头痈|脓包=脓肿|胼胝=趼子|寿斑=老人斑=老年斑|痤疮=粉刺|雀斑=黄褐斑|瘊子=肉赘=臀疣=赘疣=赘瘤|圪塔=疙瘩=疹子=肿块|老茧=茧子|内阁=当局=政府|单位=机关=机构=部门|看守内阁=看守政府=过渡内阁|宫廷=庙堂=朝廷=清廷=王室=皇朝|县衙=官厅=官府=官署=官衙=清水衙门=衙署=衙门|枢机=枢要|公署=行政公署=行署|使馆=分馆=大使馆=领馆|总领事馆=总领馆|计委=计生委|宇航局=航天局|国税局=税务局|林业局=林管局|国资局=物资局|邮局=邮电局|厂子=工厂|作坊=小器作=工场|碾坊=磨坊=磨房|酱园=酱坊|总公司=总局=总店=总行=母公司|分公司=分号=分店=分行=子公司=孙公司=支店=支行|中药店=草药店=药店=药材店=药铺|药房=西药店|书局=书店=书报摊=书摊=书铺|小吃店=小吃部|茶坊=茶堂=茶室=茶楼=茶社=茶馆|典当=当铺=押当|成衣铺=时装店=服装店=裁缝店|布庄=布店|商城=杂货店=杂货铺=百货公司=百货商店=百货店=超市|浴场=浴室=浴池=澡堂=澡塘|储蓄所=存储点=钱庄=银号=银行|代办点=代理点|摄影部=照相馆|便民店=杂食店=食杂店|快餐店=快餐馆|咖啡厅=咖啡吧=咖啡店=咖啡馆|工商行=工行|营业厅=营业室|中国银行=中行|世界银行=世行|中央银行=央行|私企=非国有企业|实业=实体|全校=学堂=学府=学校=母校=该校=院所=院校|书院=学塾=家塾=村塾=村学=社学=私塾|义塾=义学|大学=高校=高等学校|附中=附属中学|普高=高中=高级中学|初中=初级中学|附小=附属小学|高小=高级小学|初小=初级小学|完全小学=完小=小学=小学校|幼儿园=幼儿所=幼稚园=托儿所|师大=师范=师范大学=师范学校|大专学校=大专院校|职业高中=职高|医学院=医科院|大职校=职大=职校|产院=妇产科|疯人院=精神病院|庇护所=救护所|休养所=休养院=干休所=康复站=疗养院|养老院=托老院=敬老院=福利院=老人院|影剧院=影戏院=影院=电影室=电影院|剧场=剧院=小剧场=戏园子=戏院=戏馆子=歌剧院|剧团=剧院=戏班=戏班子=班子=草台班=马戏团|文工团=文联=歌舞团=评剧团=豫剧团|体育场=操场=运动场|舞厅=舞场|俱乐部=文化宫=文化馆=文学社=游乐场=游艺场=画报社|博物院=博物馆|报社=报馆|无线电台=电台=转播台|联合社=联社|快慢=进度=速度|声速=音速|音势=音强|抗张强度=抗拉强度|精密度=精度|长短=高低=高度=高矮|海拔=高程|吃水=深度=深浅=纵深=进深|厚度=厚薄=薄厚|个儿=个头=个子=块头=身材=身量=身长|尺寸=长度=长短|尺寸=尺码|比例尺=缩尺|浓度=浓淡=深浅|份量=份额=净重=分量=千粒重=毛重=轻重=重量|荷重=负荷=负载=载荷=载重|响度=轻重=音量=高低|光度=灯光|工分=工资分|频段=频率段=频道|声望度=知名度|温度=热度|土温=地温|光热=热度|发火点=燃点=着火点|区间=距离=跨距=间距=间隔|总长=行程=路程=路途=里程|回程=归程=规程|振幅=波幅|多寡=多少=数据=数目=数码=数量=数额=额数|总和=总数=总额|人口=人头=人数=家口=总人口|字数=篇幅|平头=成数=整数|尾子=尾数=零数|得数=答数|乘幂=乘方=积数|偶数=双数|单数=奇数|零儿=零头=零数|函数=因变量|反函数=逆函数|因子=因数|等差级数=算术级数|几何级数=等比级数|自变数=自变量|十进对数=常用对数|无穷大=无限大|无穷小=无限小|常量=恒量|化学当量=热功当量|胃口=食量=饭量|空额=缺额|单个=单件=单科|伯仲=其次=次之=第二=老二|其三=第三=老三|一半=半截=半拉=半拉子=半数=参半=拦腰|半数以上=多半=多数=大半=大多数=左半=过半|概数=约数|上下=光景=内外=前后=左右|冒尖=出头=多种=开外=挂零=有余=有零|几何=几多=多多少少=多少=好多=若干|倍儿=倍数=公倍数=翻番|倒扣=对折=折头=折扣|比值=比率|几率=或然率=概率=票房价值|对比=比例|分之=比例=比重=百分数=百分比|数量单位=标准单位|帮子=把子=起子|嘟噜=梭子|各条=各类=各队=各项|档儿=档子|区块=回目=条块=章节|段子=段落|千伏安=千瓦|专列=车皮|一阵=阵子=阵阵|中纬度=经纬度|盎司=英两|变革=打天下=打江山=革命|起义=首义|为民除害=锄奸=除暴安良|击倒=打倒=打翻=推倒=推翻=赶下台|翻身=解放|勾心斗角=斗心眼=斗法=明争暗斗=钩心斗角|兄弟阋墙=内乱=内讧=同室操戈=煮豆燃萁=祸起萧墙=窝里斗|争奇斗艳=百花争艳|反抗=对抗=抗议|上台=初掌帅印=当家做主=登台=登场=粉墨登场=组阁=袍笏登场|加冕=即位=登基=黄袍加身|承袭=禅让=继位|南面=称孤道寡=称帝=称王|当家作主=当家做主|独霸=称王称霸=称霸|割据=封建割据=称雄|下台=下野=倒台=倒阁=在野|让位=退位=逊位|变法=变法维新=改良=维新|存亡=救亡=救亡图存=救国=救国救民=断绝=毁家纾难=赴难|闭关自守=闭关锁国|压服=弹压=超高压=镇住=镇压=高压|剿除=清剿=肃反=镇反|兴师问罪=吊民伐罪=征伐=征讨=讨伐|围剿=平叛=平定=平息=扫平=扫荡=敉平=绥靖|夺取=攘夺=篡夺|窃国=篡位=问鼎|倾覆=颠覆|倒算=变天=复辟=翻天=翻天覆地=颠覆|出卖=叛卖=吃里爬外|卖国=叛国=私通=通敌=里通外国|卖国求荣=卖身投靠=投敌=认贼作父|募兵=征丁=征兵=招兵=招兵买马|抽丁=抽壮丁|武备=武装=装备=装设=配备|动员=誓师|检阅=阅兵|交火=兵戈相见=兵戎相见=接火=接触=短兵相接=赤膊上阵|动干戈=动武=宣战=开仗=开战=开火=用武|挑战=求战|出战=后发制人=应战=应敌=迎头痛击=迎战|奋战=孤军作战=孤军奋战=浴血奋战=血战|恶战=打硬仗=激战=苦战=酣战=鏖兵=鏖战|一决雌雄=决一死战=决战=背城借一=背水一战|南征北战=纵横驰骋=转战|内乱=内讧=同室操戈=火并|干戈四起=干戈扰攘=混战=群雄逐鹿|好战=穷兵黩武|上岸=登岸|强行军=急行军|督军=督战|出击=强攻=抢攻=攻击=攻打=进击=进攻|围击=围攻|内外夹攻=分进合击=合击=夹击=夹攻|冲击=冲刺=冲锋=冲锋陷阵=厮杀=拼杀|乘胜追击=穷追猛打=追击|不可抗力=招架不住|反击=反戈一击=反扑=反攻=回击=杀回马枪=还击|侍卫=保卫=卫护=护卫=捍卫|布防=设防|换防=调防|戍边=边防|卫戍=戒备=警卫=警备|屯兵=屯扎=留驻=进驻=驻守=驻屯=驻扎=驻防|安营扎寨=宿营=扎营|执勤=放哨=站岗|巡回=巡查=巡行=巡视=巡逻|发射=射击=打靶|开枪=打枪=枪击=鸣枪|开炮=打炮=放炮=炮击=炮轰=轰击|回击=还击|投弹=狂轰滥炸=空袭=轰炸|刺杀=拼刺=拼刺刀=肉搏|扫雷=排雷=探雷|伏击=埋伏=打埋伏=设伏|侵袭=掩杀=袭击=袭取|欲擒故纵=突击=闪击|截击=拦击=狙击=邀击=阻击|兜抄=包抄=抄袭=迂回|乘其不备=偷营=偷袭=掩袭=突袭|引敌他顾=调虎离山|内应=接应=策应=里应外合|打掩护=掩护=断后|牵制=犄角|侦察=侦探=刑侦|包围=合围=围住=围困=围城=围城打援=围魏救赵|冲破=打破=杀出重围=突围|喧扰=扰乱=窜扰=肆扰=袭扰=骚扰|占据=盘踞=龙盘虎踞|光复=克复=取回=收复|围剿=围歼=聚歼|击毁=摧毁|俘获=俘虏=扭获=擒拿=擒敌=活捉=生俘=生擒|截获=收缴=收获=缴枪=缴械=缴获=虏获|反正=归降=投诚=投降=缴械=解缴=降服=降顺|乞降=请降|佯降=诈降|割地=割让|俯首称臣=归心=归附=归顺|招安=招抚=招降|治治=治理=治监=经纬=经纶|励精图治=安邦定国=施政=治世=治国=治国安民=治国安邦=经纶天下|办理=操办|承办=经办=经手=过手|一手包办=包办代替|代办=代劳=代庖=代理=署理=越俎代庖|筹划=筹办|分理=清理=理清=踢蹬|掌管=治治=治理=管事=管治=管理=管管=经营|保管=军事管制=治本=田间管理=管住=管制=管理|综合治理=综治|经理=经纪=经营|公办=公立=公营=国办=国立=国营=官办|民办=私立=私营|惨淡经营=苦心经营|营业=运营|专营=主营|自主经营=自营|交待=安排=安置=安顿=铺排|安排=布局=布置=部署=配备=配置|调动=调整|调剂=调节=调试|划拨=划转=核拨=调拨|调兵遣将=调派=调遣=调配=选调|整改=整治=整肃=整顿=整饬|收编=改编=整编|分发=分派=分配|使唤=支使=支派|指名=指定=点名|另起炉灶=建立=成立=树立=白手起家=确立=起家|建国=开国=立国|奠都=定都=建都|立宪=立法|建业=建功立业=成家立业=立业=立户=置业|搭设=架起|协办=合办|举办=兴办=办起=开办=开设=设立=设置|开拓=开辟=打开|初创=草创|创始=始创=首创|标新立异=独创=独树一帜=独辟蹊径=自我作古|创下=创出|为名=取名=命名=定名=起名儿|废止=废除=废黜|免予=免去=免掉=免除=罢免=解除=豁免|解散=遣散|一笔勾销=一笔抹杀=一风吹|下发=发出=行文=颁发|发放=发给|分发=散发|发证=颁证|告假=续假=请假|主办=主持=主管=拿事=掌管=牵头|带队=带领=引领=提挈=率领=统率=统领=领队|执掌=掌握|总理=总统=管辖=统制=统御=统摄=统辖=节制|占据=垄断=总揽=把持=收揽=独占=独揽|召集=招集=集合|出榜=发榜=张榜=揭榜|责令=责成|勒令=喝令=强令|令行禁止=言出法随|兴师动众=动员=劳师动众=发动=总动员=掀动=掀腾=鼓动|倡导=倡议=发起=提倡=首倡|召唤=号召=呼唤=唤起=感召=振臂一呼|召回=唤回|一呼百应=响应|呼叫=呼唤|建言献计=建议=提议=纳谏|商议=审议=座谈=探讨=研讨=讨论=议事=议论|决断=商定=处决=定局=定案=拍板|确定=规定|确认=肯定=认可=认定|否决=否定=推翻|创制=制定=制订|拟定=拟就=拟订=草拟|报了名=挂号=注册=登记|报到=登录=签到=记名|报失=挂失|报名=提请=申请|投考=报考|交代=交卷=交差|伪报=浮报=虚报|回报=回禀=回话=复命|具名=签名=签字=签定=签约=签署=署名|押尾=画押=签押|加盖=打印=盖章|圈阅=批阅|批复=批示|签注=签证|不准=严令禁止=取缔=明令禁止=来不得=查禁=禁止=禁绝|屡禁不止=屡禁不绝=禁而不止|弛禁=解禁|查明=查证=检察=考察=调查=调研=踏勘=踏看|察明=查清|审定=审验=把关=核准=核实=检定|寓目=过目|自审=自查=自纠自查|初查=收审|严查=查询=查问=盘查=盘根究底=盘问|联查=联检|监察=监控=监理=监督=督察=督查|监视=蹲点|监场=监考|查点=检点=清点=清账=盘账=过数|唱名=点卯=点名|考评=裁判=评判=评定=评比=评议=贬褒=鉴定|考勤=考核=考绩|嘉奖=奖励=奖赏=褒奖=记功=论功行赏=评功论赏|发奖=授奖=颁奖|头彩=重彩=金质奖|信赏必罚=奖惩=奖罚=赏罚|表彰=表扬=褒扬|判罚=处分=处罚=惩办=惩罚=论处=责罚=重罚|开除=除名=革除|反省=检查=检讨=自我批评|公推=推举=推选=选举=选出|挑选=甄拔=选拔=遴选|提升=提干=提拔=提挈=擢升=擢用=晋职=栽培|延聘=延请=招录=特聘=聘任=聘用=聘请|敦聘=礼聘|征聘=招聘=招贤=招贤纳士=聘选=选聘|征募=征召=征集=招兵买马=招募=招收=招生=招用|委任=委派|分封=加官进爵=封爵=授职=授衔|册封=册立|封妻荫子=荫袭|斥退=清退=罢免=罢官=罢黜=靠边儿站=黜免|贬斥=贬谪=贬黜|用活=雇佣=雇工=雇用=雇请|炒鱿鱼=解聘=解雇=辞掉=辞退|下任=卸任|接任=接办=接手=接替=接班=继任|交代=交割=交卸=交接=交班=移交|做事=办事|公出=出勤=出差|值勤=值日=值星=值班=当班=轮值|值夜=夜班=守夜|巡夜=查夜|出巡=巡幸|喝道=开道=清道=鸣锣开道|修建=修筑=兴修=大兴土木=建筑=建造=构筑=组构|动土=动工=施工=破土=破土动工|营建=营造|改建=改造|翻修=翻盖|基建=基本建设|架构=架设|敷设=街垒=铺就=铺砌=铺设|养护=护养|放置=码放|安上=安装=安设=装置=设置|组建=组装|抹灰=涂刷=粉刷|喷漆=油漆|点缀=装修=装潢=装点=装璜=装裱=装饰|制作=制造=打造=炮制=筑造=造作|酿制=酿造|仿制=仿造=克隆|再生=再造=还魂|掺假=掺杂使假=造假|电弧焊接=电焊|冶炼=冶金=炼制=熔炼|打铁=锻压=锻打=锻造|拉制=拉延|回炉=炼化=熔化=熔断=熔融|淬火=蘸火|提制=提炼=提纯=纯化|裂化=裂解|错金=镶金|印染=印花|编制=编织|抽丝=缫丝|排字=排版|付排=发排|出版=问世|刊行=发行|再版=重版|勘察=勘查=勘测=勘验=查勘=考量=踏勘|勘探=探矿=钻探|开矿=开采=采掘=采矿=采采|修浚=宣泄=疏导=疏开=疏浚=疏通|治水=治水改土=治理|防汛=防洪|浇地=浇水=浇灌=灌溉=灌输|劈山=开山|垦殖=垦荒=开垦=开荒=拓荒|屯垦=屯田|开发=开拓=开辟|种地=种田=稼穑|耕作=耕地=耕种=耕耘|平地=平整=整地|匀播耧=秋耕=耦耕|深耕细作=精耕细作|刀耕火种=火种刀耕|间作=间种|套作=套种|连作=重茬|倒茬=轮作=轮种|催青=春化|下种=播种|撒种=点播=点种=种籽|栽植=栽种=植苗=种养=种植|培植=栽培|定植=移栽=移植|扦插=插条|培土=翻地|嫁接=接穗=枝接=芽接|打杈=整枝|条施=沟施|挠秧=耕田=芟除=锄草=除草|打场=脱粒|打鱼=捕鱼=渔捞=渔猎|垂钓=钓鱼|养活=牧畜=畜牧=饲养|催肥=肥育=育肥|养殖=养育=培养=放养=繁育|去势=阉割|宰割=宰杀=屠宰|出产=推出=搞出=生产=盛产|交易=贸易|商品流通=流通=通商|出口=输出|入口=输入=进口|入股=投资=斥资=注资|合股=集资|募股=招股|做广告=兜揽=招徕=招揽=揽客|明码=标价|易货=讨价还价=议价=讲价|开价=要价=讨价|加价=哄抬物价=抬价|压价=杀价=砍价|成交=拍板|买断=收买=收订=收购=购回|定货=定购=订座=订货=订购=预订=预购|函购=邮购|打药=抓药|出卖=出售=发售=售卖=贩卖=趸售|倒卖=倒手=倒腾=购销|售货=行销=销售=销行|兜售=兜销=推销|经售=经销|发行=批发=批销=批零=联销|零卖=零售|寄卖=寄售|处理=拍卖=甩卖|出倒=出盘=招盘=盘店|出让=转让|出手=出脱=脱手|待价而沽=炒买炒卖=炒卖|卖出=卖掉=售出|紧俏=走俏|出租=招租=租借=租售=租赁|出顶=包租=转租|承租=租下=租借=租用=租赁|创利=创汇=扭亏=扭亏为盈=扭亏增盈=扭亏解困=营利=赚钱|居奇牟利=渔利=牟利=谋利|分红=分配|捞本=翻本|兑换=换钱|兑付=兑现|借款=拆借=放债=放款=贷款|举借=举债=借债=借款=借贷=告贷=筹借=筹资|东挪西借=垫补=挪借=挪用=通融|借支=入不敷出=透支|减利=降息|拉亏空=拉饥荒=欠债=欠帐=欠资=背债=负债=负债累累|挂帐=欠账=赊欠=赊账|索债=要帐=讨债=讨账=讨还=追回=追索|偿付=偿还=折帐=还债=还款=还贷|典当=典押=押当|抵押=质押|抵债=抵账|包赔=赔付=赔偿|赔帐=赔款|理赔=索赔|征收=征缴=执收=清收|收款=收贷=收费|上交=上缴=交纳=呈交=缴付=缴纳|交款=交费=缴费|上税=交税=完税=收税=纳税=缴税|付出=开发=开支=开销=支付=支出|交账=付帐=付款=会帐=给付=计付|垫付=垫款|付清=付讫|两讫=收讫|催讨=追交=追缴|划价=计费|偷漏税=偷税=偷逃税=漏税=逃税=避税=骗税|拨付=拨款|入帐=记帐|查帐=盘帐|核销=销帐|实报实销=报帐=报销|盘存=盘库=盘点=盘货|积攒=积淀=积累=积聚=累积=聚积|积储=积蓄=蓄积|消费=花消=花费|损耗=消耗=磨耗=耗费|枉费=白费|抖搂=旷费=浪费=糜费=糟踏=荒废|奢侈浪费=悖入悖出=挥霍=暴殄天物=糟蹋|撙节=省去=省掉=节省=节约|抽出=挤出=腾出|十足=够用=足够=足足|平衡=抵消=相抵|下剩=余下=剩下=剩余=多余=盈余=结余=节余|下存=现存=留存=结存|亏欠=亏空=亏累|亏损=亏耗|亏本=亏蚀=赔本|不足=供不应求=僧多粥少=欠缺=相差=粥少僧多=贫乏=阙如|挂一漏万=漏掉=疏漏=脱漏=遗漏|驾驭=驾驶|出车=开车=驱车=驾车|拉客=拉脚=捎脚=搭客|代步=搭乘|奔驶=疾驶|宇航=航空=飞行|上水=上溯=上行|下水=下行|巡弋=巡航=游弋|划桨=划船=摇船=泛舟=竞渡=翻浆=行船|旅行=行旅=远足|出外=出行=外出=远门|出远门=远征=远涉重洋=远行=长征=飘洋过海|涉水=翻山越岭=跋山涉水=跋涉=长途跋涉|舟车=车马=鞍马|同行=同路|出国=出境=出洋=离境=过境=远渡重洋|兼程=赶路=趱行|抄小路=抄近儿=抄近路=抄道|绕圈子=绕远儿=绕道|引水=引航=领江=领港|导航=领航|运载=运输=运送|河运=漕运|押车=押运=押送|历经=经由=经过=行经=路过=途经|穿越=穿过=越过=通过|摆渡=渡河=航渡|拐弯=拐弯抹角=转弯|急弯=急转弯|开走=撤出=撤离=离去=离开=背离=走人|滚开=滚蛋=走开|离乡=离乡背井=离家=背井离乡=远离|回到=回去=回来=归来=赶回=返回|叶落归根=回乡=落叶归根=返乡=还乡|荣归=荣归故里=衣锦还乡|倦鸟投林=回家=打道回府=返家=还家=金凤还巢|折回=折返=撤回=转回=退回=重返|复归=复返|到达=抵达|下碇=停泊=抛锚|循循善诱=诲人不倦=谆谆教导=谆谆教诲|安居乐教=安居而乐教|传授=口传心授=授受=灌输=相传=衣钵相传|为人师表=以身作则=演示=现身说法=示例=示范=言传身教|启发=启示=启迪=开导=诱发=诱导|发蒙=启蒙|指导=指点=点化=点拨|发聋振聩=唤起=唤醒=抛砖引玉=提拔=提示=提醒|因势利导=引导=指引=指点迷津|上装=假扮=化装=扮成=扮装=装扮|下装=卸妆=卸装|修养=修身=修身养性=养气|录像=拍摄=拍照=摄像=摄录=摄影=照相=留影|测距=调焦|暴光=曝光|冲洗=显影=洗印|录音=灌音|上映=公映=播出=播映=放映|广播=播发=播报=播放=播讲=播送=播音=放送|教养=管教=管束=调教=辖制|教训=训导=训话=训诫|以儆效尤=告诫=提个醒=警告=警戒=警示|传习=教学=讲习|教练=训练|勤学苦练=操演=操练=演习=练习=练兵|吊嗓子=练嗓子|演武=练功=练武|练出=练就|强身健体=强身健魄|实验=尝试=试行=试验|测验=考查=考试=试验|大考=期考|下场=应考=应试=赶考|会试=春试|发出=发射|复习=复课=温习=温书=温课|自习=自修=自学=进修|实习=见习|勤工俭学=勤工助学=半工半读|取长补短=用长避短|不求甚解=囫囵吞枣=生吞活剥|复读=重读|从师=受业=执业=投师=拜师|留学=留洋=镀金|旷课=逃学=逃课|开卷=披阅=涉猎=翻阅=读书=阅览=阅读|默诵=默读|看报=读报|查看=查阅=翻动=翻开=翻看|宣读=朗诵=朗读=讽诵=诵读|吟咏=吟唱=吟诵=咏叹=哼唧=沉吟|一唱一和=唱和=唱酬=步韵=酬和|吟诗=诗朗诵|背书=背诵=记诵|大书特书=大写=大处落墨=奋笔疾书=小写=题写=题诗|填充=填入=填写=填空|代笔=捉刀|亲笔=手书|临帖=临摹=描摹=摹写|写道=划拉=划线=涂抹=涂鸦|抬头=提行|笔录=著录=记下=记录|笔记=简记=速记|手写=手记|摘录=摘抄=摘由=摘要=摘记=节录=选录|附笔=附言=附记|分解=解说=解释=训诂=诠释=说明=释疑|注解=注释=笺注=诠注=诠释|引用=引证=引述=征引=援引=援用=摘引=旁征博引|引经据典=用事=用典|参照=参看=参考=参见=参阅|介绍=说明|标出=标号=标明=标注|圈点=断句=标点|分析=剖析=剖解=条分缕析=浅析=解析=辨析|切磋琢磨=字斟句酌=推敲=推磨=斟酌=琢磨=锤炼|去伪存真=去粗取精|切磋=研究=研讨=钻研|探究=探索=探讨=探赜索隐=推究=根究=深究=追究|咬文嚼字=抠字眼儿=钻牛角尖|查考=考据=考究=考证|分拣=分类=分门别类=归类|下结论=小结=总结|推导=推求=推演=推理=演绎|举一反三=以此类推=依此类推=类推=类比=触类旁通|拟稿=拟议=草拟=起稿=起草|布局=搭架子|动笔=执笔|完稿=杀青=汗青|杜撰=编造=臆造=虚拟=虚构|叠床架屋=堆砌=寻章摘句=舞文弄墨=雕砌|作曲=谱写=谱曲|作诗=吟风弄月=嘲风咏月=赋诗|合写=合编=合著|作出=编成|翻译=通译=重译|译音=音译|缀辑=编写=编制=编排=编撰=编次=编纂=编辑|剪接=剪辑=摘录=编录=辑录|增补=拾遗=拾遗补阙=补正=补遗|审校=校准=校对=校改|校勘=校核=校正=校订=校阅|修饰=增辉=润色=润饰=点染|修正=匡正=更正|呈正=指正=斧正=雅正|删改=删繁就简=删节|删减=删去=删除=刨除=剔除=去除=芟除=除去|改错=纠错|修订=审订=考订|勘误=正误=订正|作画=写生=描画=描绘=点染=画画=绘画|传真=写真=画像|勾勒=勾画|上色=着色=设色|作图=制图=打样=绘制=绘图|镂花=雕花|临床=医治=医疗=治疗=治病=看病=诊治=诊疗|听诊=诊察=诊视|确诊=诊断|切脉=号脉=把脉=按脉=诊脉|救死扶伤=行医|就医=就诊=看病=诊病|求医=求治|急救=急诊=抢救=救护=救治|杀菌=消毒|刮痧=揪痧|修复=修补|消炎=消肿|打针=注射|扎针=针刺|补液=输液|种牛痘=种痘=种花|动手术=开刀|配方=配药|下药=投药=施药=用药|接产=接生|人工流产=人流=刮宫=堕胎=打胎|上演=公演=卖艺=演出=演艺=献技=献艺=表演|跑龙套=配戏|会演=汇演|试演=预演|打出手=武打=短打|上台=上场=出台=出场=出演=登台=登场=鸣锣登场|下台=下场|彩排=排戏=排演=排练=演练|串演=扮作=扮演=装扮=饰演|唱歌=歌咏=歌唱=讴歌|引吭高歌=欢歌=高唱=高歌|悲歌=长歌当哭|哼唧=哼唱|对口=对唱=对歌|变调=移调=转调|婆娑起舞=翩然起舞=翩翩起舞=翩跹起舞=舞蹈=起舞=跳舞|歌舞=轻歌曼舞=载歌载舞|作乐=吹打=奏乐=演奏|击节=打拍子=拍板|发球=开球|封网=拦网|踢球=蹴鞠|打拳=练拳|溜冰=滑冰|冲浪=击水=游水=游泳|海豚泳=蝶泳|下棋=博弈=对局=对弈=着棋|交锋=比试=比赛=竞技=竞赛=较量|赛马=跑马|争衡=决一胜负=决一雌雄=夺标=打擂台=摆擂台=见高低|奥林匹克=奥运会|争奇斗艳=争妍斗丽|见分晓=见雌雄|夺魁=胜利|卫冕=蝉联|交接=交游=会友=相交=神交=结交=结识=缔交|交好=亲善=修好=友善=和睦相处=相好=通好|套交情=套近乎=拉交情=拉关系=拉近乎=搞关系|为人处事=作人=做人=处世=待人接物=立身处世|相与=相处|友邻=睦邻|借助=凭借|上门=登门|回拜=回访|参拜=参见=参谒=拜见=晋见=晋谒=谒见=进见|上朝=朝见=朝觐=觐见|探望=探视=探访=探问=省视=看望=看看=细瞧|探亲=省亲|串亲戚=走亲戚|约集=邀集|约定=说定=预定=预约|稿约=约稿|履约=应邀=赴约=践约|一言为定=一诺千金=守信=守信用=言而有信=说到做到|作数=算数|实践=践诺=还愿|失约=爽约=破约=负约=违约|翻脸=闹翻|出迎=欢迎=迎候=迎接=迎迓|喜迎=夹道欢迎=笑脸相迎=迎宾|伴同=伴随=奉陪=陪伴=陪同=随同|为伴=作伴=作陪=做伴=相伴|接送=迎送|欢送=送别=送客=送行|饯别=饯行|告别=告辞=拜别=辞别=辞行|伫候=伺机=听候=守候=拭目以待=等候=等待=虚位以待|少待=稍候|坐待=坐等|扫地出门=赶走=赶跑=驱赶=驱逐=驱遣|容留=收养=收容=收留|挽留=款留|待遇=招待=接待=款待|对待=待遇=相待=看待|优待=厚待=宽待=恩遇=礼遇|凌虐=肆虐=虐待|对付=应付|走过场=过场=逢场作戏|祝愿=祝福=祝颂|庆贺=恭喜=祝贺=道喜=道贺|庆祝=欢庆|团拜=恭贺新禧=拜年=贺岁=贺年=贺春|拜寿=祝寿=纪寿|暖房=闹新房|致意=致敬=请安=问候=问好=问安=问讯|上书=修函=写信=来信=致信=致函=通信=鸿雁传书|下帖=发信=寄信=投书=投送|函复=回信=回函=复信=复函|信汇=汇寄=汇款=电汇=邮汇|付邮=邮发=邮寄=邮递|投递=递送|发报=发电=打电报=拍电报=电告=致电|打电话=挂电话=通电话=通话|做声=则声=吭声=吭气=启齿=吱声|哩哩罗罗=噜苏=废话=费口舌=赘言=赘述|旧调重弹=炒冷饭=重提|吞吐=吞吞吐吐=含糊其辞=吭哧=支吾=支支吾吾=闪烁其辞|仗义执言=和盘托出=开门见山=直抒己见=直言=直言不讳=直说|一吐为快=倾倒=倾吐=倾诉=倾谈=吐诉|诉说=陈诉|哗众取宠=巧言如簧=摇唇鼓舌=能说会道=花言巧语=调嘴弄舌=鼓舌|多嘴=插口=插嘴=插话|接茬=搭理=搭腔=搭讪=搭话=答茬儿|有说有笑=欢谈=笑语=耍笑=说笑=谈笑=谈笑风生|人机会话=会话=对话|侈谈=唱高调=夸夸其谈=高谈阔论|坐而论道=放空炮=空口说白话=空谈=纸上谈兵=说空话|叙旧=话旧|叙别=话别=道别|交口=交谈=叙谈=搭腔=攀谈=过话|晤谈=面议=面谈|泛泛而谈=浅说=清谈|交心=促膝谈心=娓娓而谈=娓娓道来=恳谈=谈心=长谈|倾心吐胆=倾谈=畅叙=畅所欲言=畅谈|漫话=漫谈=纵谈|断言=预言|说三道四=说长道短=说闲话=闲言闲语|冷言冷语=吹冷风=泼冷水|侃侃而谈=慷慨陈辞|一语破的=一语道破=一针见血|一言以蔽之=总之=总的说来=总而言之=总起来讲|欢声笑语=欢歌笑语|致词=致辞|拉三扯四=神聊=说东道西|发言=演讲=演说=讲演|论说=论述=阐发=阐述=阐释|列举=历数=数说=毛举细故=点数=罗列=胪列=论列|叙说=叙述=平铺直叙=描述=讲述|胪陈=陈言=陈说=陈述|前述=慷慨陈词=细说=详谈=详述|敷衍=缕述=缕陈=铺叙=铺陈|称述=述说|忆述=记述=追叙=追述|叙写=记事=记叙=记载|声明=声称=声言=宣示=宣称=扬言|写实=写真|示意=表示|吹风=放风|丢眼色=使眼色=授意=暗示|发挥=发表=抒发=致以=表达=表述|抒怀=抒情=抒情畅怀|发明=申明=申说=申述=表明=说明=阐发=阐明|剖白=表白|吐露=披露=表露=说出=透露|发誓=宣誓=盟誓=立誓=誓死=赌咒=起誓|告知=告诉=奉告=报告|回禀=禀告|晓示=晓谕|传言=传话=传达=转告=转达=过话|测报=预告=预报|告警=报警|告捷=报捷|透风=通风报信|丁宁=交代=叮咛=叮嘱=嘱事=嘱咐|介绍=引见=牵线=穿针引线|撮合=说合=说说|保媒=做媒=提亲=说亲=说媒|保举=保荐=保送|毛遂自荐=自告奋勇=自荐|冒头=抛头露面=照面儿=露头=露面|出台=出名=出头=出头露面=出面=出马|代替=代表=取代=取而代之=指代=替代=顶替|替班=顶班|发问=叩问=咨询=提问=讯问=问讯=问话=问问|查询=查问=询问|盘根究底=盘诘=盘问=细问=问长问短|诘问=追询=追问|反诘=反问|喝问=诘问=责问=质问=问罪|质疑=质疑问难=质询=质问|报请=请命=请示|对簿=对证=对质|卖狗皮膏药=自卖自夸=自吹自擂=自夸=自诩|吹嘘=标榜=树碑立传=美化=鼓吹|夸大=夸大其词=夸大其辞=夸张=夸耀=浮夸=虚夸=言过其实|凭空捏造=妖言惑众=蛊惑人心=谣言惑众=造谣=造谣中伤=造谣惑众=飞短流长|放冷风=放空气=放风|不说=背着=闭口不谈=隐匿=隐瞒=隐秘|掩盖=掩饰=讳莫如深=讳言=遮掩=遮盖=遮羞=隐讳|打埋伏=打掩护|搽脂抹粉=文过饰非=文饰=涂脂抹粉=矫饰=粉饰=粉饰太平|保密=守口如瓶|揭发=揭底=揭开=揭破=揭秘=揭露=点破|戳穿=抖搂=拆穿=揭短=揭穿=揭老底=说穿|引咎=引咎自责=自咎=自我批评=自责|求全责备=苛责|声讨=申讨=谴责|开炮=批评=放炮=针砭=针砭时弊|批判=揭批|反驳=批驳=驳倒=驳斥|一棍子打死=一笔勾销=一笔抹杀=一笔抹煞=勾销=抹杀|口诛笔伐=大张挞伐=抨击=挨斗=掊击=攻击=鞭挞|承认=确认=肯定=认可=认同=认账|认命=认罪=认输=认错|不认帐=否定=否认=矢口=矢口否认|抵赖=狡赖=矢口抵赖=赖债=赖帐=赖皮=赖账|干涉=干预=过问|探明=摸清=摸透|探口气=探察=探路=试探|乞援=告急=呼救=求助=求援=求救|告饶=求饶=讨饶|哀告=哀求=央求|征得=征求=征询|乞哀告怜=乞怜=摇尾乞怜|付托=信托=嘱托=委托=寄托=托付|央托=托人=托人情=拜托|求情=缓颊=美言=讨情=讲情=说情=说项|奉送=捐赠=赠与=赠予=赠给=赠送=馈赠=馈送|借花献佛=转赠=转送|送人情=送礼|回礼=回赠=还礼|赏赐=赐予|互通有无=投桃报李=礼尚往来=赠答|捐献=白送|呈献=奉献=孝敬=贡献|朝贡=进贡|捐给=献给|呈送=呈递=递交=递给=面交|传送=传递=转交=转送|付费=付钱|提取=领到=领取|借出=借用|借给=出借=放贷=贷出|吐出=清退=赔还=退回=退掉=退赔=退还|串换=互换=交换=对调=掉换|偷天换日=偷梁换柱=掉包|更换=更替|传接=传送=传递|酬劳=酬宾=酬报=酬答=酬谢|答谢=谢恩|报偿=报答=报经=结草衔环=补报|致歉=赔不是=赔小心=赔礼=赔礼道歉=赔罪=道歉|忍让=推让=礼让=让给=谦让=辞让|让位=让座|让路=让道|服软=让步=退让=退避三舍|将就=迁就|交涉=折冲樽俎=讨价还价=谈判|会商=会谈|商洽=接洽=洽商=洽谈=面洽|和平谈判=和谈|允许=同意=容许|回绝=婉拒=婉言谢绝=婉辞=敬谢不敏=谢却=谢绝=辞谢|借口=假托=托辞=推三阻四=推托|推卸=推委=推脱=推诿=溜肩膀=踢皮球|委罪=归咎=归罪|激励=激发=激扬=鼓劲|规谏=进言|劝止=劝退=劝阻|劝慰=安慰=安抚=慰藉=抚慰=温存|嘘寒问暖=慰劳=慰唁=慰问=抚慰=犒劳=犒赏=问寒问暖|互助=互帮互助=互济=相濡以沫|救急=雪中送炭|帮衬=捐助=补助=资助|与人为善=积德=行善=行善积德=行好=行方便|作成=周全=圆成=成人之美=成全=玉成|助威=助战=呐喊助威=捧场=摇旗呐喊|帮腔=撑腰=支持=敲边鼓|打下手=跑腿|救人=救命=救生|扑救=扑火=救火=灭火|救活=活命|接应=救应|出点子=出谋划策=出谋献策=建言献策=摇鹅毛扇=献策=献计|伴伺=伺候=侍候=侍奉=侍弄=服侍|医护=守护=护养=护理=照护=看护|保安=保护=保障=卫护=护卫=掩护=维护|保镖=保驾|护身=防身|收养=认领|抱养=领养|养活=养育=扶养=抚养=拉扯|保育=抚育=护养|供养=供奉=养老=奉养=菽水承欢=赡养|从命=奉命=遵命=遵奉|背弃=背离=背道而驰=违反=违拗=违背|犯忌=触犯=违犯|对抗=抗命=抗拒=抵制=违抗|过奖=过誉|丑化=抹黑=搞臭|倒打一耙=反咬一口|分说=分辨=分辩=辩白=辩解|巧辩=强辩=狡辩=胡搅=诡辩=鼓舌|座谈=讨论=议论=讲论=谈论=谈谈|公议=公论|信口雌黄=妄下雌黄=强作解人|街谈巷议=议论纷纷=说短论长=说长道短|叫骂=叱骂=唾骂=斥骂=责骂=骂街=骂骂咧咧|痛骂=破口大骂=臭骂|咒骂=诅咒|叱喝=怒斥=怒骂|呵斥=呵责=申斥|漫骂=笑骂=诟骂=谩骂=辱骂|对骂=骂架|回嘴=强嘴=还嘴=顶嘴|又哭又闹=叫嚣=吵闹=哭闹=大吵大闹=有哭有闹=起哄=骂娘|闹别扭=闹意见|作对=顶牛儿|动武=拳打脚踢=挥拳=殴打=殴斗|击伤=打伤|劝架=劝解=拉架=解劝|折服=收服=降伏=驯服|以理服人=疏堵=说动=说服|怀柔=拉拢=收买=收拢=收揽=牢笼=笼络|夤缘=如蚁附膻=攀缘=攀附=攀龙附凤=趋奉=趋炎附势=趋附|投其所好=迎合|偏向=偏护=偏袒=向着=左右袒=左袒|姑息迁就=牵就|娇纵=放纵=纵令=纵容|姑息=姑息养奸=宽纵|破罐破摔=自暴自弃|打马虎眼=欺上瞒下=欺瞒=瞒上欺下=瞒天过海=蒙哄=蒙混=蒙蔽|惑人耳目=故弄玄虚=糊弄=迷惑|偷天换日=偷梁换柱|掩目捕雀=掩耳盗铃=瞒心昧己=自欺欺人|坑人=骗人|上下其手=做手脚=做鬼=弄鬼=捣鬼=搞鬼=耍花样|冒犯=冲撞=冲犯=唐突=得罪=触犯=顶撞|激怒=触怒|抓辫子=揪辫子|劳神=劳驾=困扰=找麻烦=添麻烦=烦劳=费事=麻烦|免开尊口=堵嘴=阻断|封路=挡路=阻路|扯后腿=拉后腿=拖后腿|拆台=拆墙脚=挖墙脚|撒刁=撒泼=撒赖=耍无赖=耍流氓=耍赖=耍赖皮|引逗=招惹=挑逗=逗弄=逗引|凑趣儿=打趣=打趣逗乐=逗乐儿=逗笑=逗笑儿=逗趣=逗趣儿|任人摆布=拨弄=摆布=摆弄=播弄|主使=指使|勉为其难=勉强=强人所难|劫持=强制=挟制=挟持=胁持=裹胁=要挟|吓唬=哄吓=威吓=恐吓=恫吓=惊吓=诈唬|威慑=威胁=威逼=胁从=胁迫|核威慑=核威胁|侮慢=侮辱=凌辱=折辱=污辱=糟践=糟蹋|放暗箭=暗害=暗算=暗箭伤人=杀人不见血=算计=计算=谋害|下药=鸩毒|乘人之危=打落水狗=投井下石=落井下石=落井投石=趁火打劫|为害=危害|为虎作伥=为虎傅翼=助桀为虐=助纣为虐=帮凶|损坏=破坏=糟蹋=败坏|坏事=帮倒忙=误事|侵害=侵犯=侵蚀=侵越|毒害=流毒=荼毒=蛊惑=麻醉|浸蚀=腐蚀=销蚀=风剥雨蚀|复仇=报仇=算账|公报私仇=官报私仇|以牙还牙=报复=睚眦必报=穿小鞋|回报=报恩|昭雪=申雪=雪冤|搭伙=搭伴=搭帮=结伴=结对|为伍=拉帮结派=招降纳叛=结伙=结党营私|拜把子=拜盟=结拜|同盟=拉帮结伙=歃血为盟=歃血结盟=结盟=联盟|一刀两断=断交=绝交|作鸟兽散=拆伙=散伙|为生=度命=求生=立身=糊口=营生=谋生|混居=群居=聚居|小住=暂住=暂居=落脚|作客=侨居=客居=寄寓=寄居=寓居=旅居=流落|安家=安家落户=定居=落户|幽居=归隐=蛰伏=蛰居=闭门谢客=隐居|露宿=露营|家居=赋闲=闲居|东奔西走=东奔西跑=东跑西颠=居无定所|乡规民约=风俗|动迁=外移=搬迁=迁徙=迁移|乔迁=喜迁=挪窝儿=搬家=移居=迁居|打发=消磨=虚度=鬼混|度过=渡过=走过|度日如年=苦熬|虚度=虚度年华=蹉跎|涉世=经历=经验=阅世=阅历|亲历=躬逢|做寿=做生日=过生日|独立=独立自主=自主=自立|自力=自力更生=自给有余=自给自足=自食其力|仰人鼻息=依附=俯仰由人=寄人篱下=看人眉睫=身不由己|任人宰割=受人牵制=受制于人|得过且过=混日子|吃现成=吃现成饭=吃闲饭=尸位素餐=无所事事=素食=素餐|依托=依赖|亡命=流亡=逃亡|投亲靠友=投奔=投靠|奔忙=奔波=奔波如梭=奔走=跑前跑后=鞍马劳顿|走南闯北=走江湖=跑江湖=闯江湖=闯荡江湖|劳累=操劳|偷空=偷闲=忙里偷闲=抽空|卧薪尝胆=自励=自勉=自强=自强不息|争先创优=评先创优|偏废=抛荒=荒废=荒疏|偷懒=偷闲=怠惰=躲懒|避重就轻=避难就易|偷安=偷生=苟且=苟且偷生=苟全=苟全性命=苟安=苟活|承继=继嗣=过继|代代相承=传承=承受=承继=承袭=继承|上工=上班=出勤=出工|共事=同事|单干=唱独脚戏|从业=在业|劳务=劳动=服务|加班=加班加点=开快车=突击=赶任务|怠工=消极怠工=磨洋工|夜战=开夜车=打夜作=挑灯夜战|打杂=打杂儿=摸爬滚打=跑腿儿=跑龙套|做好=办好=善为=抓好=搞好=搞活=盘活|办到=办成|协作=南南合作=合作=搭伙=搭档=经合=通力合作|试办=试工=试看=试飞|临时抱佛脚=临渴掘井=临阵磨枪=抱佛脚|放马后炮=贼去关门|赶时髦=赶浪头=赶潮流|留一手=留余地=留后手=留后路=留底=留有余地|养痈成患=养痈遗患=养虎遗患=后患无穷=放虎归山=留后患=纵虎归山|谋福利=造福=造福一方|伸张=发扬=发扬光大=弘扬=恢弘|光前裕后=光大=光宗耀祖=增光=增光添彩=增色添彩|增色=生光=生色|亵渎=污辱=玷污=玷辱=蝇粪点玉=辱没|亡羊补牢=弥补=挽救=补救|困兽犹斗=垂死挣扎=挣命=挣扎|冒险=孤注一掷=虎口拔牙=铤而走险=龙口夺食|拼命=拼死拼活=玩儿命=豁出去|守节=节烈|变节=失节|专事=专司=从业=从事=致力=转业=转产|侧身=厕足=厕身=存身=投身=置身|入伙=加入=加盟=参加=投入=进入|入席=即席=各就各位=就位=就席|混入=混进=混迹|剥离=洗脱=淡出=脱离=脱胶=退伙=退出|退伍=退役|脱节=脱钩|不到=缺席=缺阵|找事=求业=求职=谋事=谋生路=谋职|做工=做活儿=干活儿|扛活=扛长活=揽工|打短儿=打短工=打零工|农务=务农=犁地=种地=种田=种粮|做生意=经商|跑单帮=跑码头|任教=执教|从医=行医|弃文就武=投笔从戎|出家=剃度=削发=遁入空门|入行=出道|从政=做官|卷铺盖=告退=辞却=辞去=辞职=退职|去职=离任=离职|功成引退=功成身退=引退=急流勇退=抽身=解甲归田=退隐=隐退|告老=告老还乡=离休=离退休=退休=退居二线|充任=充当=出任=勇挑重担=常任=担任=担纲|不负=尽职尽责=独当一面=胜任|任职=供职|一身两役=兼任=兼差=兼职=兼顾|招致=搜罗=收罗=网罗=罗致|甄拔=选材|择交=择友|取样=抽样|取长补短=截长补短=扬长补短=扬长避短=用长避短=趋长避短|纵观=纵论=综观=通观|向前看=展望=瞻望|看破=看穿=看透=透视|可比=同比=比拟=比起=比较=相形之下=较之|分别=区分=区别=工农差别=有别=有别于=界别=组别|开门揖盗=引狼入室|私用=自用|享用=受用|零用=零花|用于=用以=用来|套用=沿用=萧规曹随=袭用|因循=因袭=承袭=沿袭=率由旧章=蹈袭=陈陈相因|照搬=生吞活剥=生搬硬套|称称=称量=过磅=过秤|比量=计计=计量|核算=核计|折算=换算|妙算=掐算=能掐会算|演算=运算|七拼八凑=东拼西凑=凑合=并拢=拼凑=拼接|分等=四分开=均分=平分=平均=等分|一分为二=中分=分块=分片=平分秋色|分担=分摊=分派=平摊=摊派|分为=分成|出资=出钱=慷慨解囊=掏腰包=掏钱=解囊|凑份子=筹集|下床=起床=起来=起身|上床=安息=安歇=就寝=歇息=睡眠=睡觉|假寐=小睡=打盹儿=打瞌睡|午睡=歇晌|休工=歇工|乘凉=凉快=歇凉=纳凉|滋补=药补=补养|剃头=推头=整容=理发|梳头=梳理|烫发=烫头|修面=刮脸|化妆=妆饰=打扮=美发=美容=装扮|修饰=梳妆=梳洗|描眉=描眉画眼=画眉|归拢=归着=归集=理顺|整装=治装|张罗=操持=料理=经纪=调停=调理|以防不测=准备=备灾=备而不用=备选=有备而来=未雨绸缪=预备|制备=张罗=筹划=筹备=筹措=筹组|带入=带走=拖带=挟带=携家带口=携带=随带|拉家带口=拖家带口|尾随=紧跟着=跟随=追随=随从=随行|赶场=赶集|出外=出远门=出门=去往=外出=飞往|出亡=出奔=出走|溃散=溃逃|卷逃=席卷而逃|抱头鼠窜=流窜=窜逃=逃奔=逃窜|溜之乎也=溜之大吉=溜号=溜走|逃命=逃生|逃出=逃离|畏避=躲避=躲闪=退避=闪躲=闪避|盯住=盯梢=跟踪=钉住|寻踪=蹑踪=追踪|倾箱倒箧=翻箱倒柜|储备=存贮=贮备|保存=保留=封存|存档=归档|库存=库藏|储蓄=储贷=存款=联储|修修补补=修补=织补=缝缝补补=缝缝连连=缝补=补缀=补补|刺绣=扎花=挑花=绣花|沿边儿=滚边|穿针=纫针|晾晒=曝晒|上灯=掌灯=明灯=点火=点灯|打火=点火=烧火=燃爆=生火=笼火=钻木取火|引燃=点燃=燃放=燃点|火化=烧化=焚化|加温=加热|取暖=暖和|烧火=着火|烹制=烹调=烹饪|下厨=做饭=煮饭=起火|泡茶=烹茶|做菜=小炒|拉丝=拔丝|回炉=回笼=回锅|品味=品尝=尝尝=尝试=遍尝|尝新=尝鲜|垫补=点心=点补=点饥|充饥=果腹|吃饭=就餐=开饭=用膳=用餐=进食=进餐|下饭=佐餐|吃素=素食=素餐|吃荤=打牙祭=肉食|偏食=挑食|哺乳=喂奶|会餐=聚餐|大宴宾客=宴请=接风洗尘=设宴=请客=飨客|作东=做东|接风=洗尘|劝酒=敬酒|划拳=打通关=猜拳|展出=展览|捉迷藏=藏猫儿|猜谜=猜谜儿=破谜儿|三峡游=城乡游=春游=游园=踏青=郊游=野营|游荡=游逛=转悠=逛荡=逛逛=闲荡=闲逛|作乐=取乐=声色犬马=寻欢作乐=行乐|抓阄儿=抽签=拈阄儿|婚恋=恋爱=相恋=谈恋爱=谈情说爱|求偶=言情=追求|提亲=求亲=求婚|吊膀子=调情|偷情=偷香窃玉=窃玉偷香|幽会=幽期=约会=花前月下|受聘=定亲=定婚=攀亲=订婚|匹配=喜结良缘=换亲=男婚女嫁=结亲=缔姻=联姻=通婚|娶亲=讨亲=迎娶|纳妾=续弦|出嫁=出门子=出阁=嫁人=嫁娶=过门|改嫁=转嫁|再婚=再嫁|上门=倒插门=入赘=招亲=招女婿=招赘|离婚=离异|退亲=退婚|抹脖子=自刎|上吊=吊死=悬梁=自缢|投井=投河|丧葬=办丧事=治丧|吊丧=吊唁=吊孝=奔丧|入殓=大殓=收殓=殡殓=装殓|出殡=发送=殡葬|执绋=送丧=送殡=送葬|下葬=入土=入土为安=土葬=埋葬=安葬|火化=火葬|水葬=海葬|殉葬=陪葬=随葬|带孝=戴孝=穿孝|上坟=扫墓=祭扫|参见=参谒=拜谒=瞻仰|祝福=祭天=祭拜=祭祀|蠢动=蠢蠢欲动|寻衅=找上门=挑衅=衅寻滋事|乱来=胡搅=胡搅蛮缠=胡来=胡闹=造孽|肆无忌惮=肆行=胆大妄为=胡作非为|假造=捏合=捏造=无中生有=杜撰=编造=胡编=虚构|伪托=借此=假借=假公济私=假托=冒名=冒名顶替=盗名欺世|欺世惑众=欺世盗名=沽名钓誉|摆摊子=摆阔=摆阔气|摆样子=摆谱=摆门面=耍排场=装潢门面=装门面|撑场面=撑门面|拿架子=搭架子=摆架子|逞强=逞能=逞英雄|卖乖=卖弄聪明=自作聪明|布鼓雷门=班门弄斧|任性=任意=使性子=耍脾气=逞性=闹脾气|意气用事=感情用事|拾荒=捡破烂儿|乞讨=乞食=行乞=要饭=讨乞=讨饭|上去=上来|一哄而上=一拥而上=蜂拥而上|下去=下来|到来=来临=来到=赶到=赶来=过来=驶来|接踵而来=接踵而至=源源而来=纷至沓来=蜂拥而来|前去=前往=转赴=过去=通往|奔赴=开往=开赴=赶往=赶赴|一怒而去=拂衣而去=拂袖而去|出去=出来|跻身=进入=进去=进来|注入=流入|升堂入室=登堂入室|出入=进出|入出境=进出境|失口=失言=说走嘴=走嘴|鲁鱼亥豕=鲁鱼帝虎|点金成铁=画虎类狗=画蛇添足|失职=渎职=玩忽职守|犯禁=犯规=违禁=违章|弄清=搞清=正本清源=清淤=澄清=疏淤=辟谣|反客为主=喧宾夺主|曲解=歪曲=篡改|拨乱反正=改正=纠正|矫正=纠偏=补偏救弊|真伪=真假=真真假假|乘风破浪=破浪前进=长风破浪|昂首阔步=阔步前进|弥撒=弥散=祈愿=祈祷=祈福=祷告|礼拜=顶礼膜拜|礼拜=跪拜|祝福=赐福|巡礼=朝圣=朝拜=朝觐|供奉=拜佛=敬奉|烧香=焚香|吃斋=斋戒|念佛=念经=讲经说法=诵经|修行=修道=尊神=苦行|传教=传道=布道=说教=说法|募化=化缘|嗟来之食=布施=施舍|点化=炼丹|拆字=测字|相面=看相|占梦=圆梦|卜卦=占卦=算卦|保佑=呵护=庇佑=荫庇|举报=告发=告密=报案=揭发=检举|告状=指控=控告=控诉=状告|上告=上诉|叫屈=喊冤=喊冤叫屈=抗诉=申冤=申雪|打官司=诉讼=词讼=辞讼|投案=自首|交待=供认=供认不讳=招认=认罪|不打自招=交代=坦白=招供=松口=自供|抄家=搜查=查抄|抄身=搜身|幽禁=幽闭=软禁|劳动改造=劳改=劳教|一网打尽=抓获=抓走=拿获=捕获=擒获=破获=缉获|密押=扭送=押解=押送=解送|升堂=审案=审讯=审问=讯问=问案=鞫讯=鞫问|再审=复审|判案=审判=审理=断案|传讯=提审|开庭=过堂|刑讯=屈打成招=打问=拷问=逼供|公判=判决=宣判=裁决=裁判=裁定=裁断|判刑=判处=判罪=定罪=论罪|定案=定责|处刑=量刑|严惩=严惩不贷=重办|以一警百=惩一儆百=惩一警百=惩前毖后=惩戒=杀一儆百=杀鸡吓猴|上刑=严刑=动刑=拷打=用刑|五马分尸=车裂|夷族=株连九族=灭族|充公=抄没=没收=罚没|封门=封闭=查封|剥夺=禁用=褫夺|游街=示众|下放=充军=刺配=发配=放流=放逐=流放|偿命=抵命|临刑=处决=处死=明正典刑=正法=行刑=镇压|枪决=枪毙=毙伤|开刀=斩首=杀头|大赦=特赦=赦免|免刑=免罪=免责|徇私枉法=有法不依=枉法=贪赃枉法|执法犯法=明知故犯=知法犯法|放火=纵火|劫持=绑架=绑票|劫机=持机|断路=路劫|一抢而空=劫掠一空=哄抢=洗劫=洗劫一空|趁人之危=趁火打劫|偷鸡摸狗=鼠窃狗偷|窝藏=窝赃|干掉=杀死=结果|下毒手=凶杀=杀人越货=杀害=残害=残杀=灭口=行凶|下毒=放毒=毒杀|自相残害=自相残杀=自相鱼肉|刺杀=暗杀=行刺|劈杀=大屠杀=屠戮=屠杀=杀戮=血洗|卖淫=卖身=招蜂引蝶|偷人=同居=姘居=私通=苟合=通奸|奸污=奸淫=强奸=诱奸=鸡奸|猥亵=玩弄=调戏|耍钱=赌博=赌钱|压宝=投注|打头=抽头|中饱私囊=受惠=受贿=纳贿=贪赃=贪赃枉法|上下其手=作弊=做手脚=徇私舞弊=舞弊=营私=营私舞弊|以权谋私=开后门=徇情=徇私=放水=猫儿腻|依葫芦画瓢=剽取=剽窃=剿袭=抄袭|克扣=揩油|勒索=敲竹杠=敲诈=敲诈勒索=讹诈|坑蒙拐骗=打秋风=抽风=秋风|坑骗=拐带=拐骗=诱拐|行骗=诈骗|剥削=宰客=敲骨吸髓=盘剥|买空卖空=投机=投机倒把|走漏=走私=走私贩私|发亮=天亮=天明=拂晓=旭日东升=破晓|日上三竿=晴好|夜幕低垂=天暗=天黑=迟暮|夕阳西下=日薄西山|春光明媚=风和日丽=风和日暖|云开日出=云消雾散=放晴=雨过天晴|刮风=起风|习习=扑面=拂面|春风料峭=萧瑟=萧萧|狂风怒号=飞沙走石=飞砂走石|下雨=天不作美=天公不作美=掉点儿=普降=降水=降雨|大雨如注=滂沱|暴风骤雨=风狂雨骤|凄风苦雨=风雨交加=风雨凄凄=风雨如磐=风风雨雨|下雪=大雪纷飞=降雪|降霜=霜降|打闪=闪电|打雷=雷电=雷电交加=雷轰电闪=雷鸣=雷鸣电闪=霹雳|起雾=雾气腾腾=雾腾腾=雾蒙蒙|冒烟=浓烟滚滚=烟雾弥漫|怒涛澎湃=惊涛骇浪=汹涌澎湃=波涛汹涌=波涛滚滚=洪流滚滚=起浪|投射=映射=映照=炫耀=照临=照射=照耀=辉映|烛照=照亮=照明=生辉|光照=日照=普照|倒映=反光=反射=反照=相映成辉|辐射=辐照|交相辉映=晖映|映出=照见|折光=折射|发亮=发光|金光闪闪=金闪闪|作响=叮当=呜咽=响起=鼓乐齐鸣|呼啸=咆哮=啸鸣=巨响=轰鸣|放炮=爆炸=爆裂|炸掉=炸毁=炸裂|焚烧=燃烧|付之一炬=烧毁=焚毁|开锅=沸腾=滚沸|乱跑=挥发=蒸发|溶化=溶解|化入=消融=溶入=溶化=溶溶=融化=融注=融解|冷却=制冷=气冷=降温|上冻=冰冻=冷冻=冷凝=冻结=凝冻=封冻=结冰|化冻=开化=开河=解冻|朽烂=糜烂=腐化=腐朽=腐烂=腐败|发霉=霉烂|掉色=脱色=落色=褪色=走色=退色|添丁=生产=生儿育女=生养=生育|双生=孪生|待产=足月|临产=临盆=分娩=分蘖=分身|坐月子=坐蓐|小产=流产|出世=出生=坠地=落地=落草=诞生=降生|发育=生长=见长|成人=成才=成材=成长=长进|出息=出挑=出脱=出落|长大=长成|传宗接代=增殖=滋生=生息=生殖=繁殖=繁衍=蕃息|下蛋=产卵|孵化=孵卵=抱窝|发福=发胖|健在=在世=活着=生存=生活|回生=生还|升天=圆寂=坐化=物化=羽化|兰摧玉折=夭亡=夭折=早逝=英年早逝|一息尚存=半死=濒死|复明=清醒=睡醒=苏醒=醒来|入梦=入梦乡=入眠=入睡=安眠=成眠=睡着|沉睡=熟睡=睡熟=酣梦=酣然=酣睡=鼾睡|休眠=蛰伏|打盹=瞌睡|夜不能寐=失眠=寝不安席=目不交睫=辗转反侧|喝西北风=嗷嗷待哺=挨饿=食不果腹=饥肠辘辘=饥饿=饿饭|口渴=干渴=焦渴=舌敝唇焦|嘴馋=垂涎欲滴=贪吃=贪嘴=饕餮=馋涎欲滴|烂醉如泥=酩酊=酩酊大醉=醉醺醺|呃逆=嗝儿=嗳气=打嗝儿=饱嗝儿|喷嚏=嚏喷|呵欠=哈欠=微醺=打呵欠=打哈欠|出恭=大便=大解=拉屎|下泄=便秘|小便=小解=排泄=撒尿=泌尿=起夜|尿床=尿炕=遗尿|上解=便溺=净手=大小便=更衣=解手|出冷汗=盗汗|便血=来潮=行经|云雨=交媾=人道=同房=性交=行房|交尾=交配=杂交=配对|梦遗=遗精|大肚子=妊娠=怀孕=怀胎=有喜=有身子=身怀六甲|受孕=受精=受胎|不得劲=不快=不爽=不适=无碍=难受=难过|发病=犯病=犯节气|不安=欠安|病笃=病重|临危=临终=垂危=垂死=濒危|受伤=挂彩=挂花=负伤|体无完肤=皮开肉绽=遍体鳞伤=重伤|灼伤=烧伤=烧灼|伤亡=死伤|刺伤=杀伤|大好=康复=治愈=病愈=痊愈=药到病除=起床=霍然|回春=好转=有起色=见好|伤愈=合口=愈合=收口|复活=复生=死而复生=起死回生=还魂|刺挠=刺痒=发痒=痒痒=瘙痒|酸溜溜=酸软|作痛=火辣辣=生疼=疼痛=触痛=隐隐作痛|心绞痛=狭心症|水肿=浮肿=肿大|发胀=头昏脑胀=气臌=水臌=滞胀=肿胀=腹胀=鼓胀|存食=食积|咳嗽=干咳|孕吐=害喜=胎气|吐血=呕血=咯血|下泻=拉稀=拉肚子=水泻=泻肚=腹泻=跑肚=闹肚子|伤风=受凉=受寒=感冒=着凉=着风|发痧=受暑=受热|发寒热=发烧=发热=发高烧|高烧=高热|头昏眼花=昏花=目眩=看朱成碧=眼花=雾里看花|休克=窒息=虚脱|不省人事=昏倒=昏厥=昏迷=昏迷不醒=晕倒=晕厥=痰厥|说胡话=谵妄|不仁=发麻=酥麻=麻木=麻木不仁=麻痹=麻酥酥|偏瘫=半身不遂=截瘫=瘫痪=脑瘫=风瘫|下痿=单瘫|心悸=心跳=怔忡=惊悸|血亏=贫血|堵塞=壅塞=栓塞=梗塞|肠套叠=肠梗阻=肠阻塞|出血=大出血=崩漏=流血=血崩=血流如注|化脓=溃烂|倒嗓=喑哑=嘶哑=失音=沙哑|失聪=耳沉=耳背=重听|失明=瞎眼|口吃=期期艾艾=磕巴=结巴|佝偻=水蛇腰=驼背|结出=结实=结果=结荚|吐穗=孕穗=打苞=抽穗|受粉=受精|出芽=发芽=吐绿=抽芽=滋芽=萌动=萌发=萌芽|欢笑=笑笑|嫣然一笑=微笑=满面笑容=眉欢眼笑=粲然一笑=莞尔=面带微笑|发笑=失笑=忍俊不禁|干笑=强颜欢笑=苦笑|暗笑=窃笑|奸笑=皮笑肉不笑=笑里藏刀|傻乐=傻笑=哂笑=憨笑|笑吟吟=笑呵呵=笑哈哈=笑嘻嘻=笑盈盈=笑眯眯|嘻嘻哈哈=嬉皮笑脸=嬉笑|含笑=喜眉笑眼=眉开眼笑=笑容可掬=笑容满面=笑逐颜开|哭丧着脸=哭哭啼啼=哭鼻子=啼哭|声泪俱下=挥泪=洒泪=流泪=涕零=潸然泪下=落泪|以泪洗面=泪如泉涌=泪如雨下=泪流满面=泪痕斑斑=痛哭=老泪横流=老泪纵横|含泪=泪汪汪=热泪夺眶=热泪盈眶=珠泪盈眶|红潮=红脸=脸皮薄=脸红=赧然=赧颜=面红耳赤|卖俏=搔头弄姿|传情=暗送秋波=眉来眼去=眉目传情=脉脉传情|发嗲=扭捏=撒娇|嗲声嗲气=娇滴滴=娇里娇气|兴叹=叹息=叹气=咳声叹气=唉声叹气=嗟叹=太息=长吁短叹|仰天长叹=浩叹=长叹|哀叹=悲叹|沉默=沉默寡言=缄默=静默=默不作声=默然=默默不语=默默无言|人困马乏=仆仆风尘=力尽筋疲=声嘶力竭=疲惫不堪=精疲力竭=风尘仆仆|恹恹=懒散=懒洋洋=有气无力=没精打采=精神不振=蔫不唧=软弱无力|垂头丧气=暮气沉沉=死气沉沉=死沉=萎靡不振=蔫头耷脑=颓唐|板脸=绷脸|怒目=横眉怒目=瞪眼|喘喘气=喘嘘嘘=喘息=气吁吁=气咻咻=气喘吁吁=气急=气短|哮喘=喘气=气喘=痰喘|屏息=屏气|装傻=装疯卖傻=装糊涂|佯死=假死=装死=装熊=诈死|下垂=低下=低垂=悬垂=放下=耷拉|凸起=崛起=突出=突起=隆起=鼓起=鼓鼓=鼓鼓的|凹陷=塌陷=穹形=陷落|一丝不挂=精光=裸体=赤条条=赤裸裸=赤身裸体|打赤膊=赤背=赤膊|打赤脚=科头跣足=赤脚=赤足|披盖=掩盖=蒙面=被覆=覆盖=遮住=遮盖=遮荫|伸进=奋翅展翼|伸展=展开=张大=舒展=舒张=铺展|伸直=挺直|收拢=收缩|挛缩=瑟缩=蜷缩=龟缩|伸缩=舒卷|张合=翕张|倒下=倒塌=倾倒=倾覆=坍塌=塌架=崩塌|坍方=塌方|天坍地陷=天塌地陷|弄坏=损坏=毁伤=毁坏=毁损=毁掉=破坏=磨损|崩裂=炸掉=爆裂=迸裂|折断=断裂|停放=放置|存放=存放在=寄存=寄放|吊放=吊起=悬垂=悬挂=挂到=昂立=浮吊=高悬|位列=列支=班列=罗列=陈列=陈放|布置=布阵=摆布=摆放=摆设=陈设|平列=排列|列为=名列=排定|分布=散布=遍布|堆放=堆积=堆积如山=积聚|冲积=沉积=淤积=淤积物|天女散花=散落|迸射=飞溅|喷发=喷射=喷洒=喷涂=喷涌=喷溅=迸发=高射|泛滥=溢出=漫溢|淋漓=滴滴答答=滴答|浸入=浸泡=浸渍|淹没=溺水=灭顶|下沉=下浮=下移=击沉=沉底=降下|下陷=沉井=沉没=沉淀=沉陷=没顶=陷没=陷落|磁悬浮=磁浮|横流=流动=流淌=绿水长流|涓涓=潺潺|沸腾=滔天=滚滚=翻滚=翻腾|滑动=滑行=滑跑|匀速运动=等速运动|简谐运动=谐振|动作=动弹|双人跳=扑腾=跳动|周转=运作=运行=运转|回环=弯弯=旋绕=盘曲=缭绕=萦回=萦绕|一骨碌=滚动=滴溜溜转=轮转=骨碌|回身=转身|润泽=润滑=滋润|接触=沾手=触及=触发|冤家路窄=狭路相逢=狭路相遇|不期而遇=偶遇=巧遇=萍水相逢=邂逅=邂逅相逢|久别重逢=旧雨重逢|交臂失之=失之交臂=擦肩而过=相左=错过|吹拂=抗磨=摩擦=磨光=磨蹭|依附=嘎巴=屈居=沾满=附上=附着=黏附|透气=透风=通气=通风|渗漏=渗透|渗出=渗水=漏水|漏风=透风|漏光=透光|漏气=透气|交界=分界=接壤=毗连=毗邻=邻接|偎依=相依=紧贴=紧靠|临界=压境=旦夕存亡=迫近=逼近|偏离=相差=相距=离开=距离|分隔=相间=相隔|回环=围绕=拱卫=拱抱=环抱=环绕=盘绕=缠绕|包围=重围|前呼后拥=簇拥|交融=扭结=纠结|交加=交叉=立交|交错=犬牙交错=纵横=阑干|超载=超重=过重|传导=传输=输导|一脉相传=沿袭=流传=衣钵相传|传说=哄传=相传=风传|以讹传讹=谣传=谬种流传|大行其道=时兴=流行=盛行=风行=风靡|蔚成风气=蔚然成风|相沿成习=约定俗成|承上启下=承先启后=承前启后=承接=承载|组网=连网|纠缠=绕组=缠绕|积压=郁积=郁结|与世隔膜=凝集=切断=割裂=隔断=隔离=隔绝|奏效=收效=生效=立竿见影=见效|失效=失灵|点缀=装点|存亡未卜=未决=未定=没准儿|已婚=成家|求同克异=求同存异|一统天下=世界一统|三位一体=统一体|分崩离析=分裂=四分五裂=土崩瓦解=崩溃=支解=瓦解=解体|分道扬镳=各奔东西=各奔前程=各持己见=各自为政=各行其是=各谋其政|各执一词=同床异梦=离心离德=貌合神离|不辞而别=离乡背井=离京=背井离乡|久别=久违=阔别|永别=永诀|取齐=汇总=汇流=汇集=聚齐=集中|三五成群=凑数=凑足=凝聚=密集=成群结队=攒三聚五=麇集|啸聚=总汇=纠合=纠集=结社|云集=济济一堂=群蚁附膻=荟萃=集大成=鸾翔凤集|四散=星散=风流云散=飘散|天各一方=离散|劳燕分飞=妻离子散=鸾飘凤泊|如鸟兽散=树倒猢狲散|排尾=殿后|击中=击中要害=切中=命中=打中=枪响靶落=歪打正着=猜中|循序渐进=渐进=由浅入深=稳中有进=稳中求进=稳步前进|实施=实行=实践=履行=执行=推行=施行|奉行=推广=施训=普及=遵行|举行=召开|定稿=杀青=汗青=脱稿|出手=得了=脱手|促成=兑现=奋斗以成=实现=心想事成=落实=贯彻|延误=愆期=耽搁=耽误=误工=违误=迟误|因循=延宕=拖延=拖锚=耽搁=蘑菇=迁延|任满=期满=满期|到时=到期=到点=届时=届期=截稿|晚点=脱班=误点=超时=过期=逾期|亡羊补牢=来得及=犹为未晚=赶得及=赶趟|不及=不迭=为时已晚=措手不及=来不及=赶不及|受得了=吃得住=吃得消=禁得住=禁得起=经得起|不堪=受不了=吃不住=吃不消=架不住=禁不住=禁不起=经不起|享乐=享清福=享福=纳福|受罪=受苦=吃苦=吃苦头=遭罪=风吹日晒|受益=得益=沾光=讨巧|占便宜=捡便宜=讨便宜=贪便宜|不劳而获=吃现成=吃现成饭=坐享其成=坐收渔利=无功受禄=渔人得利|受益匪浅=获益匪浅|互利=互惠|上当=上钩=受骗=吃一堑=蒙在鼓里|吃亏=吃哑巴亏|发家=发家致富=发财=发迹|发大财=发横财=暴发=暴富|多灾多难=祸不单行=避坑落井=雪上加霜|走头无路=走投无路|不好=不得了=糟糕|借水行舟=借风使船=因势利导=趁势=顺势=顺水推舟|一筹莫展=内外交困=山穷水尽=束手无策=毫无办法=焦头烂额|折磨=折腾=揉搓=煎熬=磨难|万世流芳=万古留芳=声名鹊起|名誉扫地=扫地=臭名昭彰=臭名远扬=身败名裂=遗臭万年|下岗=丢饭碗=失业=待业=待岗=无业=砸饭碗=赋闲|丢官=免职=罢官|左迁=贬低=贬职=降格=降级=降职|与世沉浮=升升降降=升贬=升降=沉浮=浮沉|中选=入选=当选=相中=膺选=选中=选为|中式=及第=折桂=榜上有名=考中=考取=蟾宫折桂=金榜题名|名落孙山=落榜=落第=落聘=落选|受累=黑锅|李代桃僵=背黑锅|平反=昭雪=洗冤=洗刷=洗雪=申冤=雪冤|受奖=得奖=获奖|受罚=受过=抵罪|束手就擒=落网=被捕|受宠=得势=得宠|坐冷板凳=失宠=打入冷宫|吃闭门羹=扑空|一鼻子灰=打回票=碰壁=碰钉子|自寻烦恼=自找麻烦=自讨没趣=自讨苦吃|断后=断子绝孙=无后=绝后|孀居=守寡=寡居|受灾=遭灾|闹灾荒=闹饥荒|一片汪洋=发水=山洪暴发=水漫金山=泛滥成灾=雨涝|决口=开口子|深受其害=祸从天降=遭殃|中弹=饮弹|遇刺=遇害|发火=失慎=失火=走火=起火|漏电=电击=走电=跑电|失盗=失窃|迷失=迷航=迷路=迷途|下落不明=不知去向=失踪=渺无声息=走失|不见踪影=无影无踪=杳如黄鹤=杳无音信=杳无音讯=销声匿迹=音信全无|不翼而飞=不见=丢失=丢掉=散失=有失=遗失=遗落|出乱子=出事=出岔子=惹是生非=惹祸=肇祸=酿祸=闯祸|召祸=招灾惹祸=捅娄子|得救=获救=遇救|片甲不存=覆没=覆灭|四面楚歌=插翅难飞=腹背受敌=被围|失守=失陷=沦陷=陷落|亡国=沦亡=灭亡|成败=胜负=胜败=输赢=高下|倒闭=停歇=停闭=关张=关门=关门大吉=关闭=闭馆|停业=歇业=毁于一旦|打垮=搞垮|东窗事发=图穷匕见=败露|原形毕露=显形=现形|大白=水落石出=真相大白|外泄=泄漏=泄露=漏风=走漏=走漏风声=走风=透漏|兜底=泄底=露底|失密=失机=泄密|折价=损失=海损=破财|亏欠=亏空=亏累=拖欠=缺损|一石多鸟=上算=事半功倍=划得来=划算=占便宜=合算=经济|一举两得=一箭双雕=多快好省|杀鸡取卵=涸泽而渔=竭泽而渔|失策=失计|坐失良机=失之交臂=失时=失机|欠产=歉收|下手=入手=动手=着手|上工=兴工=动工=开工|始业=开学|开业=开市=开拔=开篇=开赛=开饭|启动=启航=开动=开行=起先=起动=起步|发车=开车|出航=启碇=开航=扬帆=拔锚=起碇=起航=起锚|起航=起飞|启运=起运|开幕=揭幕|开台=开场=开演|萌动=萌发=萌生=萌芽|入冬=入夏=入春=入秋|住手=善罢甘休=歇手=甘休=用尽=罢休=罢手|作罢=罢了|休会=散会=闭会=闭幕|剧终=散场=终场=落幕|卒业=毕业=结业|下工=下班=收工=放工|下操=收操|下学=放学|售完=售罄=脱销=销售一空|停滞=停滞不前=僵化=撂挑子=驻足|关门=打烊|煞车=熄灭|停战=停火|住口=住嘴=绝口|望而止步=驻足不前|展开=开展=拓展=进展=进行|双管齐下=并举=齐头并进|光阴荏苒=无以为继=流逝=荏苒=蹉跎|寒来暑往=年复一年=春去秋来=物换星移|周而复始=大循环=巡回=循环=循环往复=轮回|小循环=微循环|嬗变=演化=演变=衍变|事过境迁=情随事迁=沧海桑田=移花接木|剧变=急变=急转直下=愈演愈烈=突变=面目全非=骤变|渐变=潜移默化=默化潜移|变质=蜕变=质变|一反常态=变脸=变色=翻脸|变味=霉变|变样=走样|化为=化作=变为=变成=成为=改为=改成|欧化=西化|交替=倒换=掉换=更迭=替换=调换=轮换|交换=包换=包退=换成=换换=置换=鸟枪换炮|改天换地=旋转乾坤=星移斗换=更新换代=移风易俗|改弦易辙=改弦更张|改元=改朝换代|改行=跳行|化名=改名=改名换姓=改性=易名=更名|改口=改嘴|壮大=恢宏=恢弘=扩充=扩大=扩展=扩张=推而广之|加大=拓宽=推广=放大=放开=日见其大|体膨胀=微涨=暴涨=暴胀=猛涨=线膨胀=膨大=膨胀|滋蔓=蔓延=迷漫|延伸=延绵=延长=拉开|抽缩=收缩=缩合|压缩=简缩=紧缩=缩小|冷缩=抽水=浓缩=缩水=缩短=缩编|浸润=浸湿=浸透=湿邪=濡染|丰富=加上=助长=增长=抬高=日益增长=添加=累加|叠加=增大=外加=附加|与日俱增=递加=递增|乘以=倍加=倍增=加倍=双增长=成倍|升值=增值|添枝加叶=添油加醋|填平补齐=拾遗=拾遗补阙=补遗|弥缝=弥补|减半=扣除=折半|减员=裁员|精兵简政=裁军|剧减=骤减|优胜劣汰=选优淘劣|上升=升腾=升起=升高=狂升=稳中有升=腾达=蒸腾|凌空=抬高=攀升=爬升=腾空=腾飞=飙升|升华=增高=拔高=提高|上涨=水涨船高=飞涨=高升=高涨|提速=来潮=涨价=涨潮=涨风|跃升=跃居|猛跌=落潮=退潮|减价=削价=廉价=掉价儿=落价=跌价=降价|贬值=通货膨胀|提前=提早=超前|兼程=加快=加紧=加速=增速=开快车=快马加鞭|减慢=减速=放慢=缓一缓=缓减=缓手|加固=巩固|兴国=强国|减弱=减杀=削弱=弱化=衰弱|冲淡=和缓=缓和=软化=降温|抓紧=赶紧|放宽=放松=松劲=松扣|上轨道=好转=改善=改进=日臻完善=有起色=渐入佳境|九死一生=化险为夷=文艺复兴=有色=死里逃生=绝处逢生=转危为安=逢凶化吉|再生=勃发生机=复业=复兴=复苏=复馆=更生=枯木逢春|刮垢磨光=改善=改良=改进=更上一层楼=精益求精|恶化=恶变=毒化=逆转|乐极生悲=倾覆=大厦将倾|创新=履新=换代=更新=翻新|万象更新=焕然一新=面目一新|吐故纳新=推陈出新=旧貌换新颜=破旧立新=花样翻新=除旧布新=除旧迎新=革故鼎新|以旧翻新=刷新=基础代谢=整旧如新=更型换代|复古=复旧|故伎重演=故态复萌=旧病复发=老调重弹|初生=后来=后起=喷薄欲出=新兴=新生=旭日东升|式微=破败=衰微=衰败=衰颓=颓败|世风日下=人心不古|出租车=的士=计程车|包菜=卷心菜=圆白菜=甘蓝|棒子=玉米=苞米=苞谷|奇异果=猕猴桃|樱桃=车厘子|创口贴=创可贴=止血贴|洗洁净=洗洁精=洗涤灵|乒乓球=桌球";
    let hitSynonymMap = null;

    function initHitSynonymMap() {
        hitSynonymMap = new Map();
        if (HIT_THESAURUS_COMPACT) {
            const groups = HIT_THESAURUS_COMPACT.split('|');
            for (let i = 0; i < groups.length; i++) {
                const words = groups[i].split('=');
                for (let j = 0; j < words.length; j++) {
                    const w = words[j];
                    let set = hitSynonymMap.get(w);
                    if (!set) {
                        set = new Set();
                        hitSynonymMap.set(w, set);
                    }
                    for (let k = 0; k < words.length; k++) {
                        if (j !== k) set.add(words[k]);
                    }
                }
            }
        }

    }

    function getHitSynonyms(keyword) {
        if (!keyword) return [];
        if (!hitSynonymMap) initHitSynonymMap();
        const set = hitSynonymMap.get(keyword.toLowerCase());
        return set ? Array.from(set) : [];
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

                // 提取视频简介（网络拦截 + DOM 元素）
                const videoDesc = cleanText(videoDescMap.get(id) || '');
                const descEl = card.querySelector('.bili-video-card__info--desc, .bili-video-card__desc, .video-desc, p.desc, div[class*="desc"]');
                const domDesc = descEl ? cleanText(descEl.getAttribute('title') || descEl.textContent || '') : '';
                const allDesc = cleanText(`${videoDesc} ${domDesc}`);

                // 纯净提取作者名字（提取第一署名作者）
                const authorEl = card.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname');
                const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';
                const author = cleanText(rawAuthor.replace(/[\s·•].*$/, ''));

                // 检查标题是否包含 B 站官方搜索高亮的 em.keyword 标签
                const hasEmKeyword = !!(titleEl.querySelector('em.keyword, em[class*="keyword"]') || card.querySelector('h3 em.keyword, .bili-video-card__info--tit em.keyword'));

                const matchTitle = createMatcher(title);
                const matchTags = createMatcher(allVideoTags);
                const matchAuthor = createMatcher(author);
                const matchDesc = createMatcher(allDesc);

                // 四道安检关卡：
                // 1. 排除词保持严格判定（命中任一排除词即刻剔除）
                // 2. 普通关键词采取 OR 逻辑（包含 em.keyword、标题匹配、拆分词匹配视频标签、UP主匹配、或匹配视频简介）
                // 3. 方案 A 实时扩展词放行（命中 B 站联想词、高频共现标签或相关搜索即放行）
                // 4. 标签与 UP 主保持严格约束（指定标签须全部满足，指定作者须符合）
                let filterReason = '';
                const matchedExclude = exclude.find(k => title.includes(k));

                // UP 主名字命中判定：UP 主名字包含搜索文字时也放行
                const authorHasMatched = !!(author && (
                    queryWordList.some(w => author.includes(w)) ||
                    normal.some(k => author.includes(k) || k.includes(author))
                ));

                // 简介命中判定：视频简介包含搜索关键词时放行（OR 匹配备选条件）
                const hasDescMatched = !!(allDesc && (
                    normal.some(k => matchDesc(k)) ||
                    queryWordList.some(w => allDesc.includes(w))
                ));

                const hasNormalMatched = hasEmKeyword || hasTagMatched || authorHasMatched || normal.some(k => matchTitle(k)) || hasDescMatched;

                // 纯异素/词林同义词放行检测 (哈工大《同义词词林（扩展版）》+ 用户自定义等价)
                let matchedSynonymInfo = null;
                if (!hasNormalMatched && normal.length > 0) {
                    for (const k of normal) {
                        const syns = getHitSynonyms(k);
                        if (!syns || syns.length === 0) continue;
                        for (const syn of syns) {
                            if (matchTitle(syn) || matchDesc(syn) || (allVideoTags && allVideoTags.includes(syn))) {
                                matchedSynonymInfo = { original: k, synonym: syn };
                                break;
                            }
                        }
                        if (matchedSynonymInfo) break;
                    }
                }

                let matchedExpWord = '';
                if (!hasNormalMatched && !matchedSynonymInfo && currentExpandedWords.size > 0) {
                    for (const expWord of currentExpandedWords) {
                        if (matchTitle(expWord) || (allVideoTags && allVideoTags.includes(expWord)) || (allDesc && allDesc.includes(expWord))) {
                            matchedExpWord = expWord;
                            break;
                        }
                    }
                }

                if (matchedExclude) {
                    filterReason = `排除词: -${matchedExclude}`;
                } else if (normal.length && !hasNormalMatched) {
                    if (matchedSynonymInfo) {
                        // 命中哈工大《同义词词林》纯异素同义词放行
                        card.dataset.purifiedSemantic = 'rescued';
                        card.dataset.purifiedNote = `同义放行 [${matchedSynonymInfo.original}->${matchedSynonymInfo.synonym}]`;
                        card.dataset.purifiedSemanticQuery = currentSearchQuery;
                    } else if (matchedExpWord) {
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
                } else if (hasNormalMatched && hasDescMatched && !hasEmKeyword && !normal.some(k => matchTitle(k)) && !hasTagMatched && !authorHasMatched) {
                    // 若仅因简介命中而放行，在测试模式下标注徽标便于溯源
                    card.dataset.purifiedSemantic = 'rescued';
                    card.dataset.purifiedNote = '简介命中';
                    card.dataset.purifiedSemanticQuery = currentSearchQuery;
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
    console.log('[Bilibili 搜索净化] 0.0.5 (Fuse.js + bge-small-zh + 搜索联想扩展) 已启动。');
})();
