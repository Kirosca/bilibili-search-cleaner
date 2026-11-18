// ==UserScript==
// @name         Bilibili 搜索页自动无缝翻页 (键值对字典去重版)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  从 AutoPager 独立提取的 B站搜索页无缝翻页脚本，基于全局键值对哈希字典实现视频精准去重：只要字典已存在，绝不追加；若 DOM 存在重复即刻物理移除。
// @author       xiusu / modified
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 0. 路由匹配判定（仅在有效搜索页生效）
    function isValidSearchPage() {
        const path = window.location.pathname;
        const validPaths = ['/all', '/video', '/pgc', '/article'];
        const isPathMatched = validPaths.some(p => path === p || path.startsWith(p + '/'));
        const hasKeyword = window.location.search.includes('keyword=') || window.location.hash.includes('keyword=');
        return isPathMatched && hasKeyword;
    }

    if (!isValidSearchPage()) return;

    // 1. 注入响应式样式与 iframe 隐藏样式
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .to_hide_md:not(.to_hide_xl) { display: initial !important; }
        iframe#bili_autopager_iframe {
            position: absolute !important;
            top: -9999px !important;
            left: -9999px !important;
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            z-index: -999 !important;
        }
    `;
    (document.head || document.documentElement).appendChild(styleEl);

    // 2. 状态锁、配置参数与全局持久键值对字典
    const CONFIG = {
        scrollDistance: 3000,                                         // 距离底部 3000px 时预加载下一页
        loadTime: 600,                                               // iframe 等待渲染基准耗时 (600ms)
        pageSelector: '.video-list-item, .media-list>div, .video-list>div', // 卡片选择器
        replaceSelector: '.vui_pagenation--btns',                    // 底部分页器选择器
        userModuleSelector: '.user-video-info, .search-user-card, .user-list, [class*="user-video"], [class*="search-user"]'
    };

    let isPaging = false;
    let lastLoadedUrl = '';
    let lastSearchKeyword = '';

    // 全局持久键值对字典（纯净无原型对象，查询复杂度 O(1)）
    let seenVideoMap = Object.create(null);

    // 3. 核心键（Key）提取器：HTML 穿透提取唯一标识
    function getVideoKey(card) {
        if (!card) return '';

        const html = card.innerHTML || '';

        // 优先匹配标准 BV 号 (BV + 10位字符)
        const matchBV = html.match(/\b(BV[a-zA-Z0-9]{10})\b/i);
        if (matchBV) return matchBV[1].toLowerCase();

        // 匹配 av 号
        const matchAV = html.match(/\/video\/(av\d+)/i);
        if (matchAV) return matchAV[1].toLowerCase();

        // 匹配番剧/影视 ep 或 ss 号
        const matchPGC = html.match(/\/bangumi\/play\/(ep\d+|ss\d+)/i);
        if (matchPGC) return matchPGC[1].toLowerCase();

        // 匹配直播间 ID
        const matchLive = html.match(/live\.bilibili\.com\/(\d+)/i);
        if (matchLive) return 'live_' + matchLive[1];

        // 匹配专栏 cv 号
        const matchCV = html.match(/\/read\/(cv\d+)/i);
        if (matchCV) return matchCV[1].toLowerCase();

        // 兜底：清洗标点后的规范化纯标题（防止商业推广等无 BV 卡片跨页重复）
        const titleEl = card.querySelector('h3, [class*="title"], [title]');
        const rawTitle = titleEl?.getAttribute('title') || titleEl?.textContent || '';
        const cleanTitle = rawTitle.replace(/[\s\p{P}]+/gu, '').toLowerCase();
        if (cleanTitle) return 'tit_' + cleanTitle;

        return '';
    }

    // 获取主视频流容器（严格排除作者模块）
    function getMainListContainer(rootDoc = document) {
        const candidates = rootDoc.querySelectorAll(
            '.video.search-all-list .video-list, ' +
            '.video.i_wrapper .video-list, ' +
            '.search-page-video .video-list, ' +
            '.search-all-list .video-list, ' +
            'div.video-list.row, ' +
            '.video-list'
        );
        for (const el of candidates) {
            if (el.closest(CONFIG.userModuleSelector)) continue;
            return el;
        }
        return null;
    }

    // 4. 将当前主页面真实 DOM 中的所有视频完整录入键值对字典中
    function syncExistingToMap() {
        const container = getMainListContainer(document);
        const scope = container || document;
        scope.querySelectorAll(CONFIG.pageSelector).forEach(card => {
            if (card.closest(CONFIG.userModuleSelector)) return;
            const key = getVideoKey(card);
            if (key) {
                seenVideoMap[key] = true;
            }
        });
    }

    // 5. 终极防线：DOM 级物理去重（保证已渲染树中绝无重复节点）
    function purgeDuplicatesInDOM() {
        const container = getMainListContainer(document);
        const scope = container || document;
        const liveMap = Object.create(null);
        let removedCount = 0;

        scope.querySelectorAll(CONFIG.pageSelector).forEach(card => {
            if (card.closest(CONFIG.userModuleSelector)) return;
            const key = getVideoKey(card);
            if (key) {
                if (liveMap[key]) {
                    card.remove(); // 发现 DOM 中已存在相同键，立即物理删除重复节点
                    removedCount++;
                } else {
                    liveMap[key] = true;
                    seenVideoMap[key] = true;
                }
            }
        });

        if (removedCount > 0) {
            console.log(`[B站独立无缝翻页] DOM 物理去重完成，移除了 ${removedCount} 个重复视频卡片`);
        }
    }

    // 6. 搜索词重置检查
    function checkKeywordReset() {
        const params = new URLSearchParams(window.location.search);
        const currentKw = params.get('keyword') || window.location.hash || '';
        if (currentKw !== lastSearchKeyword) {
            lastSearchKeyword = currentKw;
            seenVideoMap = Object.create(null); // 更换搜索词时清空旧字典
            syncExistingToMap();
        }
    }

    // 7. 计算下一页完整地址（getNextEP 原理）
    function getNextPageUrl() {
        const nextNumBtn = document.querySelector('.vui_pagenation--btn-num.vui_button--active + button.vui_pagenation--btn-num');
        if (!nextNumBtn) return '';

        const nextNum = nextNumBtn.textContent.trim();
        if (!nextNum) return '';

        const reg = /page=\d+(&o=\d+)?/;
        let nextSearch = window.location.search;

        if (reg.test(nextSearch)) {
            nextSearch = nextSearch.replace(reg, 'page=' + nextNum);
        } else {
            const sep = nextSearch ? '&' : '?';
            nextSearch = nextSearch + sep + 'page=' + nextNum;
        }

        return window.location.origin + window.location.pathname + nextSearch;
    }

    // 8. 创建或复用隐藏 iframe
    function getOrCreateIframe() {
        let iframe = document.getElementById('bili_autopager_iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'bili_autopager_iframe';
            document.documentElement.appendChild(iframe);
        }
        return iframe;
    }

    // 9. 核心元素处理：键值对字典过滤 + 正序挂载 + 物理兜底
    function processIframeDocument(iframeDoc, nextUrl) {
        checkKeywordReset();
        syncExistingToMap(); // 挂载前先将主页面最新状态全部打入字典

        const container = getMainListContainer(document);
        const iframeContainer = getMainListContainer(iframeDoc);

        const targetIframeScope = iframeContainer || iframeDoc;
        const rawNewCards = Array.from(targetIframeScope.querySelectorAll(CONFIG.pageSelector)).filter(c => !c.closest(CONFIG.userModuleSelector));

        if (rawNewCards.length === 0) {
            console.warn('[B站独立无缝翻页] 未能在 iframe 中匹配到视频卡片');
            return;
        }

        // 核心去重：在键值对字典中查重，有则坚决不添加
        const toAppend = [];
        let duplicateCount = 0;

        for (const card of rawNewCards) {
            const key = getVideoKey(card);

            // 规则：无有效 Key 或者在字典中已存在，绝对不添加
            if (!key || seenVideoMap[key]) {
                duplicateCount++;
                continue;
            }

            // 存入键值对字典，并加入待追加列表
            seenVideoMap[key] = true;
            toAppend.push(card);
        }

        const currentScope = container || document;
        const currentCards = Array.from(currentScope.querySelectorAll(CONFIG.pageSelector)).filter(c => !c.closest(CONFIG.userModuleSelector));
        const lastCard = currentCards.length > 0 ? currentCards[currentCards.length - 1] : null;

        // 若有未重复的新视频，正序挂载
        if (toAppend.length > 0) {
            if (lastCard && typeof lastCard.after === 'function') {
                lastCard.after(...toAppend);
            } else if (container) {
                container.append(...toAppend);
            } else if (lastCard) {
                let anchor = lastCard;
                toAppend.forEach(card => {
                    anchor.insertAdjacentElement('afterend', card);
                    anchor = card;
                });
            }
            console.log(`[B站独立无缝翻页] 字典放行追加 ${toAppend.length} 个新视频（已精准拦截 ${duplicateCount} 个重复视频）`);
        } else {
            console.warn(`[B站独立无缝翻页] 本页 ${duplicateCount} 个视频均在字典中已存在，全部跳过`);
        }

        // 挂载完毕后执行 DOM 物理去重兜底
        purgeDuplicatesInDOM();

        // 替换底部分页栏
        const oldPager = document.querySelector(CONFIG.replaceSelector);
        const newPager = iframeDoc.querySelector(CONFIG.replaceSelector);
        if (oldPager && newPager) {
            oldPager.outerHTML = newPager.outerHTML;
        }

        // 同步浏览器地址栏历史记录
        try {
            window.history.replaceState(null, '', nextUrl);
        } catch {}

        lastLoadedUrl = nextUrl;

        // 若本页视频全被拦截丢弃且滚动条依然在底部附近，延迟继续尝试触发下一页
        if (toAppend.length === 0) {
            setTimeout(() => {
                handleScroll();
            }, 350);
        }
    }

    // 10. iframe 沙盒加载与分步模拟滚动（insIframe_ 核心机制）
    function loadNextPage(nextUrl) {
        if (isPaging) return;
        if (nextUrl === lastLoadedUrl) return;

        isPaging = true;
        const iframe = getOrCreateIframe();

        iframe.onload = function() {
            let step = 0;
            const stepInterval = CONFIG.loadTime / 10; // 60ms

            // 分 12 次步进模拟滚动，触发 B 站官方脚本的客户端 Vue 渲染和图片懒加载
            const scrollTimer = setInterval(() => {
                const win = iframe.contentWindow;
                const doc = win?.document;
                if (!win || !doc) {
                    clearInterval(scrollTimer);
                    isPaging = false;
                    return;
                }

                const scrollHeight = (doc.documentElement.scrollHeight || doc.body.scrollHeight) / 10;
                win.scrollTo(0, 999999);
                win.scrollTo(0, scrollHeight * step);

                if (++step === 12) {
                    clearInterval(scrollTimer);
                    try {
                        processIframeDocument(doc, nextUrl);
                    } catch (err) {
                        console.error('[B站独立无缝翻页] DOM 挂载异常:', err);
                    } finally {
                        isPaging = false; // 解锁
                    }
                }
            }, stepInterval);
        };

        // 清除 hash 后赋予 iframe src，正式触发加载
        iframe.src = nextUrl.replace(/#.+$/, '');
    }

    // 11. 滚动监听调度器
    let lastScrollY = window.scrollY;

    function handleScroll() {
        if (isPaging) return;

        const currentScrollY = window.scrollY;
        const isScrollingDown = currentScrollY > lastScrollY;
        lastScrollY = currentScrollY;

        if (!isScrollingDown) return;

        const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
        const clientHeight = window.innerHeight || document.documentElement.clientHeight;
        const distanceToBottom = scrollHeight - (currentScrollY + clientHeight);

        // 距离页面底部不足 3000px 时拉取下一页
        if (distanceToBottom <= CONFIG.scrollDistance) {
            const nextUrl = getNextPageUrl();
            if (nextUrl && nextUrl !== lastLoadedUrl) {
                loadNextPage(nextUrl);
            }
        }
    }

    // 页面初始化：延迟 1 秒待首屏渲染完毕后，完整构建首屏字典
    setTimeout(() => {
        syncExistingToMap();
        purgeDuplicatesInDOM();
    }, 1000);

    // 监听全局滚动
    window.addEventListener('scroll', handleScroll, { passive: true });

    console.log('[B站独立无缝翻页] 1.3.0 (键值对字典去重版) 已就绪。');
})();
