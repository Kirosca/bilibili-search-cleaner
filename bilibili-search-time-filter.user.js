// ==UserScript==
// @name         Bilibili 搜索时间筛选测试器 (验证2009时间去噪法)
// @namespace    https://greasyfork.org/users/addpd
// @version      1.0.0
// @description  验证测试【搜索时添加时间筛选从2009年开始消除无关内容】效果。在搜索页注入悬浮面板，支持向搜索API附加多种协议的时间参数、统计关键词匹配率并高亮无关推荐视频。
// @author       Kirosca
// @license      MIT
// @icon         https://www.bilibili.com/favicon.ico
// @match        *://search.bilibili.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // 默认配置
    const STORAGE_KEY = 'bili_search_time_filter_config';
    const DEFAULT_CONFIG = {
        enabled: true,                       // 是否启用时间参数注入
        startDate: '2009-06-26',            // 起始时间（B站成立日：2009年6月26日）
        endDate: '',                         // 结束时间（默认为当前日期）
        paramMode: 'all',                    // 传参协议模式: 'all' | 'pubtime' | 'time_from' | 'pub_time' | 'ctime'
        hideIrrelevantDOM: false,            // 是否在DOM中隐藏不包含搜索词的无关卡片
        showBadgeOnCard: true                // 是否在卡片上标注实际发布日期与相关性徽章
    };

    function loadConfig() {
        try {
            if (typeof GM_getValue === 'function') {
                return Object.assign({}, DEFAULT_CONFIG, GM_getValue(STORAGE_KEY, {}));
            }
            const local = localStorage.getItem(STORAGE_KEY);
            return local ? Object.assign({}, DEFAULT_CONFIG, JSON.parse(local)) : DEFAULT_CONFIG;
        } catch {
            return DEFAULT_CONFIG;
        }
    }

    function saveConfig(cfg) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, cfg);
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
            }
        } catch {}
    }

    const config = loadConfig();

    // 辅助格式化时间
    function getTodayString() {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    if (!config.endDate) {
        config.endDate = getTodayString();
    }

    // 时间转换工具
    function toTimestampSec(dateStr, isEnd = false) {
        if (!dateStr) return isEnd ? Math.floor(Date.now() / 1000) : 1245945600;
        const timePart = isEnd ? '23:59:59' : '00:00:00';
        const d = new Date(`${dateStr} ${timePart}`);
        return Math.floor(d.getTime() / 1000);
    }

    function toCompactDate(dateStr) {
        return (dateStr || '').replace(/-/g, '');
    }

    // 搜索参数与结果监控状态
    const monitorState = {
        lastApiUrl: '',
        lastInjectedParams: {},
        totalItems: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        logs: [],
        videoMap: new Map() // bvid -> { title, author, pubdate, isMatched }
    };

    function addLog(msg) {
        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${msg}`;
        monitorState.logs.unshift(line);
        if (monitorState.logs.length > 50) monitorState.logs.pop();
        updateLogUI();
        console.log(`%c[2009时间测试]%c ${msg}`, 'color: #00aeec; font-weight: bold;', 'color: inherit;');
    }

    // 提取当前搜索词
    function getCurrentSearchKeyword() {
        try {
            const params = new URLSearchParams(window.location.search);
            const raw = params.get('keyword') || '';
            return decodeURIComponent(raw.replace(/\+/g, ' ')).trim().toLowerCase();
        } catch {
            return '';
        }
    }

    // ================= 1. 网络层拦截与时间参数注入 =================
    function buildTimeParams(urlStr) {
        if (!config.enabled) return null;

        const startTs = toTimestampSec(config.startDate, false);
        const endTs = toTimestampSec(config.endDate || getTodayString(), true);
        const startCompact = toCompactDate(config.startDate);
        const endCompact = toCompactDate(config.endDate || getTodayString());

        const extraParams = {};

        switch (config.paramMode) {
            case 'pubtime':
                extraParams['pubtime_begin_s'] = String(startTs);
                extraParams['pubtime_end_s'] = String(endTs);
                break;
            case 'time_from':
                extraParams['time_from'] = startCompact;
                extraParams['time_to'] = endCompact;
                break;
            case 'pub_time':
                extraParams['pub_time_from'] = config.startDate;
                extraParams['pub_time_to'] = config.endDate || getTodayString();
                break;
            case 'ctime':
                extraParams['ctime_from'] = `${config.startDate} 00:00:00`;
                extraParams['ctime_to'] = `${config.endDate || getTodayString()} 23:59:59`;
                break;
            case 'all':
            default:
                extraParams['pubtime_begin_s'] = String(startTs);
                extraParams['pubtime_end_s'] = String(endTs);
                extraParams['time_from'] = startCompact;
                extraParams['time_to'] = endCompact;
                extraParams['pub_time_from'] = config.startDate;
                extraParams['pub_time_to'] = config.endDate || getTodayString();
                break;
        }

        return extraParams;
    }

    function injectParamsToUrl(originalUrl) {
        const extra = buildTimeParams(originalUrl);
        if (!extra) return { newUrl: originalUrl, injected: {} };

        try {
            const parsed = new URL(originalUrl, window.location.origin);
            for (const [k, v] of Object.entries(extra)) {
                parsed.searchParams.set(k, v);
            }
            return { newUrl: parsed.toString(), injected: extra };
        } catch {
            return { newUrl: originalUrl, injected: {} };
        }
    }

    // 结果数据分析
    function analyzeSearchResults(data) {
        if (!data?.data?.result) return;
        const currentKw = getCurrentSearchKeyword();
        let items = [];

        if (Array.isArray(data.data.result)) {
            if (data.data.result.length > 0 && Array.isArray(data.data.result[0].data)) {
                for (const cat of data.data.result) {
                    if (cat.data && Array.isArray(cat.data)) {
                        items = items.concat(cat.data);
                    }
                }
            } else {
                items = data.data.result;
            }
        }

        let matched = 0;
        let unmatched = 0;

        items.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const bvid = item.bvid || item.aid || item.id;
            if (!bvid) return;

            // 净化标题（剔除高亮 <em> 标签与 HTML 实体）
            const rawTitle = (item.title || '')
                .replace(/<[^>]+>/g, '')
                .replace(/&[a-z0-9#]+;/gi, '')
                .trim()
                .toLowerCase();

            const pubdate = item.pubdate || item.senddate || 0;
            const author = item.author || (item.owner && item.owner.name) || '';

            const isMatched = !currentKw || rawTitle.includes(currentKw);
            if (isMatched) {
                matched++;
            } else {
                unmatched++;
            }

            monitorState.videoMap.set(String(bvid), {
                title: item.title,
                cleanTitle: rawTitle,
                author,
                pubdate,
                isMatched
            });
        });

        monitorState.totalItems = items.length;
        monitorState.matchedCount = matched;
        monitorState.unmatchedCount = unmatched;

        addLog(`收到响应：共 ${items.length} 条，标题含关键词: ${matched} 条，无关/无关键词: ${unmatched} 条`);
        updateStatusUI();
        updateCardBadges();
    }

    // 拦截 window.fetch
    const rawFetch = window.fetch;
    window.fetch = async function (...args) {
        let urlStr = '';
        if (typeof args[0] === 'string') {
            urlStr = args[0];
        } else if (args[0] && typeof args[0] === 'object') {
            urlStr = args[0].url || '';
        }

        const isSearchReq = urlStr.includes('/wbi/search') || urlStr.includes('/search/type') || urlStr.includes('/search/all');

        if (isSearchReq) {
            const { newUrl, injected } = injectParamsToUrl(urlStr);
            monitorState.lastApiUrl = newUrl;
            monitorState.lastInjectedParams = injected;

            const paramKeys = Object.keys(injected);
            if (paramKeys.length > 0) {
                addLog(`拦截搜索请求，已注入时间参数: ${JSON.stringify(injected)}`);
            } else {
                addLog('拦截搜索请求（未启用时间注入）');
            }

            if (typeof args[0] === 'string') {
                args[0] = newUrl;
            } else if (args[0] && typeof args[0] === 'object') {
                args[0] = new Request(newUrl, args[0]);
            }
        }

        const response = await rawFetch.apply(this, args);
        if (!isSearchReq) return response;

        try {
            const clone = response.clone();
            const data = await clone.json();
            analyzeSearchResults(data);
        } catch (e) {
            addLog(`解析搜索响应失败: ${e.message}`);
        }

        return response;
    };

    // ================= 2. DOM 视图标记与去噪处理 =================
    function updateCardBadges() {
        const cards = document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"]');
        const currentKw = getCurrentSearchKeyword();

        cards.forEach(card => {
            const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"]');
            if (!linkEl) return;

            const href = linkEl.href || '';
            const match = href.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
            if (!match) return;

            const bvid = match[1];
            const info = monitorState.videoMap.get(bvid);

            // 若开启了卡片标注
            if (config.showBadgeOnCard && info) {
                let badge = card.querySelector('.bili-time-test-badge');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.className = 'bili-time-test-badge';
                    badge.style.cssText = `
                        position: absolute;
                        top: 4px;
                        right: 4px;
                        z-index: 99;
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: bold;
                        line-height: 14px;
                        pointer-events: none;
                        display: flex;
                        gap: 4px;
                        align-items: center;
                    `;
                    const container = card.querySelector('.bili-video-card__wrap') || card;
                    container.style.position = 'relative';
                    container.appendChild(badge);
                }

                const dateStr = info.pubdate ? new Date(info.pubdate * 1000).toLocaleDateString() : '未知日期';
                if (info.isMatched) {
                    badge.style.backgroundColor = 'rgba(0, 174, 236, 0.85)';
                    badge.style.color = '#fff';
                    badge.textContent = `✓ 命中 | ${dateStr}`;
                    card.style.outline = 'none';
                } else {
                    badge.style.backgroundColor = 'rgba(255, 102, 102, 0.9)';
                    badge.style.color = '#fff';
                    badge.textContent = `✕ 无关推荐 | ${dateStr}`;
                    card.style.outline = '2px dashed #ff6666';
                }
            }

            // 若开启了本地隐藏无关推荐
            if (config.hideIrrelevantDOM && info && !info.isMatched && currentKw) {
                card.style.display = 'none';
            } else if (card.style.display === 'none' && (!config.hideIrrelevantDOM || (info && info.isMatched))) {
                card.style.display = '';
            }
        });
    }

    // 观察 DOM 加载
    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updateCardBadges);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // ================= 3. 悬浮测试控制面板 UI =================
    function createPanelUI() {
        if (document.getElementById('bili-time-filter-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'bili-time-filter-panel';
        panel.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            width: 320px;
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: blur(10px);
            border: 1px solid #e3e5e7;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
            font-size: 13px;
            color: #18191c;
            overflow: hidden;
            transition: transform 0.2s ease;
        `;

        panel.innerHTML = `
            <div id="btf-header" style="background: #00aeec; color: #fff; padding: 10px 14px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none;">
                <span>⏱️ 2009时间去噪测试器</span>
                <span id="btf-toggle-btn" style="cursor: pointer; font-size: 14px;">▼</span>
            </div>
            <div id="btf-body" style="padding: 12px 14px; max-height: 480px; overflow-y: auto;">
                <div style="margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
                    <label style="font-weight: bold; display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="btf-enabled" ${config.enabled ? 'checked' : ''} style="margin-right: 6px;">
                        启用时间参数注入
                    </label>
                    <button id="btf-refresh-btn" style="padding: 2px 8px; font-size: 12px; background: #00aeec; color: #fff; border: none; border-radius: 4px; cursor: pointer;">重新检索</button>
                </div>

                <div style="background: #f6f7f8; padding: 8px; border-radius: 6px; margin-bottom: 10px;">
                    <div style="margin-bottom: 6px;">
                        <span style="color: #61666d; font-size: 12px;">起始日期：</span>
                        <input type="date" id="btf-start-date" value="${config.startDate}" style="padding: 2px 4px; font-size: 12px; border: 1px solid #ccd0d7; border-radius: 4px;">
                        <button id="btf-reset-2009" style="padding: 2px 6px; font-size: 11px; margin-left: 4px; background: #e3e5e7; border: none; border-radius: 3px; cursor: pointer;">重置2009</button>
                    </div>
                    <div>
                        <span style="color: #61666d; font-size: 12px;">结束日期：</span>
                        <input type="date" id="btf-end-date" value="${config.endDate}" style="padding: 2px 4px; font-size: 12px; border: 1px solid #ccd0d7; border-radius: 4px;">
                    </div>
                </div>

                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #61666d; margin-bottom: 4px;">注入协议模式：</div>
                    <select id="btf-param-mode" style="width: 100%; padding: 4px; font-size: 12px; border: 1px solid #ccd0d7; border-radius: 4px;">
                        <option value="all" ${config.paramMode === 'all' ? 'selected' : ''}>模式1: 全协议注入 (pubtime+time_from+pub_time)</option>
                        <option value="pubtime" ${config.paramMode === 'pubtime' ? 'selected' : ''}>模式2: pubtime_begin_s (秒级时间戳)</option>
                        <option value="time_from" ${config.paramMode === 'time_from' ? 'selected' : ''}>模式3: time_from & time_to (YYYYMMDD)</option>
                        <option value="pub_time" ${config.paramMode === 'pub_time' ? 'selected' : ''}>模式4: pub_time_from (标准日期格式)</option>
                        <option value="ctime" ${config.paramMode === 'ctime' ? 'selected' : ''}>模式5: ctime_from (创建时间)</option>
                    </select>
                </div>

                <div style="margin-bottom: 10px; padding: 6px 0; border-top: 1px dashed #e3e5e7; border-bottom: 1px dashed #e3e5e7;">
                    <label style="font-size: 12px; display: block; margin-bottom: 4px; cursor: pointer;">
                        <input type="checkbox" id="btf-hide-dom" ${config.hideIrrelevantDOM ? 'checked' : ''} style="margin-right: 4px;">
                        DOM辅助：直接隐藏不含搜索词的卡片
                    </label>
                    <label style="font-size: 12px; display: block; cursor: pointer;">
                        <input type="checkbox" id="btf-badge-dom" ${config.showBadgeOnCard ? 'checked' : ''} style="margin-right: 4px;">
                        卡片标注：卡片显示发布日期与相关性徽章
                    </label>
                </div>

                <div style="background: #f1f2f3; padding: 8px; border-radius: 6px; margin-bottom: 10px;">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 12px; color: #18191c;">📊 搜索效果即时统计</div>
                    <div style="font-size: 12px; color: #61666d;">当前关键词: <b id="btf-kw-display" style="color: #00aeec;">-</b></div>
                    <div style="font-size: 12px; color: #61666d;">总条数: <span id="btf-total-count">0</span></div>
                    <div style="font-size: 12px; color: #18191c;">包含关键词: <span id="btf-match-count" style="color: #00a1d6; font-weight: bold;">0</span></div>
                    <div style="font-size: 12px; color: #18191c;">无关/强推项: <span id="btf-unmatch-count" style="color: #ff6666; font-weight: bold;">0</span></div>
                </div>

                <div>
                    <div style="font-size: 12px; color: #61666d; margin-bottom: 4px; display: flex; justify-content: space-between;">
                        <span>实时拦截日志：</span>
                        <span id="btf-clear-log" style="cursor: pointer; color: #00aeec;">清空</span>
                    </div>
                    <div id="btf-log-box" style="background: #2b2b2b; color: #00ff88; font-family: Consolas, monospace; font-size: 11px; padding: 6px; border-radius: 4px; height: 90px; overflow-y: auto; line-height: 1.4;">
                        [准备就绪] 等待搜索请求...
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // 事件绑定
        const enabledCheckbox = document.getElementById('btf-enabled');
        const startDateInput = document.getElementById('btf-start-date');
        const endDateInput = document.getElementById('btf-end-date');
        const paramModeSelect = document.getElementById('btf-param-mode');
        const hideDomCheckbox = document.getElementById('btf-hide-dom');
        const badgeDomCheckbox = document.getElementById('btf-badge-dom');
        const reset2009Btn = document.getElementById('btf-reset-2009');
        const refreshBtn = document.getElementById('btf-refresh-btn');
        const toggleBtn = document.getElementById('btf-toggle-btn');
        const bodyEl = document.getElementById('btf-body');
        const clearLogBtn = document.getElementById('btf-clear-log');

        enabledCheckbox.addEventListener('change', () => {
            config.enabled = enabledCheckbox.checked;
            saveConfig(config);
            addLog(`切换时间注入开关: ${config.enabled ? '已启用' : '已停用'}`);
        });

        startDateInput.addEventListener('change', () => {
            config.startDate = startDateInput.value;
            saveConfig(config);
            addLog(`更新起始日期: ${config.startDate}`);
        });

        endDateInput.addEventListener('change', () => {
            config.endDate = endDateInput.value;
            saveConfig(config);
            addLog(`更新结束日期: ${config.endDate}`);
        });

        paramModeSelect.addEventListener('change', () => {
            config.paramMode = paramModeSelect.value;
            saveConfig(config);
            addLog(`切换参数模式: ${config.paramMode}`);
        });

        hideDomCheckbox.addEventListener('change', () => {
            config.hideIrrelevantDOM = hideDomCheckbox.checked;
            saveConfig(config);
            updateCardBadges();
        });

        badgeDomCheckbox.addEventListener('change', () => {
            config.showBadgeOnCard = badgeDomCheckbox.checked;
            saveConfig(config);
            updateCardBadges();
        });

        reset2009Btn.addEventListener('click', () => {
            startDateInput.value = '2009-06-26';
            config.startDate = '2009-06-26';
            saveConfig(config);
            addLog('起始日期已重置为 B站成立日 2009-06-26');
        });

        refreshBtn.addEventListener('click', () => {
            addLog('正在重新加载当前搜索页...');
            window.location.reload();
        });

        let isCollapsed = false;
        toggleBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            bodyEl.style.display = isCollapsed ? 'none' : 'block';
            toggleBtn.textContent = isCollapsed ? '▲' : '▼';
        });

        clearLogBtn.addEventListener('click', () => {
            monitorState.logs = [];
            updateLogUI();
        });

        updateStatusUI();
    }

    function updateStatusUI() {
        const kwEl = document.getElementById('btf-kw-display');
        const totalEl = document.getElementById('btf-total-count');
        const matchEl = document.getElementById('btf-match-count');
        const unmatchEl = document.getElementById('btf-unmatch-count');

        if (kwEl) kwEl.textContent = getCurrentSearchKeyword() || '(空)';
        if (totalEl) totalEl.textContent = monitorState.totalItems;
        if (matchEl) matchEl.textContent = monitorState.matchedCount;
        if (unmatchEl) unmatchEl.textContent = monitorState.unmatchedCount;
    }

    function updateLogUI() {
        const box = document.getElementById('btf-log-box');
        if (!box) return;
        box.innerHTML = monitorState.logs.join('<br>') || '[无日志]';
    }

    // 页面加载完成后注入 UI 面板
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createPanelUI);
    } else {
        createPanelUI();
    }

    console.log('[2009时间筛选测试器] 已注入准备就绪。');
})();
