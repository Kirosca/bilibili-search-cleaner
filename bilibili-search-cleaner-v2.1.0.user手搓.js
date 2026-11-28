// ==UserScript==
// @name         Bilibili 去掉搜索无关视频
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  去掉搜索无关视频/12维视频品质分类/自动翻页：1.支持用【标题、-标题排除、#标签和@UP主】筛选视频 2.视频品质（神作/干货/宝藏/避坑等） 3.无缝瀑布流与筛选常驻（支持简繁）。
// @author       Kirosca
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.jsdmirror.com/npm/opencc-js@1.4.2/dist/umd/t2cn.js
// 备用保底链接:  https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/umd/t2cn.js
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
    // 菜单管理与持久化配置（虚化显示 & 筛选常驻 & 无缝瀑布流 & 评价体系）
    // ==========================================
    let isDimmed = localStorage.getItem('bili_cleaner_dimmed') !== 'false';
    let isFilterSticky = localStorage.getItem('bili_cleaner_sticky_filter') !== 'false';
    let isWaterfall = localStorage.getItem('bili_cleaner_waterfall') !== 'false';

    // 仅限综合/视频搜索路径（/all、/video）
    function isVideoSearchPath() {
        try {
            return /^\/(all|video)\/?$/i.test(window.location.pathname || '');
        } catch (e) {
            return false;
        }
    }
    let isEvaluationBadge = localStorage.getItem('bili_cleaner_eval_badge') !== 'false';
    let isEvalFullMode = localStorage.getItem('bili_cleaner_eval_full_mode') !== 'false';
    let isEvalScoreEnabled = localStorage.getItem('bili_cleaner_eval_score') !== 'false';
    let isSyntaxFilter = localStorage.getItem('bili_cleaner_syntax_filter') === 'true';
    // 选中的品质标签筛选集合（多选，空集合代表全部/不限）
    let activeQualityFilters = new Set();
    try {
        const savedFilters = JSON.parse(localStorage.getItem('bili_cleaner_active_quality_filters') || '[]');
        if (Array.isArray(savedFilters) && isEvaluationBadge) {
            savedFilters.forEach(k => {
                if (k && k !== 'exclude_warning') activeQualityFilters.add(k);
            });
        }
    } catch (e) {}
    let toggleAllMenuId = null;
    let syntaxFilterMenuId = null;
    let filterStickyMenuId = null;
    let dimmedMenuId = null;
    let waterfallMenuId = null;
    let evalBadgeMenuId = null;
    let evalModeMenuId = null;
    let evalScoreMenuId = null;

    // 注册与更新油猴菜单命令
    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        // 注销上一轮菜单，防止重复追加
        if (typeof GM_unregisterMenuCommand === 'function') {
            if (toggleAllMenuId !== null) {
                try { GM_unregisterMenuCommand(toggleAllMenuId); } catch (e) {}
            }
            if (syntaxFilterMenuId !== null) {
                try { GM_unregisterMenuCommand(syntaxFilterMenuId); } catch (e) {}
            }
            if (filterStickyMenuId !== null) {
                try { GM_unregisterMenuCommand(filterStickyMenuId); } catch (e) {}
            }
            if (dimmedMenuId !== null) {
                try { GM_unregisterMenuCommand(dimmedMenuId); } catch (e) {}
                dimmedMenuId = null;
            }
            if (waterfallMenuId !== null) {
                try { GM_unregisterMenuCommand(waterfallMenuId); } catch (e) {}
            }
            if (evalBadgeMenuId !== null) {
                try { GM_unregisterMenuCommand(evalBadgeMenuId); } catch (e) {}
            }
            if (evalModeMenuId !== null) {
                try { GM_unregisterMenuCommand(evalModeMenuId); } catch (e) {}
                evalModeMenuId = null;
            }
            if (evalScoreMenuId !== null) {
                try { GM_unregisterMenuCommand(evalScoreMenuId); } catch (e) {}
                evalScoreMenuId = null;
            }
        }

        const isAllEnabled = isSyntaxFilter && isFilterSticky && isDimmed && isWaterfall && isEvaluationBadge;
        const isAllDisabled = !isSyntaxFilter && !isFilterSticky && !isDimmed && !isWaterfall && !isEvaluationBadge;
        const toggleAllStatus = isAllEnabled ? '✅ 已开启' : (isAllDisabled ? '❌ 已关闭' : '🌓 部分开启');
        const toggleAllLabel = `⚡ 一键全开/全关: ${toggleAllStatus}`;
        toggleAllMenuId = GM_registerMenuCommand(toggleAllLabel, toggleAllFeatures);

        const filterStickyLabel = `⚓ 搜索筛选常驻: ${isFilterSticky ? '✅ 已开启' : '❌ 已关闭'}`;
        filterStickyMenuId = GM_registerMenuCommand(filterStickyLabel, toggleFilterSticky);

        const waterfallLabel = `🌊 无缝瀑布流: ${isWaterfall ? '✅ 已开启' : '❌ 已关闭'}`;
        waterfallMenuId = GM_registerMenuCommand(waterfallLabel, toggleWaterfall);

        const syntaxFilterLabel = `🗝️ 搜索语法过滤 (Alt+Q): ${isSyntaxFilter ? '✅ 已开启' : '❌ 已关闭'}`;
        syntaxFilterMenuId = GM_registerMenuCommand(syntaxFilterLabel, toggleSyntaxFilter);

        // 二级级联子菜单：仅在搜索语法过滤开启时展示虚化显示开关
        if (isSyntaxFilter) {
            const dimmedLabel = `  └─ 虚化显示模糊内容: ${isDimmed ? '✅ 已开启' : '❌ 已关闭'}`;
            dimmedMenuId = GM_registerMenuCommand(dimmedLabel, toggleDimmed);
        }

        const evalBadgeLabel = `🏷️ 视频品质标签: ${isEvaluationBadge ? '✅ 已开启' : '❌ 已关闭'}`;
        evalBadgeMenuId = GM_registerMenuCommand(evalBadgeLabel, toggleEvaluationBadge);

        // 二级级联子菜单：仅在品质标签开启时展示显示范围与显性评分开关
        if (isEvaluationBadge) {
            const evalModeLabel = `  ├─ 标签可见范围: ${isEvalFullMode ? '📑 全部展示' : '✨ 仅精选'}`;
            evalModeMenuId = GM_registerMenuCommand(evalModeLabel, toggleEvalMode);

            const evalScoreLabel = `  └─ 封面显性评分: ${isEvalScoreEnabled ? '✅ 已开启' : '❌ 已关闭'}`;
            evalScoreMenuId = GM_registerMenuCommand(evalScoreLabel, toggleEvalScore);
        }
    }

    // 切换搜索语法过滤状态并持久化配置（默认关闭；关闭后停止接口脱壳并保留广告剔除与品质筛选）
    function toggleSyntaxFilter() {
        isSyntaxFilter = !isSyntaxFilter;
        localStorage.setItem('bili_cleaner_syntax_filter', String(isSyntaxFilter));
        registerMenu();

        document.querySelectorAll('[data-purified-query]').forEach(card => {
            delete card.dataset.purifiedQuery;
        });
        filterDOMElements();
    }

    // 一键全开 / 全关所有功能（严格按顺序依次调用现有菜单方法，最后开关【无缝瀑布流】）
    function toggleAllFeatures() {
        const isAllEnabled = isSyntaxFilter && isFilterSticky && isDimmed && isWaterfall && isEvaluationBadge;
        const targetState = !isAllEnabled;

        // 0. 搜索语法过滤
        if (isSyntaxFilter !== targetState) {
            toggleSyntaxFilter();
        }

        // 1. 搜索筛选常驻
        if (isFilterSticky !== targetState) {
            toggleFilterSticky();
        }

        // 2. 虚化显示模糊内容
        if (isDimmed !== targetState) {
            toggleDimmed();
        }

        // 3. 视频品质标签
        if (isEvaluationBadge !== targetState) {
            toggleEvaluationBadge();
        }

        // 4. 最后开关【无缝瀑布流】（以安全处理可能的页面重载或路由复位）
        if (isWaterfall !== targetState) {
            toggleWaterfall();
        } else {
            registerMenu();
        }
    }

    // 切换评价体系显示范围（仅精选 vs 全部展示）
    function toggleEvalMode() {
        isEvalFullMode = !isEvalFullMode;
        localStorage.setItem('bili_cleaner_eval_full_mode', String(isEvalFullMode));
        registerMenu();

        // 重新安检渲染卡片评价
        document.querySelectorAll('[data-purified-query]').forEach(card => {
            delete card.dataset.purifiedQuery;
        });
        filterDOMElements();
    }

    // 切换视频评价体系显示状态并持久化配置（默认开启）
    function toggleEvaluationBadge() {
        isEvaluationBadge = !isEvaluationBadge;
        localStorage.setItem('bili_cleaner_eval_badge', String(isEvaluationBadge));
        registerMenu();
        applyEvaluationBadgeState();

        if (isEvaluationBadge) {
            bindStickyObserver();
            document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card').forEach(el => {
                const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
                delete card.dataset.purifiedQuery;
            });
            filterDOMElements();
        } else {
            // 关闭品质标签体系：清空分类筛选状态与持久化记忆、清除锚点
            activeQualityFilters.clear();
            try {
                localStorage.removeItem('bili_cleaner_active_quality_filters');
            } catch (e) {}
            lastQualityAnchorKey = null;

            // 彻底移除页面中已渲染的品质筛选行和评价勋章列
            document.querySelectorAll('.bili-cleaner-quality-filter-row').forEach(el => el.remove());
            document.querySelectorAll('.bili-cleaner-badge-col').forEach(el => el.remove());

            // 清空卡片安检标记并重新安检，恢复因品质筛选而被隐藏的所有卡片
            document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card').forEach(el => {
                const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
                delete card.dataset.purifiedQuery;
            });
            filterDOMElements();
        }
    }

    // 应用视频评价体系的 CSS 根类名
    function applyEvaluationBadgeState() {
        if (document.documentElement) {
            document.documentElement.classList.toggle('bili-eval-badge-enabled', isEvaluationBadge);
        }
    }

    // 应用封面显性评分的 CSS 根类名
    function applyEvalScoreState() {
        if (document.documentElement) {
            document.documentElement.classList.toggle('bili-eval-score-enabled', isEvalScoreEnabled);
        }
    }

    // 切换封面显性评分显示状态并持久化配置（O(1) 根类名切换，1000+ 卡片零重算）
    function toggleEvalScore() {
        isEvalScoreEnabled = !isEvalScoreEnabled;
        localStorage.setItem('bili_cleaner_eval_score', String(isEvalScoreEnabled));
        applyEvalScoreState();
        registerMenu();
    }

    // 应用虚化显示模糊内容的 CSS 根类名
    function applyDimmedState() {
        if (document.documentElement) {
            document.documentElement.classList.toggle('bili-dimmed-enabled', isDimmed);
        }
    }

    // 切换虚化显示模糊内容状态并持久化配置（O(1) 根类名切换，1000+ 卡片零重算零卡顿）
    function toggleDimmed() {
        isDimmed = !isDimmed;
        localStorage.setItem('bili_cleaner_dimmed', String(isDimmed));
        applyDimmedState();
        registerMenu();

        if (isEvaluationBadge && typeof updateQualityFilterCounts === 'function') {
            updateQualityFilterCounts();
        }
        if (typeof WaterfallLifecycle !== 'undefined') {
            requestAnimationFrame(() => WaterfallLifecycle.sync('filter'));
        }
    }

    // 切换搜索筛选常驻状态并更新样式
    function toggleFilterSticky() {
        isFilterSticky = !isFilterSticky;
        localStorage.setItem('bili_cleaner_sticky_filter', String(isFilterSticky));
        registerMenu();
        applyFilterStickyState();
    }

    // 切换瀑布流状态并在复位后刷新或跳转至第 1 页
    function toggleWaterfall() {
        isWaterfall = !isWaterfall;
        localStorage.setItem('bili_cleaner_waterfall', String(isWaterfall));
        registerMenu();

        // 1. 优先触发官方分页组件的「第 1 页」按钮，通知 B 站内部路由与状态回到首页
        try {
            const firstPageBtn = document.querySelector('button.vui_pagenation--btn-num[aria-label^="第 1 页"]');
            if (firstPageBtn) {
                firstPageBtn.click();
                // 通知 B 站内部路由与 Pinia 状态回到首页，为后续强制重置预留渲染时间
            }
        } catch (e) {}

        // 2. 强制重置瀑布流核心状态到第 1 页
        currentRequestedPage = 1;
        seenBvidMap.clear();
        totalRequestedVideos = 0;
        cachedCardTemplate = null;
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

    // 应用搜索筛选常驻的 CSS 类名并绑定变动观察者
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

    // 同步并应用瀑布流当前生命周期状态
    function applyWaterfallState() {
        if (typeof syncWaterfallLifecycle === 'function') {
            syncWaterfallLifecycle();
        }
    }

    registerMenu();
    applyDimmedState();
    applyFilterStickyState();
    applyEvaluationBadgeState();
    applyEvalScoreState();
 
    // 0. 接入 OpenCC 单例转换器（由 @require 本地持久化驱动）
    let sConverter = null;
    // 将文本由繁体中文转换为简体中文
    function toSimplified(text) {
        if (!text) return '';
        if (!/[^\x00-\x7F]/.test(text)) return text;
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

        /* 0.1 长列表离屏渲染优化：跳过视口外离屏卡片的绘制与重排，节约内存与 CPU */
        /* padding-bottom: 1px 为 contain:paint 提供次像素安全缓冲区，防止 110%/120% 缩放下底部边框被裁剪 */
        .video-list-item, div[class*="col_"] {
            content-visibility: auto;
            contain-intrinsic-size: auto 300px;
            padding-bottom: 1px !important;
        }

        /* 关闭虚化时：直接物理隐藏未通过语法的卡片 */
        html:not(.bili-dimmed-enabled) [data-syntax-pass="0"] {
            display: none !important;
        }

        /* 1. 未匹配卡片常态暗化（仅开启虚化时生效）：深度半透明 + 灰度去色 + 占位保留 */
        html.bili-dimmed-enabled .bili-video-card,
        html.bili-dimmed-enabled .bili-live-card {
            transition: opacity 0.25s ease, filter 0.25s ease, transform 0.25s ease !important;
        }
        html.bili-dimmed-enabled .bili-cleaner-dimmed {
            opacity: 0.16 !important;
            filter: grayscale(85%) contrast(85%) !important;
        }

        /* 1.1 视频卡片封面评价勋章（左上角常驻胶囊标签，直接常驻展示） */
        .bili-cleaner-badge-col {
            position: absolute !important;
            top: 6px !important;
            left: 6px !important;
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            z-index: 10 !important;
            pointer-events: auto !important;
            max-width: calc(100% - 12px) !important;
        }

        /* 评价体系菜单未开启时彻底物理隐藏 */
        html:not(.bili-eval-badge-enabled) .bili-cleaner-badge-col {
            display: none !important;
        }
        .bili-cleaner-badge-pill {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            padding: 2.5px 7px !important;
            border-radius: 10px !important;
            font-size: 11px !important;
            font-weight: 600 !important;
            line-height: 1.2 !important;
            user-select: none !important;
            box-sizing: border-box !important;
            backdrop-filter: blur(8px) !important;
            -webkit-backdrop-filter: blur(8px) !important;
            cursor: pointer !important;
            max-width: 100% !important;
            white-space: nowrap !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28) !important;
        }

        .bili-cleaner-badge-tag {
            font-weight: 700 !important;
            flex-shrink: 0 !important;
            letter-spacing: 0.2px !important;
        }
        .bili-cleaner-badge-score {
            font-size: 10.5px !important;
            font-weight: 600 !important;
            opacity: 0.9 !important;
            font-variant-numeric: tabular-nums !important;
            flex-shrink: 0 !important;
        }
        html:not(.bili-eval-score-enabled) .bili-cleaner-badge-score {
            display: none !important;
        }

        /* --- 纯品质金字塔胶囊配色体系 --- */
        /* 1. 🏆 殿堂神作：耀目流金 */
        .bili-cleaner-badge-pill.q-hall-of-fame {
            background: linear-gradient(135deg, rgba(255, 170, 0, 0.95), rgba(255, 102, 0, 0.95)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(255, 235, 180, 0.7) !important;
            box-shadow: 0 0 10px rgba(255, 170, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }
        /* 1.5. ⚡ 爆款短片：电光青碧渐变（高能快节奏短片，互动爆棚） */
        .bili-cleaner-badge-pill.q-viral-short {
            background: linear-gradient(135deg, rgba(6, 182, 212, 0.95), rgba(16, 185, 129, 0.95)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(165, 243, 252, 0.7) !important;
            box-shadow: 0 0 10px rgba(6, 182, 212, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }
        /* 2. 💡 硬核干货：琥珀密金 */
        .bili-cleaner-badge-pill.q-hardcore {
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.92), rgba(217, 119, 6, 0.92)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(255, 215, 0, 0.5) !important;
            box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4) !important;
        }
        /* 3. ⭐ 高口碑佳作：清亮透蓝 */
        .bili-cleaner-badge-pill.q-high-reputation {
            background: linear-gradient(135deg, rgba(0, 174, 236, 0.92), rgba(0, 120, 215, 0.92)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(180, 230, 255, 0.5) !important;
            box-shadow: 0 2px 8px rgba(0, 174, 236, 0.4) !important;
        }
        /* 4. 💎 冷门宝藏：神秘晶紫 */
        .bili-cleaner-badge-pill.q-hidden-gem {
            background: linear-gradient(135deg, rgba(147, 51, 234, 0.92), rgba(99, 102, 241, 0.92)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(220, 180, 255, 0.5) !important;
            box-shadow: 0 2px 8px rgba(147, 51, 234, 0.4) !important;
        }
        /* 4.5 🏅 综合标杆：铂金玄霜银渐变（六边形战士，赞藏互动态度全面均衡无短板） */
        .bili-cleaner-badge-pill.q-balanced-masterpiece {
            background: linear-gradient(135deg, rgba(71, 85, 105, 0.95), rgba(30, 41, 59, 0.98)) !important;
            color: #f8fafc !important;
            border: 1px solid rgba(226, 232, 240, 0.75) !important;
            box-shadow: 0 0 10px rgba(148, 163, 184, 0.35), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }
        /* 5. 💥 话题焦点：霓虹紫粉渐变（弹幕密集与评论热烈齐飞，全网热议/深度探讨） */
        .bili-cleaner-badge-pill.q-opinion-storm {
            background: linear-gradient(135deg, rgba(236, 72, 153, 0.95), rgba(168, 85, 247, 0.95)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(251, 207, 232, 0.7) !important;
            box-shadow: 0 0 10px rgba(236, 72, 153, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }
        /* 6. 💬 激辩热议：深海电光靛蓝渐变（理性论辩/深度观点交锋，与冷门宝藏的晶紫彻底区分） */
        .bili-cleaner-badge-pill.q-heated-debate {
            background: linear-gradient(135deg, rgba(37, 99, 235, 0.95), rgba(79, 70, 229, 0.95)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(191, 219, 254, 0.7) !important;
            box-shadow: 0 2px 8px rgba(37, 99, 235, 0.45) !important;
        }
        /* 7. 🔥 弹幕密集：烈焰霓橙（高互动/名场面/弹幕密集） */
        .bili-cleaner-badge-pill.q-danmaku-carnival {
            background: linear-gradient(135deg, rgba(255, 68, 102, 0.92), rgba(255, 120, 40, 0.92)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(255, 200, 210, 0.5) !important;
            box-shadow: 0 2px 8px rgba(255, 68, 102, 0.4) !important;
        }
        /* 8. ⚠️ 谨慎观看（低质避坑预警）：警示赤红 */
        .bili-cleaner-badge-pill.q-warning {
            background: linear-gradient(135deg, rgba(220, 38, 38, 0.92), rgba(153, 27, 27, 0.92)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(254, 202, 202, 0.5) !important;
            box-shadow: 0 2px 8px rgba(220, 38, 38, 0.4) !important;
        }
        /* 9. 🍀 稳健良作：深林墨玉绿渐变（典雅沉稳，有分量感） */
        .bili-cleaner-badge-pill.q-routine {
            background: linear-gradient(135deg, rgba(16, 110, 75, 0.88), rgba(10, 70, 50, 0.92)) !important;
            color: #ffffff !important;
            border: 1px solid rgba(74, 222, 128, 0.35) !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25) !important;
        }
        /* 10. 🌱 样本较少（冷门置信度保护）：低调雾霾蓝灰 */
        .bili-cleaner-badge-pill.q-low-sample {
            background: rgba(30, 41, 59, 0.82) !important;
            color: rgba(148, 163, 184, 0.95) !important;
            border: 1px solid rgba(148, 163, 184, 0.25) !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2) !important;
        }

        /* 3. 暗化卡片悬停临时查验 */
        html.bili-dimmed-enabled .bili-cleaner-dimmed:hover {
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

        /* 4.5. 搜索结果顶部品质药丸多选筛选栏 (嵌入 .more-conditions) */
        .bili-cleaner-quality-filter-row {
            display: flex;
            align-items: flex-start;
            flex-wrap: wrap;
            padding: 7px 0;
            margin-top: 5px;
            border-top: 1px dashed rgba(148, 153, 160, 0.25);
            font-size: 13px;
            user-select: none;
            gap: 6px 8px;
        }
        .bili-cleaner-filter-label {
            color: #61666d;
            font-weight: 500;
            line-height: 26px;
            margin-right: 6px;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .bili-cleaner-filter-pills-box {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            flex: 1;
        }
        .bili-cleaner-filter-pill-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
            border: 1px solid rgba(148, 153, 160, 0.35);
            background: var(--bg1_float);
            color: var(--v_text2);
            transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            line-height: 1.5;
        }
        .bili-cleaner-filter-pill-btn:hover {
            border-color: #00aeec;
            color: #00aeec;
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(0, 174, 236, 0.15);
        }
        .bili-cleaner-filter-pill-btn.active {
            background: #00aeec;
            border-color: #00aeec;
            color: #ffffff !important;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(0, 174, 236, 0.35);
        }
        .bili-cleaner-filter-pill-btn.is-empty:not(.active) {
            opacity: 0.55;
        }
        .bili-cleaner-pill-count {
            font-size: 11px;
            opacity: 0.78;
            font-weight: 400;
        }
        .bili-cleaner-filter-pill-btn.active .bili-cleaner-pill-count {
            opacity: 0.92;
        }

        /* 5. 瀑布流相关样式 */
        html.bili-waterfall-enabled .vui_pagenation,
        html.bili-waterfall-enabled .vui_pagenation--btns {
            visibility: hidden !important;
            position: absolute !important;
            pointer-events: none !important;
            opacity: 0 !important;
        }
        .bili-waterfall-loader {
            display: none;
            align-items: center;
            justify-content: center;
            width: 100% !important;
            box-sizing: border-box;
            margin: 24px auto !important;
            color: #00aeec;
            font-size: 14px;
            font-weight: 500;
            padding: 0 !important;
            position: static !important;
        }
        .bili-waterfall-loader.active {
            display: flex !important;
        }
        .bili-waterfall-loader.ended {
            color: #9499a0;
            font-size: 12px;
            font-weight: normal;
            padding: 0 !important;
            user-select: none;
        }
        .bili-waterfall-loader.ended .bili-waterfall-spinner {
            display: none !important;
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
        #bili-cleaner-toast {
            position: fixed;
            left: 24px;
            bottom: 24px;
            background: var(--bg1_float, rgba(255, 255, 255, 0.95));
            border: 1px solid rgba(0, 174, 236, 0.45);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
            color: var(--v_text1, #18191c);
            padding: 8px 14px;
            border-radius: 18px;
            font-size: 13px;
            font-weight: 600;
            z-index: 100000;
            backdrop-filter: blur(8px);
            pointer-events: none;
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 0.2s ease, transform 0.2s ease;
        }
        #bili-cleaner-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        html.bili-waterfall-enabled #bili-cleaner-toast {
            bottom: 72px;
        }
        #bili-waterfall-badge {
            position: fixed;
            left: 24px;
            bottom: 24px;
            background: var(--bg1_float);
            border: 1px solid rgba(0, 174, 236, 0.35);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
            color: var(--v_text1);
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
            transform: translateY(-1px);
            box-shadow: 0 6px 18px rgba(0, 174, 236, 0.25);
            border-color: #00aeec;
        }
        #bili-waterfall-badge.paused {
            background: rgba(245, 246, 247, 0.96);
            border-color: rgba(148, 153, 160, 0.35);
            color: #61666d;
        }
        #bili-waterfall-badge.paused svg {
            filter: grayscale(0.6) opacity(0.7);
        }
    `;
    (document.head || document.documentElement).appendChild(styleElement);
 
    // 3. 解析当前 URL 中的关键词分类 (普通词 / -排除词 / #Tag词 / @UP主词)
    let cachedSearchKwKey = null;
    let cachedSearchKwResult = null;
    function getSearchKeywords() {
        const cacheKey = window.location.search + '||' + window.location.hash;
        if (cachedSearchKwKey === cacheKey && cachedSearchKwResult) {
            return cachedSearchKwResult;
        }
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
        if (!rawKeyword) {
            cachedSearchKwKey = cacheKey;
            cachedSearchKwResult = { normal: [], exclude: [], tags: [], ups: [] };
            return cachedSearchKwResult;
        }
 
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
        cachedSearchKwKey = cacheKey;
        cachedSearchKwResult = { normal, exclude, tags, ups };
        return cachedSearchKwResult;
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
    const videoStatMap = new Map();
    const MAX_CACHE_MAP_SIZE = 5000;

    function setBoundedMap(map, key, value) {
        if (map.size >= MAX_CACHE_MAP_SIZE && !map.has(key)) {
            const oldestKey = map.keys().next().value;
            if (oldestKey !== undefined) map.delete(oldestKey);
        }
        map.set(key, value);
    }

    // 物理剔除数据列表中的商业推广与广告卡片，并提取存储标签字典及量化数据
    function cleanAdsOnly(list) {
        if (!Array.isArray(list)) return list;

        return list.filter(v => {
            if (!v || typeof v !== 'object') return true;

            const tagText = [v.tag, v.keywords, v.tags, v.typename].filter(Boolean).join(',');
            const rawTags = cleanText(tagText);

            if (v.bvid) setBoundedMap(videoTagMap, String(v.bvid), rawTags);
            if (v.aid) {
                setBoundedMap(videoTagMap, String(v.aid), rawTags);
                setBoundedMap(videoTagMap, "av" + v.aid, rawTags);
            }
            if (v.id) setBoundedMap(videoTagMap, String(v.id), rawTags);
            if (v.season_id) setBoundedMap(videoTagMap, String(v.season_id), rawTags);
            if (v.roomid) setBoundedMap(videoTagMap, String(v.roomid), rawTags);

            // 存储量化统计数据（播放、点赞、收藏、弹幕等），供封面评价勋章计算（跳过直播间条目）
            if ((v.bvid || v.aid || v.id) && v.type !== 'live_room' && !v.roomid) {
                const stat = {
                    play: Number(v.play) || 0,
                    like: Number(v.like) || 0,
                    favorites: Number(v.favorites) || 0,
                    danmaku: Number(v.danmaku !== undefined ? v.danmaku : v.video_review) || 0,
                    duration: v.duration,
                    review: Number(v.review) || 0,
                    pubdate: Number(v.pubdate) || 0,
                    typename: v.typename ? String(v.typename).trim() : ''
                };
                if (v.bvid) setBoundedMap(videoStatMap, String(v.bvid).toLowerCase(), stat);
                if (v.aid) setBoundedMap(videoStatMap, String(v.aid), stat);
                if (v.id) setBoundedMap(videoStatMap, String(v.id), stat);
            }

            if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;

            return true;
        });
    }
 
    // 突破油猴沙箱隔离：锁定宿主真实 window 对象
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // 首屏 SSR 初始状态补偿读取（适配现代 Vite + Pinia 架构与旧版 __INITIAL_STATE__）
    function scanInitialState() {
        let hasData = false;
        try {
            const pinia = targetWindow.__pinia;
            if (pinia) {
                // 1. 综合搜索：searchResponse.searchAllResponse.result
                const allRes = pinia.searchResponse?.searchAllResponse?.result;
                if (Array.isArray(allRes)) {
                    for (const cat of allRes) {
                        if (cat.data && Array.isArray(cat.data)) {
                            cleanAdsOnly(cat.data);
                            hasData = true;
                        }
                    }
                }

                // 2. 分类搜索（如 /video）：searchTypeResponse.searchTypeResponse.result
                const typeRes = pinia.searchTypeResponse?.searchTypeResponse?.result;
                if (Array.isArray(typeRes)) {
                    cleanAdsOnly(typeRes);
                    hasData = true;
                }
            }

            // 3. 兜底兼容旧版 SSR 格式
            const state = targetWindow.__INITIAL_STATE__;
            if (state?.flow?.data && Array.isArray(state.flow.data)) {
                cleanAdsOnly(state.flow.data);
                hasData = true;
            } else if (state?.result && Array.isArray(state.result)) {
                cleanAdsOnly(state.result);
                hasData = true;
            }
        } catch (e) {}
        return hasData;
    }
    scanInitialState();

    // 首屏高频轮询提取 Pinia 状态：在首屏渲染后的几十毫秒内尽快拿到点赞/收藏全量数据
    let initPollCount = 0;
    const initPollTimer = setInterval(() => {
        initPollCount++;
        if (scanInitialState() || initPollCount >= 20) {
            clearInterval(initPollTimer);
            document.querySelectorAll('[data-purified-query]').forEach(card => {
                delete card.dataset.purifiedQuery;
            });
            filterDOMElements();
        }
    }, 80);

    window.addEventListener('DOMContentLoaded', () => {
        applyEvaluationBadgeState();
        if (scanInitialState()) {
            document.querySelectorAll('[data-purified-query]').forEach(card => {
                delete card.dataset.purifiedQuery;
            });
        }
        filterDOMElements();
        bindStickyObserver();
    });
    window.addEventListener('load', () => {
        applyEvaluationBadgeState();
        if (scanInitialState()) {
            document.querySelectorAll('[data-purified-query]').forEach(card => {
                delete card.dataset.purifiedQuery;
            });
        }
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
 
        if (isSearchReq && isSyntaxFilter) {
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
                let hasAdRemoved = false;
                if (Array.isArray(data.data.result)) {
                    if (data.data.result.length > 0 && data.data.result[0].data && Array.isArray(data.data.result[0].data)) {
                        for (const cat of data.data.result) {
                            if (cat.result_type === 'video' || cat.result_type === 'live_room' || !cat.result_type) {
                                const beforeLen = Array.isArray(cat.data) ? cat.data.length : 0;
                                cat.data = cleanAdsOnly(cat.data);
                                if (Array.isArray(cat.data) && cat.data.length !== beforeLen) {
                                    hasAdRemoved = true;
                                }
                            }
                        }
                    } else {
                        const beforeLen = data.data.result.length;
                        data.data.result = cleanAdsOnly(data.data.result);
                        if (Array.isArray(data.data.result) && data.data.result.length !== beforeLen) {
                            hasAdRemoved = true;
                        }
                    }
                }
 
                // 数据就绪后唤醒重新安检：仅在首屏搜索响应返回时清除早期未就绪缓存；瀑布流增量翻页时无需重置已有卡片
                if (!isPaging) {
                    setTimeout(() => {
                        document.querySelectorAll('[data-purified-query]').forEach(card => {
                            delete card.dataset.purifiedQuery;
                        });
                        filterDOMElements();
                    }, 50);
                }

                // 官方搜索响应握手：当检测到 B 站发起官方搜索（非瀑布流内部翻页请求）并返回数据时，
                // 延时等待 Vue 将新搜索首屏结果与新分页器渲染挂载到 DOM 树，再唤醒瀑布流状态同步
                if (!isInternalPaging && !isPaging && typeof WaterfallLifecycle !== 'undefined') {
                    setTimeout(() => {
                        WaterfallLifecycle.sync('official-search');
                    }, 120);
                }

                if (!hasAdRemoved) {
                    return response;
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
 
    // 遍历匹配 DOM 卡片元素并执行多维度安检过滤（支持全量扫描或针对新增卡片数组的增量净化）
    function filterDOMElements(target = document) {
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
            const qualityFilterKey = Array.from(activeQualityFilters).sort().join(',');
            const currentQueryKey = currentSearchQuery + '_' + (isSyntaxFilter ? 'syn1' : 'syn0') + '_' + qualityFilterKey;
            let elements = [];
            if (Array.isArray(target)) {
                elements = target;
            } else if (target && target.nodeType) {
                if (target.querySelectorAll) {
                    elements = target.querySelectorAll('.video-list-item, div[class*="col_"], .bili-live-card');
                    if (elements.length === 0) {
                        elements = target.querySelectorAll('.bili-video-card');
                    }
                } else {
                    elements = [target];
                }
            } else {
                elements = document.querySelectorAll('.video-list-item, div[class*="col_"], .bili-live-card');
                if (elements.length === 0) {
                    elements = document.querySelectorAll('.bili-video-card');
                }
            }

            let processedCount = 0;
            const seenBatchCards = new Set();

            elements.forEach(el => {
                const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
                if (seenBatchCards.has(card)) return;
                seenBatchCards.add(card);
 
                // 排除活动、游戏、付费课程及商业推广/广告卡片
                if (card.closest('.activity-game-list, .activity-card, .activity-game-list-item')) return;
                if (card.querySelector('.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]')) return;

                // 性能缓存：当前卡片在本次搜索词及当前模式下若已判定过，直接跳过，零重复计算
                if (card.dataset.purifiedQuery === currentQueryKey) return;
 
                const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                if (!linkEl) return;
 
                const titleEl = card.querySelector('h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3');
                if (!titleEl) return;
 
                // 提取标题并进行反转义与标点规范化
                const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
                const title = cleanText(rawTitle);
 
                const link = linkEl.href || '';
                let id = '';
                const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
                const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
                if (matchVideo) id = matchVideo[1];
                else if (matchLive) id = matchLive[1];
 
                const videoTags = videoTagMap.get(id) || '';
 
                // 纯净提取作者名字（提取第一署名作者）
                const authorEl = card.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname');
                const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';
                const author = cleanText(rawAuthor.replace(/[\s·•].*$/, ''));
 
                let isSyntaxFail = false;

                // 四道安检关卡（仅在开启【筛选语法过滤】时执行）
                if (isSyntaxFilter) {
                    if (exclude.some(k => title.includes(k))) {
                        isSyntaxFail = true;
                    } else if (normal.length && !normal.every(k => title.includes(k))) {
                        isSyntaxFail = true;
                    } else if (tags.length && !tags.every(k => videoTags.includes(k))) {
                        isSyntaxFail = true;
                    } else if (ups.length && !ups.some(k => author.includes(k))) {
                        isSyntaxFail = true;
                    }
                }

                // 在类 v-img bili-video-card__cover 中追加评价勋章（方案 B：右侧竖向勋章），作为最后一个子元素
                let quadrant = null;
                let metrics = null;
                let hasFullStat = false;
                const isLiveCard = card.matches('.bili-live-card') ||
                                   Boolean(matchLive) ||
                                   Boolean(card.querySelector('.bili-video-card__info--living, .v-inline-live-player'));
                const coverEl = card.querySelector('.v-img.bili-video-card__cover, .bili-video-card__cover');
                if (coverEl && !isLiveCard) {
                    let stat = id ? (videoStatMap.get(id.toLowerCase()) || videoStatMap.get(id)) : null;
                    if (stat) {
                        hasFullStat = true;
                    } else {
                        stat = extractStatFromCard(card);
                    }
                    let evalCtx = null;
                    if (!stat.isPartial) {
                        evalCtx = { title, tags: videoTags };
                        metrics = computeQualityMetrics(stat);
                        quadrant = getQualityQuadrant(stat, metrics, evalCtx);
                    }
                    renderBadgeColumn(coverEl, stat, quadrant, metrics, evalCtx);
                } else if (isLiveCard) {
                    hasFullStat = true;
                    if (coverEl) {
                        const existingBadge = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
                        if (existingBadge) existingBadge.remove();
                    }
                }

                // 只有在 Tag 数据就绪且品质全量数据就绪时，才记录缓存标记，避免半成品数据时被提前锁死
                const isTagReady = !tags.length || videoTagMap.size > 0 || !isSyntaxFilter;
                const isStatReady = !isEvaluationBadge || hasFullStat;
                if (card.dataset.externalHidden === undefined && card.style.display !== 'none') {
                    card.dataset.externalHidden = getComputedStyle(card).display === 'none' ? '1' : '0';
                }
                card.dataset.isLive = isLiveCard ? '1' : '0';
                card.dataset.syntaxPass = isSyntaxFail ? '0' : '1';
                card.dataset.qualityClass = quadrant?.className || '';
                if (isTagReady && isStatReady) {
                    card.dataset.purifiedQuery = currentQueryKey;
                }

                // 第五道安检关卡：品质药丸多选筛选过滤（仅在开启【视频品质标签】时生效）
                let isQualityFail = false;
                if (isEvaluationBadge && activeQualityFilters.size > 0) {
                    const qClass = quadrant?.className;
                    // 正向多选品质白名单检查：只有命中目标品质的卡片才能保留；无品质评级或非目标品质严格淘汰隐藏
                    if (!qClass || !activeQualityFilters.has(qClass)) {
                        isQualityFail = true;
                    }
                }

                const innerCard = card.querySelector('.bili-video-card, .bili-live-card') || card;

                // 确保外层列容器不承载虚化类，维持原生栅格间隙纯净
                card.classList.remove('bili-cleaner-dimmed');

                // 核心渲染与可见性决策：
                // 1. 若品质筛选不匹配，彻底物理隐藏；否则移除内联隐藏，由根类名 html.bili-dimmed-enabled + CSS 瞬时控制虚化或隐藏
                if (isQualityFail) {
                    innerCard.classList.remove('bili-cleaner-dimmed');
                    card.style.setProperty('display', 'none', 'important');
                } else {
                    card.style.removeProperty('display');
                    innerCard.classList.toggle('bili-cleaner-dimmed', isSyntaxFail);
                }
                processedCount++;
            });
            if (processedCount > 0) {
                if (isEvaluationBadge && typeof updateQualityFilterCounts === 'function') {
                    updateQualityFilterCounts();
                }
                if (typeof WaterfallLifecycle !== 'undefined') {
                    WaterfallLifecycle.sync('filter');
                }
            }
        } finally {
            isProcessing = false;
        }
    }
 
    // 7. 帧级节流监听：使用 requestAnimationFrame 防抖与增量节点收集
    let rafId = null;
    let pendingAddedNodes = [];
    let pendingFullScan = false;
    let pendingStickyCheck = false;

    function isCleanerOwnNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.id === 'bili-cleaner-toast' || node.id === 'bili-waterfall-badge' || node.id === 'bili-waterfall-loader') return true;
        const cl = node.classList;
        return Boolean(cl && (cl.contains('bili-cleaner-badge-col') || cl.contains('bili-cleaner-quality-filter-row')));
    }

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (isCleanerOwnNode(m.target)) continue;
            if (m.addedNodes && m.addedNodes.length > 0) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1 || isCleanerOwnNode(node)) continue;
                    if (node.matches && node.matches('div.more-conditions, .vui_pagenation, .vui_pagenation--btns')) {
                        pendingStickyCheck = true;
                        pendingFullScan = true;
                    } else if (node.matches && node.matches('.video-list-item, div[class*="col_"], .bili-live-card, .bili-video-card')) {
                        pendingAddedNodes.push(node);
                    } else if (node.querySelector) {
                        if (node.querySelector('div.more-conditions')) pendingStickyCheck = true;
                        const subCards = node.querySelectorAll('.video-list-item, div[class*="col_"], .bili-live-card');
                        if (subCards.length > 0) {
                            for (const c of subCards) pendingAddedNodes.push(c);
                        } else if (node.querySelector('.bili-video-card')) {
                            pendingFullScan = true;
                        }
                    }
                }
            }
        }
        if (!pendingFullScan && pendingAddedNodes.length === 0 && !pendingStickyCheck) return;

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            const doFullScan = pendingFullScan;
            const addedNodes = pendingAddedNodes;
            const doSticky = pendingStickyCheck;
            pendingFullScan = false;
            pendingAddedNodes = [];
            pendingStickyCheck = false;

            if (doFullScan) {
                filterDOMElements();
            } else if (addedNodes.length > 0) {
                filterDOMElements(addedNodes);
            }
            if (doSticky) {
                bindStickyObserver();
            }
            // 分页器节点存活与换新自愈检测：
            // B 站 Vue 在单页切换结果时会直接销毁旧分页器并创建新节点，
            // 此时旧 IntersectionObserver 会停留在脱离文档流的孤立节点上导致失效，
            // 通过监测活跃节点的 isConnected 状态与引用一致性，实现无感自愈重绑
            if (typeof WaterfallLifecycle !== 'undefined') {
                WaterfallLifecycle.sync('dom');
            }
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 8. 快捷键支持：'/' 快速聚焦搜索框；'Alt+Q' 切换搜索语法过滤并展示轻量 Toast
    let toastTimer = null;
    function showCleanerToast(msg) {
        if (!document.body) return;
        let toast = document.getElementById('bili-cleaner-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'bili-cleaner-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        void toast.offsetWidth;
        toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 1500);
    }

    // 获取当前页面中的搜索输入框元素
    function getSearchInput() {
        return document.querySelector('input.search-input-el') ||
               document.querySelector('input.search-input') ||
               document.querySelector('.search-input-wrap input') ||
               document.querySelector('.search-bar input') ||
               document.querySelector('input[type="text"]');
    }

    document.addEventListener('keydown', function(e) {
        const active = document.activeElement;
        const isEditing = active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable
        );

        // 当按键为 '/' 且未按下 Ctrl / Alt / Meta(Cmd) 组合键时触发
        if ((e.key === '/' || e.code === 'Slash') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (!isEditing) {
                const input = getSearchInput();
                if (input) {
                    e.preventDefault(); // 阻止 '/' 字符输入到框内
                    input.focus();
                }
            }
            return;
        }

        // 当按下 Alt + Q 时切换【搜索语法过滤】并在左下角弹出轻量 Toast 提示
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'KeyQ' || (e.key && e.key.toLowerCase() === 'q'))) {
            if (!isEditing) {
                e.preventDefault();
                toggleSyntaxFilter();
                showCleanerToast(`🗝️ 搜索语法过滤：${isSyntaxFilter ? '已开启' : '已关闭'}`);
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

    // 监听筛选条件面板 DOM 变动，确保面板始终处于展开状态
    function bindStickyObserver() {
        const targets = document.querySelectorAll('div.more-conditions');
        targets.forEach(el => {
            if (isFilterSticky) {
                if (!el.dataset.stickyObserved) {
                    el.dataset.stickyObserved = 'true';
                    stickyObserver.observe(el, {
                        attributes: true,
                        attributeFilter: ['class', 'style']
                    });
                }
                enforceConditions(el);
            }
            // 清理可能遗留的旧版过滤模式与筛选语法行
            const oldExtraRows = el.querySelectorAll('.bili-cleaner-dimmed-filter-row, .bili-cleaner-syntax-filter-row');
            oldExtraRows.forEach(r => r.remove());

            injectQualityFilterRow(el);
        });
    }

    // ==========================================
    // 10. 无缝瀑布流独立模块（Wbi API 驱动）
    // ==========================================
    let isWaterfallMounted = false;
    let isWaterfallPaused = false;
    let isPaging = false;
    let currentPagingPromise = null;
    let pagingAbortController = null;
    let pagingSessionSeq = 0;
    let isAllLoaded = false;
    let currentRequestedPage = 1;
    let currentViewportPage = 1;
    let totalViewportPages = 1;
    let maxWaterfallPage = 34;
    let waterfallObserver = null;
    let currentObservedPager = null;
    let isInternalPaging = false;
    const seenBvidMap = new Set();
    let totalRequestedVideos = 0;
    let cachedWbiKeys = null;
    let cachedCardTemplate = null;

    // 内联轻量 MD5 实现（自研自包含，无外部依赖）
    function computeMd5(string) {
        // 32 位循环左移
        function rotL(val, bits) { return (val << bits) | (val >>> (32 - bits)); }
        // 32 位无符号加法
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
        // MD5 基础逻辑运算函数 F, G, H, I
        function F(x, y, z) { return (x & y) | ((~x) & z); }
        // MD5 逻辑函数 G
        function G(x, y, z) { return (x & z) | (y & (~z)); }
        // MD5 逻辑函数 H
        function H(x, y, z) { return (x ^ y ^ z); }
        // MD5 逻辑函数 I 
        function I(x, y, z) { return (y ^ (x | (~z))); }
        // MD5 四轮转换迭代函数 FF, GG, HH, II
        function FF(a,b,c,d,x,s,ac) { return addU(rotL(addU(addU(a, F(b,c,d)), addU(x, ac)), s), b); }
        // MD5 迭代函数 GG
        function GG(a,b,c,d,x,s,ac) { return addU(rotL(addU(addU(a, G(b,c,d)), addU(x, ac)), s), b); }
        // MD5 迭代函数 HH
        function HH(a,b,c,d,x,s,ac) { return addU(rotL(addU(addU(a, H(b,c,d)), addU(x, ac)), s), b); }
        // MD5 迭代函数 II
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
        // 将数值转为十六进制小写格式
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

    // 对编码密钥进行重排映射计算生成 Wbi mixin_key
    function getMixinKey(orig) {
        let temp = '';
        mixinKeyEncTab.forEach(n => { temp += orig[n] || ''; });
        return temp.slice(0, 32);
    }

    // 获取 B 站当前会话的 Wbi 签名密钥（优先从首屏状态读取，次选接口请求）
    async function getWbiKeys() {
        if (cachedWbiKeys) return cachedWbiKeys;
        try {
            const state = targetWindow.__INITIAL_STATE__;
            if (state?.wbi_img?.img_url && state?.wbi_img?.sub_url) {
                const img_url = state.wbi_img.img_url;
                const sub_url = state.wbi_img.sub_url;
                const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
                const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
                cachedWbiKeys = { img_key, sub_key, mixin_key: getMixinKey(img_key + sub_key) };
                return cachedWbiKeys;
            }
            const navRes = await targetWindow.fetch('https://api.bilibili.com/x/web-interface/nav');
            const navData = await navRes.json();
            if (navData?.data?.wbi_img) {
                const img_url = navData.data.wbi_img.img_url;
                const sub_url = navData.data.wbi_img.sub_url;
                const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
                const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
                cachedWbiKeys = { img_key, sub_key, mixin_key: getMixinKey(img_key + sub_key) };
                return cachedWbiKeys;
            }
        } catch (e) {}
        return null;
    }

    // 对请求参数进行 Wbi 签名并生成带 wts 与 w_rid 的查询字符串
    function signWbi(params, img_key, sub_key, cachedMixinKey) {
        const mixin_key = cachedMixinKey || getMixinKey(img_key + sub_key);
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

    // 获取主视频列表容器（兼容首屏综合列表与纯视频列表）
    function getMainListContainer(root = document) {
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

    // 获取或创建瀑布流状态悬浮微标 DOM 元素
    function getOrCreateBadge() {
        if (!isWaterfallMounted) return null;
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

    // 微软官方 Win11 Fluent Emoji (Water Wave 🌊) 矢量 SVG，确保跨设备/跨操作系统绝对一致显示
    const ICON_WAVE_SVG = '<svg viewBox="0 0 32 32" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><path d="M18.7303 8.60911V6.06653H7.03174V26.9651H26.0109V20.3841C25.4929 20.8941 24.42 21.809 22.704 22.3834C21.7762 22.6939 20.6231 22.8701 19.3753 22.9286C19.1503 22.9499 18.9223 22.9607 18.6917 22.9607C14.7286 22.9607 11.5159 19.748 11.5159 15.7849C11.5159 11.8218 14.7286 8.60901 18.6917 8.60901C18.7046 8.60901 18.7175 8.60904 18.7303 8.60911Z" fill="#26C9FC"/><path d="M2.00391 15.154L2.00394 28.9922C2.00394 29.5445 2.45165 29.9922 3.00394 29.9922H28.9937C29.546 29.9922 29.9937 29.5445 29.9937 28.9922L29.9937 17.8442C27.5057 18.7649 25.9825 20.5075 24.1129 22.0289C22.3405 23.4712 20.1514 24.7191 17.0031 24.7191C12.7544 24.7191 7.80713 20.8973 7.80713 15.8858C7.80713 9.86697 12.9891 7.30096 15.8417 7.30096C16.99 7.30096 17.4804 7.54554 17.6761 7.66783L18.8867 9.31877H23.0691V8.3649C22.3965 6.46938 19.5251 2.67834 13.4203 2.67834C7.80713 2.67834 2.00391 8.3649 2.00391 15.154Z" fill="#00A6ED"/><path d="M22.1939 5.86245C22.1939 6.49073 21.6846 7.00005 21.0563 7.00005C20.428 7.00005 19.9187 6.49073 19.9187 5.86245C19.9187 5.23417 20.428 4.72485 21.0563 4.72485C21.6846 4.72485 22.1939 5.23417 22.1939 5.86245Z" fill="#B4F6FC"/><path d="M27.9251 10.2761C28.5534 10.2761 29.0627 9.76673 29.0627 9.13845C29.0627 8.51017 28.5534 8.00085 27.9251 8.00085C27.2968 8.00085 26.7875 8.51017 26.7875 9.13845C26.7875 9.76673 27.2968 10.2761 27.9251 10.2761Z" fill="#B4F6FC"/><path d="M27.9251 16.1137C28.5534 16.1137 29.0627 15.6044 29.0627 14.9761C29.0627 14.3478 28.5534 13.8385 27.9251 13.8385C27.2968 13.8385 26.7875 14.3478 26.7875 14.9761C26.7875 15.6044 27.2968 16.1137 27.9251 16.1137Z" fill="#B4F6FC"/><path d="M19.1854 14.1376C19.1854 14.7659 18.676 15.2752 18.0478 15.2752C17.4195 15.2752 16.9102 14.7659 16.9102 14.1376C16.9102 13.5093 17.4195 13 18.0478 13C18.676 13 19.1854 13.5093 19.1854 14.1376Z" fill="#B4F6FC"/><path d="M25.023 13.1946C25.6513 13.1946 26.1606 12.6853 26.1606 12.057C26.1606 11.6134 25.9066 11.229 25.5361 11.0415C25.8288 10.6142 26 10.0971 26 9.54011C26 8.07111 24.8092 6.88025 23.3402 6.88025C22.4254 6.88025 21.6184 7.34206 21.1398 8.04526C20.6611 7.34206 19.8542 6.88025 18.9394 6.88025C18.1349 6.88025 17.4139 7.23738 16.9262 7.80174C16.4384 7.23738 15.7174 6.88025 14.9129 6.88025C13.4439 6.88025 12.2531 8.07111 12.2531 9.54011C12.2531 11.0091 13.4439 12.2 14.9129 12.2C15.7174 12.2 16.4384 11.8428 16.9262 11.2785C17.4139 11.8428 18.1349 12.2 18.9394 12.2C19.8542 12.2 20.6611 11.7382 21.1398 11.035C21.6184 11.7382 22.4254 12.2 23.3402 12.2C23.5282 12.2 23.7116 12.1805 23.8886 12.1434C23.9327 12.7313 24.4237 13.1946 25.023 13.1946Z" fill="#B4F6FC"/></svg>';

    // 更新瀑布流悬浮微标的文本内容与激活状态（显示当前窗口所在页 / 当前可见总页数）
    function updateBadge() {
        const badge = getOrCreateBadge();
        if (!badge) return;
        if (isWaterfallPaused) {
            badge.innerHTML = `${ICON_WAVE_SVG}<span>已暂停: 第 ${currentViewportPage}/${totalViewportPages} 页</span>`;
            badge.classList.add('paused');
        } else {
            badge.innerHTML = `${ICON_WAVE_SVG}<span>瀑布流: 第 ${currentViewportPage}/${totalViewportPages} 页</span>`;
            badge.classList.remove('paused');
        }
    }

    // 缓存可见卡片及其物理行号，避免高频滚动时全量触碰离屏节点几何属性
    let cachedVisibleCards = [];
    let cachedTotalRows = 0;
    let cachedRowContainer = null;

    function recomputeCardRows(mainContainer) {
        cachedVisibleCards = [];
        cachedTotalRows = 0;
        cachedRowContainer = mainContainer;
        if (!mainContainer) return;

        const children = mainContainer.children;
        const len = children.length;
        let currentRow = 0;
        let lastTop = -9999;

        for (let i = 0; i < len; i++) {
            const el = children[i];
            if (el.id === 'bili-waterfall-loader' || el.classList.contains('flex_center')) continue;
            if (el.offsetHeight === 0) continue;

            const isCard = el.classList.contains('video-list-item') ||
                           el.matches('div[class*="col_"]') ||
                           el.querySelector('.bili-video-card');
            if (!isCard) continue;

            const top = el.offsetTop;
            if (Math.abs(top - lastTop) > 6) {
                currentRow++;
                lastTop = top;
            }
            el._wfRow = currentRow;
            cachedVisibleCards.push(el);
        }
        cachedTotalRows = currentRow;
    }

    // 依据可视窗口内卡片的物理行数实时计算当前所在页（二分查找 + 视口局部遍历，每 6 行为一页）
    function updateViewportPage(forceRecomputeRows = false) {
        if (!isWaterfallMounted) return;
        const mainContainer = getMainListContainer(document);
        if (!mainContainer) return;

        if (forceRecomputeRows || cachedRowContainer !== mainContainer || cachedVisibleCards.length === 0) {
            recomputeCardRows(mainContainer);
        }

        const cards = cachedVisibleCards;
        const len = cards.length;
        if (!len) return;

        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

        // 二分查找第一个底边进入或位于视口下方的卡片（rect.bottom > 0）
        let lo = 0;
        let hi = len - 1;
        let firstVisibleIdx = len;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const rect = cards[mid].getBoundingClientRect();
            if (rect.bottom > 0) {
                firstVisibleIdx = mid;
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }

        let maxInViewPage = 0;
        let lastPassedPage = 1;

        if (firstVisibleIdx < len) {
            // 向前微调回退一行以防同排高度略微参差
            let scanIdx = Math.max(0, firstVisibleIdx - 8);
            for (; scanIdx < len; scanIdx++) {
                const el = cards[scanIdx];
                const rect = el.getBoundingClientRect();
                if (rect.top >= viewportHeight) break;

                const cardPage = Math.floor((el._wfRow - 1) / 6) + 1;
                if (rect.bottom > 0) {
                    if (cardPage > maxInViewPage) maxInViewPage = cardPage;
                }
                if (cardPage > lastPassedPage) {
                    lastPassedPage = cardPage;
                }
            }
        } else if (len > 0) {
            lastPassedPage = Math.floor((cards[len - 1]._wfRow - 1) / 6) + 1;
        }

        const newTotalPages = Math.max(1, Math.ceil(cachedTotalRows / 6));
        let newPage = maxInViewPage > 0 ? maxInViewPage : lastPassedPage;
        newPage = Math.min(Math.max(1, newPage), newTotalPages);

        if (newPage !== currentViewportPage || newTotalPages !== totalViewportPages) {
            currentViewportPage = newPage;
            totalViewportPages = newTotalPages;
            updateBadge();
        }
    }

    // 居中样式改由 CSS Flexbox 原生驱动，移除高频 JS 回流计算，保留方法供历史调用兼容
    function adjustLoaderCentering() {
        const loader = document.getElementById('bili-waterfall-loader');
        if (loader && loader.style.left) {
            loader.style.removeProperty('left');
            loader.style.removeProperty('position');
            loader.style.removeProperty('top');
        }
    }

    // 维护加载器位置：保证 loader 节点始终插在当前活跃分页器的正前方（避免因 Vue 重新渲染导致 loader 脱落或位移）
    function ensureLoaderPosition(pager) {
        if (!isWaterfallMounted) return null;
        let loader = document.getElementById('bili-waterfall-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'bili-waterfall-loader';
            loader.className = 'bili-waterfall-loader';
            loader.innerHTML = `
                <div class="bili-waterfall-spinner"></div>
                <span class="bili-waterfall-loader-text">正在筛选...</span>
            `;
        }
        const targetPager = pager || document.querySelector('.vui_pagenation, .vui_pagenation--btns');
        if (targetPager && targetPager.parentNode && loader.nextSibling !== targetPager) {
            targetPager.parentNode.insertBefore(loader, targetPager);
        } else if (!targetPager) {
            // 无分页组件场景（例如单页搜索结果）：在 mainSection 中新建最后一个子级元素并挂载 loader
            const mainSection = document.querySelector('div.video.i_wrapper.search-all-list, div.search-page-video.i_wrapper, div.video.i_wrapper') || getMainListContainer();
            if (mainSection) {
                let wrapper = loader.parentElement;
                if (!wrapper || !wrapper.classList.contains('flex_center') || wrapper.parentElement !== mainSection) {
                    wrapper = document.createElement('div');
                    wrapper.className = 'flex_center mt_x50 mb_lg';
                    mainSection.appendChild(wrapper);
                    wrapper.appendChild(loader);
                } else if (mainSection.lastElementChild !== wrapper) {
                    mainSection.appendChild(wrapper);
                }
            }
        }
        adjustLoaderCentering();
        return loader;
    }

    // 获取或创建瀑布流底部加载指示器 DOM 元素
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

    // 重新计算并同步当前搜索结果的最大页码
    function updateDynamicMaxPage() {
        const p = getDynamicMaxPage();
        if (p > 0) {
            maxWaterfallPage = p;
        }
        return maxWaterfallPage;
    }

    // 直接测量 DOM 第一行与第二行卡片的物理数量（物理列数）：
    // 统计前两行各行的物理卡片数并取较大值，有效规避首行因直播大卡、话题卡或广告剔除导致的列数测量偏差；
    // 兼备卡片宽度与容器宽度几何比值双重校验
    function getGridColumnCount() {
        const mainContainer = getMainListContainer(document);
        if (!mainContainer) return 5;

        const firstCard = mainContainer.querySelector(
            '.video-list-item, div[class*="col_"]:has(.bili-video-card), div[class*="col_"]'
        );
        if (!firstCard || firstCard.offsetWidth === 0) return 5;

        // 1. 扫描第一行与第二行的卡片物理数量，仅遍历前两行即刻提前退出，杜绝千级 DOM 全量回流
        let row1Count = 0;
        let row2Count = 0;
        let row1Top = null;
        let row2Top = null;

        const children = mainContainer.children;
        const len = children.length;
        for (let i = 0; i < len; i++) {
            const card = children[i];
            if (!card || card.id === 'bili-waterfall-loader' || card.classList.contains('flex_center')) continue;
            if (card.offsetHeight === 0) continue;
            const isCard = card.classList.contains('video-list-item') || 
                           card.matches('div[class*="col_"]') || 
                           Boolean(card.querySelector('.bili-video-card'));
            if (!isCard) continue;

            const top = card.offsetTop;
            if (row1Top === null) {
                row1Top = top;
                row1Count = 1;
            } else if (Math.abs(top - row1Top) <= 6) {
                row1Count++;
            } else if (row2Top === null) {
                row2Top = top;
                row2Count = 1;
            } else if (Math.abs(top - row2Top) <= 6) {
                row2Count++;
            } else {
                // 已扫描完前两行，立即退出
                break;
            }
        }

        const maxMeasured = Math.max(row1Count, row2Count);
        if (maxMeasured >= 4 && maxMeasured <= 7) {
            return maxMeasured;
        }

        // 2. 兜底与少卡片场景（如首屏仅有 1~3 个卡片）：卡片宽度与容器宽度几何比值计算
        const containerWidth = mainContainer.clientWidth;
        const cardWidth = firstCard.offsetWidth;
        if (containerWidth > 0 && cardWidth > 0) {
            const cols = Math.round(containerWidth / cardWidth);
            if (cols >= 4 && cols <= 7) {
                return cols;
            }
            if (cols > 7) return 7;
            if (cols < 4 && cols > 0) return 4;
        }

        return 5;
    }

    // 根据 DOM 第一行卡片的物理列数，按固定 6 行直接计算单页请求容量（page_size）：
    // - 4 列（窄屏）：4 × 6 = 24 条
    // - 5 列（标屏）：5 × 6 = 30 条
    // - 6 列（宽屏）：6 × 6 = 36 条
    // - 7 列（超宽屏）：7 × 6 = 42 条
    function getDynamicPageSize() {
        const cols = getGridColumnCount();
        return cols * 6;
    }

    // 生成终态文案
    function getEndedTipHtml() {
        const reasonText = `已展示全部匹配视频`;
        return `<span>${reasonText}</span>`;
    }

    // 渲染网络/接口异常提示，并提供一键重试交互
    function showErrorLoader(customMsg = '⚠️ 加载失败，点击重试') {
        const loader = getOrCreateLoader();
        if (!loader) return;
        loader.classList.add('active');
        loader.classList.remove('ended');
        const txtEl = loader.querySelector('.bili-waterfall-loader-text');
        if (txtEl) {
            txtEl.innerHTML = `<span class="bili-waterfall-retry-btn" style="cursor: pointer; color: #ff6699; font-weight: 500;">${customMsg}</span>`;
        }
        const spinner = loader.querySelector('.bili-waterfall-spinner');
        if (spinner) {
            spinner.style.display = 'none';
        }
        const onRetryClick = (e) => {
            const btn = e.target.closest('.bili-waterfall-retry-btn');
            if (btn) {
                loader.removeEventListener('click', onRetryClick);
                if (spinner) spinner.style.removeProperty('display');
                updateLoader(true);
                triggerLoadNextPage();
            }
        };
        loader.addEventListener('click', onRetryClick);
    }

    // 生成动态加载文案：按请求过的原始视频总数展示实时进度
    function getLoaderText(customText) {
        if (customText) return customText;
        return totalRequestedVideos > 0 
            ? `正在筛选... (已检索 ${totalRequestedVideos} 条)` 
            : '正在筛选...';
    }

    // 更新加载状态条：展示加载动画或平滑隐藏
    function updateLoader(show, text = null) {
        const loader = getOrCreateLoader();
        if (!loader) return;
        const txtEl = loader.querySelector('.bili-waterfall-loader-text');
        const spinner = loader.querySelector('.bili-waterfall-spinner');
        const displayText = getLoaderText(text);
        if (show) {
            loader.classList.add('active');
            loader.classList.remove('ended');
            if (spinner) {
                spinner.style.removeProperty('display');
            }
            adjustLoaderCentering();
            if (txtEl) {
                txtEl.textContent = displayText;
            }
        } else {
            if (txtEl && !isAllLoaded) {
                txtEl.textContent = displayText;
            }
            if (!isAllLoaded) {
                loader.classList.remove('active', 'ended');
            }
        }
    }

    // 专属终态展示：调用 getEndedTipHtml() 渲染客观终态提示
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

    // 格式化播放量与弹幕数统计数字（支持万/亿转换）
    function formatStat(n) {
        if (!n && n !== 0) return '';
        if (typeof n === 'string' && (n.includes('万') || n.includes('亿'))) return n;
        const num = Number(n);
        if (isNaN(num)) return String(n);
        if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
        if (num >= 10000) return (num / 10000).toFixed(1) + '万';
        return String(num);
    }

    // 格式化视频时长（对齐 mm:ss 或 hh:mm:ss 格式规范）
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

        // 冒号分隔格式（处理 B 站接口返回的分钟累加格式，如 "403:22" -> "06:43:22"）
        if (str.includes(':')) {
            const parts = str.split(':').map(p => parseInt(p.trim(), 10) || 0);
            if (parts.length === 2) {
                const [totalM, s] = parts;
                if (totalM >= 60) {
                    const h = Math.floor(totalM / 60);
                    const m = totalM % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }
                return `${String(totalM).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            } else if (parts.length >= 3) {
                const [h, m, s] = parts;
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }
        }

        return str;
    }

    // 检测当前屏幕卡片是否充盈，不足时触发瀑布流增补
    function checkWaterfallFillScreen() {
        if (!isWaterfallMounted || isWaterfallPaused || isPaging || isAllLoaded) return;
        const mainContainer = getMainListContainer(document);
        if (!mainContainer) return;

        const visibleCards = Array.from(mainContainer.children).filter(c => c.style.display !== 'none' && !c.classList.contains('flex_center'));
        // 可视卡片少于 10 张时，触发一次下一页静默抓取
        if (visibleCards.length < 10) {
            triggerLoadNextPage();
        }
    }

    // 获取并预清洗纯净母卡模板骨架（单例缓存，彻底消除高开销的重复选择器查询与节点剔除）
    function getCardTemplate() {
        if (cachedCardTemplate) {
            return cachedCardTemplate;
        }

        const mainContainer = getMainListContainer(document);
        if (!mainContainer) return null;

        // 仅在首次提取时执行一次高开销的选择器扫描
        const sampleCol = mainContainer.querySelector(
            'div[class*="col_"]:has(a[href*="/video/"]):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living)), ' +
            '.video-list-item:has(a[href*="/video/"]):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living)), ' +
            'div[class*="col_"]:has(.bili-video-card):not(:has(a[href*="live.bilibili.com"], a[href*="/cheese/"], .bili-video-card__info--living))'
        ) || mainContainer.querySelector('.video-list-item, div[class*="col_"]:has(.bili-video-card)');

        if (!sampleCol) return null;

        // 克隆并预清洗为纯净模板骨架
        const tpl = sampleCol.cloneNode(true);
        delete tpl.dataset.purifiedQuery;
        tpl.classList.remove('bili-cleaner-dimmed');
        tpl.querySelectorAll('.bili-cleaner-dimmed').forEach(el => el.classList.remove('bili-cleaner-dimmed'));
        tpl.querySelectorAll('.bili-cleaner-badge-col').forEach(el => el.remove());

        // 彻底清理直播专属节点、赞助商角标（如 SponsorBlock/插件注入的 sponsorThumbnailLabel）及残留播放器
        tpl.querySelectorAll('.v-inline-live-player, .bili-video-card__info--living, .v-inline-player, .bpx-docker, video, .sponsorThumbnailLabel, [class*="sponsorThumbnailLabel"]').forEach(el => el.remove());

        // 清理 picture 内部残留的旧 source 标签，防止干扰后续动态封面
        const pictureEl = tpl.querySelector('picture');
        if (pictureEl) {
            pictureEl.querySelectorAll('source').forEach(s => s.remove());
        }

        // 预处理纯净的 img 标签（继承母卡样式与属性，清空旧 src/srcset）
        const oldImg = tpl.querySelector('.bili-video-card__cover img, picture img, img');
        if (oldImg) {
            const cleanImg = document.createElement('img');
            for (const attr of oldImg.attributes) {
                const name = attr.name.toLowerCase();
                if (name !== 'src' && name !== 'srcset' && !name.startsWith('on')) {
                    cleanImg.setAttribute(attr.name, attr.value);
                }
            }
            cleanImg.loading = 'lazy';
            oldImg.replaceWith(cleanImg);
        }

        cachedCardTemplate = tpl;
        return cachedCardTemplate;
    }

    // 根据接口返回的数据项克隆或生成视频卡片 DOM 元素
    function createCardElement(item) {
        const durationText = formatDuration(item.duration);
        const cleanTit = (item.title || '').replace(/<[^>]+>/g, '');
        const coverUrl = item.pic ? (item.pic.startsWith('http') ? item.pic : 'https:' + item.pic) : '';
        const videoHref = `//www.bilibili.com/video/${item.bvid}`;

        const sampleCol = getCardTemplate();
        let col;

        if (sampleCol) {
            col = sampleCol.cloneNode(true);

            // 统一将卡片内部所有主链接（视频/直播/课程遗留）重定向为当前视频地址
            col.querySelectorAll('a[href*="/video/"], a[href*="live.bilibili.com"], a[href*="/cheese/"]').forEach(a => {
                a.href = videoHref;
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
                    parentA.href = videoHref;
                }
            }

            // 同步卡片 bvid 属性
            col.querySelectorAll('[data-bsb-bvid]').forEach(el => {
                el.setAttribute('data-bsb-bvid', item.bvid);
            });

            // 替换封面图片：模板骨架已预清洗为单一 img，直接写入目标地址
            const imgEl = col.querySelector('.bili-video-card__cover img, picture img, img');
            if (imgEl) {
                imgEl.alt = cleanTit;
                imgEl.src = coverUrl ? (coverUrl + '@672w_378h_1c_!web-search-common-cover.webp') : '';
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

    // 向主视频列表容器批量追加卡片并执行去重
    function appendCards(items) {
        if (!Array.isArray(items) || items.length === 0) return 0;
        const mainContainer = getMainListContainer(document);
        if (!mainContainer) return 0;

        const fragment = document.createDocumentFragment();
        const newCards = [];
        let addedCount = 0;

        for (const item of items) {
            if (!item.bvid) continue;
            const bvidLower = item.bvid.toLowerCase();
            if (seenBvidMap.has(bvidLower)) continue;
            seenBvidMap.add(bvidLower);

            // 存入标签字典供后续规则使用
            const rawTagText = [item.tag, item.keywords, item.tags, item.typename].filter(Boolean).join(',');
            if (rawTagText) {
                const cleanedTagText = cleanText(rawTagText);
                setBoundedMap(videoTagMap, item.bvid, cleanedTagText);
                if (item.aid) {
                    setBoundedMap(videoTagMap, String(item.aid), cleanedTagText);
                    setBoundedMap(videoTagMap, 'av' + item.aid, cleanedTagText);
                }
            }

            // 存储量化统计数据供评价勋章计算
            if (item.bvid) {
                const stat = {
                    play: Number(item.play) || 0,
                    like: Number(item.like) || 0,
                    favorites: Number(item.favorites) || 0,
                    danmaku: Number(item.danmaku !== undefined ? item.danmaku : item.video_review) || 0,
                    duration: item.duration,
                    review: Number(item.review) || 0,
                    pubdate: Number(item.pubdate) || 0,
                    typename: item.typename ? String(item.typename).trim() : ''
                };
                setBoundedMap(videoStatMap, item.bvid.toLowerCase(), stat);
                if (item.aid) setBoundedMap(videoStatMap, String(item.aid), stat);
            }

            // 直接构建卡片
            const cardNode = createCardElement(item);
            fragment.appendChild(cardNode);
            newCards.push(cardNode);
            addedCount++;
        }

        if (addedCount > 0) {
            // 增量预净化：在挂载入主 DOM 树前完成类名与样式设定，杜绝页面闪烁与全量扫描
            filterDOMElements(newCards);
            mainContainer.appendChild(fragment);
            if (isEvaluationBadge && typeof updateQualityFilterCounts === 'function') {
                updateQualityFilterCounts();
            }
            updateViewportPage(true);
        }
        return addedCount;
    }

    // 强制终止当前进行中的分页拉取事务并释放互斥锁
    function abortRunningPaging() {
        pagingSessionSeq++;
        if (pagingAbortController) {
            try {
                pagingAbortController.abort();
            } catch (e) {}
            pagingAbortController = null;
        }
        isPaging = false;
        currentPagingPromise = null;
    }

    // 异步请求下一页视频数据并驱动瀑布流追加渲染（严格单例互斥：一次只能运行一个）
    async function triggerLoadNextPage() {
        if (!isWaterfallMounted || isWaterfallPaused || isAllLoaded) return null;
        if (currentPagingPromise || isPaging) return currentPagingPromise;

        updateDynamicMaxPage();
        if (currentRequestedPage >= maxWaterfallPage) {
            isAllLoaded = true;
            updateBadge();
            showEndedLoader();
            return null;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const rawKeyword = urlParams.get('keyword');
        if (!rawKeyword) return null;

        const nextPage = currentRequestedPage + 1;
        isPaging = true;
        updateBadge();
        updateLoader(true);

        const sessionSeq = pagingSessionSeq;
        const controller = new AbortController();
        pagingAbortController = controller;

        currentPagingPromise = (async () => {
            let success = false;
            let riskMsg = null;
            try {
                const keys = await getWbiKeys();
                if (controller.signal.aborted || sessionSeq !== pagingSessionSeq) return;
                if (!keys) {
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
                    keyword: (isSyntaxFilter ? getCleanApiKeyword() : '') || decodeURIComponent(rawKeyword.replace(/\+/g, ' ')),
                    source_tag: 3,
                    gaia_vtoken: '',
                    web_location: 1430654,
                    'x-bili-device-req-json': JSON.stringify({ platform: 'web', device: 'pc', spmid: '333.337', mobi_app: 'web_cn' }),
                    'x-bili-locale-json': JSON.stringify({ c_locale: { language: 'zh', script: 'Hans' }, always_translate: false })
                };

                const signedQs = signWbi(queryObj, keys.img_key, keys.sub_key, keys.mixin_key);
                const res = await targetWindow.fetch(`${apiBase}?${signedQs}`, {
                    headers: { 'Referer': 'https://search.bilibili.com/' },
                    signal: controller.signal
                });
                const data = await res.json();
                if (controller.signal.aborted || sessionSeq !== pagingSessionSeq) return;

                // 识别风控熔断码（-412 / -403），避免误判为自然到底
                if (data?.code === -412 || data?.code === -403) {
                    riskMsg = `⚠️ 触发风控 (${data.code})，请稍候点击重试`;
                    return;
                }

                let videoItems = [];
                if (data?.data?.result) {
                    if (Array.isArray(data.data.result)) {
                        videoItems = data.data.result;
                    }
                }

                if (videoItems.length > 0) {
                    totalRequestedVideos += videoItems.length;
                    const curLoader = document.getElementById('bili-waterfall-loader');
                    const curTxtEl = curLoader?.querySelector('.bili-waterfall-loader-text');
                    if (curTxtEl && curLoader.classList.contains('active') && !curLoader.classList.contains('ended')) {
                        curTxtEl.textContent = getLoaderText();
                    }
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
                success = true;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error('[Bilibili 搜索净化] 瀑布流加载下一页失败:', e);
                }
            } finally {
                isPaging = false;
                if (pagingAbortController === controller) {
                    pagingAbortController = null;
                }
                currentPagingPromise = null;
                if (!controller.signal.aborted && sessionSeq === pagingSessionSeq) {
                    finishPaging(success, riskMsg);
                }
            }
        })();

        return currentPagingPromise;
    }

    // 判定当前是否满足触发下一页加载的条件（视口进入预加载缓冲带且尚未全部加载完毕）
    function isPagingConditionMet() {
        if (!isWaterfallMounted || isWaterfallPaused || isAllLoaded) return false;
        if (currentRequestedPage >= maxWaterfallPage) return false;
        const target = document.querySelector('.vui_pagenation, .vui_pagenation--btns') || document.getElementById('bili-waterfall-loader');
        if (!target) return false;
        const rect = target.getBoundingClientRect();
        return rect.top < (window.innerHeight + 1000) && rect.bottom > -100;
    }

    // 结束单次分页拉取事务，重置加载状态并按需触发视口连续预加载或异常重试引导
    function finishPaging(success = true, riskMsg = null) {
        updateBadge();

        if (isAllLoaded) {
            showEndedLoader();
            return;
        }

        if (!success) {
            showErrorLoader(riskMsg || undefined);
            return;
        }

        // 核心优化：若添加视频后依然符合已有的「加载下一页」视口判定，则不移除 active 类，保持连贯加载
        if (!isWaterfallPaused && isPagingConditionMet()) {
            updateLoader(true);
            setTimeout(() => {
                if (!isPaging && !currentPagingPromise && !isAllLoaded && !isWaterfallPaused && isPagingConditionMet()) {
                    triggerLoadNextPage();
                }
            }, 60);
        } else {
            // 已推移至预加载缓冲带之外，平滑收起加载状态条
            updateLoader(false);
            if (!isAllLoaded && !isWaterfallPaused) {
                setTimeout(checkAndTriggerPaging, 300);
            }
        }
    }

    // 重新扫描首屏卡片提取已有视频 BV 号，用于增量去重防抖与累计请求基数初始化
    function refreshSeenBvidsFromDOM() {
        seenBvidMap.clear();
        document.querySelectorAll('a[href*="/video/"]').forEach(a => {
            const m = a.href.match(/\/video\/([A-Za-z0-9]+)/);
            if (m) seenBvidMap.add(m[1].toLowerCase());
        });
        totalRequestedVideos = seenBvidMap.size;
    }

    // 视口相交检测与分页拉取触发器：兼备监听器离线脱落自愈功能
    function checkAndTriggerPaging() {
        if (!isWaterfallMounted || isWaterfallPaused || isPaging || currentPagingPromise || isAllLoaded) return;
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
        if (!isWaterfallMounted) return;

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
                if (!isPaging && !currentPagingPromise) {
                    triggerLoadNextPage();
                }
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
        if (!isWaterfallMounted) return;
        const currentSign = getSearchSignature();
        const signChanged = !lastSearchSign || currentSign !== lastSearchSign;
        lastSearchSign = currentSign;

        const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
        const urlPage = isNaN(p) ? 1 : p;

        if (signChanged || isNewSearch) {
            abortRunningPaging();
            // 新搜索场景：强制回到第 1 页并解除已全部加载完毕的状态
            currentRequestedPage = 1;
            currentViewportPage = 1;
            totalViewportPages = 1;
            cachedCardTemplate = null;
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
        updateViewportPage(true);
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
        if (!isWaterfallMounted) return;
        updateDynamicMaxPage();
        const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
        const urlPage = isNaN(p) ? 1 : p;
        if (urlPage === 1) {
            abortRunningPaging();
            currentRequestedPage = 1;
            currentViewportPage = 1;
            totalViewportPages = 1;
            isAllLoaded = maxWaterfallPage <= 1;
        }
        cachedCardTemplate = null;
        isPaging = false;
        refreshSeenBvidsFromDOM();
        updateViewportPage(true);
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
        if (!isWaterfallMounted || isInternalPaging) return;

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

    // 视口滚动与尺寸变化句柄（随生命周期动态挂载/卸载）
    let scrollRafId = null;
    function onWaterfallScroll() {
        if (!isWaterfallMounted) return;
        if (!scrollRafId) {
            scrollRafId = requestAnimationFrame(() => {
                scrollRafId = null;
                if (!isWaterfallMounted) return;
                updateViewportPage();
                if (!isWaterfallPaused && !isPaging && !isAllLoaded) {
                    checkAndTriggerPaging();
                }
            });
        }
    }

    let resizeTimer = null;
    function onWaterfallResize() {
        if (!isWaterfallMounted) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            if (!isWaterfallMounted) return;
            updateViewportPage(true);

            const curLoader = document.getElementById('bili-waterfall-loader');
            if (curLoader && curLoader.classList.contains('ended')) return;

            // 重新解析分页器提取当前最大页数（基于前两行轻量测量列数 × 6）
            updateDynamicMaxPage();

            // 动态重校终态边界状态
            if (!isAllLoaded && currentRequestedPage >= maxWaterfallPage) {
                isAllLoaded = true;
                showEndedLoader();
            }
        }, 150);
    }

    // =========================================================================
    // Vue 风格瀑布流生命周期控制器
    // -------------------------------------------------------------------------
    // 设计思路：将原本分散在各处的事件与跨模块调用统一收口为单一生命周期状态机：
    //   1. 唯一准入：shouldMount()       —— 决定当前页面是否允许运行瀑布流
    //   2. 唯一入口：sync(reason)        —— 外部仅需通知“发生了什么”，自动分发挂载/更新/卸载
    //   3. 生命周期：onMounted()         —— 初始化状态、创建 UI、按需绑定滚动/缩放监听
    //                onUpdated(reason)   —— 响应筛选、接口返回、DOM 重绘、路由或搜索变化
    //                onUnmounted()       —— 中断请求、解绑监听、销毁 UI 与缓存
    // =========================================================================
    const WaterfallLifecycle = {
        /**
         * 唯一准入守卫（相当于 Vue 的条件渲染 v-if）：
         * 必须同时满足：菜单开关已开启 && 位于 /all 或 /video 视频搜索页 && URL 含有效 keyword 参数
         */
        shouldMount() {
            if (!isWaterfall || !isVideoSearchPath()) return false;
            try {
                const kw = new URLSearchParams(window.location.search).get('keyword');
                return Boolean(kw && kw.trim());
            } catch (e) {
                return false;
            }
        },

        /**
         * 统一外部调度入口：根据「目标准入状态」与「当前挂载状态 isWaterfallMounted」自动切换阶段
         * @param {'mount'|'load'|'route'|'dom'|'filter'|'official-search'|'search-trigger'|'sync'} reason 触发来源
         */
        sync(reason = 'sync') {
            if (!document.body) return;
            const targetMount = this.shouldMount();
            if (targetMount && !isWaterfallMounted) {
                // 未挂载 -> 满足条件：执行挂载
                this.onMounted();
            } else if (!targetMount && isWaterfallMounted) {
                // 已挂载 -> 不再满足条件（如切到番剧/用户 Tab 或无词页）：执行卸载清理
                this.onUnmounted();
            } else if (targetMount && isWaterfallMounted) {
                // 已挂载 -> 仍然满足条件：按触发来源执行局部更新
                this.onUpdated(reason);
            }
        },

        /**
         * 挂载阶段（类似 Vue onMounted）：
         * 初始化首屏状态、注入样式类与悬浮微标/加载条，并动态绑定 scroll / resize / IntersectionObserver
         */
        onMounted() {
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

            abortRunningPaging();
            isWaterfallMounted = true;
            document.documentElement.classList.add('bili-waterfall-enabled');

            lastSearchSign = getSearchSignature();
            refreshSeenBvidsFromDOM();

            const hasPager = Boolean(document.querySelector('.vui_pagenation, .vui_pagenation--btns'));
            updateDynamicMaxPage();
            currentRequestedPage = 1;
            currentViewportPage = 1;
            totalViewportPages = 1;
            // 仅当分页器已存在或首屏卡片已挂载时才判定是否只有 1 页，避免 Vue 尚未渲染完就被误判为 isAllLoaded = true
            isAllLoaded = (hasPager || seenBvidMap.size > 0) ? (maxWaterfallPage <= 1) : false;
            isPaging = false;

            updateViewportPage(true);
            getOrCreateBadge();
            updateBadge();
            getOrCreateLoader();
            if (isAllLoaded) {
                showEndedLoader();
            } else {
                updateLoader(false);
            }
            bindWaterfallObserver();

            // 仅在挂载期间监听全局滚动与视口缩放，卸载时通过 removeEventListener 彻底释放
            window.addEventListener('scroll', onWaterfallScroll, { passive: true });
            window.addEventListener('resize', onWaterfallResize, { passive: true });

            // 首屏初始化后校验视口高度，若大屏或首屏卡片较少导致缓冲不足，提前静默预载下一页
            setTimeout(() => {
                if (isWaterfallMounted) checkAndTriggerPaging();
            }, 300);
        },

        /**
         * 更新阶段（类似 Vue onUpdated）：
         * 仅在已挂载状态下响应各类运行时事件，避免无关状态变化触发全量重建
         */
        onUpdated(reason) {
            if (!isWaterfallMounted) return;
            switch (reason) {
                case 'filter':
                    // 筛选或品质过滤导致可见卡片数变化：重算视口页码并在首屏卡片过少时自动补页
                    updateViewportPage(true);
                    checkWaterfallFillScreen();
                    break;
                case 'official-search':
                    // 拦截到 B 站官方搜索接口返回：重新采样首屏卡片与分页器
                    onOfficialSearchMounted();
                    break;
                case 'dom': {
                    // MutationObserver 检测到 DOM 变动：若 Vue 首屏延迟渲染或替换了分页器节点，补齐采样并重绑观察者
                    const currentPager = document.querySelector('.vui_pagenation, .vui_pagenation--btns');
                    const pagerChanged = currentPager && (!currentObservedPager || currentObservedPager !== currentPager || !currentObservedPager.isConnected);
                    if (pagerChanged) {
                        if (seenBvidMap.size === 0) {
                            refreshSeenBvidsFromDOM();
                        }
                        updateDynamicMaxPage();
                        if (currentRequestedPage <= 1) {
                            isAllLoaded = maxWaterfallPage <= 1;
                            if (isAllLoaded) {
                                showEndedLoader();
                            } else {
                                updateLoader(false);
                            }
                        }
                        bindWaterfallObserver();
                        updateViewportPage(true);
                        updateBadge();
                    }
                    checkSearchChange();
                    break;
                }
                case 'search-trigger':
                    // 用户主动按回车或点击搜索按钮：重置为新一轮搜索
                    resetWaterfallForNewSearch(true);
                    break;
                case 'route':
                    // SPA 路由或分页器点击导致 URL 变化：比对搜索特征决定是否重置
                    checkSearchChange();
                    break;
                default: {
                    // load / sync 等兜底同步：补全首屏采样、重算总页数并确保观察者处于绑定状态
                    if (seenBvidMap.size === 0) {
                        refreshSeenBvidsFromDOM();
                    }
                    const hasPager = Boolean(document.querySelector('.vui_pagenation, .vui_pagenation--btns'));
                    updateDynamicMaxPage();
                    if (currentRequestedPage <= 1 && (hasPager || seenBvidMap.size > 0)) {
                        isAllLoaded = maxWaterfallPage <= 1;
                        if (isAllLoaded) {
                            showEndedLoader();
                        } else {
                            updateLoader(false);
                        }
                    }
                    updateViewportPage(true);
                    updateBadge();
                    bindWaterfallObserver();
                    break;
                }
            }
        },

        /**
         * 卸载阶段（类似 Vue onUnmounted）：
         * 彻底回收请求、定时器、全局监听器、交叉观察器以及页面挂载的 UI 节点
         */
        onUnmounted() {
            isWaterfallMounted = false;
            abortRunningPaging();
            window.removeEventListener('scroll', onWaterfallScroll);
            window.removeEventListener('resize', onWaterfallResize);
            if (scrollRafId) {
                cancelAnimationFrame(scrollRafId);
                scrollRafId = null;
            }
            if (resizeTimer) {
                clearTimeout(resizeTimer);
                resizeTimer = null;
            }

            document.documentElement.classList.remove('bili-waterfall-enabled');
            if (waterfallObserver) {
                waterfallObserver.disconnect();
                waterfallObserver = null;
            }
            currentObservedPager = null;
            cachedVisibleCards = [];
            cachedTotalRows = 0;
            cachedRowContainer = null;
            lastSearchSign = '';

            const badge = document.getElementById('bili-waterfall-badge');
            if (badge) badge.remove();

            const loader = document.getElementById('bili-waterfall-loader');
            if (loader) loader.remove();
        }
    };

    // 兼容顶部 applyWaterfallState() 调用
    function syncWaterfallLifecycle() {
        WaterfallLifecycle.sync('sync');
    }

    // 劫持单页路由与搜索操作，统一转发至 WaterfallLifecycle.sync()
    try {
        const originPushState = targetWindow.history.pushState;
        if (originPushState) {
            targetWindow.history.pushState = function(...args) {
                const res = originPushState.apply(this, args);
                setTimeout(() => {
                    WaterfallLifecycle.sync('route');
                    bindStickyObserver();
                }, 50);
                return res;
            };
        }
        const originReplaceState = targetWindow.history.replaceState;
        if (originReplaceState) {
            targetWindow.history.replaceState = function(...args) {
                const res = originReplaceState.apply(this, args);
                setTimeout(() => {
                    WaterfallLifecycle.sync('route');
                    bindStickyObserver();
                }, 50);
                return res;
            };
        }
        targetWindow.addEventListener('popstate', () => {
            setTimeout(() => {
                WaterfallLifecycle.sync('route');
                bindStickyObserver();
            }, 50);
        });

        // 委托监听分页按钮点击，单页切页时实时校准瀑布流页码
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button.vui_pagenation--btn, button.vui_pagenation--btn-num');
            if (btn) {
                setTimeout(() => WaterfallLifecycle.sync('route'), 80);
            }
        }, true);

        // 监听搜索框回车与搜索按钮点击，前置触发瀑布流状态同步
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.classList.contains('search-input'))) {
                    setTimeout(() => WaterfallLifecycle.sync('search-trigger'), 100);
                }
            }
        }, true);

        document.addEventListener('click', (e) => {
            const searchBtn = e.target.closest('.search-button, .search-btn, .nav-search-btn, button[class*="search"]');
            if (searchBtn) {
                setTimeout(() => WaterfallLifecycle.sync('search-trigger'), 100);
            }
        }, true);
    } catch (e) {}

    window.addEventListener('DOMContentLoaded', () => {
        WaterfallLifecycle.sync('mount');
    });
    window.addEventListener('load', () => {
        WaterfallLifecycle.sync('load');
    });

    // ==========================================
    // 11. 视频品级独立模块（评价勋章 & 品质筛选）
    // ==========================================

    // 挂载/更新品质药丸筛选行（位置 A：嵌入 .more-conditions）
    const QUALITY_FILTER_OPTIONS = [
        {
            key: 'all',
            label: '全部',
            isAll: true,
            criteria: '不限制品质分类，展示当前搜索词下的全部有效视频'
        },
        {
            key: 'q-hall-of-fame',
            label: '🏆 殿堂神作',
            criteria: '时长 ≥ 90秒，且播放 ≥ 2万，赞播比*权重 ≥ 7%，藏播比*权重 ≥ 3.5%，赞 ≥ 1500，藏 ≥ 800\n【特点】长篇深度精作，双率断层爆棚，三连拉满的顶峰神作'
        },
        {
            key: 'q-hardcore',
            label: '💡 硬核干货',
            criteria: '时长 ≥ 90秒，且 (藏赞比 ≥ 40% 且 ((播放 ≥ 5000 且 藏播比*权重 ≥ 4%，藏 ≥ 250) 或 (藏 ≥ 2000 且 藏播比*权重 ≥ 2.5%)) 或 (播放 ≥ 3000 且 藏 ≥ 120 且 藏赞比 ≥ 75% 且 藏播比*权重 ≥ 2.5%))\n【特点】收藏转化与藏赞比极高，深度实用干货与知识合集（干货区门槛-15%，娱乐区+15%）'
        },
        {
            key: 'q-high-reputation',
            label: '⭐ 高口碑佳作',
            criteria: '(播放 ≥ 5000 且 赞播比*权重 ≥ 7%，赞 ≥ 400) 或 (赞 ≥ 5000 且 赞播比*权重 ≥ 4.5%)\n【特点】观众清一色好评点赞，高认可度优质佳作（时长/播放加权）'
        },
        {
            key: 'q-balanced-masterpiece',
            label: '🏅 综合标杆',
            criteria: '播放 ≥ 1万 且 赞播比*权重 ≥ 4.5%，藏播比*权重 ≥ 2.2%，赞 ≥ 600，藏 ≥ 300\n【特点】赞藏双优全面扎实，六边形无短板水准（时长/播放加权）'
        },
        {
            key: 'q-hidden-gem',
            label: '💎 冷门宝藏',
            criteria: '((1000 ≤ 播放 < 3000 且 (赞 ≥ 150 或 藏 ≥ 80)) 或 (3000 ≤ 播放 < 2万 且 赞 ≥ 200，藏 ≥ 80))，且 (赞播比*权重 ≥ 8% 或 藏播比*权重 ≥ 4.5%)\n【特点】中小样本下的极高纯度遗珠，小众高分佳作（时长/播放加权）'
        },
        {
            key: 'q-routine',
            label: '🍀 稳健良作',
            criteria: '播放 ≥ 3000，且未触碰避坑线 (≤15分需赞播比≥1.2%或藏播比≥0.5%；>15分需赞播比≥0.5%或藏播比≥0.2%)，各项数据平稳均衡\n【特点】品质可靠健康，内容扎实的中流砥柱良品'
        },
        {
            key: 'q-opinion-storm',
            label: '💥 话题焦点',
            criteria: '弹幕密集 (密度≥15条/分且弹幕≥300，或弹幕≥3000且密度≥8；娱乐区+15%) 且 评赞比 ≥ 10% (干货/教程向 ≥ 18%)\n【特点】弹幕刷屏与评论热议齐飞，全网热议/深度探讨'
        },
        {
            key: 'q-heated-debate',
            label: '💬 激辩热议',
            criteria: '评赞比 ≥ 10% (干货/教程向 ≥ 18%) 且 评论绝对量大 (评≥300且评播比≥0.35% 或 评≥1500且评播比≥0.2%)\n【特点】长篇评论密集对线，观点激烈深度碰撞'
        },
        {
            key: 'q-danmaku-carnival',
            label: '🔥 弹幕密集',
            criteria: '弹幕密度 ≥ 15条/分 且 弹幕 ≥ 300，或 弹幕总量 ≥ 3000 且密度 ≥ 8条/分（娱乐分区密度门槛上调 15%）\n【特点】弹幕高频如潮，高能互动、笑点或名场面聚集'
        },
        {
            key: 'q-viral-short',
            label: '⚡ 爆款短片',
            criteria: '时长 < 90秒，且 (播放 ≥ 2万 且 赞 ≥ 1500，赞播比 ≥ 6% 或 藏播比 ≥ 3%) 或 (播放 ≥ 1万 且 赞 ≥ 1000 且 赞播比 ≥ 8%) 或 (赞 ≥ 3万 且 (赞播比 ≥ 3% 或 藏播比 ≥ 1.5%))\n【特点】高能快节奏短片，完播互动极高，爆款短视频精选'
        },
        {
            key: 'q-low-sample',
            label: '🌱 样本较少',
            criteria: '播放量 < 3000（未触发极小样本破格冷门宝藏）\n【特点】早期冷门或新发视频，样本量较少暂不作定性评级'
        }
    ];

    // 参与范围选择与单选排他的基础品质分类键（有序）
    const QUALITY_CATEGORY_KEYS = [
        'q-hall-of-fame',
        'q-hardcore',
        'q-high-reputation',
        'q-balanced-masterpiece',
        'q-hidden-gem',
        'q-routine',
        'q-opinion-storm',
        'q-heated-debate',
        'q-danmaku-carnival',
        'q-viral-short',
        'q-low-sample'
    ];
    let lastQualityAnchorKey = null;

    function injectQualityFilterRow(container) {
        if (!container || !container.isConnected) return;
        if (!isEvaluationBadge || !isVideoSearchPath()) {
            const oldRow = container.querySelector('.bili-cleaner-quality-filter-row');
            if (oldRow) oldRow.remove();
            return;
        }

        let filterRow = container.querySelector(':scope > .bili-cleaner-quality-filter-row');
        if (!filterRow) {
            filterRow = document.createElement('div');
            filterRow.className = 'search-condition-row bili-cleaner-quality-filter-row';
            container.appendChild(filterRow);
        }

        // 仅在初次构建或内部按钮数不一致时生成结构
        let isFirstRender = false;
        if (!filterRow.dataset.rendered) {
            isFirstRender = true;
            filterRow.dataset.rendered = 'true';
            filterRow.innerHTML = `
                <div class="bili-cleaner-filter-label" title="点击单选，支持按住 Ctrl 多选、按住 Shift 范围连选">🏷️ 视频品质:</div>
                <div class="bili-cleaner-filter-pills-box"></div>
            `;
            const box = filterRow.querySelector('.bili-cleaner-filter-pills-box');
            QUALITY_FILTER_OPTIONS.forEach(opt => {
                const btn = document.createElement('div');
                btn.className = 'bili-cleaner-filter-pill-btn';
                if (opt.isAll) btn.classList.add('pill-all');
                btn.dataset.key = opt.key;
                btn.innerHTML = `<span class="bili-cleaner-pill-text">${opt.label}</span><span class="bili-cleaner-pill-count"></span>`;
                if (opt.criteria) {
                    const actionTip = opt.isAll 
                        ? '点击重置为全部' 
                        : '点击单选 | 按住 Ctrl 点击多选 | 按住 Shift 点击范围连选';
                    const weightLine = opt.isAll ? '' : `\n【参考分权重】${formatTrackWeights(opt.key)}`;
                    btn.title = `【${opt.label}】筛选标准：\n${opt.criteria}${weightLine}\n────────────────────\n💡 ${actionTip}`;
                }
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleQualityFilter(opt.key, e);
                });
                box.appendChild(btn);
            });
        }

        updateQualityFilterButtons(filterRow);
        if (isFirstRender) {
            updateQualityFilterCounts();
        }
    }

    // 切换品质筛选状态（类文件夹式交互：默认单选，Ctrl多选，Shift范围连选）
    function toggleQualityFilter(key, event) {
        const isCtrl = !!(event && (event.ctrlKey || event.metaKey));
        const isShift = !!(event && event.shiftKey);

        if (key === 'all') {
            // 点击【全部】：重置所有品质分类筛选
            activeQualityFilters.clear();
            lastQualityAnchorKey = null;
        } else if (QUALITY_CATEGORY_KEYS.includes(key)) {
            if (isShift) {
                // 【Shift 范围连选】：选中从上一个锚点 (lastQualityAnchorKey) 到当前项闭区间内所有分类
                let anchorKey = lastQualityAnchorKey;
                if (!anchorKey || !QUALITY_CATEGORY_KEYS.includes(anchorKey)) {
                    // 若无前置锚点，取当前已选中的首项，若完全无选中则以第一项为锚点
                    const firstSelected = QUALITY_CATEGORY_KEYS.find(k => activeQualityFilters.has(k));
                    anchorKey = firstSelected || QUALITY_CATEGORY_KEYS[0];
                }
                const startIdx = QUALITY_CATEGORY_KEYS.indexOf(anchorKey);
                const targetIdx = QUALITY_CATEGORY_KEYS.indexOf(key);
                const minIdx = Math.min(startIdx, targetIdx);
                const maxIdx = Math.max(startIdx, targetIdx);

                if (!isCtrl) {
                    // 非 Ctrl+Shift 时，范围连选替换现有品质分类选择
                    QUALITY_CATEGORY_KEYS.forEach(k => activeQualityFilters.delete(k));
                }
                for (let i = minIdx; i <= maxIdx; i++) {
                    activeQualityFilters.add(QUALITY_CATEGORY_KEYS[i]);
                }
                if (!lastQualityAnchorKey) lastQualityAnchorKey = anchorKey;
            } else if (isCtrl) {
                // 【Ctrl 独立多选】：反转当前项选中状态
                if (activeQualityFilters.has(key)) {
                    activeQualityFilters.delete(key);
                } else {
                    activeQualityFilters.add(key);
                }
                lastQualityAnchorKey = key;
            } else {
                // 【默认单选效果】：清空其余品质项，仅选中当前项
                QUALITY_CATEGORY_KEYS.forEach(k => activeQualityFilters.delete(k));
                activeQualityFilters.add(key);
                lastQualityAnchorKey = key;
            }
        }

        // 持久化存储用户选中的筛选项
        try {
            localStorage.setItem('bili_cleaner_active_quality_filters', JSON.stringify([...activeQualityFilters]));
        } catch (e) {}

        // 刷新所有筛选按钮的高亮态
        document.querySelectorAll('.bili-cleaner-quality-filter-row').forEach(updateQualityFilterButtons);

        // 直接基于已缓存的品质分类切换卡片显隐，未就绪的卡片再补跑增量安检
        const unreadyCards = [];
        const container = getMainListContainer(document) || document;
        const seenCards = new Set();
        container.querySelectorAll('.video-list-item, div[class*="col_"], .bili-live-card').forEach(el => {
            const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
            if (seenCards.has(card)) return;
            seenCards.add(card);
            if (card.dataset.qualityClass === undefined) {
                unreadyCards.push(card);
                return;
            }
            const qClass = card.dataset.qualityClass;
            const isSyntaxFail = card.dataset.syntaxPass === '0';
            const isQualityFail = isEvaluationBadge && activeQualityFilters.size > 0 && (!qClass || !activeQualityFilters.has(qClass));
            const innerCard = card.querySelector('.bili-video-card, .bili-live-card') || card;
            if (isQualityFail) {
                innerCard.classList.remove('bili-cleaner-dimmed');
                card.style.setProperty('display', 'none', 'important');
            } else {
                card.style.removeProperty('display');
                innerCard.classList.toggle('bili-cleaner-dimmed', isSyntaxFail);
            }
        });
        if (unreadyCards.length > 0) {
            filterDOMElements(unreadyCards);
        }
        if (isEvaluationBadge && typeof updateQualityFilterCounts === 'function') {
            updateQualityFilterCounts();
        }
        if (typeof WaterfallLifecycle !== 'undefined') {
            WaterfallLifecycle.sync('filter');
        }
    }

    // 更新药丸按钮 active 高亮样式
    function updateQualityFilterButtons(filterRow) {
        if (!filterRow) return;
        const btns = filterRow.querySelectorAll('.bili-cleaner-filter-pill-btn');
        const isAllSelected = activeQualityFilters.size === 0;

        btns.forEach(btn => {
            const key = btn.dataset.key;
            if (key === 'all') {
                btn.classList.toggle('active', isAllSelected);
            } else {
                btn.classList.toggle('active', activeQualityFilters.has(key));
            }
        });
    }

    // 统计当前已加载视频卡片在各品级下的数量（非灰色卡片 / 总数）并更新按钮展示
    function updateQualityFilterCounts() {
        if (!isEvaluationBadge) return;
        const rows = document.querySelectorAll('.bili-cleaner-quality-filter-row');
        if (!rows.length) return;

        const container = getMainListContainer(document) || document;
        const cards = container.querySelectorAll('[data-syntax-pass]');
        const counts = { all: { clear: 0, total: 0 } };
        QUALITY_CATEGORY_KEYS.forEach(k => {
            counts[k] = { clear: 0, total: 0 };
        });

        const seenCards = new Set();
        cards.forEach(el => {
            const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
            if (seenCards.has(card)) return;
            seenCards.add(card);
            if (!card.isConnected) return;
            if (card.dataset.isLive === '1') return;
            // 排除非脚本自身隐藏的卡片（在未设置脚本内联 display:none 时持久化记录，防止切换筛选时反复跳变）
            if (card.dataset.externalHidden === '1') return;

            const isClear = card.dataset.syntaxPass === '1';
            const qClass = card.dataset.qualityClass || '';

            counts.all.total++;
            if (isClear) counts.all.clear++;

            if (qClass && counts[qClass]) {
                counts[qClass].total++;
                if (isClear) counts[qClass].clear++;
            }
        });

        const showTotal = isSyntaxFilter && isDimmed;
        rows.forEach(row => {
            row.querySelectorAll('.bili-cleaner-filter-pill-btn').forEach(btn => {
                const key = btn.dataset.key;
                const stat = counts[key];
                const countEl = btn.querySelector('.bili-cleaner-pill-count');
                if (stat && countEl) {
                    countEl.textContent = showTotal ? `(${stat.clear}/${stat.total})` : `(${stat.clear})`;
                    btn.classList.toggle('is-empty', key !== 'all' && (showTotal ? stat.total === 0 : stat.clear === 0));
                }
            });
        });
    }

    // 解析时间时长为分钟浮点数（用于计算弹幕密度）
    function parseDurationMinutes(val) {
        if (!val && val !== 0) return 0;
        if (typeof val === 'number') return val > 0 ? (val / 60) : 0;
        const parts = String(val).trim().split(':').map(Number);
        if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
        if (parts.length === 2) return parts[0] + parts[1] / 60;
        const num = parseFloat(val);
        return (!isNaN(num) && num > 0) ? (num / 60) : 0;
    }

    // 从 DOM 节点文本解析数值（支持万/亿/k 缩写，如 '62.3万' -> 623000）
    function parseStatText(text) {
        if (!text) return 0;
        const clean = String(text).replace(/[^\d.万亿wWkK]/g, '').trim();
        if (!clean) return 0;
        if (clean.includes('万') || clean.toLowerCase().endsWith('w')) {
            return parseFloat(clean) * 10000;
        }
        if (clean.includes('亿')) {
            return parseFloat(clean) * 100000000;
        }
        if (clean.toLowerCase().endsWith('k')) {
            return parseFloat(clean) * 1000;
        }
        return parseFloat(clean) || 0;
    }

    // 从 DOM 卡片节点回退提取播放量、弹幕与时长
    function extractStatFromCard(card) {
        let play = 0;
        let danmaku = 0;
        let duration = '';
        const statItems = card.querySelectorAll('.bili-video-card__stats--item');
        if (statItems.length >= 1) {
            play = parseStatText(statItems[0].textContent);
        }
        if (statItems.length >= 2) {
            danmaku = parseStatText(statItems[1].textContent);
        }
        const durEl = card.querySelector('.bili-video-card__stats__duration');
        if (durEl) {
            duration = durEl.textContent.trim();
        }
        return { play, like: 0, favorites: 0, danmaku, duration, review: 0, isPartial: true };
    }

    // 统一计算视频互动指标与时长/播放量修正权重
    function computeQualityMetrics(stat) {
        const play = stat?.play || 0;
        const like = stat?.like || 0;
        const favorites = stat?.favorites || 0;
        const danmaku = stat?.danmaku || 0;
        const review = stat?.review || 0;
        const pubdate = Number(stat?.pubdate) || 0;
        const ageDays = pubdate > 0 ? Math.max(0, (Date.now() / 1000 - pubdate) / 86400) : -1;
        const durationMinutes = parseDurationMinutes(stat?.duration);

        const likeRatio = play > 0 ? (like / play) : 0;
        const favRatio = play > 0 ? (favorites / play) : 0;
        const favLikeRatio = like > 0 ? (favorites / like) : (favorites > 0 ? 1 : 0);
        const reviewRatio = play > 0 ? (review / play) : 0;
        const reviewLikeRatio = like > 0 ? (review / like) : (review > 0 ? 1 : 0);
        const danmakuDensity = durationMinutes > 0 ? (danmaku / durationMinutes) : 0;

        // 方案 3：时长加权归一化（数学模型修正）
        // 5分钟为标准基准时长（durFactor = 1.0）；长视频完播难度大、观众付出时间成本极高，给予加权提升；短视频互动完播轻快无压力，给予系数惩罚（下限0.4，上限2.0）
        const durFactor = durationMinutes > 0 ? Math.min(2.0, Math.max(0.4, Math.sqrt(durationMinutes / 5.0))) : 1.0;
        // 高播放量稀释修正（5万以下 1.0x，50万 1.20x，500万 1.40x，5000万封顶 1.60x）
        const playFactor = play > 50000 ? Math.min(1.6, 1.0 + 0.2 * Math.log10(play / 50000)) : 1.0;

        const normLikeRatio = likeRatio * durFactor * playFactor;
        const normFavRatio = favRatio * durFactor * playFactor;

        return {
            play,
            like,
            favorites,
            danmaku,
            review,
            pubdate,
            ageDays,
            durationMinutes,
            likeRatio,
            favRatio,
            favLikeRatio,
            reviewRatio,
            reviewLikeRatio,
            danmakuDensity,
            durFactor,
            playFactor,
            normLikeRatio,
            normFavRatio
        };
    }

    // 分赛道权重表（同品级横向对比用，0~100% 饱和封顶）
    const HEALTH_SCORE_TRACKS = {
        'q-hardcore': { like: 0.35, fav: 0.55, dm: 0.10, review: 0, noDurPenalty: false },
        'q-viral-short': { like: 0.55, fav: 0.25, dm: 0.20, review: 0, noDurPenalty: true },
        'q-danmaku-carnival': { like: 0.30, fav: 0.15, dm: 0.55, review: 0, noDurPenalty: false },
        'q-heated-debate': { like: 0.30, fav: 0.15, dm: 0, review: 0.55, noDurPenalty: false },
        'q-opinion-storm': { like: 0.30, fav: 0.15, dm: 0.30, review: 0.25, noDurPenalty: false },
        'q-warning': { like: 0.60, fav: 0.40, dm: 0, review: 0, noBonus: true }
    };
    const DEFAULT_HEALTH_TRACK = { like: 0.50, fav: 0.35, dm: 0.15, review: 0, noDurPenalty: false };

    // 格式化输出当前品级赛道的权重配比文案（供筛选栏与封面胶囊 title 复用）
    function formatTrackWeights(qualityClass) {
        const track = HEALTH_SCORE_TRACKS[qualityClass] || DEFAULT_HEALTH_TRACK;
        const parts = [];
        if (track.like > 0) parts.push(`赞${Math.round(track.like * 100)}%`);
        if (track.fav > 0) parts.push(`藏${Math.round(track.fav * 100)}%`);
        if (track.dm > 0) parts.push(`弹幕${Math.round(track.dm * 100)}%`);
        if (track.review > 0) parts.push(`评${Math.round(track.review * 100)}%`);
        const suffix = track.noDurPenalty ? '，无时长惩罚' : '';
        return `${parts.join(' · ')}${suffix}`;
    }

    // 分区轻量微调规则（干货倾向分区 vs 纯娱乐倾向分区，仅作 ±15% 门槛微调与 ±5% 评分偏置，不做一刀切禁入）
    const HARDCORE_BOOST_ZONE_RE = /科普|技术|软件|编程|开发|数码|教程|财经|社科|心理|法律|职场|学习|机械|极客|设计|摄影|人文|历史/;
    const ENTERTAINMENT_ZONE_RE = /宅舞|舞蹈|颜值|服饰|时尚|明星|鬼畜|搞笑|日常|运动|萌宠|动物|美食|演奏|翻唱|MAD|MMD|手书/i;
    const TUTORIAL_INTENT_RE = /教程|教学|攻略|指南|测评|避坑|原理|入门|实操|解析|源码|配置|安装|拆解|复习|考前|笔记|干货/;
    const SERIES_INTENT_RE = /合集|全集|全套|保姆级|完整版|从零|一小时/;

    // 杀戮尖塔式品级稀有度底分与区间锚定表（通过 perfFloor ~ perfCeil 拉伸同品级内部跨度，避免扎堆）
    const SCORE_TIER_BANDS = {
        'q-warning':              { base: 4,  floatMax: 16, min: 0,  max: 20, perfFloor: 0.00, perfCeil: 0.35 },
        'q-low-sample':           { base: 20, floatMax: 24, min: 12, max: 48, perfFloor: 0.05, perfCeil: 0.65 },
        'q-routine':              { base: 22, floatMax: 34, min: 22, max: 58, perfFloor: 0.10, perfCeil: 0.52 },
        'q-danmaku-carnival':     { base: 44, floatMax: 28, min: 44, max: 76, perfFloor: 0.25, perfCeil: 0.82 },
        'q-heated-debate':        { base: 46, floatMax: 28, min: 46, max: 78, perfFloor: 0.25, perfCeil: 0.82 },
        'q-opinion-storm':        { base: 50, floatMax: 28, min: 50, max: 82, perfFloor: 0.30, perfCeil: 0.88 },
        'q-hidden-gem':           { base: 60, floatMax: 22, min: 60, max: 88, perfFloor: 0.32, perfCeil: 0.88 },
        'q-high-reputation':      { base: 60, floatMax: 22, min: 60, max: 88, perfFloor: 0.32, perfCeil: 0.88 },
        'q-hardcore':             { base: 60, floatMax: 22, min: 60, max: 88, perfFloor: 0.32, perfCeil: 0.88 },
        'q-balanced-masterpiece': { base: 62, floatMax: 22, min: 62, max: 90, perfFloor: 0.36, perfCeil: 0.90 },
        'q-viral-short':          { base: 60, floatMax: 22, min: 60, max: 88, perfFloor: 0.32, perfCeil: 0.88 },
        'q-hall-of-fame':         { base: 68, floatMax: 22, min: 68, max: 98, perfFloor: 0.50, perfCeil: 0.96 }
    };

    // 按杀戮尖塔式三层模型（品级底分 + 赛道表现浮动 + 明码词条加减）计算完整评分明细
    function computeScoreBreakdown(metrics, qualityClass, typename = '', evalContext = null) {
        if (!metrics || metrics.play <= 0) {
            return { score: 0, base: 0, floatScore: 0, bonusTotal: 0, rawBonusTotal: 0, capType: '', bonuses: [] };
        }
        let track = HEALTH_SCORE_TRACKS[qualityClass] || DEFAULT_HEALTH_TRACK;
        const band = SCORE_TIER_BANDS[qualityClass] || SCORE_TIER_BANDS['q-routine'];
        const isHardcoreZone = Boolean(typename && HARDCORE_BOOST_ZONE_RE.test(typename));
        const isEntZone = !isHardcoreZone && Boolean(typename && ENTERTAINMENT_ZONE_RE.test(typename));

        // 干货倾向分区在使用默认赛道时，将 10% 弹幕权重让渡给收藏，避免教程/知识视频因弹幕少吃亏
        if (track === DEFAULT_HEALTH_TRACK && isHardcoreZone) {
            track = { like: 0.45, fav: 0.50, dm: 0.05, review: 0, noDurPenalty: false };
        }
        const effectiveDur = (track.noDurPenalty || track.noBonus) ? 1.0 : metrics.durFactor;
        const effectivePlay = track.noBonus ? 1.0 : metrics.playFactor;

        const smoothPlay = metrics.play + 2000;
        const smoothLikeRatio = ((metrics.like + 40) / smoothPlay) * effectiveDur * effectivePlay;
        const smoothFavRatio = ((metrics.favorites + 20) / smoothPlay) * effectiveDur * effectivePlay;

        const likeScore = 100 * (1 - Math.exp(-smoothLikeRatio / 0.06));
        const favScore = 100 * (1 - Math.exp(-smoothFavRatio / 0.035));
        const dmScore = 100 * (1 - Math.exp(-metrics.danmakuDensity / 18));
        const reviewScore = 100 * (1 - Math.exp(-metrics.reviewRatio / 0.006));

        const perfRatio = Math.min(1, Math.max(0, (
            likeScore * track.like +
            favScore * track.fav +
            dmScore * track.dm +
            reviewScore * track.review
        ) / 100));
        // 按品级有效区间 [perfFloor, perfCeil] 做归一化拉伸，将同品级内部表现分铺满 0~floatMax 全幅跨度
        const floor = band.perfFloor || 0;
        const ceil = band.perfCeil || 1;
        const span = Math.max(0.05, ceil - floor);
        const stretchedPerf = Math.min(1, Math.max(0, (perfRatio - floor) / span));
        const curvedPerf = band.base >= 50 ? Math.pow(stretchedPerf, 1.15) : Math.pow(stretchedPerf, 0.90);
        const floatScore = Math.round(curvedPerf * band.floatMax);

        const bonuses = [];
        if (!track.noBonus && qualityClass !== 'q-low-sample') {
            if (metrics.likeRatio >= 0.10 && metrics.favRatio >= 0.05) {
                bonuses.push({ label: '🔥 三连拉满', delta: 3 });
            }
            if (metrics.likeRatio >= 0.15 && metrics.like >= 1000) {
                bonuses.push({ label: '🌟 极致口碑', delta: 3 });
            }
            if (metrics.favRatio >= 0.08 && metrics.favorites >= 300) {
                bonuses.push({ label: '📌 极高藏播', delta: 3 });
            }
            if (metrics.favLikeRatio >= 1.20 && metrics.favorites >= 500) {
                bonuses.push({ label: '📚 压箱宝典', delta: 4 });
            } else if (metrics.favLikeRatio >= 0.90 && metrics.favorites >= 300) {
                bonuses.push({ label: '💎 纯度极高', delta: 2 });
            }
            const playLikeRatio = metrics.likeRatio * effectivePlay;
            const playFavRatio = metrics.favRatio * effectivePlay;
            const isPhenomenal = metrics.play >= 3000000 && playLikeRatio >= 0.05 && playFavRatio >= 0.025;
            if (isPhenomenal) {
                bonuses.push({ label: '👑 现象级破圈', delta: 4 });
            } else if (metrics.play >= 1000000 && playLikeRatio >= 0.05) {
                bonuses.push({ label: '🌊 百万不稀释', delta: 3 });
            }
            if (metrics.durationMinutes >= 45 && metrics.normLikeRatio >= 0.04) {
                bonuses.push({ label: '🎬 超长精作', delta: 3 });
            } else if (metrics.durationMinutes >= 20 && metrics.normLikeRatio >= 0.05) {
                bonuses.push({ label: '⏱️ 长篇硬核', delta: 2 });
            } else if (metrics.durationMinutes > 0 && metrics.durationMinutes <= 2 && metrics.likeRatio >= 0.10 && metrics.favRatio >= 0.04) {
                bonuses.push({ label: '⚡ 短小精悍', delta: 2 });
            }
            if (metrics.durationMinutes >= 15 && metrics.favLikeRatio >= 0.5 && SERIES_INTENT_RE.test(evalContext?.title || '')) {
                bonuses.push({ label: '📑 系统合集', delta: 1 });
            }
            if (metrics.likeRatio >= 0.05 && metrics.favRatio >= 0.025 && metrics.danmakuDensity >= 8 && metrics.reviewRatio >= 0.002) {
                bonuses.push({ label: '⚖️ 六边形平衡', delta: 2 });
            }
            if (metrics.danmakuDensity >= 30 && metrics.danmaku >= 500) {
                bonuses.push({ label: '💬 满屏名场面', delta: 2 });
            } else if (metrics.durationMinutes >= 3 && metrics.danmakuDensity < 0.5 && metrics.likeRatio >= 0.06) {
                bonuses.push({ label: '🔇 静默纯享', delta: 1 });
            }
            if (metrics.review >= 2000 && metrics.likeRatio >= 0.04 && metrics.reviewLikeRatio >= 0.02 && metrics.reviewLikeRatio <= 0.15) {
                bonuses.push({ label: '💬 热评如潮', delta: 3 });
            } else if (metrics.review >= 500 && metrics.likeRatio >= 0.05 && metrics.reviewLikeRatio >= 0.02 && metrics.reviewLikeRatio <= 0.12) {
                bonuses.push({ label: '🗣️ 深度共鸣', delta: 2 });
            }
            if (metrics.ageDays >= 1095 && (playLikeRatio >= 0.05 || playFavRatio >= 0.03)) {
                bonuses.push({ label: '🏛️ 三年经典', delta: 4 });
            } else if (metrics.ageDays >= 365 && (playLikeRatio >= 0.05 || playFavRatio >= 0.03)) {
                bonuses.push({ label: '🏛️ 跨年长青', delta: 2 });
            } else if (metrics.ageDays >= 0 && metrics.ageDays < 2 && band.base >= 50) {
                bonuses.push({ label: '⏳ 新片冷静', delta: -3 });
            }
            if (metrics.play >= 100000 && metrics.likeRatio < 0.015 && metrics.favRatio < 0.008) {
                bonuses.push({ label: '🕳️ 标题党预警', delta: -3 });
            }
            if (!isHardcoreZone && metrics.reviewLikeRatio >= 0.20 && metrics.review >= 300) {
                bonuses.push({ label: '⚔️ 争议高发', delta: -2 });
            }
            if (!isHardcoreZone && metrics.durationMinutes >= 10 && metrics.danmaku < 10 && metrics.play >= 10000) {
                bonuses.push({ label: '🤖 长篇冷清', delta: -1 });
            }
            if (isHardcoreZone) {
                bonuses.push({ label: '📂 干货分区', delta: 1 });
            } else if (isEntZone && qualityClass !== 'q-hall-of-fame' && !isPhenomenal) {
                bonuses.push({ label: '🎈 娱乐微调', delta: -2 });
            }
            if (qualityClass === 'q-routine' && metrics.likeRatio < 0.02 && metrics.favRatio < 0.01) {
                bonuses.push({ label: '📉 互动平淡', delta: -4 });
            }
        }

        const rawBonusTotal = bonuses.reduce((sum, b) => sum + b.delta, 0);
        const bonusTotal = Math.min(12, rawBonusTotal);
        const rawTotal = band.base + floatScore + bonusTotal;
        const score = Math.min(band.max, Math.max(band.min, rawTotal));
        const capType = rawTotal > band.max ? 'max' : (rawTotal < band.min ? 'min' : '');

        return { score, base: band.base, floatScore, bonusTotal, rawBonusTotal, capType, bonuses };
    }

    // 按命中品级所在赛道计算 0~100 综合参考分
    function computeHealthScore(metrics, qualityClass, typename = '') {
        return computeScoreBreakdown(metrics, qualityClass, typename).score;
    }

    // 纯视频品质象限判定函数（返回命中象限对象）
    function getQualityQuadrant(stat, precomputedMetrics = null, evalContext = null) {
        if (!stat) return null;
        // 方案 1：数据尚未就绪（仅卡片 DOM 提取的粗略部分数据，无真实点赞/收藏）时，一开始不评级
        if (stat.isPartial) return null;
        const {
            play,
            like,
            favorites,
            danmaku,
            review,
            durationMinutes,
            likeRatio,
            favRatio,
            favLikeRatio,
            reviewRatio,
            reviewLikeRatio,
            danmakuDensity,
            normLikeRatio,
            normFavRatio
        } = precomputedMetrics || computeQualityMetrics(stat);

        const typename = stat.typename || '';
        const combinedText = `${evalContext?.title || ''} ${evalContext?.tags || ''} ${typename}`;
        const hasTutorialIntent = TUTORIAL_INTENT_RE.test(combinedText);
        const isHardcoreZone = Boolean(typename && HARDCORE_BOOST_ZONE_RE.test(typename));
        const isEntZone = !isHardcoreZone && Boolean(typename && ENTERTAINMENT_ZONE_RE.test(typename));

        // 干货门槛微调系数：干货区/教程意图放宽 15% (0.85x)，纯娱乐区收紧 15% (1.15x)，其余维持 1.0x
        let hardcoreMult = 1.0;
        let minFavLikeForNorm = 0.40;
        if (isHardcoreZone || hasTutorialIntent) {
            hardcoreMult = 0.85;
            minFavLikeForNorm = 0.30;
        } else if (isEntZone) {
            hardcoreMult = 1.15;
            minFavLikeForNorm = 0.55;
        }

        // 弹幕与评论热度特征分析
        // 争议/论战特征校验：真实网络对线与争议事件的核心特征是“观众不愿点赞，集中在评论区写小作文互撕”，评赞比异常高（>= 10%）
        // 若属干货/教程向内容，适度提高阈值至 18% 以减少评论区求资源/问报错的误判
        const debateRatioThreshold = (isHardcoreZone || hasTutorialIntent) ? 0.18 : 0.10;
        const dmDensityMult = isEntZone ? 1.15 : 1.0;
        const isDanmakuHigh = (danmakuDensity >= 15 * dmDensityMult && danmaku >= 300) || (danmaku >= 3000 && danmakuDensity >= 8 * dmDensityMult);
        const isReviewDebated = (reviewLikeRatio >= debateRatioThreshold) && (
            (review >= 300 && reviewRatio >= 0.0035) || 
            (review >= 1500 && reviewRatio >= 0.002)
        );

        // 干货判定：以「藏赞比」与「藏播比」为主轴，配合分区轻量微调，不做硬性黑名单封禁
        const isHardcoreMatch = durationMinutes >= 1.5 && (
            (favLikeRatio >= minFavLikeForNorm && (
                (play >= 5000 && normFavRatio >= 0.04 * hardcoreMult && favorites >= 250) ||
                (favorites >= 2000 && normFavRatio >= 0.025 * hardcoreMult)
            )) ||
            (play >= 3000 && favorites >= 120 && favLikeRatio >= 0.75 && normFavRatio >= 0.025 * hardcoreMult)
        );

        // 【第一层：冷门置信度保护】播放量不足 3000 时，不作随意定性（极少数纯度极高者破格授予冷门宝藏）
        if (play < 3000) {
            if (play >= 1000 && (like >= 150 || favorites >= 80) && (normLikeRatio >= 0.08 || normFavRatio >= 0.045)) {
                return {
                    className: 'q-hidden-gem',
                    tag: '💎 冷门宝藏',
                    desc: '小众高纯度佳品，播放虽少但互动扎实'
                };
            } else {
                return {
                    className: 'q-low-sample',
                    tag: '🌱 样本较少',
                    desc: '数据样本量较少（播放量 < 3000），暂不作定性评级'
                };
            }
        } else if (play >= 3000 && like > 0 && (
            ((durationMinutes <= 15 || durationMinutes === 0) && likeRatio < 0.012 && favRatio < 0.005) ||
            (durationMinutes > 15 && likeRatio < 0.005 && favRatio < 0.002)
        )) {
            // 【风控防线：低质劣作避坑】补齐 3000+ 样本区间低转化预警（长视频 > 15 分钟使用更严苛的底线防误判）
            return {
                className: 'q-warning',
                tag: '⚠️ 谨慎观看',
                desc: '高播放低评价，含金量较低谨慎点击'
            };
        } else if (durationMinutes >= 1.5 && play >= 20000 && normLikeRatio >= 0.07 && normFavRatio >= 0.035 && like >= 1500 && favorites >= 800) {
            // 【T0 顶峰神作】：大样本 + 最低时长门槛 >= 90秒 + 双率时长归一化达标 + 绝对量达标
            return {
                className: 'q-hall-of-fame',
                tag: '🏆 殿堂神作',
                desc: '殿堂级神作，三连爆满无需犹豫'
            };
        } else if (durationMinutes > 0 && durationMinutes < 1.5 && (
            (play >= 20000 && like >= 1500 && (likeRatio >= 0.06 || favRatio >= 0.03)) ||
            (play >= 10000 && like >= 1000 && likeRatio >= 0.08) ||
            (like >= 30000 && (likeRatio >= 0.03 || favRatio >= 0.015))
        )) {
            // 【专设独立分类：⚡ 爆款短片】时长 < 90秒，快节奏高完播互动爆款
            return {
                className: 'q-viral-short',
                tag: '⚡ 爆款短片',
                desc: '高能快节奏短片，互动爆棚完播极高'
            };
        } else if (play < 20000 && like >= 200 && favorites >= 80 && (normLikeRatio >= 0.08 || normFavRatio >= 0.045)) {
            // 【T2 璞玉遗珠】：中小样本下的极高纯度宝藏（时长加权）
            return {
                className: 'q-hidden-gem',
                tag: '💎 冷门宝藏',
                desc: '小众冷门宝藏，播放虽少但纯度极高'
            };
        } else if (isHardcoreMatch) {
            // 【T1 一流干货】：样本充足、时长门槛 >= 90秒且收藏转化/藏赞比达标（含分区与擦边隔离）
            return {
                className: 'q-hardcore',
                tag: '💡 硬核干货',
                desc: '顶级实用干货，建议立即收藏备用'
            };
        } else if ((play >= 5000 && normLikeRatio >= 0.07 && like >= 400) || (like >= 5000 && normLikeRatio >= 0.045)) {
            // 【T1 一流口碑】：样本充足且点赞好评清一色（时长加权）
            return {
                className: 'q-high-reputation',
                tag: '⭐ 高口碑佳作',
                desc: '观众清一色好评，极高品质无踩雷'
            };
        } else if (play >= 10000 && normLikeRatio >= 0.045 && normFavRatio >= 0.022 && like >= 600 && favorites >= 300) {
            // 【T1.5 综合标杆】：点赞、收藏、播放全方位均衡达标，六边形无短板综合水准（时长加权）
            return {
                className: 'q-balanced-masterpiece',
                tag: '🏅 综合标杆',
                desc: '赞藏双优全面扎实，六边形无短板综合标杆'
            };
        } else if (isDanmakuHigh && isReviewDebated) {
            // 【焦点级热议】：弹幕密集与评论热烈齐飞（全网大事件/深度探讨/全平台话题焦点）
            return {
                className: 'q-opinion-storm',
                tag: '💥 话题焦点',
                desc: '弹幕刷屏与评论热议齐飞，全网热议/深度探讨话题焦点'
            };
        } else if (isReviewDebated) {
            // 【评论深度交锋】：评论区长篇小作文对线（多方观点激烈碰撞/争议焦点）
            return {
                className: 'q-heated-debate',
                tag: '💬 激辩热议',
                desc: '评论区高密度交锋对线，观点碰撞引发深度热议'
            };
        } else if (isDanmakuHigh) {
            // 【弹幕即时高能】：弹幕极度密集（满屏互动、乐子欢呼或现场吵架名场面）
            return {
                className: 'q-danmaku-carnival',
                tag: '🔥 弹幕密集',
                desc: '弹幕密集高频，高能互动、乐子或热议焦点'
            };
        } else {
            // 【T3 基准良作】：各项指标均衡扎实
            return {
                className: 'q-routine',
                tag: '🍀 稳健良作',
                desc: '各项数据均衡扎实，品质稳健可靠'
            };
        }
    }

    // 在视频封面 .v-img.bili-video-card__cover 内挂载/更新评价勋章列
    function renderBadgeColumn(coverEl, stat, precomputedQuadrant = undefined, precomputedMetrics = null, evalContext = null) {
        if (!coverEl) return;
        if (!isEvaluationBadge) {
            const existing = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
            if (existing) existing.remove();
            return;
        }

        const metrics = precomputedMetrics || (stat && !stat.isPartial ? computeQualityMetrics(stat) : null);
        const quadrant = precomputedQuadrant !== undefined ? precomputedQuadrant : getQualityQuadrant(stat, metrics, evalContext);
        // 数据未就绪或未命中评级时，清空原有勋章并留白
        if (!quadrant) {
            const existing = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
            if (existing) existing.remove();
            return;
        }

        // 精选高光减负策略：未开启“全部显示”时，稳健良作 (q-routine) 与 样本较少 (q-low-sample) 默认留白不显示
        if (!isEvalFullMode && (quadrant.className === 'q-routine' || quadrant.className === 'q-low-sample')) {
            const existing = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
            if (existing) existing.remove();
            return;
        }

        const {
            play,
            like,
            favorites,
            danmaku,
            review,
            durationMinutes,
            likeRatio,
            favRatio,
            reviewRatio,
            danmakuDensity,
            durFactor,
            playFactor
        } = metrics;
        const scoreDetail = computeScoreBreakdown(metrics, quadrant.className, stat?.typename || '', evalContext);
        const healthScore = scoreDetail.score;

        let badgeCol = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
        if (!badgeCol) {
            badgeCol = document.createElement('div');
            badgeCol.className = 'bili-cleaner-badge-col';
            coverEl.appendChild(badgeCol);
        }

        // 构造悬停提示文本 (Tooltip)
        const tipLines = [
            `【${quadrant.tag}】${quadrant.desc}`,
            '────────────────────'
        ];
        if (stat?.typename) {
            tipLines.push(`📂 分区: ${stat.typename}`);
        }
        if (play > 0) {
            const bonusCapNote = scoreDetail.rawBonusTotal > 12 ? `，上限封顶` : '';
            const bonusPart = scoreDetail.bonusTotal !== 0
                ? (scoreDetail.bonusTotal > 0 ? ` + 词条${scoreDetail.bonusTotal}${bonusCapNote}` : ` - 词条${Math.abs(scoreDetail.bonusTotal)}`)
                : '';
            const bandCapNote = scoreDetail.capType === 'max' ? '，品级封顶' : (scoreDetail.capType === 'min' ? '，品级保底' : '');
            tipLines.push(`📊 综合参考分: ${healthScore} (基础${scoreDetail.base} + 表现${scoreDetail.floatScore}${bonusPart}${bandCapNote})`);
            if (scoreDetail.bonuses.length > 0) {
                tipLines.push(`✨ 结算词条: ${scoreDetail.bonuses.map(b => `${b.label}(${b.delta > 0 ? '+' : ''}${b.delta})`).join(' · ')}`);
            }
        }
        if (like > 0) {
            tipLines.push(`👍 赞播比: ${(likeRatio * 100).toFixed(1)}% (${formatStat(like)})`);
        }
        if (favorites > 0) {
            tipLines.push(`⭐ 藏播比: ${(favRatio * 100).toFixed(1)}% (${formatStat(favorites)})`);
        }
        if (play > 0) {
            const playFactorText = playFactor >= 1.05 ? ` (播放权重 ${playFactor.toFixed(2)}x)` : '';
            tipLines.push(`▶️ 播放量: ${formatStat(play)}${playFactorText}`);
        }
        if (danmaku > 0) {
            const densityText = durationMinutes > 0 ? ` (${danmakuDensity.toFixed(1)}条/分)` : '';
            tipLines.push(`💬 弹幕数: ${formatStat(danmaku)}${densityText}`);
        }
        if (review > 0) {
            tipLines.push(`📝 评论数: ${formatStat(review)} (评播比 ${(reviewRatio * 100).toFixed(2)}%)`);
        }
        if (stat?.duration) {
            const factorText = (durationMinutes > 0 && Math.abs(durFactor - 1.0) >= 0.05) ? ` (时长权重 ${durFactor.toFixed(2)}x)` : '';
            tipLines.push(`⏱️ 视频时长: ${formatDuration(stat.duration)}${factorText}`);
        }
        if (metrics.pubdate > 0) {
            const pd = new Date(metrics.pubdate * 1000);
            const yyyy = pd.getFullYear();
            const mm = String(pd.getMonth() + 1).padStart(2, '0');
            const dd = String(pd.getDate()).padStart(2, '0');
            const daysText = metrics.ageDays >= 0 ? ` (${Math.floor(metrics.ageDays)}天前)` : '';
            tipLines.push(`📅 发布时间: ${yyyy}-${mm}-${dd}${daysText}`);
        }

        const tip = tipLines.join('\n');

        const showInlineScore = play > 0 && quadrant.className !== 'q-low-sample';
        const scoreText = showInlineScore ? `· ${healthScore}` : '';

        // 幂等性守卫：若勋章已存在且评级未变，仅更新 title 与分数文本，严禁销毁重建 DOM 节点（避免重置正在播放的 CSS 动画）
        const pill = badgeCol.querySelector('.bili-cleaner-badge-pill');
        if (pill && pill.classList.contains(quadrant.className)) {
            if (pill.title !== tip) pill.title = tip;
            let scoreEl = pill.querySelector('.bili-cleaner-badge-score');
            if (showInlineScore) {
                if (!scoreEl) {
                    scoreEl = document.createElement('span');
                    scoreEl.className = 'bili-cleaner-badge-score';
                    pill.appendChild(scoreEl);
                }
                if (scoreEl.textContent !== scoreText) scoreEl.textContent = scoreText;
            } else if (scoreEl) {
                scoreEl.remove();
            }
            return;
        }

        // 先用占位空 title 注入结构，再通过 DOM property 写入含换行的完整提示文本（避免 innerHTML 中引号截断 title 属性）
        const scoreHtml = showInlineScore ? `<span class="bili-cleaner-badge-score">${scoreText}</span>` : '';
        badgeCol.innerHTML = `
            <div class="bili-cleaner-badge-pill ${quadrant.className}">
                <span class="bili-cleaner-badge-tag">${quadrant.tag}</span>
                ${scoreHtml}
            </div>
        `;
        const newPill = badgeCol.querySelector('.bili-cleaner-badge-pill');
        if (newPill) newPill.title = tip;
    }

    console.log('[Bilibili 搜索净化] 3.1.0 已启动。');
})();