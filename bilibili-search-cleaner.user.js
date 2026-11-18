// ==UserScript==
// @name         Bilibili 去掉搜索无关视频 高亮
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 @UP主 定向筛选、-排除词、#Tag 专项筛选，新增 API 直连跨页连续聚合流与智能枯竭劝退机制。（支持简繁双向归一化）
// @author       Kirosca
// @match        *://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

/* global OpenCC */

(function() {
    'use strict';

    // =========================================================================
    // 0. 基础环境与 OpenCC 单例繁简转换器
    // =========================================================================
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

    // 通用文本清洗：繁简归一化、HTML实体反转义与标点规范化（去除引号与管道符转空格）
    function cleanText(str) {
        if (!str) return '';
        const simplified = toSimplified(str);
        return simplified
            .replace(/&#x27;|&#39;|&apos;/g, '')
            .replace(/&quot;/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/[\u2018\u2019\u201A\u201B\uFF07`']/g, '')
            .replace(/[\u201C\u201D\uFF02"]/g, '')
            .replace(/[\uFF5C|]/g, ' ')
            .trim()
            .toLowerCase();
    }

    // =========================================================================
    // 1. 预注入 CSS 规则：秒杀推广广告并美化控制组件
    // =========================================================================
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        div[class*="col_"]:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]),
        .video-list-item:has(.bili-video-card__info--ad, svg.bili-video-card__info--ad-creative, a[href*="cm.bilibili.com"]) {
            display: none !important;
        }
        .bili-cleaner-toast {
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(24, 25, 28, 0.9);
            color: #ffffff;
            padding: 8px 18px;
            border-radius: 8px;
            font-size: 13px;
            z-index: 1000000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            pointer-events: none;
            transition: opacity 0.3s;
        }
        /* 聚光灯聚焦模式样式（纯视觉聚焦，100% 保留原生事件与交互） */
        .bili-cleaner-dimmed {
            opacity: 0.16 !important;
            filter: grayscale(85%) contrast(85%) !important;
            transition: opacity 0.25s ease, filter 0.25s ease, transform 0.25s ease !important;
        }
        .bili-cleaner-dimmed:hover {
            opacity: 1 !important;
            filter: none !important;
            transform: translateY(-2px);
            z-index: 10;
        }
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
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
            pointer-events: none;
        }
    `;
    (document.head || document.documentElement).appendChild(styleElement);

    // =========================================================================
    // 2. WBI 官方签名与自包含 MD5 模块（解决翻页与脱壳导致 -403 的深层 Bug）
    // =========================================================================
    const MIXIN_KEY_ENC_TAB = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
        33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
        61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
        36, 20, 34, 44, 52
    ];

    function md5(string) {
        function rotateLeft(lValue, iShiftBits) {
            return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
        }
        function addUnsigned(lX, lY) {
            const lX8 = (lX & 0x80000000);
            const lY8 = (lY & 0x80000000);
            const lX4 = (lX & 0x40000000);
            const lY4 = (lY & 0x40000000);
            const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
            if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
            if (lX4 | lY4) {
                if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                else return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
            } else {
                return (lResult ^ lX8 ^ lY8);
            }
        }
        function F(x, y, z) { return (x & y) | ((~x) & z); }
        function G(x, y, z) { return (x & z) | (y & (~z)); }
        function H(x, y, z) { return (x ^ y ^ z); }
        function I(x, y, z) { return (y ^ (x | (~z))); }
        function FF(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }
        function GG(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }
        function HH(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }
        function II(a, b, c, d, x, s, ac) {
            a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }
        function convertToWordArray(string) {
            let lWordCount;
            const lMessageLength = string.length;
            const lNumberOfWords_temp1 = lMessageLength + 8;
            const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
            const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
            const lWordArray = Array(lNumberOfWords - 1);
            let lBytePosition = 0;
            let lByteCount = 0;
            while (lByteCount < lMessageLength) {
                lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
                lByteCount++;
            }
            lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
            lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
            return lWordArray;
        }
        function wordToHex(lValue) {
            let WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
            for (lCount = 0; lCount <= 3; lCount++) {
                lByte = (lValue >>> (lCount * 8)) & 255;
                WordToHexValue_temp = "0" + lByte.toString(16);
                WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
            }
            return WordToHexValue;
        }
        function utf8Encode(string) {
            string = string.replace(/\r\n/g, "\n");
            let utftext = "";
            for (let n = 0; n < string.length; n++) {
                const c = string.charCodeAt(n);
                if (c < 128) {
                    utftext += String.fromCharCode(c);
                } else if ((c > 127) && (c < 2048)) {
                    utftext += String.fromCharCode((c >> 6) | 192);
                    utftext += String.fromCharCode((c & 63) | 128);
                } else {
                    utftext += String.fromCharCode((c >> 12) | 224);
                    utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                    utftext += String.fromCharCode((c & 63) | 128);
                }
            }
            return utftext;
        }

        const x = convertToWordArray(utf8Encode(string));
        let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
        for (let k = 0; k < x.length; k += 16) {
            const AA = a, BB = b, CC = c, DD = d;
            a = FF(a, b, c, d, x[k + 0], 7, 0xD76AA478);
            d = FF(d, a, b, c, x[k + 1], 12, 0xE8C7B756);
            c = FF(c, d, a, b, x[k + 2], 17, 0x242070DB);
            b = FF(b, c, d, a, x[k + 3], 22, 0xC1BDCEEE);
            a = FF(a, b, c, d, x[k + 4], 7, 0xF57C0FAF);
            d = FF(d, a, b, c, x[k + 5], 12, 0x4787C62A);
            c = FF(c, d, a, b, x[k + 6], 17, 0xA8304613);
            b = FF(b, c, d, a, x[k + 7], 22, 0xFD469501);
            a = FF(a, b, c, d, x[k + 8], 7, 0x698098D8);
            d = FF(d, a, b, c, x[k + 9], 12, 0x8B44F7AF);
            c = FF(c, d, a, b, x[k + 10], 17, 0xFFFF5BB1);
            b = FF(b, c, d, a, x[k + 11], 22, 0x895CD7BE);
            a = FF(a, b, c, d, x[k + 12], 7, 0x6B901122);
            d = FF(d, a, b, c, x[k + 13], 12, 0xFD987193);
            c = FF(c, d, a, b, x[k + 14], 17, 0xA679438E);
            b = FF(b, c, d, a, x[k + 15], 22, 0x49B40821);

            a = GG(a, b, c, d, x[k + 1], 5, 0xF61E2562);
            d = GG(d, a, b, c, x[k + 6], 9, 0xC040B340);
            c = GG(c, d, a, b, x[k + 11], 14, 0x265E5A51);
            b = GG(b, c, d, a, x[k + 0], 20, 0xE9B6C7AA);
            a = GG(a, b, c, d, x[k + 5], 5, 0xD62F105D);
            d = GG(d, a, b, c, x[k + 10], 9, 0x02441453);
            c = GG(c, d, a, b, x[k + 15], 14, 0xD8A1E681);
            b = GG(b, c, d, a, x[k + 4], 20, 0xE7D3FBC8);
            a = GG(a, b, c, d, x[k + 9], 5, 0x21E1CDE6);
            d = GG(d, a, b, c, x[k + 14], 9, 0xC33707D6);
            c = GG(c, d, a, b, x[k + 3], 14, 0xF4D50D87);
            b = GG(b, c, d, a, x[k + 8], 20, 0x455A14ED);
            a = GG(a, b, c, d, x[k + 13], 5, 0xA9E3E905);
            d = GG(d, a, b, c, x[k + 2], 9, 0xFCEFA3F8);
            c = GG(c, d, a, b, x[k + 7], 14, 0x676F02D9);
            b = GG(b, c, d, a, x[k + 12], 20, 0x8D2A4C8A);

            a = HH(a, b, c, d, x[k + 5], 4, 0xFFFA3942);
            d = HH(d, a, b, c, x[k + 8], 11, 0x8771F681);
            c = HH(c, d, a, b, x[k + 11], 16, 0x6D9D6122);
            b = HH(b, c, d, a, x[k + 14], 23, 0xFDE5380C);
            a = HH(a, b, c, d, x[k + 1], 4, 0xA4BEEA44);
            d = HH(d, a, b, c, x[k + 4], 11, 0x4BDECFA9);
            c = HH(c, d, a, b, x[k + 7], 16, 0xF6BB4B60);
            b = HH(b, c, d, a, x[k + 10], 23, 0xBEBFBC70);
            a = HH(a, b, c, d, x[k + 13], 4, 0x289B7EC6);
            d = HH(d, a, b, c, x[k + 0], 11, 0xEAA127FA);
            c = HH(c, d, a, b, x[k + 3], 16, 0xD4EF3085);
            b = HH(b, c, d, a, x[k + 6], 23, 0x04881D05);
            a = HH(a, b, c, d, x[k + 9], 4, 0xD9D4D039);
            d = HH(d, a, b, c, x[k + 12], 11, 0xE6DB99E5);
            c = HH(c, d, a, b, x[k + 15], 16, 0x1FA27CF8);
            b = HH(b, c, d, a, x[k + 2], 23, 0xC4AC5665);

            a = II(a, b, c, d, x[k + 0], 6, 0xF4292244);
            d = II(d, a, b, c, x[k + 7], 10, 0x432AFF97);
            c = II(c, d, a, b, x[k + 14], 15, 0xAB9423A7);
            b = II(b, c, d, a, x[k + 5], 21, 0xFC93A039);
            a = II(a, b, c, d, x[k + 12], 6, 0x655B59C3);
            d = II(d, a, b, c, x[k + 3], 10, 0x8F0CCC92);
            c = II(c, d, a, b, x[k + 10], 15, 0xFFEFF47D);
            b = II(b, c, d, a, x[k + 1], 21, 0x85845DD1);
            a = II(a, b, c, d, x[k + 8], 6, 0x6FA87E4F);
            d = II(d, a, b, c, x[k + 15], 10, 0xFE2CE6E0);
            c = II(c, d, a, b, x[k + 6], 15, 0xA3014314);
            b = II(b, c, d, a, x[k + 13], 21, 0x4E0811A1);
            a = II(a, b, c, d, x[k + 4], 6, 0xF7537E82);
            d = II(d, a, b, c, x[k + 11], 10, 0xBD3AF235);
            c = II(c, d, a, b, x[k + 2], 15, 0x2AD7D2BB);
            b = II(b, c, d, a, x[k + 9], 21, 0xEB86D391);

            a = addUnsigned(a, AA);
            b = addUnsigned(b, BB);
            c = addUnsigned(c, CC);
            d = addUnsigned(d, DD);
        }
        return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
    }

    function getMixinKey(origKey) {
        let mixinKey = '';
        for (let i = 0; i < 32; i++) {
            mixinKey += origKey[MIXIN_KEY_ENC_TAB[i]];
        }
        return mixinKey;
    }

    let cachedWbiKeys = null;
    async function getWbiKeys() {
        if (cachedWbiKeys) return cachedWbiKeys;
        const res = await window.fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
        const json = await res.json();
        const wbiImg = json.data?.wbi_img;
        if (!wbiImg) throw new Error('未能从 nav 接口获取 WBI 密钥');
        cachedWbiKeys = {
            imgKey: wbiImg.img_url.slice(wbiImg.img_url.lastIndexOf('/') + 1, wbiImg.img_url.lastIndexOf('.')),
            subKey: wbiImg.sub_url.slice(wbiImg.sub_url.lastIndexOf('/') + 1, wbiImg.sub_url.lastIndexOf('.'))
        };
        return cachedWbiKeys;
    }

    function signWbiParams(params, imgKey, subKey) {
        const mixinKey = getMixinKey(imgKey + subKey);
        const currTime = Math.floor(Date.now() / 1000);
        const queryObj = Object.assign({}, params, { wts: currTime });

        const sortedKeys = Object.keys(queryObj).sort();
        const queryParts = [];
        for (const key of sortedKeys) {
            let value = queryObj[key];
            if (value === undefined || value === null) continue;
            value = String(value).replace(/[!'()*]/g, '');
            queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
        const queryString = queryParts.join('&');
        const w_rid = md5(queryString + mixinKey);
        return `${queryString}&w_rid=${w_rid}`;
    }

    // =========================================================================
    // 3. 核心语法解析引擎（支持普通词 / -排除词 / #Tag / @UP主）
    // =========================================================================
    // 统一获取原始搜索词（彻底解决 F5 刷新时未转义的 # 被浏览器切分入 window.location.hash，导致无法读取 #Tag 的问题）
    function getRawSearchKeyword() {
        let kw = '';

        // 1. 优先尝试从 search 中获取
        const params = new URLSearchParams(window.location.search);
        const searchKeyword = params.get('keyword');
        if (searchKeyword !== null) {
            kw = searchKeyword;
        }

        // 2. 检查 hash（兼容未编码 # 切分入 hash，如 ?keyword=python#教程 或 ?keyword=#教程）
        if (window.location.hash) {
            const hash = window.location.hash;
            if (hash.includes('keyword=')) {
                try {
                    const hashParams = new URLSearchParams(hash.slice(hash.indexOf('?')));
                    const val = hashParams.get('keyword');
                    if (val) kw = val;
                } catch (e) {}
            } else if (!hash.startsWith('#/') && !hash.startsWith('#?')) {
                const tagFragment = decodeURIComponent(hash.slice(1)).trim();
                if (tagFragment) {
                    if (kw) {
                        kw = decodeURIComponent(kw.replace(/\+/g, ' ')) + ' #' + tagFragment;
                    } else {
                        kw = '#' + tagFragment;
                    }
                }
            }
        }

        // 3. DOM 搜索输入框兜底（若 URL 中缺失或丢失 # 符号，读取真实输入框内容）
        const inputEl = document.querySelector('input.search-input-el, input.nav-search-input, .search-input input, .search-input-wrap input');
        if (inputEl && inputEl.value && inputEl.value.trim()) {
            const domVal = inputEl.value.trim();
            if (domVal.includes('#') || domVal.includes('@') || domVal.includes('-')) {
                kw = domVal;
            } else if (!kw) {
                kw = domVal;
            }
        }

        try {
            return decodeURIComponent(kw.replace(/\+/g, ' ')).trim();
        } catch (e) {
            return kw.replace(/\+/g, ' ').trim();
        }
    }

    // 解析关键词分类 (普通词 / -排除词 / #Tag词 / @UP主词)
    function getSearchKeywords() {
        const rawKeyword = cleanText(getRawSearchKeyword());
        if (!rawKeyword) return { normal: [], exclude: [], tags: [], ups: [], hasRules: false };

        const list = rawKeyword.split(/\s+/);
        const normal = [];
        const exclude = [];
        const tags = [];
        const ups = [];

        for (let k of list) {
            // 输入法全角归一化容错，移除 * 前缀
            k = k.replace(/^[\*＊]+/, '')
                 .replace(/^[\#＃]/, '#')
                 .replace(/^[\@＠]/, '@')
                 .replace(/^[\-－]/, '-');

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

        const hasRules = Boolean(normal.length || exclude.length || tags.length || ups.length);
        return { normal, exclude, tags, ups, hasRules };
    }

    // 提取发给 B 站官方接口的搜索词（脱壳脱除 #, @, - 前缀并繁简归一）
    function getCleanApiKeyword() {
        const rawKeyword = getRawSearchKeyword();
        if (!rawKeyword) return '';

        const list = rawKeyword.split(/\s+/);
        const searchTerms = [];
        for (let k of list) {
            k = k.replace(/^[\*＊]+/, '')
                 .replace(/^[\#＃]/, '#')
                 .replace(/^[\@＠]/, '@')
                 .replace(/^[\-－]/, '-');

            if (k.startsWith('-')) {
                continue; // 负向排除词不发送给 B站 API
            } else if (k.startsWith('@') || k.startsWith('#')) {
                if (k.length > 1) searchTerms.push(k.substring(1));
            } else if (k) {
                searchTerms.push(k);
            }
        }
        return toSimplified(searchTerms.join(' ')) || rawKeyword.replace(/^[\#\@\-]/gm, '').trim();
    }

    // =========================================================================
    // 4. 网络层拦截与存储：缓存 Tag 字典 + 拦截广告
    // =========================================================================
    const videoTagMap = new Map();

    function cleanAdsOnly(list) {
        if (!Array.isArray(list)) return list;
        return list.filter(v => {
            if (!v || typeof v !== 'object') return true;
            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = cleanText(v.tag || v.keywords || v.tags || '');
            if (id) {
                const sId = String(id);
                videoTagMap.set(sId, rawTags);
                videoTagMap.set(sId.toLowerCase(), rawTags);
                videoTagMap.set(sId.toUpperCase(), rawTags);
            }
            if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;
            return true;
        });
    }

    // 拦截 XMLHttpRequest 与 Fetch（覆盖 Axios 等库，确保 /video 子页面的 Tag 字典无遗漏入库）
    const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const originXHR = targetWin.XMLHttpRequest || window.XMLHttpRequest;
    function CustomXHR() {
        const xhr = new originXHR();
        let requestUrl = '';

        const origOpen = xhr.open;
        xhr.open = function(method, url, ...rest) {
            requestUrl = String(url || '');
            return origOpen.call(this, method, url, ...rest);
        };

        xhr.addEventListener('load', function() {
            const isSearch = requestUrl.includes('/wbi/search') || requestUrl.includes('/search/type') || requestUrl.includes('/search/all');
            if (isSearch && xhr.responseText) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (data?.data?.result) {
                        if (Array.isArray(data.data.result)) {
                            if (data.data.result.length > 0 && data.data.result[0].data && Array.isArray(data.data.result[0].data)) {
                                for (const cat of data.data.result) {
                                    if (cat.result_type === 'video' || cat.result_type === 'live_room' || !cat.result_type) {
                                        cleanAdsOnly(cat.data);
                                    }
                                }
                            } else {
                                cleanAdsOnly(data.data.result);
                            }
                        }
                    }
                } catch (e) {}
            }
        });

        return xhr;
    }
    CustomXHR.prototype = originXHR.prototype;
    Object.keys(originXHR).forEach(k => {
        try { CustomXHR[k] = originXHR[k]; } catch (e) {}
    });
    targetWin.XMLHttpRequest = CustomXHR;
    try { if (window !== targetWin) window.XMLHttpRequest = CustomXHR; } catch (e) {}

    const originFetch = targetWin.fetch || window.fetch;
    const customFetch = async function(...args) {
        let urlStr = '';
        if (typeof args[0] === 'string') urlStr = args[0];
        else if (args[0] && typeof args[0] === 'object') urlStr = args[0].url || '';

        const isSearchReq = urlStr.includes('/wbi/search') || urlStr.includes('/search/type') || urlStr.includes('/search/all');

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
    targetWin.fetch = customFetch;
    try { if (window !== targetWin) window.fetch = customFetch; } catch (e) {}

    // =========================================================================
    // 5. 纯数据对象过滤判定器（内存级极速安检，杜绝无效卡片挂载 DOM）
    // =========================================================================
    function checkVideoMatch(titleRaw, tagsRaw, authorRaw, filters) {
        const title = cleanText(titleRaw);
        const tags = cleanText(tagsRaw);
        // 先进行 trim 剔除首尾换行与空格，再精准剥离日期后缀（避免首字符为空白时误把作者全部清空）
        const author = cleanText((authorRaw || '').trim().replace(/\s*[·•][\s\S]*$/, '').trim());

        const { normal, exclude, tags: filterTags, ups } = filters;

        // 1. 排除词一票否决
        if (exclude.some(k => title.includes(k))) return false;
        // 2. 普通词：标题严格包含 (AND)
        if (normal.length && !normal.every(k => title.includes(k))) return false;
        // 3. 显式标签筛选：
        // 若已捕获到视频 Tag 字典，优先在标签库中精确比对；
        // 兼容支持：若当前视频标签库尚为空（首屏异步未到位）或标签为复合词，回退检查标题与作者，杜绝误杀全部视频
        if (filterTags.length) {
            const hasTagMatch = filterTags.every(k => {
                if (tags && tags.length > 0) {
                    return tags.includes(k) || title.includes(k) || author.includes(k);
                } else {
                    return title.includes(k) || author.includes(k);
                }
            });
            if (!hasTagMatch) return false;
        }
        // 4. 显式UP主筛选：必须匹配作者
        if (ups.length && !ups.some(k => author.includes(k))) return false;

        return true;
    }

    // DOM 层执行安检
    // 展现模式：spotlight（聚光灯高亮·堵不如疏） vs hide（物理隐藏）
    // 核心运行模式（三个平级选项：waterfall 瀑布流 | spotlight 聚光灯高亮 | hide 物理隐藏）
    // A【瀑布流】：翻页方式为瀑布流，展示方式为物理隐藏，不聚光灯高亮展示，拉取时不过滤视频全部注入
    // B【聚光灯高亮】：B站原生翻页不动，纯聚光灯高亮/暗化展示
    // C【物理隐藏】：B站原生翻页不动，B站原生卡片展示方式（无关视频 display:none 物理隐藏）
    let currentMode = localStorage.getItem('bili_cleaner_mode') || 'waterfall';

    function applyCardFilterVisual(card, isMatch) {
        if (currentMode === 'spotlight') {
            // B. 聚光灯高亮模式：高亮与暗化，不物理隐藏，翻页为B站原生
            card.style.removeProperty('display');
            if (isMatch) {
                card.classList.add('bili-cleaner-highlighted');
                card.classList.remove('bili-cleaner-dimmed');
            } else {
                card.classList.add('bili-cleaner-dimmed');
                card.classList.remove('bili-cleaner-highlighted');
            }
        } else {
            // A. 瀑布流模式 & C. 物理隐藏模式：展示方式均为【物理隐藏】+ 原生展示，不使用聚光灯
            card.classList.remove('bili-cleaner-highlighted', 'bili-cleaner-dimmed');
            if (isMatch) {
                card.style.removeProperty('display');
            } else {
                card.style.setProperty('display', 'none', 'important');
            }
        }
    }

    let isProcessing = false;
    function filterDOMElements() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const filters = getSearchKeywords();
            if (!filters.hasRules && !filters.normal.length) return;

            const currentSearchQuery = getRawSearchKeyword() + '_' + currentMode;
            // 采用单一容器层级选择器，彻底杜绝子节点与父节点重复获取 (避免 3x 冗余遍历)
            let cards = document.querySelectorAll('.video-list-item, div.video-list > div[class*="col_"], .bili-live-card');
            if (!cards || cards.length === 0) {
                cards = document.querySelectorAll('.bili-video-card');
            }

            let matchCount = 0;
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];

                if (card.dataset.purifiedQuery !== currentSearchQuery) {
                    const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                    if (!linkEl) continue;

                    const titleEl = card.querySelector('h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3');
                    if (!titleEl) continue;

                    const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
                    if (!rawTitle.trim()) continue; // 骨架屏阶段未注水标题时暂不打标，等待 Vue 注入真实数据

                    const authorEl = card.querySelector('.bili-video-card__info--author, .bili-video-card__info--author-name, .up-name, .bili-live-card__info--uname, a[href*="space.bilibili.com"]');
                    const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';

                    // 关键时序防护：若包含 UP主 规则，且作者元素尚未挂载出文字，暂不标记与裁决，等待下一帧 Vue 渲染
                    if (filters.ups.length && !rawAuthor.trim()) {
                        continue;
                    }

                    card.dataset.purifiedQuery = currentSearchQuery;

                    const link = linkEl.href || '';
                    let id = '';
                    const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
                    const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
                    if (matchVideo) id = matchVideo[1];
                    else if (matchLive) id = matchLive[1];

                    const rawTags = videoTagMap.get(id) || card.dataset.tags || '';

                    const isMatch = checkVideoMatch(rawTitle, rawTags, rawAuthor, filters);
                    applyCardFilterVisual(card, isMatch);
                }

                // 单遍快速统计匹配数量，不再进行二次全 DOM 查询
                if (currentMode === 'spotlight') {
                    if (card.classList.contains('bili-cleaner-highlighted')) matchCount++;
                } else {
                    if (card.style.display !== 'none') matchCount++;
                }
            }

            // 仅在统计数变动时同步更新控制栏，杜绝无意义重绘
            if (streamState.totalMatchesFound !== matchCount) {
                streamState.totalMatchesFound = matchCount;
                updatePanelUI();
            }
        } finally {
            isProcessing = false;
        }
    }

    // DOM 动态变更监听（针对性筛选视频卡片变动，配合 80ms 防抖，杜绝播放器与全局微动引发的高频重绘）
    let domDebounceTimer = null;
    const observer = new MutationObserver((mutationsList) => {
        const routeChanged = (window.location.search + window.location.hash) !== lastKnownSearchQuery;
        if (!routeChanged) {
            let hasRelevantNodes = false;
            for (let i = 0; i < mutationsList.length; i++) {
                const m = mutationsList[i];
                if (m.type === 'childList') {
                    const checkNodeList = (nodes) => {
                        for (let j = 0; j < nodes.length; j++) {
                            const node = nodes[j];
                            if (node.nodeType === 1) {
                                if (
                                    (node.classList && (
                                        node.classList.contains('video-list-item') ||
                                        node.classList.contains('bili-video-card') ||
                                        node.classList.contains('video-list') ||
                                        node.classList.contains('bili-live-card')
                                    )) || (node.querySelector && node.querySelector('.bili-video-card, .video-list-item, div.video-list'))
                                ) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    };
                    if (checkNodeList(m.addedNodes) || checkNodeList(m.removedNodes)) {
                        hasRelevantNodes = true;
                        break;
                    }
                }
            }
            if (!hasRelevantNodes) return;
        }

        if (domDebounceTimer) clearTimeout(domDebounceTimer);
        domDebounceTimer = setTimeout(() => {
            requestAnimationFrame(() => {
                checkAndResetIfSearchChanged();
                filterDOMElements();
            });
        }, 80);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // =========================================================================
    // 6. 跨页连续聚合流引擎（支持【瀑布流】、【聚光灯高亮】、【物理隐藏】三平级模式）
    // =========================================================================
    const streamState = {
        currentPage: 1,
        isFetching: false,
        hasMore: true,
        totalMatchesFound: 0,
        seenBvidMap: Object.create(null)
    };

    // 监听单页应用 (SPA) 路由切换与搜索词重置
    let lastKnownSearchQuery = window.location.search + window.location.hash;

    function checkAndResetIfSearchChanged() {
        const currentQuery = window.location.search + window.location.hash;
        if (currentQuery === lastKnownSearchQuery) return;

        console.log('[Bilibili 搜索净化] 发现搜索词/路由变更，重置控制栏与状态:', currentQuery);
        lastKnownSearchQuery = currentQuery;

        // 1. 重置状态
        streamState.currentPage = 1;
        streamState.isFetching = false;
        streamState.hasMore = true;
        streamState.totalMatchesFound = 0;
        streamState.seenBvidMap = Object.create(null);
        cachedNativeTemplate = null;

        // 2. 立即重置悬浮面板 UI
        updatePanelUI();

        // 3. 延迟等待 B站 Vue 渲染新首屏 DOM 后同步
        setTimeout(() => {
            syncInitialCardsToBvidMap();
            filterDOMElements();
            updatePanelUI();
        }, 350);
    }

    function setupUrlWatcher() {
        const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const targetHistory = targetWin.history || history;
        const rawPushState = targetHistory.pushState;
        targetHistory.pushState = function(...args) {
            const ret = rawPushState.apply(this, args);
            checkAndResetIfSearchChanged();
            return ret;
        };

        const rawReplaceState = targetHistory.replaceState;
        targetHistory.replaceState = function(...args) {
            const ret = rawReplaceState.apply(this, args);
            checkAndResetIfSearchChanged();
            return ret;
        };

        targetWin.addEventListener('popstate', checkAndResetIfSearchChanged);
        targetWin.addEventListener('hashchange', checkAndResetIfSearchChanged);
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'bili-cleaner-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2200);
    }

    function syncInitialCardsToBvidMap() {
        let count = 0;
        document.querySelectorAll('a[href*="/video/BV"]').forEach(a => {
            const m = a.href.match(/\b(BV[a-zA-Z0-9]{10})\b/i);
            if (m) {
                const bvid = m[1].toLowerCase();
                if (!streamState.seenBvidMap[bvid]) {
                    streamState.seenBvidMap[bvid] = true;
                    const card = a.closest('[class*="col_"], .video-list-item');
                    if (card && card.style.display !== 'none') count++;
                }
            }
        });
        streamState.totalMatchesFound = count;
    }

    function getMainCardContainer() {
        return document.querySelector(
            '.video.search-all-list .video-list, ' +
            '.video.i_wrapper .video-list, ' +
            '.search-page-video .video-list, ' +
            '.search-all-list .video-list, ' +
            'div.video-list.row, ' +
            '.video-list'
        );
    }



    function formatStatNum(num) {
        if (!num) return '0';
        if (typeof num === 'string' && (num.includes('万') || num.includes('亿'))) {
            return num;
        }
        const n = Number(num);
        if (isNaN(n) || n <= 0) return '0';
        if (n >= 100000000) {
            return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
        }
        if (n >= 10000) {
            return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
        }
        return String(n);
    }

    function formatDuration(d) {
        if (!d) return '00:00';
        if (typeof d === 'string' && d.includes(':')) {
            const parts = d.split(':');
            return parts.map(p => p.padStart(2, '0')).join(':');
        }
        const sec = Number(d);
        if (isNaN(sec) || sec <= 0) return '00:00';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function formatPubDate(pubdate) {
        if (!pubdate) return '';
        const d = new Date(Number(pubdate) * 1000);
        if (isNaN(d.getTime())) return '';
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }

    function createInjectedVideoCard(v) {
        const col = document.createElement('div');
        col.className = 'video-list-item col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40';
        col.dataset.injected = 'true';

        const cleanTitle = (v.title || '').replace(/<[^>]+>/g, '');
        const videoUrl = `//www.bilibili.com/video/${v.bvid}`;
        let basePic = v.pic || '';
        if (basePic.startsWith('//')) basePic = 'https:' + basePic;
        const cleanPic = basePic.split('@')[0];
        const coverUrlWebp = cleanPic ? `${cleanPic}@672w_378h_1c_!web-search-common-cover.webp` : '';
        const coverUrlAvif = cleanPic ? `${cleanPic}@672w_378h_1c_!web-search-common-cover.avif` : '';
        const coverUrlFallback = cleanPic ? `${cleanPic}@672w_378h_1c_!web-search-common-cover` : basePic;

        const authorUrl = `//space.bilibili.com/${v.mid}`;
        const pubDateStr = formatPubDate(v.pubdate);
        const playStr = formatStatNum(v.play);
        const danmakuStr = formatStatNum(v.danmaku || v.video_review);
        const durationStr = formatDuration(v.duration);

        col.innerHTML = `
            <div class="bili-video-card" data-bsb-bvid="${v.bvid}">
                <div class="bili-video-card__wrap">
                    <a href="${videoUrl}" target="_blank" data-mod="search-card" data-idx="all" data-ext="click">
                        <div class="bili-video-card__image">
                            <div class="bili-video-card__image--wrap">
                                <picture class="v-img bili-video-card__cover">
                                    ${coverUrlAvif ? `<source srcset="${coverUrlAvif}" type="image/avif">` : ''}
                                    ${coverUrlWebp ? `<source srcset="${coverUrlWebp}" type="image/webp">` : ''}
                                    <img src="${coverUrlFallback}" alt="${cleanTitle}" loading="lazy">
                                </picture>
                                <div class="bili-video-card__mask">
                                    <div class="bili-video-card__stats">
                                        <div class="bili-video-card__stats--left">
                                            <span class="bili-video-card__stats--item">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="#ffffff" class="bili-video-card__stats--icon"><path d="M12 4.99805C9.48178 4.99805 7.283 5.12616 5.73089 5.25202C4.65221 5.33949 3.81611 6.16352 3.72 7.23254C3.60607 8.4998 3.5 10.171 3.5 11.998C3.5 13.8251 3.60607 15.4963 3.72 16.76355C3.81611 17.83255 4.65221 18.6566 5.73089 18.7441C7.283 18.8699 9.48178 18.998 12 18.998C14.5185 18.998 16.7174 18.8699 18.2696 18.74405C19.3481 18.65655 20.184 17.8328 20.2801 16.76405C20.394 15.4973 20.5 13.82645 20.5 11.998C20.5 10.16965 20.394 8.49877 20.2801 7.23205C20.184 6.1633 19.3481 5.33952 18.2696 5.25205C16.7174 5.12618 14.5185 4.99805 12 4.99805zM5.60965 3.75693C7.19232 3.62859 9.43258 3.49805 12 3.49805C14.5677 3.49805 16.8081 3.62861 18.3908 3.75696C20.1881 3.90272 21.6118 5.29278 21.7741 7.09773C21.8909 8.3969 22 10.11405 22 11.998C22 13.88205 21.8909 15.5992 21.7741 16.8984C21.6118 18.7033 20.1881 20.09335 18.3908 20.23915C16.8081 20.3675 14.5677 20.498 12 20.498C9.43258 20.498 7.19232 20.3675 5.60965 20.2392C3.81206 20.0934 2.38831 18.70295 2.22603 16.8979C2.10918 15.5982 2 13.8808 2 11.998C2 10.1153 2.10918 8.39787 2.22603 7.09823C2.38831 5.29312 3.81206 3.90269 5.60965 3.75693z" fill="currentColor"></path><path d="M14.7138 10.96875C15.50765 11.4271 15.50765 12.573 14.71375 13.0313L11.5362 14.8659C10.74235 15.3242 9.75 14.7513 9.75001 13.8346L9.75001 10.1655C9.75001 9.24881 10.74235 8.67587 11.5362 9.13422L14.7138 10.96875z" fill="currentColor"></path></svg>
                                                <span>${playStr}</span>
                                            </span>
                                            <span class="bili-video-card__stats--item">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" class="bili-video-card__stats--icon"><path d="M12 4.99805C9.48178 4.99805 7.283 5.12616 5.73089 5.25202C4.65221 5.33949 3.81611 6.16352 3.72 7.23254C3.60607 8.4998 3.5 10.171 3.5 11.998C3.5 13.8251 3.60607 15.4963 3.72 16.76355C3.81611 17.83255 4.65221 18.6566 5.73089 18.7441C7.283 18.8699 9.48178 18.998 12 18.998C14.5185 18.998 16.7174 18.8699 18.2696 18.74405C19.3481 18.65655 20.184 17.8328 20.2801 16.76405C20.394 15.4973 20.5 13.82645 20.5 11.998C20.5 10.16965 20.394 8.49877 20.2801 7.23205C20.184 6.1633 19.3481 5.33952 18.2696 5.25205C16.7174 5.12618 14.5185 4.99805 12 4.99805zM5.60965 3.75693C7.19232 3.62859 9.43258 3.49805 12 3.49805C14.5677 3.49805 16.8081 3.62861 18.3908 3.75696C20.1881 3.90272 21.6118 5.29278 21.7741 7.09773C21.8909 8.3969 22 10.11405 22 11.998C22 13.88205 21.8909 15.5992 21.7741 16.8984C21.6118 18.7033 20.1881 20.09335 18.3908 20.23915C16.8081 20.3675 14.5677 20.498 12 20.498C9.43258 20.498 7.19232 20.3675 5.60965 20.2392C3.81206 20.0934 2.38831 18.70295 2.22603 16.8979C2.10918 15.5982 2 13.8808 2 11.998C2 10.1153 2.10918 8.39787 2.22603 7.09823C2.38831 5.29312 3.81206 3.90269 5.60965 3.75693z" fill="currentColor"></path><path d="M15.875 10.75L9.875 10.75C9.46079 10.75 9.125 10.4142 9.125 10C9.125 9.58579 9.46079 9.25 9.875 9.25L15.875 9.25C16.2892 9.25 16.625 9.58579 16.625 10C16.625 10.4142 16.2892 10.75 15.875 10.75z" fill="currentColor"></path><path d="M17.375 14.75L11.375 14.75C10.9608 14.75 10.625 14.4142 10.625 14C10.625 13.5858 10.9608 13.25 11.375 13.25L17.375 13.25C17.7892 13.25 18.125 13.5858 18.125 14C18.125 14.4142 17.7892 14.75 17.375 14.75z" fill="currentColor"></path><path d="M7.875 10C7.875 10.4142 7.53921 10.75 7.125 10.75L6.625 10.75C6.21079 10.75 5.875 10.4142 5.875 10C5.875 9.58579 6.21079 9.25 6.625 9.25L7.125 9.25C7.53921 9.25 7.875 9.58579 7.875 10z" fill="currentColor"></path><path d="M9.375 14C9.375 14.4142 9.03921 14.75 8.625 14.75L8.125 14.75C7.71079 14.75 7.375 14.4142 7.375 14C7.375 13.5858 7.71079 13.25 8.125 13.25L8.625 13.25C9.03921 13.25 9.375 13.5858 9.375 14z" fill="currentColor"></path></svg>
                                                <span>${danmakuStr}</span>
                                            </span>
                                        </div>
                                        <span class="bili-video-card__stats__duration">${durationStr}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a>
                    <div class="bili-video-card__info">
                        <div class="bili-video-card__info--right">
                            <a href="${videoUrl}" target="_blank" data-mod="search-card" data-idx="all" data-ext="click">
                                <h3 class="bili-video-card__info--tit" title="${cleanTitle}">
                                    ${v.title}
                                </h3>
                            </a>
                            <div class="bili-video-card__info--bottom">
                                <a class="bili-video-card__info--owner" href="${authorUrl}" target="_blank" data-mod="search-card" data-idx="all" data-ext="click">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" class="bili-video-card__info--author-ico mr_2"><path d="M6.15 8.24805C6.5642 8.24805 6.9 8.58383 6.9 8.99805L6.9 12.7741C6.9 13.5881 7.55988 14.248 8.3739 14.248C9.18791 14.248 9.8478 13.5881 9.8478 12.7741L9.8478 8.99805C9.8478 8.58383 10.1836 8.24805 10.5978 8.24805C11.012 8.24805 11.3478 8.58383 11.3478 8.99805L11.3478 12.7741C11.3478 14.41655 10.01635 15.748 8.3739 15.748C6.73146 15.748 5.4 14.41655 5.4 12.7741L5.4 8.99805C5.4 8.58383 5.73578 8.24805 6.15 8.24805z" fill="currentColor"></path><path d="M12.6522 8.99805C12.6522 8.58383 12.98795 8.24805 13.4022 8.24805L15.725 8.24805C17.31285 8.24805 18.6 9.53522 18.6 11.123C18.6 12.71085 17.31285 13.998 15.725 13.998L14.1522 13.998L14.1522 14.998C14.1522 15.4122 13.8164 15.748 13.4022 15.748C12.98795 15.748 12.6522 15.4122 12.6522 14.998L12.6522 8.99805zM14.1522 12.498L15.725 12.498C16.4844 12.498 17.1 11.8824 17.1 11.123C17.1 10.36365 16.4844 9.74804 15.725 9.74804L14.1522 9.74804L14.1522 12.498z" fill="currentColor"></path><path d="M12 4.99805C9.48178 4.99805 7.283 5.12616 5.73089 5.25202C4.65221 5.33949 3.81611 6.16352 3.72 7.23254C3.60607 8.4998 3.5 10.171 3.5 11.998C3.5 13.8251 3.60607 15.4963 3.72 16.76355C3.81611 17.83255 4.65221 18.6566 5.73089 18.7441C7.283 18.8699 9.48178 18.998 12 18.998C14.5185 18.998 16.7174 18.8699 18.2696 18.74405C19.3481 18.65655 20.184 17.8328 20.2801 16.76405C20.394 15.4973 20.5 13.82645 20.5 11.998C20.5 10.16965 20.394 8.49877 20.2801 7.23205C20.184 6.1633 19.3481 5.33952 18.2696 5.25205C16.7174 5.12618 14.5185 4.99805 12 4.99805zM5.60965 3.75693C7.19232 3.62859 9.43258 3.49805 12 3.49805C14.5677 3.49805 16.8081 3.62861 18.3908 3.75696C20.1881 3.90272 21.6118 5.29278 21.7741 7.09773C21.8909 8.3969 22 10.11405 22 11.998C22 13.88205 21.8909 15.5992 21.7741 16.8984C21.6118 18.7033 20.1881 20.09335 18.3908 20.23915C16.8081 20.3675 14.5677 20.498 12 20.498C9.43258 20.498 7.19232 20.3675 5.60965 20.2392C3.81206 20.0934 2.38831 18.70295 2.22603 16.8979C2.10918 15.5982 2 13.8808 2 11.998C2 10.1153 2.10918 8.39787 2.22603 7.09823C2.38831 5.29312 3.81206 3.90269 5.60965 3.75693z" fill="currentColor"></path></svg>
                                    <span class="bili-video-card__info--author">${v.author}</span>
                                    <span class="bili-video-card__info--date"> · ${pubDateStr}</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return col;
    }

    // =========================================================================
    // 原生 DOM 模板克隆与数据填充系统
    // 在 div.video-list.row 下子 div 复制一个原生视频 DOM 作为母版，保证 100% UI 与样式一致性
    // =========================================================================
    let cachedNativeTemplate = null;

    function getNativeCardTemplate() {
        const container = getMainCardContainer();
        const nativeCandidate = (container && container.querySelector(':scope > div:not([data-injected="true"])')) ||
                               document.querySelector('div.video-list.row > div:not([data-injected="true"]), .video-list > div:not([data-injected="true"])') ||
                               (container && container.firstElementChild);

        if (nativeCandidate) {
            const template = nativeCandidate.cloneNode(true);
            // 彻底清理母版自带的动态播放器、video 标签与高亮/暗化类名
            template.querySelectorAll('.v-inline-player, .bpx-player-container, video').forEach(el => el.remove());
            template.classList.remove('bili-cleaner-dimmed', 'bili-cleaner-highlighted');
            template.style.removeProperty('display');
            delete template.dataset.purifiedQuery;
            cachedNativeTemplate = template;
            return template;
        }
        return cachedNativeTemplate;
    }

    function createVideoCardFromTemplate(v, template) {
        if (!template) {
            return createInjectedVideoCard(v);
        }

        const clone = template.cloneNode(true);
        clone.dataset.injected = 'true';
        clone.style.removeProperty('display');
        clone.classList.remove('bili-cleaner-dimmed', 'bili-cleaner-highlighted');

        const cleanTitle = (v.title || '').replace(/<[^>]+>/g, '');
        const videoUrl = `//www.bilibili.com/video/${v.bvid}`;
        let basePic = v.pic || '';
        if (basePic.startsWith('//')) basePic = 'https:' + basePic;
        const cleanPic = basePic.split('@')[0];
        const coverUrlWebp = cleanPic ? `${cleanPic}@672w_378h_1c_!web-search-common-cover.webp` : '';
        const coverUrlAvif = cleanPic ? `${cleanPic}@672w_378h_1c_!web-search-common-cover.avif` : '';
        const coverUrlFallback = cleanPic ? `${cleanPic}@672w_378h_1c_!web-search-common-cover` : basePic;

        const authorUrl = `//space.bilibili.com/${v.mid}`;
        const pubDateStr = formatPubDate(v.pubdate);
        const playStr = formatStatNum(v.play);
        const danmakuStr = formatStatNum(v.danmaku || v.video_review);
        const durationStr = formatDuration(v.duration);

        // 1. 设置 BVID
        const cardInner = clone.querySelector('.bili-video-card') || clone;
        cardInner.setAttribute('data-bsb-bvid', v.bvid);

        // 2. 更新所有指向视频详情的链接
        clone.querySelectorAll('a[href*="/video/"]').forEach(a => {
            a.href = videoUrl;
            a.target = '_blank';
        });

        // 3. 更新封面图片 (picture / source / img)
        const avifSource = clone.querySelector('picture source[type="image/avif"]');
        if (avifSource && coverUrlAvif) avifSource.srcset = coverUrlAvif;

        const webpSource = clone.querySelector('picture source[type="image/webp"]');
        if (webpSource && coverUrlWebp) webpSource.srcset = coverUrlWebp;

        const img = clone.querySelector('picture img, .bili-video-card__cover img, img');
        if (img) {
            img.src = coverUrlFallback;
            img.alt = cleanTitle;
            img.removeAttribute('onload');
            img.removeAttribute('onerror');
            img.removeAttribute('data-error');
        }

        // 4. 更新视频播放量与弹幕量
        const statItems = clone.querySelectorAll('.bili-video-card__stats--item');
        if (statItems.length >= 1) {
            const playSpan = statItems[0].querySelector('span:not([class])') || statItems[0].lastElementChild;
            if (playSpan) playSpan.textContent = playStr;
        }
        if (statItems.length >= 2) {
            const danmakuSpan = statItems[1].querySelector('span:not([class])') || statItems[1].lastElementChild;
            if (danmakuSpan) danmakuSpan.textContent = danmakuStr;
        }

        // 5. 更新视频时长
        const durationEl = clone.querySelector('.bili-video-card__stats__duration, .bili-video-card__stats--duration');
        if (durationEl) {
            durationEl.textContent = durationStr;
        }

        // 6. 更新视频标题（保留高亮关键词）
        const titleEl = clone.querySelector('h3.bili-video-card__info--tit, h3');
        if (titleEl) {
            titleEl.setAttribute('title', cleanTitle);
            titleEl.innerHTML = v.title;
        }

        // 7. 更新 UP 主信息与发布时间
        const ownerEl = clone.querySelector('a.bili-video-card__info--owner');
        if (ownerEl) {
            ownerEl.href = authorUrl;
            ownerEl.target = '_blank';
        }
        const authorEl = clone.querySelector('.bili-video-card__info--author');
        if (authorEl) {
            authorEl.textContent = v.author;
            authorEl.setAttribute('title', v.author);
        }
        const dateEl = clone.querySelector('.bili-video-card__info--date');
        if (dateEl) {
            dateEl.textContent = ` · ${pubDateStr}`;
        }

        // 8. 彻底清理模板可能自带的播放器残留与视频元素
        clone.querySelectorAll('.v-inline-player, .bpx-player-container, video').forEach(el => el.remove());

        // 9. 标记缓存避免重复处理
        clone.dataset.purifiedQuery = getRawSearchKeyword() + '_' + currentMode;

        return clone;
    }

    async function fetchNextPageViaAPI() {
        // 只有当前处于【瀑布流】模式时才执行 API 自动拉取！【聚光灯高亮】与【物理隐藏】均使用 B站 原生翻页
        if (currentMode !== 'waterfall') return;
        if (streamState.isFetching || !streamState.hasMore) return;

        const filters = getSearchKeywords();
        const apiKeyword = getCleanApiKeyword();
        if (!apiKeyword) {
            console.log('[Bilibili 搜索净化] 未提取到搜索词，暂不触发翻页');
            return;
        }

        const targetPage = streamState.currentPage + 1;

        streamState.isFetching = true;
        updatePanelUI();

        try {
            await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 250)));

            const wbiKeys = await getWbiKeys();

            const params = {
                keyword: apiKeyword,
                page: targetPage,
                search_type: 'video',
                order: 'totalrank'
            };

            const queryString = signWbiParams(params, wbiKeys.imgKey, wbiKeys.subKey);
            const targetUrl = `https://api.bilibili.com/x/web-interface/wbi/search/type?${queryString}`;

            const res = await window.fetch(targetUrl, { credentials: 'include' });
            const json = await res.json();

            // 频控风控自保
            if (json.code === -412 || json.code === -403) {
                console.warn('[Bilibili 搜索净化] 触发频控，安全挂起');
                showToast('触发 B站 请求频控限制，已暂停自动翻页');
                streamState.hasMore = false;
                return;
            }

            const rawList = json.data?.result || [];
            const numPages = json.data?.numPages || 50;

            // 物理到头判定（服务端已无更多视频）
            if (rawList.length === 0 || targetPage > numPages) {
                streamState.hasMore = false;
                console.log('[Bilibili 搜索净化] 已遍历至 B站 搜索结果最末页');
                return;
            }

            const container = getMainCardContainer();
            if (!container) return;

            // 获取原生卡片母版（在 div.video-list.row 下子 div 复制一个原生视频 DOM 作为模板）
            const nativeTemplate = getNativeCardTemplate();

            let addedCountThisPage = 0;

            for (const v of rawList) {
                const bvidLower = (v.bvid || '').toLowerCase();
                if (!bvidLower) continue;

                // 物理字典去重
                if (streamState.seenBvidMap[bvidLower]) continue;
                streamState.seenBvidMap[bvidLower] = true;

                // 存储 Tag 字典
                if (v.tag) videoTagMap.set(String(v.bvid), cleanText(v.tag));

                // 1. 【瀑布流】添加的视频不符合筛选的绝不添加到页面中
                const isMatch = checkVideoMatch(v.title || '', v.tag || '', v.author || '', filters);
                if (!isMatch) {
                    continue;
                }

                // 2. 以原生卡片为模板克隆并填充数据后添加到页面中，保证 UI 100% 一致
                const cardEl = createVideoCardFromTemplate(v, nativeTemplate);
                container.appendChild(cardEl);
                addedCountThisPage++;
            }

            streamState.currentPage = targetPage;
            streamState.totalMatchesFound += addedCountThisPage;

            console.log(`[Bilibili 搜索净化] 瀑布流第 ${targetPage} 页加载完成，本页合格可见 ${addedCountThisPage} 个视频`);

            // 若本页没有可见视频，检查页面高度并平滑补齐
            if (addedCountThisPage === 0) {
                streamState.isFetching = false;
                setTimeout(checkAndTriggerAutoFill, 300);
                return;
            }

        } catch (err) {
            console.error('[Bilibili 搜索净化] API 翻页异常:', err);
        } finally {
            streamState.isFetching = false;
            updatePanelUI();
        }
    }

    function clickPageOnePaginationButton() {
        // 1. 优先匹配包含 "第 1 页" 或 "第1页" 的原生数字分页按钮
        let pageOneBtn = document.querySelector(
            'button.vui_pagenation--btn-num[aria-label*="第 1 页"], ' +
            'button.vui_pagenation--btn-num[aria-label*="第1页"], ' +
            'button.vui_pagenation--btn[aria-label*="第 1 页"], ' +
            'button.vui_pagenation--btn[aria-label*="第1页"]'
        );

        // 2. 备用：遍历所有分页按钮，查找文本恰好为 "1" 的按钮
        if (!pageOneBtn) {
            const buttons = document.querySelectorAll('button.vui_pagenation--btn-num, .vui_pagenation--btn, .vui_pagenation button');
            for (const btn of buttons) {
                if (btn.textContent.trim() === '1') {
                    pageOneBtn = btn;
                    break;
                }
            }
        }

        // 3. 兜底匹配首个数字分页按钮
        if (!pageOneBtn) {
            pageOneBtn = document.querySelector('.vui_pagenation--btn-num');
        }

        if (pageOneBtn) {
            console.log('[Bilibili 搜索净化] 触发点击第 1 页分页按钮:', pageOneBtn);
            pageOneBtn.click();
            return true;
        }
        return false;
    }

    // =========================================================================
    // 7. 脚本管理器扩展菜单集成 (三平级单选项，无页面控制面板)
    // =========================================================================
    const MODES = [
        { key: 'waterfall', name: '瀑布流 (瀑布流翻页 · 物理隐藏展示)' },
        { key: 'spotlight', name: '聚光灯高亮 (原生翻页 · 视觉聚焦暗化)' },
        { key: 'hide',      name: '物理隐藏 (原生翻页 · 原生卡片隐藏)' }
    ];

    let menuCommandIds = [];

    function registerPluginMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        // 若支持 unregister，先清理旧菜单项以实现单选状态即时更新
        if (typeof GM_unregisterMenuCommand === 'function') {
            for (const id of menuCommandIds) {
                try { GM_unregisterMenuCommand(id); } catch (e) {}
            }
            menuCommandIds = [];
        }

        MODES.forEach(m => {
            const isSelected = currentMode === m.key;
            const label = `${isSelected ? '🔘' : '⚪'} ${m.name}`;
            const id = GM_registerMenuCommand(label, () => {
                if (currentMode === m.key) return;
                switchMode(m.key);
            });
            if (id !== undefined) menuCommandIds.push(id);
        });
    }

    function switchMode(newMode) {
        const prevMode = currentMode;
        if (prevMode === newMode) return;

        currentMode = newMode;
        localStorage.setItem('bili_cleaner_mode', currentMode);

        // 重新注册菜单以更新单选状态
        registerPluginMenus();

        document.querySelectorAll('.video-list-item, div[class*="col_"], .bili-video-card').forEach(c => {
            delete c.dataset.purifiedQuery;
        });

        // 判定是否属于从【瀑布流】选入或选出
        const isWaterfallTransition = (prevMode === 'waterfall' && newMode !== 'waterfall') ||
                                      (prevMode !== 'waterfall' && newMode === 'waterfall');

        if (isWaterfallTransition) {
            // 若从瀑布流选出，清理所有通过瀑布流追加注入的动态卡片
            if (prevMode === 'waterfall') {
                document.querySelectorAll('.video-list-item[data-injected="true"]').forEach(el => el.remove());
            }

            // 重置瀑布流分页与去重字典状态
            streamState.currentPage = 1;
            streamState.isFetching = false;
            streamState.hasMore = true;
            streamState.totalMatchesFound = 0;
            streamState.seenBvidMap = Object.create(null);
            cachedNativeTemplate = null;

            filterDOMElements();

            // 点击第 1 页的分页按钮
            const clicked = clickPageOnePaginationButton();
            if (!clicked) {
                // 若未找到分页按钮（如单页极少结果未渲染分页条），回退触发原生搜索按钮
                const searchBtn = document.querySelector('button.search-button, .vui_button.search-button, .search-button');
                if (searchBtn) {
                    searchBtn.click();
                }
            }
        } else {
            filterDOMElements();
        }
    }

    // 滚动触底与短页面自动补齐监听（仅在瀑布流模式下生效）
    // 仅对 scroll 进行 180ms 节流，消除滚动时的连续强制同步回流 (Forced Reflow)
    let scrollThrottleTimer = null;
    function onThrottledScroll() {
        if (currentMode !== 'waterfall') return;
        if (scrollThrottleTimer) return;
        scrollThrottleTimer = setTimeout(() => {
            scrollThrottleTimer = null;
            checkAndTriggerAutoFill();
        }, 180);
    }

    function checkAndTriggerAutoFill() {
        // 关键守卫：非瀑布流模式（聚光灯高亮 / 物理隐藏）严格使用 B站 原生翻页，绝不触发自动追加！
        if (currentMode !== 'waterfall') return;
        if (streamState.isFetching || !streamState.hasMore) return;

        const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        const clientHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
        const scrollBottom = scrollHeight - (scrollTop + clientHeight);

        // 距离底部 1200px 时，或页面内容过短时，自动触发翻页拉取
        if (scrollBottom < 1200 || scrollHeight <= clientHeight + 150) {
            fetchNextPageViaAPI();
        }
    }

    function updatePanelUI() {
        // 页面控制面板已彻底移除，由插件扩展菜单接管模式切换
    }

    // =========================================================================
    // 8. 启动与初始化装配
    // =========================================================================
    function init() {
        syncInitialCardsToBvidMap();
        registerPluginMenus();
        setupUrlWatcher();
        window.addEventListener('scroll', onThrottledScroll, { passive: true });
        // 首屏过滤后若视频极少导致不足一屏高，800ms 后自动补足一屏
        setTimeout(checkAndTriggerAutoFill, 800);
        console.log('[Bilibili 搜索净化] 2.2.0 就绪（已启用插件扩展菜单单选控制，无页面控制面板）。');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }

})();
