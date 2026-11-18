// ==UserScript==
// @name         Bilibili 视频标题全局黑名单 (DLC)
// @namespace    https://greasyfork.org/users/addpd
// @version      1.0.0
// @description  根据设定的关键词全局过滤 B 站视频（无论搜索结果页还是播放页右侧推荐均可过滤），支持动态黑名单管理与简繁兼容
// @author       Kirosca
// @license      MIT
// @icon         https://www.bilibili.com/favicon.ico
// @match        *://*.bilibili.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ================= 1. 默认黑名单与存储配置 =================
    // 初始黑名单测试内容：过滤标题包含“以防”的视频
    const DEFAULT_BLACKLIST = [
        '以防'
    ];

    const STORAGE_KEY = 'bili_global_title_blacklist';

    // 读取黑名单配置（优先 GM 跨域存储，降级 localStorage）
    function loadBlacklist() {
        let list = null;
        try {
            if (typeof GM_getValue === 'function') {
                list = GM_getValue(STORAGE_KEY, null);
            }
        } catch (e) {
            console.warn('[BiliBlacklist] GM_getValue 异常，尝试降级', e);
        }

        if (!Array.isArray(list)) {
            try {
                const local = localStorage.getItem(STORAGE_KEY);
                if (local) {
                    const parsed = JSON.parse(local);
                    if (Array.isArray(parsed)) list = parsed;
                }
            } catch (e) {}
        }

        if (!Array.isArray(list) || list.length === 0) {
            list = [...DEFAULT_BLACKLIST];
            saveBlacklist(list);
        }

        return list;
    }

    // 保存黑名单配置
    function saveBlacklist(list) {
        if (!Array.isArray(list)) return;
        const cleanedList = [...new Set(list.map(k => String(k).trim()).filter(Boolean))];
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, cleanedList);
            }
        } catch (e) {}
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanedList));
        } catch (e) {}
        return cleanedList;
    }

    let activeBlacklist = loadBlacklist();
    let cacheVersion = Date.now();
    let blockedCount = 0;

    // ================= 2. 文本清洗与繁简归一化 =================
    function cleanText(str) {
        if (!str) return '';
        return String(str)
            .replace(/&#x27;|&#39;|&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/[\u2018\u2019\u201A\u201B\uFF07`]/g, "'")
            .replace(/[\u201C\u201D\uFF02]/g, '"')
            .trim()
            .toLowerCase();
    }

    // 判断标题是否命中黑名单
    function isTitleBlacklisted(rawTitle, blacklist) {
        if (!rawTitle || !Array.isArray(blacklist) || blacklist.length === 0) return false;
        const normalizedTitle = cleanText(rawTitle);
        for (const kw of blacklist) {
            const cleanKw = cleanText(kw);
            if (cleanKw && normalizedTitle.includes(cleanKw)) {
                return true;
            }
        }
        return false;
    }

    // ================= 3. 样式规则预注入（抗闪烁） =================
    const styleEl = document.createElement('style');
    styleEl.id = 'bili-video-blacklist-style';
    styleEl.textContent = `
        [data-bili-blacklist-blocked="true"] {
            display: none !important;
        }
    `;
    (document.head || document.documentElement).appendChild(styleEl);

    // ================= 4. DOM 提取与多端卡片定位 =================

    // 提取视频标题
    function extractVideoTitle(card) {
        const titleSelectors = [
            'h3.bili-video-card__info--tit',
            '.bili-video-card__info--tit',
            '.video-page-card-small .info a .title',
            '.video-page-card-small .info .title',
            '.video-page-related-card .info .title',
            '.info .title',
            'p.title',
            'a.title',
            '.title',
            'h3',
            '.bpx-player-ending-related-item-title'
        ];

        for (const sel of titleSelectors) {
            const titleEl = card.querySelector(sel);
            if (titleEl) {
                const raw = titleEl.getAttribute('title') || titleEl.innerText || titleEl.textContent;
                if (raw && raw.trim()) return raw.trim();
            }
        }

        // 兜底：定位指向视频详情的链接
        const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
        if (linkEl) {
            const titleAttr = linkEl.getAttribute('title');
            if (titleAttr && titleAttr.trim()) return titleAttr.trim();
            const text = linkEl.innerText || linkEl.textContent;
            if (text && text.trim()) return text.trim();
        }

        return '';
    }

    // 向上追溯完整卡片容器（确保隐藏时不留网格空位）
    function findCardContainer(el) {
        return el.closest(
            'div[class*="col_"], .video-list-item, .video-page-card-small, .video-page-related-card, ' +
            '.video-page-special-card-small, .recommend-video-card, .feed-card, .bili-feed-card, ' +
            '#submit-video-list .list-item, .small-item, .bpx-player-ending-related-item, .bili-video-card'
        ) || el;
    }

    // ================= 5. 黑名单核心过滤逻辑 =================
    let isProcessing = false;

    function filterBlacklistedVideos() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            if (!activeBlacklist || activeBlacklist.length === 0) return;

            const targetElements = document.querySelectorAll(`
                .bili-video-card,
                .video-page-card-small,
                .video-page-related-card,
                .video-page-special-card-small,
                .recommend-video-card,
                .feed-card,
                .bili-feed-card,
                .video-list-item,
                .bili-live-card,
                .bpx-player-ending-related-item,
                #submit-video-list .list-item,
                .small-item
            `);

            targetElements.forEach(el => {
                const container = findCardContainer(el);

                // 缓存检查：当前版本已评估通过则跳过
                if (container.dataset.blacklistChecked === String(cacheVersion)) {
                    return;
                }

                const title = extractVideoTitle(container);
                if (!title) return;

                const hit = isTitleBlacklisted(title, activeBlacklist);

                if (hit) {
                    if (container.getAttribute('data-bili-blacklist-blocked') !== 'true') {
                        container.setAttribute('data-bili-blacklist-blocked', 'true');
                        container.style.setProperty('display', 'none', 'important');
                        blockedCount++;
                    }
                } else {
                    if (container.getAttribute('data-bili-blacklist-blocked') === 'true') {
                        container.removeAttribute('data-bili-blacklist-blocked');
                        container.style.removeProperty('display');
                    }
                    container.dataset.blacklistChecked = String(cacheVersion);
                }
            });
        } finally {
            isProcessing = false;
        }
    }

    // 重新全量扫描重载
    function reloadFilter() {
        cacheVersion = Date.now();
        document.querySelectorAll('[data-blacklist-checked]').forEach(node => {
            delete node.dataset.blacklistChecked;
        });
        filterBlacklistedVideos();
    }

    // ================= 6. 监听与帧级节流 =================
    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(filterBlacklistedVideos);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 初次启动执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', filterBlacklistedVideos, { once: true });
    } else {
        filterBlacklistedVideos();
    }

    // ================= 7. 脚本菜单命令注册 (Tampermonkey UI) =================
    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        // 1. 查看与编辑黑名单
        GM_registerMenuCommand('📋 查看 / 编辑全局黑名单关键词', () => {
            const currentStr = activeBlacklist.join(', ');
            const input = prompt(
                '当前标题黑名单关键词（以中文或英文逗号分隔）：\n输入新内容并确定即可生效',
                currentStr
            );
            if (input !== null) {
                const newList = input.split(/[,，\n]+/).map(s => s.trim()).filter(Boolean);
                activeBlacklist = saveBlacklist(newList);
                reloadFilter();
                alert(`黑名单已更新，当前有效关键词数量: ${activeBlacklist.length}`);
            }
        });

        // 2. 添加单个黑名单词
        GM_registerMenuCommand('➕ 添加黑名单关键词', () => {
            const input = prompt('请输入需要屏蔽的视频标题关键词：');
            if (input && input.trim()) {
                const term = input.trim();
                if (!activeBlacklist.includes(term)) {
                    activeBlacklist.push(term);
                    activeBlacklist = saveBlacklist(activeBlacklist);
                    reloadFilter();
                    alert(`已添加黑名单关键词: "${term}"`);
                } else {
                    alert(`关键词 "${term}" 已存在于黑名单中。`);
                }
            }
        });

        // 3. 重置为默认关键词
        GM_registerMenuCommand('🔄 重置为默认测试黑名单 (仅"以防")', () => {
            if (confirm('确认将黑名单重置为默认值 ["以防"] 吗？')) {
                activeBlacklist = saveBlacklist(DEFAULT_BLACKLIST);
                reloadFilter();
                alert('已重置为默认黑名单: ["以防"]');
            }
        });

        // 4. 查看当前过滤统计
        GM_registerMenuCommand('📊 查看本次已屏蔽视频数量', () => {
            const domBlocked = document.querySelectorAll('[data-bili-blacklist-blocked="true"]').length;
            alert(`【Bilibili 全局黑名单 DLC】\n当前黑名单词库: ${activeBlacklist.join(', ')}\n当前页面已隐藏视频数: ${domBlocked} 个\n累计触发拦截计数: ${blockedCount} 次`);
        });
    }

    registerMenu();

    console.log('[Bilibili 视频黑名单 DLC] 1.0.0 已启动，当前屏蔽词:', activeBlacklist);
})();
