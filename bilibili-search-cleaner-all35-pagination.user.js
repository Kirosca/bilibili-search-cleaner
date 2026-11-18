// ==UserScript==
// @name         Bilibili 去掉搜索无关视频 (全量35页筛选与重构分页版)
// @namespace    http://tampermonkey.net/
// @version      2.3.0
// @description  自动隐藏 Bilibili 搜索无关视频，支持全量抓取前35页并在内存中统一筛选，根据有效结果数量彻底重构底部分页条，翻页秒切。（基于 2.1.0 架构升级）
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

    // ================= 0. 配置参数与状态池 =================
    const PAGE_SIZE = 30;              // 重构后每页展示的有效视频数量
    const MAX_PAGES_TO_FETCH = 35;     // 全量抓取最大页数深度（B站搜索通常上限为35~42页）
    const FETCH_INTERVAL_MS = 260;     // 跨页后台拉取安全间隔（毫秒），防 -412 频控
    const USER_MODULE_SELECTOR = '.user-video-info, .search-user-card, .user-list, .bili-user-list, [class*="user-video"], [class*="user-list"], [class*="user-card"], [class*="search-user"]';

    let allFilteredVideos = [];        // 内存中全量有效视频池
    let currentLocalPage = 1;          // 当前重构分页的查看页码
    let isFetchingAll = false;         // 是否正在执行全量抓取
    let savedFetchTemplateArgs = null; // 捕获的首屏 API 请求模板参数
    let lastHandledSearchUrl = '';     // 上次处理的 URL 签名，避免切页面重复抓取
    let cachedSampleCol = null;        // 原生列卡片克隆模板

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

    // 1. 通用文本清洗：繁简归一化、HTML实体反转义与标点规范化（含全角标点兼容）
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

    // 2. 预注入 CSS 规则：广告秒杀、原生分页隐藏与全新重构分页器样式
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }

        /* 当接管并重构分页时，隐藏原生 B 站分页栏 */
        body.bili-cleaner-active div.flex_center:has(.vui_pagenation),
        body.bili-cleaner-active .vui_pagenation {
            display: none !important;
        }

        /* 确保主列表与网格容器自适应高度，避免塌陷遮挡 */
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

        /* 自定义重构分页器容器样式 */
        .bili-purified-pagination {
            display: flex;
            align-items: center;
            justify-content: center;
            flex-wrap: wrap;
            gap: 8px;
            margin: 45px 0 65px 0;
            padding: 10px;
            user-select: none;
            clear: both;
        }
        .bili-purified-pagination button {
            min-width: 36px;
            height: 36px;
            padding: 0 12px;
            border: 1px solid #e3e5e7;
            background: #ffffff;
            color: #18191c;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            outline: none;
        }
        .bili-purified-pagination button:hover:not(:disabled) {
            border-color: #00aeec;
            color: #00aeec;
        }
        .bili-purified-pagination button.active {
            background: #00aeec;
            border-color: #00aeec;
            color: #ffffff;
            font-weight: bold;
            cursor: default;
        }
        .bili-purified-pagination button:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            border-color: #e3e5e7;
            color: #9499a0;
        }
        .bili-purified-pagination .pagination-info {
            margin-left: 14px;
            font-size: 13px;
            color: #61666d;
        }

        /* 右下角非侵入式检索进度指示卡 */
        .bili-cleaner-progress-badge {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: rgba(0, 174, 236, 0.92);
            color: #ffffff;
            padding: 9px 16px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
            z-index: 999999;
            backdrop-filter: blur(6px);
            pointer-events: none;
            transition: opacity 0.3s ease, transform 0.3s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }
    `;
    (document.head || document.documentElement).appendChild(styleElement);

    // 进度提示框控制
    function showProgress(text, autoHideMs = 0) {
        let el = document.querySelector('.bili-cleaner-progress-badge');
        if (!el) {
            el = document.createElement('div');
            el.className = 'bili-cleaner-progress-badge';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';

        if (autoHideMs > 0) {
            setTimeout(() => {
                if (el) {
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(12px)';
                }
            }, autoHideMs);
        }
    }

    // 3. 解析当前 URL 中的关键词分类 (普通词 / -排除词 / #Tag词 / @UP主词)
    function getSearchKeywords() {
        const params = new URLSearchParams(window.location.search);
        const rawParam = params.get('keyword') || '';
        const rawKeyword = cleanText(decodeURIComponent(rawParam.replace(/\+/g, ' ')));
        if (!rawKeyword) return { normal: [], exclude: [], tags: [], ups: [], hasRules: false };

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
        const hasRules = Boolean(exclude.length || tags.length || ups.length);
        return { normal, exclude, tags, ups, hasRules };
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

    // 5. 数据校验器：Tag 存储与多条件过滤引擎
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

    function testVideoItem(item, queryInfo) {
        if (!item || typeof item !== 'object') return false;
        const { normal, exclude, tags, ups, hasRules } = queryInfo;
        if (!hasRules) return true;

        const rawTitle = (item.title || '').replace(/<[^>]+>/g, '').replace(/&[a-z0-9#]+;/gi, '');
        const title = cleanText(rawTitle);
        const author = cleanText((item.author || (item.owner && item.owner.name) || '').replace(/[\s·•].*$/, ''));
        const id = item.bvid || item.aid || item.id || '';
        const rawTags = cleanText(item.tag || item.keywords || item.tags || videoTagMap.get(String(id)) || '');
        const tagList = rawTags ? rawTags.split(/[,，、]+/).map(t => t.trim()).filter(Boolean) : [];

        // 1. 排除词安检（全局最高优先级）
        if (exclude.some(k => title.includes(k))) return false;
        // 2. 普通关键词（全匹配 AND）
        if (normal.length && !normal.every(k => title.includes(k))) return false;
        // 3. Tag 专项（全匹配 AND）
        if (tags.length && !tags.every(k => tagList.some(t => t.includes(k)) || rawTags.includes(k))) return false;
        // 4. UP主 定向（任一匹配 OR）
        if (ups.length && !ups.some(k => author.includes(k))) return false;

        return true;
    }

    function extractVideosFromResponse(data) {
        let rawList = [];
        if (data?.data?.result) {
            if (Array.isArray(data.data.result)) {
                if (data.data.result.length > 0 && Array.isArray(data.data.result[0].data)) {
                    for (const cat of data.data.result) {
                        if (cat.result_type === 'video' || !cat.result_type) {
                            rawList = rawList.concat(cat.data || []);
                        }
                    }
                } else {
                    rawList = data.data.result;
                }
            }
        }
        return cleanAdsOnly(rawList);
    }

    // 格式化播放量与弹幕数
    function formatNumber(num) {
        if (!num) return '0';
        const n = parseInt(num, 10);
        if (isNaN(n)) return String(num);
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        return String(n);
    }

    // 获取主视频流网格容器
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
            if (el.closest(USER_MODULE_SELECTOR)) continue;
            return el;
        }
        return null;
    }

    // 获取原生卡片列克隆模板（保证 scoped CSS 与栅格样式完全一致）
    function getSampleColumnTemplate(container) {
        if (cachedSampleCol) return cachedSampleCol;
        if (!container) return null;

        const cols = container.querySelectorAll('div[class*="col_"]');
        for (const col of cols) {
            if (col.hasAttribute('data-purified-bvid')) continue;
            if (col.closest(USER_MODULE_SELECTOR)) continue;
            if (col.querySelector('.bili-video-card')) {
                cachedSampleCol = col.cloneNode(true);
                cachedSampleCol.removeAttribute('style');
                cachedSampleCol.querySelectorAll('.bili-video-card__skeleton').forEach(el => el.remove());
                cachedSampleCol.querySelectorAll('.bili-video-card__no-interest').forEach(el => el.remove());
                cachedSampleCol.querySelectorAll('video, iframe, canvas').forEach(el => el.remove());
                cachedSampleCol.querySelectorAll('[class*="subtitle"], [class*="summary"], [class*="ai-"]').forEach(el => el.remove());
                return cachedSampleCol;
            }
        }
        return null;
    }

    // 渲染单张卡片节点
    function createVideoCardElement(videoItem, template) {
        const bvid = videoItem.bvid || videoItem.aid || '';
        const arcurl = videoItem.arcurl || `https://www.bilibili.com/video/${bvid}`;
        let pic = videoItem.pic || '';
        if (pic && !pic.startsWith('http')) pic = 'https:' + pic;
        const coverUrl = pic ? (pic.includes('@') ? pic : `${pic}@672w_378h_1c.webp`) : '';

        const titleHtml = videoItem.title || '';
        const cleanTitleText = (titleHtml || '').replace(/<[^>]+>/g, '').replace(/&[a-z0-9#]+;/gi, '');
        const author = videoItem.author || (videoItem.owner && videoItem.owner.name) || 'UP主';
        const mid = videoItem.mid || '';
        const playStr = formatNumber(videoItem.play || videoItem.stat?.view);
        const danmakuStr = formatNumber(videoItem.video_review || videoItem.stat?.danmaku);
        const durationStr = videoItem.duration || '00:00';
        const pubdate = videoItem.pubdate ? new Date(videoItem.pubdate * 1000).toLocaleDateString() : '';

        if (template) {
            const colDiv = template.cloneNode(true);
            colDiv.setAttribute('data-purified-bvid', bvid);
            colDiv.removeAttribute('style');

            const card = colDiv.querySelector('.bili-video-card');
            if (card) {
                card.setAttribute('data-bsb-bvid', bvid);
                card.removeAttribute('data-report-click');
            }

            colDiv.querySelectorAll('a[href*="/video/"]').forEach(a => a.href = arcurl);

            const picture = colDiv.querySelector('.bili-video-card__cover, picture.v-img');
            if (picture) {
                picture.querySelectorAll('source').forEach(s => s.srcset = coverUrl);
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

            const titEl = colDiv.querySelector('.bili-video-card__info--tit, h3');
            if (titEl) {
                titEl.title = cleanTitleText;
                titEl.innerHTML = titleHtml;
                const titLink = titEl.closest('a') || titEl.querySelector('a');
                if (titLink) titLink.href = arcurl;
            }

            const ownerLink = colDiv.querySelector('.bili-video-card__info--owner');
            if (ownerLink) ownerLink.href = mid ? `//space.bilibili.com/${mid}` : 'javascript:;';
            const authorEl = colDiv.querySelector('.bili-video-card__info--author');
            if (authorEl) authorEl.textContent = author;
            const dateEl = colDiv.querySelector('.bili-video-card__info--date');
            if (dateEl) dateEl.textContent = ` · ${pubdate}`;

            return colDiv;
        }

        // 兜底基础节点构建
        const colDiv = document.createElement('div');
        colDiv.className = 'col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40';
        colDiv.setAttribute('data-purified-bvid', bvid);
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
                                        <span class="bili-video-card__stats--item">${playStr}</span>
                                        <span class="bili-video-card__stats--item">${danmakuStr}</span>
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
        return colDiv;
    }

    // 6. 重构分页与本地视图渲染引擎
    function renderLocalPage(pageNum) {
        currentLocalPage = pageNum;
        const container = getMainVideoContainer();
        if (!container) return;

        const template = getSampleColumnTemplate(container);
        const startIndex = (pageNum - 1) * PAGE_SIZE;
        const pageItems = allFilteredVideos.slice(startIndex, startIndex + PAGE_SIZE);

        // 彻底清空容器内原有的视频列表项
        container.innerHTML = '';

        if (pageItems.length === 0) {
            container.innerHTML = `
                <div style="width: 100%; text-align: center; padding: 60px 0; color: #9499a0; font-size: 15px;">
                    未能检索到符合筛选条件的视频
                </div>
            `;
        } else {
            const fragment = document.createDocumentFragment();
            for (const item of pageItems) {
                const cardEl = createVideoCardElement(item, template);
                if (cardEl) fragment.appendChild(cardEl);
            }
            container.appendChild(fragment);
        }

        renderPaginationBar();
    }

    // 渲染全新的重构分页条
    function renderPaginationBar() {
        const totalCount = allFilteredVideos.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
        if (currentLocalPage > totalPages) currentLocalPage = totalPages;

        let pagerContainer = document.getElementById('bili-purified-pagination');
        if (!pagerContainer) {
            pagerContainer = document.createElement('div');
            pagerContainer.id = 'bili-purified-pagination';
            pagerContainer.className = 'bili-purified-pagination';

            const videoWrapper = document.querySelector('.video.search-all-list, .video.i_wrapper.search-all-list, .search-page-box');
            if (videoWrapper && videoWrapper.parentElement) {
                videoWrapper.after(pagerContainer);
            } else {
                const container = getMainVideoContainer();
                if (container && container.parentElement) {
                    container.parentElement.appendChild(pagerContainer);
                }
            }
        }

        pagerContainer.innerHTML = '';

        // 1. 上一页按钮
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '上一页';
        prevBtn.disabled = currentLocalPage <= 1;
        prevBtn.onclick = () => {
            if (currentLocalPage > 1) {
                renderLocalPage(currentLocalPage - 1);
                scrollToTop();
            }
        };
        pagerContainer.appendChild(prevBtn);

        // 2. 页码按钮（紧凑智能展示）
        const createPageBtn = (p) => {
            const btn = document.createElement('button');
            btn.textContent = String(p);
            if (p === currentLocalPage) btn.className = 'active';
            btn.onclick = () => {
                if (p !== currentLocalPage) {
                    renderLocalPage(p);
                    scrollToTop();
                }
            };
            return btn;
        };

        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) {
                pagerContainer.appendChild(createPageBtn(i));
            }
        } else {
            pagerContainer.appendChild(createPageBtn(1));
            let start = Math.max(2, currentLocalPage - 2);
            let end = Math.min(totalPages - 1, currentLocalPage + 2);

            if (start > 2) {
                const span = document.createElement('span');
                span.textContent = '...';
                span.style.color = '#9499a0';
                pagerContainer.appendChild(span);
            }

            for (let i = start; i <= end; i++) {
                pagerContainer.appendChild(createPageBtn(i));
            }

            if (end < totalPages - 1) {
                const span = document.createElement('span');
                span.textContent = '...';
                span.style.color = '#9499a0';
                pagerContainer.appendChild(span);
            }

            pagerContainer.appendChild(createPageBtn(totalPages));
        }

        // 3. 下一页按钮
        const nextBtn = document.createElement('button');
        nextBtn.textContent = '下一页';
        nextBtn.disabled = currentLocalPage >= totalPages;
        nextBtn.onclick = () => {
            if (currentLocalPage < totalPages) {
                renderLocalPage(currentLocalPage + 1);
                scrollToTop();
            }
        };
        pagerContainer.appendChild(nextBtn);

        // 4. 统计信息栏
        const infoSpan = document.createElement('span');
        infoSpan.className = 'pagination-info';
        infoSpan.textContent = `共筛选出 ${totalCount} 个有效视频 · 当前第 ${currentLocalPage}/${totalPages} 页${isFetchingAll ? ' (后台持续抓取中...)' : ''}`;
        pagerContainer.appendChild(infoSpan);
    }

    function scrollToTop() {
        const container = getMainVideoContainer();
        if (container) {
            const rect = container.getBoundingClientRect();
            window.scrollTo({
                top: rect.top + window.scrollY - 80,
                behavior: 'smooth'
            });
        }
    }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 7. 后台全量 35 页抓取管道
    async function startFullFetchPipeline(queryInfo) {
        if (isFetchingAll) return;
        isFetchingAll = true;
        document.body.classList.add('bili-cleaner-active');

        showProgress(`⚡ 正在全量检索 35 页结果并筛选 (1/35)...`);

        try {
            for (let pageNo = 2; pageNo <= MAX_PAGES_TO_FETCH; pageNo++) {
                // 安全防风控延迟
                await sleep(FETCH_INTERVAL_MS);

                if (!savedFetchTemplateArgs) break;
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

                let data = null;
                try {
                    const resp = await originFetch(fetchArg, init);
                    if (!resp.ok) break;
                    data = await resp.json();
                } catch {
                    break;
                }

                if (!data) break;
                if (data.code !== 0) {
                    if (data.code === -412 || data.code === 412) {
                        showProgress('⚠️ 触发请求频控(-412)，已保留当前抓取结果', 3500);
                    }
                    break;
                }

                const rawBatch = extractVideosFromResponse(data);
                if (rawBatch.length === 0) {
                    // 已至搜索结果末尾
                    break;
                }

                const validBatch = rawBatch.filter(item => testVideoItem(item, queryInfo));
                if (validBatch.length > 0) {
                    allFilteredVideos = allFilteredVideos.concat(validBatch);
                }

                showProgress(`⚡ 正在全量检索: 已检索 ${pageNo}/${MAX_PAGES_TO_FETCH} 页，发现 ${allFilteredVideos.length} 个有效视频...`);
                renderPaginationBar();
            }

            showProgress(`✓ 全量检索完成，共筛选出 ${allFilteredVideos.length} 个有效视频`, 3000);
        } catch (e) {
            console.error('[全量筛选] 异常:', e);
        } finally {
            isFetchingAll = false;
            // 抓取彻底完毕后，确保当前页码视图处于最新并更新分页器
            renderLocalPage(currentLocalPage);
            renderPaginationBar();
        }
    }

    // 8. 网络层拦截：首屏直出 + 启动全量后台聚合
    const originFetch = window.fetch;
    window.fetch = async function(...args) {
        let urlStr = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const isSearchReq = urlStr.includes('/wbi/search') || urlStr.includes('/search/type') || urlStr.includes('/search/all');

        if (!isSearchReq) return originFetch.apply(this, args);

        const queryInfo = getSearchKeywords();

        // 智能脱壳（去掉发往后端的排除词）
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

        // 若当前无任何自定义过滤规则，保持原生 B 站行为与分页
        if (!queryInfo.hasRules) {
            document.body.classList.remove('bili-cleaner-active');
            return originFetch.apply(this, args);
        }

        const currentFullUrl = window.location.href;
        if (currentFullUrl !== lastHandledSearchUrl) {
            lastHandledSearchUrl = currentFullUrl;
            allFilteredVideos = [];
            currentLocalPage = 1;
            cachedSampleCol = null;
        }

        const response = await originFetch.apply(this, args);

        try {
            const clone = response.clone();
            const data = await clone.json();

            if (data?.data?.result) {
                const firstPageRaw = extractVideosFromResponse(data);
                const firstPageValid = firstPageRaw.filter(item => testVideoItem(item, queryInfo));

                allFilteredVideos = firstPageValid.slice();

                // 启动后台全量 35 页抓取管道
                setTimeout(() => {
                    startFullFetchPipeline(queryInfo);
                }, 100);

                // 首屏给 Vue 响应清洗后的第 1 页数据，保证页面秒开
                if (Array.isArray(data.data.result)) {
                    if (data.data.result.length > 0 && Array.isArray(data.data.result[0].data)) {
                        for (const cat of data.data.result) {
                            if (cat.result_type === 'video' || !cat.result_type) {
                                cat.data = firstPageValid;
                            }
                        }
                    } else {
                        data.data.result = firstPageValid;
                    }
                }

                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch (e) {
            console.error('[全量筛选] 首屏接口处理异常:', e);
        }

        return response;
    };

    // 9. DOM 兜底巡检（防止首屏静态卡片逃逸）
    let isProcessingDOM = false;
    function filterDOMElements() {
        if (isProcessingDOM) return;
        isProcessingDOM = true;

        try {
            const queryInfo = getSearchKeywords();
            if (!queryInfo.hasRules) return;

            const elements = document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"]');
            elements.forEach(el => {
                if (el.closest(USER_MODULE_SELECTOR)) return;
                const card = el.closest('[class*="col_"], .video-list-item') || el;
                if (card.hasAttribute('data-purified-bvid')) return;

                const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"]');
                const titleEl = card.querySelector('.bili-video-card__info--tit, h3');
                if (!linkEl || !titleEl) return;

                const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
                const title = cleanText(rawTitle);
                const authorEl = card.querySelector('.bili-video-card__info--author, .up-name');
                const author = cleanText((authorEl?.getAttribute('title') || authorEl?.textContent || '').replace(/[\s·•].*$/, ''));

                let shouldHide = false;
                if (queryInfo.exclude.some(k => title.includes(k))) shouldHide = true;
                else if (queryInfo.normal.length && !queryInfo.normal.every(k => title.includes(k))) shouldHide = true;
                else if (queryInfo.ups.length && !queryInfo.ups.some(k => author.includes(k))) shouldHide = true;

                if (shouldHide) {
                    card.style.setProperty('display', 'none', 'important');
                }
            });
        } finally {
            isProcessingDOM = false;
        }
    }

    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(filterDOMElements);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        });
    } else {
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    console.log('[Bilibili 搜索净化] 2.3.0 (全量35页筛选与重构分页) 已启动。');
})();
