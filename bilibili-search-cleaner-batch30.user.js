// ==UserScript==
// @name         Bilibili 去掉搜索无关视频 (30项一次性批量补足 Demo)
// @namespace    http://tampermonkey.net/
// @version      2.1.3
// @description  自动隐藏 Bilibili 搜索无关视频，首屏直开与页面搜索统一清洗，后台检索凑齐每页 30 个有效视频后一次性批量上屏。（避开作者专区模块，纯净克隆原生卡片保证原生样式）
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

    // ================= 0. 配置参数与模块黑名单 =================
    const TARGET_PAGE_SIZE = 30;         // 目标每页有效展示数量
    const MAX_AUTO_FETCH_DEPTH = 3;      // 单次最大向后追拉页数

    // 作者/用户专区模块选择器（严格避开，防止将视频误追加至作者容器）
    const USER_MODULE_CONTAINER_SELECTOR = '.user-video-info, .search-user-card, .user-list, .bili-user-list, [class*="user-video"], [class*="user-list"], [class*="user-card"], [class*="search-user"]';

    // ================= 1. 简繁归一化与文本清洗 =================
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

    // ================= 2. 预注入 CSS 样式（广告秒杀、网格防塌陷与分页器保护） =================
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }
        /* 确保主列表与网格完全自适应展开，清除浮动，避免高度塌陷导致分页器上移被盖 */
        .video.search-all-list,
        .video.i_wrapper,
        .video-list.row,
        .search-page,
        .search-page-box {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            clear: both !important;
        }
        /* 确保底部翻页器不被卡片或遮罩覆盖，具有明确上外边距与显示层级 */
        div.flex_center:has(.vui_pagenation),
        div.flex_center.mt_x50.mb_x50,
        .vui_pagenation {
            position: relative !important;
            z-index: 10 !important;
            clear: both !important;
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin-top: 40px !important;
            margin-bottom: 60px !important;
        }
        .bili-cleaner-fill-indicator {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: rgba(0, 174, 236, 0.9);
            color: #fff;
            padding: 8px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 999999;
            backdrop-filter: blur(4px);
            pointer-events: none;
            transition: opacity 0.3s ease, transform 0.3s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }
    `;
    (document.head || document.documentElement).appendChild(styleElement);

    // ================= 3. 搜索语法解析引擎 =================
    function splitByTopLevelPipe(str) {
        const branches = [];
        let curr = '';
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            if (char === '|') {
                if (curr.trim()) branches.push(curr.trim());
                curr = '';
            } else {
                curr += char;
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
                if (/\s/.test(char)) {
                    const rest = branchStr.slice(i).trim();
                    if (/^[-#@]/.test(rest)) {
                        if (curr.length > 0) tokens.push(curr);
                        curr = '';
                        inQuote = false;
                        quoteChar = '';
                        continue;
                    }
                }
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

        let target = 'title';
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
        } else {
            val = val.replace(/^["']+|["']+$/g, '');
        }

        const cleanVal = cleanText(val);
        if (!cleanVal) return null;

        return { isNeg, target, isExact, val: cleanVal };
    }

    function parseSearchQuery() {
        const params = new URLSearchParams(window.location.search);
        const rawParam = params.get('keyword') || '';
        if (!rawParam) return { exclusions: [], branches: [], hasRules: false };

        let decodedParam = rawParam.replace(/\+/g, ' ');
        try {
            decodedParam = decodeURIComponent(decodedParam);
        } catch {}

        const cleaned = cleanText(decodedParam);
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

    // ================= 4. 卡片判定器 =================
    function testCard(parsedQuery, cardInfo) {
        if (!parsedQuery.hasRules) return true;
        const { title, author, tagList, tagSet, rawTags } = cardInfo;

        // 1. 排除规则（全局最高优先级）
        for (const ex of parsedQuery.exclusions) {
            if (ex.target === 'title') {
                if (title.includes(ex.val)) return false;
            } else if (ex.target === 'author') {
                if (ex.isExact ? (author === ex.val) : author.includes(ex.val)) return false;
            } else if (ex.target === 'tag') {
                if (ex.isExact ? tagSet.has(ex.val) : (tagList.some(t => t.includes(ex.val)) || rawTags.includes(ex.val))) return false;
            }
        }

        // 2. 纯排除模式
        if (parsedQuery.branches.length === 0) return true;

        // 3. 正向分支匹配 (OR)
        return parsedQuery.branches.some(branch => {
            // 标题多词 AND
            const titleMatch = branch
                .filter(c => c.target === 'title')
                .every(c => title.includes(c.val));
            if (!titleMatch) return false;

            // 标签多词 AND
            const tagMatch = branch
                .filter(c => c.target === 'tag')
                .every(c => c.isExact ? tagSet.has(c.val) : (tagList.some(t => t.includes(c.val)) || rawTags.includes(c.val)));
            if (!tagMatch) return false;

            // 作者多词 OR（满足任一指定作者即可）
            const authorConds = branch.filter(c => c.target === 'author');
            const authorMatch = authorConds.length === 0 || authorConds.some(c => c.isExact ? (author === c.val) : author.includes(c.val));
            return authorMatch;
        });
    }

    // ================= 5. 数据清洗与 Tag 索引维护 =================
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

    function getCardTagData(id, itemTagStr = '') {
        const strId = String(id || '');
        if (strId && videoTagMap.has(strId)) {
            return videoTagMap.get(strId);
        }
        const rawTags = cleanText(itemTagStr);
        const tagList = rawTags ? rawTags.split(/[,，、]+/).map(t => t.trim()).filter(Boolean) : [];
        const tagSet = new Set(tagList);
        return { rawTags, tagList, tagSet };
    }

    function scanInitialState() {
        try {
            if (window.__INITIAL_STATE__?.flowData?.result) {
                cleanAdsOnly(window.__INITIAL_STATE__.flowData.result);
            }
            if (window.__pinia) {
                for (const k of Object.keys(window.__pinia)) {
                    const store = window.__pinia[k];
                    if (store?.result && Array.isArray(store.result)) {
                        cleanAdsOnly(store.result);
                    }
                }
            }
        } catch {}
    }

    function filterVideoList(rawList, parsedQuery) {
        const cleanedList = cleanAdsOnly(rawList);
        if (!parsedQuery.hasRules) return cleanedList;

        return cleanedList.filter(item => {
            if (!item || typeof item !== 'object') return false;
            const id = item.bvid || item.aid || item.id;
            const rawTitle = (item.title || '').replace(/<[^>]+>/g, '').replace(/&[a-z0-9#]+;/gi, '');
            const title = cleanText(rawTitle);
            const author = cleanText((item.author || (item.owner && item.owner.name) || '').replace(/\s*[·•].*$/, ''));
            const { rawTags, tagList, tagSet } = getCardTagData(id, item.tag || item.keywords || '');

            return testCard(parsedQuery, { title, author, tagList, tagSet, rawTags });
        });
    }

    // ================= 6. 动态流式追加卡片渲染器（纯净克隆原生节点） =================
    function showIndicator(text, isDone = false) {
        let el = document.querySelector('.bili-cleaner-fill-indicator');
        if (!el) {
            el = document.createElement('div');
            el.className = 'bili-cleaner-fill-indicator';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        if (isDone) {
            setTimeout(() => {
                if (el) {
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(10px)';
                }
            }, 2000);
        }
    }

    function formatNumber(num) {
        if (!num) return '0';
        const n = parseInt(num, 10);
        if (isNaN(n)) return num;
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        return String(n);
    }

    // 精确锁定主视频流列表容器（严格跳过作者模块）
    function getMainVideoContainer() {
        const candidates = document.querySelectorAll(
            '.video.search-all-list .video-list, ' +
            '.video.i_wrapper .video-list, ' +
            '.search-page-video .video-list, ' +
            '.search-all-list .video-list, ' +
            'div.video .video-list, ' +
            '.video-list'
        );
        for (const el of candidates) {
            if (el.closest(USER_MODULE_CONTAINER_SELECTOR)) {
                continue; // 处于作者模块内部，跳过
            }
            return el;
        }
        return null;
    }

    // 获取用于克隆的标准原生视频卡片列节点（具备完整的 Vue scoped data-v 属性与原生样式）
    let cachedSampleCol = null;
    function getSampleColumnTemplate(container) {
        if (cachedSampleCol) return cachedSampleCol;
        if (!container) return null;

        const cols = container.querySelectorAll('div[class*="col_"]');
        for (const col of cols) {
            if (col.hasAttribute('data-cleaner-bvid')) continue;
            if (col.closest(USER_MODULE_CONTAINER_SELECTOR)) continue;
            if (col.querySelector('.bili-video-card')) {
                cachedSampleCol = col.cloneNode(true);
                cachedSampleCol.removeAttribute('style');
                // 彻底清除骨架屏、反馈下拉、视频播放器、副标题/AI摘要等可能残留的干扰节点
                cachedSampleCol.querySelectorAll('.bili-video-card__skeleton').forEach(el => el.remove());
                cachedSampleCol.querySelectorAll('.bili-video-card__no-interest').forEach(el => el.remove());
                cachedSampleCol.querySelectorAll('video, iframe, canvas').forEach(el => el.remove());
                cachedSampleCol.querySelectorAll('[class*="subtitle"], [class*="summary"], [class*="ai-"]').forEach(el => el.remove());
                return cachedSampleCol;
            }
        }
        return null;
    }

    // 获取当前页面承载主视频流网格的容器与栅格类名
    function getCardContainerInfo() {
        let colClass = 'col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40';
        let container = getMainVideoContainer();

        if (container) {
            const sampleCol = container.querySelector('div[class*="col_"]:not([class*="video-list-item"]), div[class*="col_"]');
            if (sampleCol) colClass = sampleCol.className;
            return { container, colClass };
        }

        // 兜底遍历：通过卡片向上查找主视频列表网格行，严禁回退至父级非网格容器
        const allCards = document.querySelectorAll('.bili-video-card, .video-list-item');
        for (const card of allCards) {
            if (card.closest(USER_MODULE_CONTAINER_SELECTOR)) continue;
            const row = card.closest('.video-list, .row');
            if (row && !row.closest(USER_MODULE_CONTAINER_SELECTOR)) {
                container = row;
                const col = card.closest('div[class*="col_"]');
                if (col) colClass = col.className;
                return { container, colClass };
            }
        }

        return { container: null, colClass };
    }

    // 动态构造并插入单张标准卡片
    function appendSingleVideoCard(videoItem, container, colClass) {
        const bvid = videoItem.bvid || videoItem.aid || '';
        if (!bvid || !container) return;
        if (document.querySelector(`[data-cleaner-bvid="${bvid}"]`)) return;

        const arcurl = videoItem.arcurl || `https://www.bilibili.com/video/${bvid}`;
        let pic = videoItem.pic || '';
        if (pic && !pic.startsWith('http')) pic = 'https:' + pic;
        // 使用 B 站标准的 16:9 中心裁剪规格 webp，从 CDN 层面锁定横屏比例，彻底避免原图竖版超高
        const coverUrl = pic ? (pic.includes('@') ? pic : `${pic}@672w_378h_1c.webp`) : '';

        const titleHtml = videoItem.title || '';
        const cleanTitleText = cleanText(titleHtml.replace(/<[^>]+>/g, ''));
        const author = videoItem.author || (videoItem.owner && videoItem.owner.name) || 'UP主';
        const mid = videoItem.mid || '';
        const playStr = formatNumber(videoItem.play || videoItem.stat?.view);
        const danmakuStr = formatNumber(videoItem.video_review || videoItem.stat?.danmaku);
        const durationStr = videoItem.duration || '00:00';
        const pubdate = videoItem.pubdate ? new Date(videoItem.pubdate * 1000).toLocaleDateString() : '';

        const template = getSampleColumnTemplate(container);

        if (template) {
            // 方案 A：直接克隆原生列节点，完全依靠 B 站原生 CSS 渲染
            const colDiv = template.cloneNode(true);
            colDiv.setAttribute('data-cleaner-bvid', bvid);
            colDiv.removeAttribute('style');

            const card = colDiv.querySelector('.bili-video-card');
            if (card) {
                card.setAttribute('data-bsb-bvid', bvid);
                card.removeAttribute('data-report-click');
            }

            // 更新视频跳转链接
            colDiv.querySelectorAll('a[href*="/video/"]').forEach(a => {
                a.href = arcurl;
            });

            // 更新封面图（更新 source 与 img 标签，保证统一渲染 16:9 裁剪图）
            const picture = colDiv.querySelector('.bili-video-card__cover, picture.v-img');
            if (picture) {
                picture.querySelectorAll('source').forEach(s => {
                    s.srcset = coverUrl;
                });
                const img = picture.querySelector('img') || colDiv.querySelector('img');
                if (img) {
                    img.src = coverUrl;
                    img.alt = cleanTitleText;
                    img.removeAttribute('srcset');
                    img.removeAttribute('loading');
                }
            } else {
                const img = colDiv.querySelector('img');
                if (img) {
                    img.src = coverUrl;
                    img.alt = cleanTitleText;
                    img.removeAttribute('srcset');
                }
            }

            // 更新播放量与弹幕数据
            const statItems = colDiv.querySelectorAll('.bili-video-card__stats--item');
            if (statItems[0]) {
                const textEl = statItems[0].querySelector('.bili-video-card__stats--text');
                if (textEl) {
                    textEl.textContent = playStr;
                } else {
                    const svg = statItems[0].querySelector('svg');
                    statItems[0].innerHTML = '';
                    if (svg) statItems[0].appendChild(svg);
                    statItems[0].appendChild(document.createTextNode(' ' + playStr));
                }
            }
            if (statItems[1]) {
                const textEl = statItems[1].querySelector('.bili-video-card__stats--text');
                if (textEl) {
                    textEl.textContent = danmakuStr;
                } else {
                    const svg = statItems[1].querySelector('svg');
                    statItems[1].innerHTML = '';
                    if (svg) statItems[1].appendChild(svg);
                    statItems[1].appendChild(document.createTextNode(' ' + danmakuStr));
                }
            }
            const durationEl = colDiv.querySelector('.bili-video-card__stats__duration');
            if (durationEl) durationEl.textContent = durationStr;

            // 更新标题
            const titEl = colDiv.querySelector('.bili-video-card__info--tit, h3');
            if (titEl) {
                titEl.title = cleanTitleText;
                titEl.innerHTML = titleHtml;
                const titLink = titEl.closest('a') || titEl.querySelector('a');
                if (titLink) titLink.href = arcurl;
            }

            // 更新作者与发布日期
            const ownerLink = colDiv.querySelector('.bili-video-card__info--owner');
            if (ownerLink) {
                ownerLink.href = mid ? `//space.bilibili.com/${mid}` : 'javascript:;';
            }
            const authorEl = colDiv.querySelector('.bili-video-card__info--author');
            if (authorEl) {
                authorEl.textContent = author;
            }
            const dateEl = colDiv.querySelector('.bili-video-card__info--date');
            if (dateEl) {
                dateEl.textContent = ` · ${pubdate}`;
            }

            container.appendChild(colDiv);
            return;
        }

        // 方案 B：兜底方案（仅在页面无可克隆节点时使用）
        const colDiv = document.createElement('div');
        colDiv.className = colClass;
        colDiv.setAttribute('data-cleaner-bvid', bvid);

        colDiv.innerHTML = `
            <div class="bili-video-card">
                <div class="bili-video-card__wrap __scale-wrap" style="position: relative;">
                    <a href="${arcurl}" target="_blank">
                        <div class="bili-video-card__image __scale-player-wrap">
                            <div class="bili-video-card__image--wrap">
                                <picture class="v-img bili-video-card__cover">
                                    <img src="${coverUrl}" alt="${cleanTitleText}" loading="lazy">
                                </picture>
                                <div class="bili-video-card__mask">
                                    <div class="bili-video-card__stats">
                                        <span class="bili-video-card__stats--item">
                                            <svg style="width:14px;height:14px;vertical-align:-2px;margin-right:2px;" viewBox="0 0 16 16" fill="currentColor">
                                                <path d="M12.5 8a.5.5 0 0 1-.22.42l-6 4A.5.5 0 0 1 5.5 12V4a.5.5 0 0 1 .78-.42l6 4a.5.5 0 0 1 .22.42z"/>
                                            </svg>${playStr}
                                        </span>
                                        <span class="bili-video-card__stats--item">
                                            <svg style="width:14px;height:14px;vertical-align:-2px;margin-right:2px;" viewBox="0 0 16 16" fill="currentColor">
                                                <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.414L3 13.414V3z"/>
                                            </svg>${danmakuStr}
                                        </span>
                                        <span class="bili-video-card__stats__duration">${durationStr}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a>
                    <div class="bili-video-card__info __scale-card-info">
                        <a href="${arcurl}" target="_blank">
                            <h3 class="bili-video-card__info--tit" title="${cleanTitleText}">${titleHtml}</h3>
                        </a>
                        <div class="bili-video-card__info--bottom">
                            <a class="bili-video-card__info--owner" href="//space.bilibili.com/${mid}" target="_blank">
                                <span class="bili-video-card__info--author">${author}</span>
                                <span class="bili-video-card__info--date"> · ${pubdate}</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 提取容器与页面上的 Vue scoped 属性并附加至新节点
        const scopedAttrs = [];
        const checkNodes = [container, container.parentElement, document.querySelector('.search-all-list'), document.querySelector('.video.i_wrapper')];
        checkNodes.forEach(node => {
            if (node) {
                Array.from(node.attributes).forEach(attr => {
                    if (attr.name.startsWith('data-v-') && !scopedAttrs.includes(attr.name)) {
                        scopedAttrs.push(attr.name);
                    }
                });
            }
        });

        scopedAttrs.forEach(attr => {
            colDiv.setAttribute(attr, '');
            colDiv.querySelectorAll('*').forEach(child => child.setAttribute(attr, ''));
        });

        container.appendChild(colDiv);
    }

    // 统计当前主视频容器内的有效展示数量
    function countVisibleCards() {
        const container = getMainVideoContainer();
        if (container) {
            const cards = container.querySelectorAll('.bili-video-card');
            let count = 0;
            cards.forEach(c => {
                const col = c.closest('div[class*="col_"]') || c;
                if (col.style.display !== 'none' && col.offsetParent !== null) {
                    count++;
                }
            });
            return count;
        }

        // 兜底统计（跳过作者模块）
        const cards = document.querySelectorAll('.bili-video-card');
        let count = 0;
        cards.forEach(c => {
            if (c.closest(USER_MODULE_CONTAINER_SELECTOR)) return;
            const col = c.closest('div[class*="col_"]') || c;
            if (col.style.display !== 'none' && col.offsetParent !== null) {
                count++;
            }
        });
        return count;
    }

    // ================= 7. 增量拉取器与流式补足调度 (100ms~300ms 快速流式追加) =================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let isFillingInProgress = false;
    let fillingCompletedForCurrentState = false; // 当前页/当前关键词的动态补足是否已终结（关键：彻底防死循环）
    let videoBuffer = [];
    let currentRemotePage = 1;
    let lastSearchKeyword = '';
    let savedFetchTemplateArgs = null;
    let lastAutoFetchTime = 0;

    // 确保翻页栏容器始终排列在视频主网格下方，不被错位与遮挡
    function ensurePaginationPosition() {
        try {
            const videoWrapper = document.querySelector('.video.search-all-list, .video.i_wrapper.search-all-list');
            const pagerBox = document.querySelector('div.flex_center:has(.vui_pagenation), div.flex_center.mt_x50.mb_x50');
            if (videoWrapper && pagerBox && videoWrapper.parentElement) {
                if (pagerBox.nextSibling === videoWrapper) {
                    videoWrapper.after(pagerBox);
                } else if (pagerBox.parentElement === videoWrapper.parentElement) {
                    videoWrapper.parentElement.appendChild(pagerBox);
                }
            }
        } catch {}
    }

    async function fetchPageData(pageNo) {
        if (!savedFetchTemplateArgs) return null;
        let [input, init] = savedFetchTemplateArgs;
        let urlStr = typeof input === 'string' ? input : input.url;

        let nextUrl = urlStr.replace(/([?&]page=)[^&]+/, `$1${pageNo}`);
        if (!nextUrl.includes('page=')) {
            nextUrl += (nextUrl.includes('?') ? '&' : '?') + `page=${pageNo}`;
        }

        let fetchArg = nextUrl;
        if (typeof input !== 'string' && input && typeof input === 'object') {
            fetchArg = new Request(nextUrl, input);
        }

        try {
            const resp = await originFetch(fetchArg, init);
            if (!resp.ok) {
                console.warn(`[补足 2.1.3] 接口 HTTP 响应异常: ${resp.status}`);
                return null;
            }
            const clone = resp.clone();
            return await clone.json();
        } catch (err) {
            console.error('[补足 2.1.3] 网络请求失败:', err);
            return null;
        }
    }

    // 后台集中拉取凑齐后，一次性批量挂载上屏
    async function startDynamicIncrementalFilling(parsedQuery) {
        if (isFillingInProgress || fillingCompletedForCurrentState) return;
        isFillingInProgress = true;

        try {
            const { container, colClass } = getCardContainerInfo();
            if (!container) {
                fillingCompletedForCurrentState = true;
                return;
            }

            let visibleCount = countVisibleCards();
            if (visibleCount >= TARGET_PAGE_SIZE) {
                fillingCompletedForCurrentState = true;
                ensurePaginationPosition();
                return;
            }

            showIndicator(`⚡ 正在后台检索有效视频...`);

            const collectedItems = [];

            // 1. 先收集合并本地缓冲池
            while (videoBuffer.length > 0 && (visibleCount + collectedItems.length) < TARGET_PAGE_SIZE) {
                collectedItems.push(videoBuffer.shift());
            }

            // 2. 缓冲池不足，向服务端深度拉取并集中暂存
            let depth = 0;
            while ((visibleCount + collectedItems.length) < TARGET_PAGE_SIZE && depth < MAX_AUTO_FETCH_DEPTH) {
                depth++;
                currentRemotePage++;

                // 请求延迟：100ms ~ 300ms 快速拉取
                const delayMs = 100 + Math.floor(Math.random() * 200);
                await sleep(delayMs);

                const data = await fetchPageData(currentRemotePage);
                lastAutoFetchTime = Date.now();

                // 接口与风控状态检查
                if (!data) break;
                if (data.code !== 0) {
                    if (data.code === -412 || data.code === 412) {
                        showIndicator('⚠️ 触发平台请求频控，已暂停自动补足', true);
                    } else {
                        console.warn(`[批量补足 2.1.3] 接口返回 code: ${data.code}, msg: ${data.message}`);
                    }
                    break;
                }
                if (!data.data?.result) break;

                let incoming = [];
                if (Array.isArray(data.data.result)) {
                    if (data.data.result.length > 0 && Array.isArray(data.data.result[0].data)) {
                        for (const cat of data.data.result) {
                            if (cat.result_type === 'video' || !cat.result_type) {
                                incoming = incoming.concat(cat.data || []);
                            }
                        }
                    } else {
                        incoming = data.data.result;
                    }
                }

                if (incoming.length === 0) break;

                // 筛选出有效数据
                const validBatch = filterVideoList(incoming, parsedQuery);

                for (const item of validBatch) {
                    if ((visibleCount + collectedItems.length) < TARGET_PAGE_SIZE) {
                        collectedItems.push(item);
                        showIndicator(`⚡ 已在后台检索出 ${visibleCount + collectedItems.length}/${TARGET_PAGE_SIZE} 个有效视频...`);
                    } else {
                        videoBuffer.push(item);
                    }
                }
            }

            // 3. 所有页面抓取并筛选完毕后，使用 DocumentFragment 一次性批量挂载上屏
            if (collectedItems.length > 0) {
                const fragment = document.createDocumentFragment();
                for (const item of collectedItems) {
                    appendSingleVideoCard(item, fragment, colClass);
                }
                container.appendChild(fragment);
                visibleCount = countVisibleCards();
            }

            // 单次深度追拉完毕，标记终结，严禁反复死循环拉取
            fillingCompletedForCurrentState = true;

            if (visibleCount >= TARGET_PAGE_SIZE) {
                showIndicator(`✓ 已一次性展示 ${visibleCount} 个有效视频`, true);
            } else {
                showIndicator(`✓ 搜索结果已全部展示 (${visibleCount} 个视频)`, true);
            }
            ensurePaginationPosition();
        } catch (e) {
            console.error('[批量补足 2.1.3] 处理异常:', e);
            fillingCompletedForCurrentState = true;
        } finally {
            isFillingInProgress = false;
        }
    }

    // ================= 8. DOM 首屏安检（跳过作者模块，带触发冷却） =================
    let domCheckTimer = null;
    function filterExistingDOMElements() {
        if (isFillingInProgress) return;
        const parsedQuery = parseSearchQuery();
        if (!parsedQuery.hasRules) return;

        scanInitialState();

        const container = getMainVideoContainer();
        const cards = (container || document).querySelectorAll('.bili-video-card, .video-list-item');
        let hiddenAny = false;

        cards.forEach(card => {
            if (card.closest(USER_MODULE_CONTAINER_SELECTOR)) return;
            const col = card.closest('div[class*="col_"]') || card;
            if (col.hasAttribute('data-cleaner-bvid')) return;

            const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"]');
            const titleEl = card.querySelector('.bili-video-card__info--tit, h3');
            if (!linkEl || !titleEl) return;

            const title = cleanText(titleEl.getAttribute('title') || titleEl.textContent || '');
            const authorEl = card.querySelector('.bili-video-card__info--author, .up-name');
            const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';
            const author = cleanText(rawAuthor.replace(/\s*[·•].*$/, ''));

            let id = '';
            const match = (linkEl.href || '').match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
            if (match) id = match[1];

            const { rawTags, tagList, tagSet } = getCardTagData(id);
            const isMatch = testCard(parsedQuery, { title, author, tagList, tagSet, rawTags });

            if (!isMatch) {
                if (col.style.display !== 'none') {
                    col.style.setProperty('display', 'none', 'important');
                    hiddenAny = true;
                }
            } else {
                col.style.removeProperty('display');
            }
        });

        // 仅在当前状态尚未执行过补足流程时，才触发自动补足
        if (!fillingCompletedForCurrentState && !isFillingInProgress) {
            const visibleCount = countVisibleCards();
            if (hiddenAny || visibleCount < TARGET_PAGE_SIZE) {
                if (Date.now() - lastAutoFetchTime < 400) return;
                if (domCheckTimer) clearTimeout(domCheckTimer);
                domCheckTimer = setTimeout(() => {
                    if (savedFetchTemplateArgs && !isFillingInProgress && !fillingCompletedForCurrentState) {
                        startDynamicIncrementalFilling(parsedQuery);
                    }
                }, 200);
            }
        }
    }

    // ================= 9. 网络层拦截与即时放行 =================
    const originFetch = window.fetch;
    window.fetch = async function(...args) {
        let urlStr = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const isSearchReq = urlStr.includes('/wbi/search') || urlStr.includes('/search/type') || urlStr.includes('/search/all');

        if (!isSearchReq) return originFetch.apply(this, args);

        const parsedQuery = parseSearchQuery();

        // 智能脱壳
        const apiKeyword = getCleanApiKeyword();
        if (apiKeyword) {
            urlStr = urlStr.replace(/([?&]keyword=)[^&]+/, `$1${encodeURIComponent(apiKeyword)}`);
            if (typeof args[0] === 'string') {
                args[0] = urlStr;
            } else if (args[0] && typeof args[0] === 'object') {
                args[0] = new Request(urlStr, args[0]);
            }
        }

        savedFetchTemplateArgs = args;

        if (!parsedQuery.hasRules) {
            return originFetch.apply(this, args);
        }

        const urlParams = new URLSearchParams(urlStr.split('?')[1] || '');
        const clientReqPage = parseInt(urlParams.get('page') || '1', 10);
        const currentKeyword = cleanText(urlParams.get('keyword') || '');

        if (currentKeyword !== lastSearchKeyword || clientReqPage !== currentRemotePage) {
            videoBuffer = [];
            currentRemotePage = clientReqPage;
            lastSearchKeyword = currentKeyword;
            cachedSampleCol = null; // 重置模板缓存
            fillingCompletedForCurrentState = false; // 切换关键词或翻页后允许执行一次新补足
            document.querySelectorAll('[data-cleaner-bvid]').forEach(el => el.remove());
        }

        const response = await originFetch.apply(this, args);

        try {
            const clone = response.clone();
            const data = await clone.json();

            if (data?.data?.result) {
                let firstBatchRaw = [];
                let isMultiCategory = false;

                if (Array.isArray(data.data.result)) {
                    if (data.data.result.length > 0 && Array.isArray(data.data.result[0].data)) {
                        isMultiCategory = true;
                        for (const cat of data.data.result) {
                            if (cat.result_type === 'video' || !cat.result_type) {
                                firstBatchRaw = firstBatchRaw.concat(cat.data || []);
                            }
                        }
                    } else {
                        firstBatchRaw = data.data.result;
                    }
                }

                const immediateValidList = filterVideoList(firstBatchRaw, parsedQuery);

                if (isMultiCategory) {
                    for (const cat of data.data.result) {
                        if (cat.result_type === 'video' || !cat.result_type) {
                            cat.data = immediateValidList;
                        }
                    }
                } else {
                    data.data.result = immediateValidList;
                }

                setTimeout(() => {
                    startDynamicIncrementalFilling(parsedQuery);
                }, 50);

                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch (e) {
            console.error('[搜索补足 2.1.3] 处理异常:', e);
        }

        return response;
    };

    // ================= 10. 页面加载与 DOM 监听启动 =================
    let observerDebounceTimer = null;
    const observer = new MutationObserver((mutations) => {
        if (isFillingInProgress) return;

        let hasExternalNode = false;
        for (const m of mutations) {
            if (m.addedNodes) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.hasAttribute?.('data-cleaner-bvid') || node.classList?.contains('bili-cleaner-fill-indicator')) {
                            continue;
                        }
                        hasExternalNode = true;
                        break;
                    }
                }
            }
            if (hasExternalNode) break;
        }

        if (hasExternalNode) {
            if (observerDebounceTimer) clearTimeout(observerDebounceTimer);
            observerDebounceTimer = setTimeout(() => {
                filterExistingDOMElements();
            }, 100);
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            filterExistingDOMElements();
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        });
    } else {
        filterExistingDOMElements();
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    console.log('[Bilibili 搜索净化] v2.1.3 (流式动态补足版) 已启动。');
})();
