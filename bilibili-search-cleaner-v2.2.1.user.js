// ==UserScript==
// @name         Bilibili 去掉搜索无关视频
// @namespace    http://tampermonkey.net/
// @version      2.2.1
// @description  自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 @UP主 定向筛选、-排除词、#Tag 专项筛选及 *三连全字段泛搜，新增 API 直连跨页连续聚合流与智能枯竭劝退机制。（支持简繁双向归一化）
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

    // 通用文本清洗：繁简归一化、HTML实体反转义与标点规范化
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
        .bili-cleaner-stream-end-banner {
            width: 100%;
            text-align: center;
            padding: 28px 16px;
            margin: 30px auto;
            background: #fafafa;
            border: 1px dashed #d9d9d9;
            border-radius: 8px;
            box-sizing: border-box;
            clear: both;
        }
        /* 聚光灯聚焦模式样式（堵不如疏） */
        .bili-cleaner-dimmed {
            opacity: 0.16 !important;
            filter: grayscale(85%) contrast(85%) !important;
            transition: opacity 0.25s ease, filter 0.25s ease, transform 0.25s ease !important;
            pointer-events: auto !important;
        }
        .bili-cleaner-dimmed:hover {
            opacity: 0.95 !important;
            filter: none !important;
            transform: translateY(-2px);
            z-index: 10;
        }
        /* 非聚光灯视频：禁止动态视频预览层渲染与播放器资源加载 */
        .bili-cleaner-dimmed .bili-video-card__image--video,
        .bili-cleaner-dimmed .bili-video-card__stats--preview,
        .bili-cleaner-dimmed .bili-cover-card__video,
        .bili-cleaner-dimmed .preview-video,
        .bili-cleaner-dimmed video {
            display: none !important;
            visibility: hidden !important;
            pointer-events: none !important;
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
    // 3. 高级语法解析引擎（支持普通词 / *三连泛搜 / -排除 / #Tag / @UP主）
    // =========================================================================
    function getSearchKeywords() {
        const params = new URLSearchParams(window.location.search);
        let rawParam = params.get('keyword') || '';
        if (!rawParam && window.location.hash.includes('keyword=')) {
            const hashParams = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?')));
            rawParam = hashParams.get('keyword') || '';
        }

        const rawKeyword = cleanText(decodeURIComponent(rawParam.replace(/\+/g, ' ')));
        if (!rawKeyword) return { normal: [], triple: [], exclude: [], tags: [], ups: [], hasRules: false };

        const list = rawKeyword.split(/\s+/);
        const normal = [];
        const triple = [];
        const exclude = [];
        const tags = [];
        const ups = [];

        for (let k of list) {
            // 输入法全角归一化容错
            k = k.replace(/^[\*＊]/, '*')
                 .replace(/^[\#＃]/, '#')
                 .replace(/^[\@＠]/, '@')
                 .replace(/^[\-－]/, '-');

            if (k.startsWith('-') && k.length > 1) {
                exclude.push(k.substring(1));
            } else if (k.startsWith('*') && k.length > 1) {
                triple.push(k.substring(1)); // 【三连模式】全字段词
            } else if (k.startsWith('#') && k.length > 1) {
                tags.push(k.substring(1));
            } else if (k.startsWith('@') && k.length > 1) {
                ups.push(k.substring(1));
            } else if (k) {
                normal.push(k);
            }
        }

        const hasRules = Boolean(normal.length || triple.length || exclude.length || tags.length || ups.length);
        return { normal, triple, exclude, tags, ups, hasRules };
    }

    // 提取发给 B 站官方接口的搜索词（脱壳脱除 *, #, @, - 前缀并繁简归一）
    function getCleanApiKeyword() {
        const params = new URLSearchParams(window.location.search);
        let rawParam = params.get('keyword') || '';
        if (!rawParam && window.location.hash.includes('keyword=')) {
            const hashParams = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?')));
            rawParam = hashParams.get('keyword') || '';
        }
        const rawKeyword = decodeURIComponent(rawParam.replace(/\+/g, ' ')).trim();
        if (!rawKeyword) return '';

        const list = rawKeyword.split(/\s+/);
        const searchTerms = [];
        for (let k of list) {
            k = k.replace(/^[\*＊]/, '*')
                 .replace(/^[\#＃]/, '#')
                 .replace(/^[\@＠]/, '@')
                 .replace(/^[\-－]/, '-');

            if (k.startsWith('-')) {
                continue;
            } else if (k.startsWith('*') || k.startsWith('@') || k.startsWith('#')) {
                if (k.length > 1) searchTerms.push(k.substring(1));
            } else if (k) {
                searchTerms.push(k);
            }
        }
        return toSimplified(searchTerms.join(' '));
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
            if (id) videoTagMap.set(String(id), rawTags);
            if (v.is_ad_loc || v.is_promoted || v.goto === 'ad' || v.type === 'ad') return false;
            return true;
        });
    }

    const originFetch = window.fetch;
    window.fetch = async function(...args) {
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

    // =========================================================================
    // 5. 纯数据对象过滤判定器（内存级极速安检，杜绝无效卡片挂载 DOM）
    // =========================================================================
    function checkVideoMatch(titleRaw, tagsRaw, authorRaw, filters) {
        const title = cleanText(titleRaw);
        const tags = cleanText(tagsRaw);
        const author = cleanText(authorRaw.replace(/[\s·•].*$/, ''));

        const { normal, triple, exclude, tags: filterTags, ups } = filters;

        // 1. 排除词一票否决
        if (exclude.some(k => title.includes(k))) return false;
        // 2. 普通词：标题严格包含 (AND)
        if (normal.length && !normal.every(k => title.includes(k))) return false;
        // 3. 【三连模式】全字段词：标题 OR 标签 OR UP主任一包含 (AND)
        if (triple.length && !triple.every(k => title.includes(k) || tags.includes(k) || author.includes(k))) return false;
        // 4. 显式标签筛选：必须全在视频标签库中
        if (filterTags.length && !filterTags.every(k => tags.includes(k))) return false;
        // 5. 显式UP主筛选：必须匹配作者
        if (ups.length && !ups.some(k => author.includes(k))) return false;

        return true;
    }

    // DOM 层执行安检
    // 展现模式：spotlight（聚光灯高亮·堵不如疏） vs hide（物理隐藏）
    let currentDisplayStyle = localStorage.getItem('bili_cleaner_display_style') || 'spotlight';

    function applyCardFilterVisual(card, isMatch) {
        if (currentDisplayStyle === 'spotlight') {
            // 聚光灯聚焦模式：不使用 display: none，通过高亮与压暗进行视觉疏导
            card.style.removeProperty('display');
            if (isMatch) {
                card.classList.add('bili-cleaner-highlighted');
                card.classList.remove('bili-cleaner-dimmed');
            } else {
                card.classList.add('bili-cleaner-dimmed');
                card.classList.remove('bili-cleaner-highlighted');
            }
        } else {
            // 物理隐藏模式：传统 display: none
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

            const currentSearchQuery = window.location.search;
            const elements = document.querySelectorAll('.bili-video-card, .video-list-item, div[class*="col_"], .bili-live-card');

            elements.forEach(el => {
                const card = el.closest('[class*="col_"], .video-list-item, .bili-live-card') || el;
                if (card.dataset.purifiedQuery === currentSearchQuery) return;

                const linkEl = card.querySelector('a[href*="/video/"], a[href*="/cheese/"], a[href*="live.bilibili.com"], a[href*="/live/"]');
                if (!linkEl) return;

                const titleEl = card.querySelector('h3.bili-video-card__info--tit, h3.bili-live-card__info--tit, a[title], .bili-video-card__info--tit, h3');
                if (!titleEl) return;

                card.dataset.purifiedQuery = currentSearchQuery;

                const rawTitle = titleEl.getAttribute('title') || titleEl.textContent || '';
                const link = linkEl.href || '';
                let id = '';
                const matchVideo = link.match(/\/(?:video|play)\/([A-Za-z0-9]+)/);
                const matchLive = link.match(/live\.bilibili\.com\/([0-9]+)/);
                if (matchVideo) id = matchVideo[1];
                else if (matchLive) id = matchLive[1];

                const rawTags = videoTagMap.get(id) || card.dataset.tags || '';
                const authorEl = card.querySelector('a[href*="space.bilibili.com"], .bili-video-card__info--author, .up-name, .bili-live-card__info--uname');
                const rawAuthor = authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '') : '';

                const isMatch = checkVideoMatch(rawTitle, rawTags, rawAuthor, filters);
                applyCardFilterVisual(card, isMatch);
            });

            // 动态校准当前合格匹配卡片数并同步至控制栏
            let matchCount = 0;
            document.querySelectorAll('[class*="col_"], .video-list-item').forEach(c => {
                if (c.classList.contains('bili-cleaner-highlighted') || (currentDisplayStyle === 'hide' && c.style.display !== 'none' && c.querySelector('a[href*="/video/BV"]'))) {
                    matchCount++;
                }
            });
            if (matchCount > 0 && !streamState.isExhausted) {
                streamState.totalMatchesFound = matchCount;
                updatePanelUI();
            }
        } finally {
            isProcessing = false;
        }
    }

    // 拦截非聚光灯（暗化）卡片的鼠标悬停动态视频加载与播放
    ['mouseenter', 'mouseover', 'pointerenter', 'pointerover'].forEach(eventType => {
        document.addEventListener(eventType, function(e) {
            const target = e.target;
            if (!target || typeof target.closest !== 'function') return;

            const dimmedCard = target.closest('.bili-cleaner-dimmed');
            if (dimmedCard) {
                // 若悬停在封面或缩放容器上，阻止向 B站原生播放器监听器分发事件
                const isCoverArea = target.closest('.bili-video-card__image, .__scale-player-wrap, .bili-cover-card, .v-img');
                if (isCoverArea) {
                    e.stopImmediatePropagation();
                }
                // 即时销毁/暂停卡片内意外生成的 video 元素
                const videos = dimmedCard.querySelectorAll('video');
                videos.forEach(v => {
                    try {
                        if (!v.paused) v.pause();
                        v.src = '';
                        v.remove();
                    } catch (err) {}
                });
            }
        }, true); // 捕获阶段拦截
    });

    let rafId = null;
    const observer = new MutationObserver((mutations) => {
        // 清理非聚光灯卡片中动态插入的 video 元素
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.tagName === 'VIDEO' && node.closest('.bili-cleaner-dimmed')) {
                        node.src = '';
                        node.remove();
                    } else if (node.querySelectorAll) {
                        const innerVideos = node.querySelectorAll('.bili-cleaner-dimmed video');
                        innerVideos.forEach(v => {
                            v.src = '';
                            v.remove();
                        });
                    }
                }
            }
        }

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            checkAndResetIfSearchChanged();
            filterDOMElements();
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // =========================================================================
    // 6. 跨页连续聚合流引擎（支持三档模式：只显示前三页 / 默认当前分页 / 瀑布流）
    // =========================================================================
    const streamState = {
        mode: localStorage.getItem('bili_cleaner_browse_mode') || 'top3', // 默认【只显示前三页】(top3 | page | waterfall)
        currentPage: 1,
        consecutiveEmptyPagesCount: 0, // 连续未命中物理页计数
        MAX_EMPTY_PAGES_TO_EXHAUST: 5, // 判定枯竭阈值：连续跨 5 页完全无匹配，直接判定全网枯竭
        isFetching: false,
        isExhausted: false,           // 是否已确认为枯竭终局
        totalMatchesFound: 0,         // 当前已呈现的合格视频总量
        seenBvidMap: Object.create(null)
    };

    // 监听单页应用 (SPA) 路由切换与搜索词重置
    let lastKnownSearchQuery = window.location.search + window.location.hash;

    function checkAndResetIfSearchChanged() {
        const currentQuery = window.location.search + window.location.hash;
        if (currentQuery === lastKnownSearchQuery) return;

        console.log('[Bilibili 搜索净化] 发现搜索词/路由变更，重置控制栏与聚合状态:', currentQuery);
        lastKnownSearchQuery = currentQuery;

        // 1. 重置跨页流式状态
        streamState.currentPage = 1;
        streamState.consecutiveEmptyPagesCount = 0;
        streamState.isFetching = false;
        streamState.isExhausted = false;
        streamState.totalMatchesFound = 0;
        streamState.seenBvidMap = Object.create(null);

        // 2. 物理清除上一次搜索遗留的终局横幅
        document.querySelectorAll('.bili-cleaner-stream-end-banner').forEach(el => el.remove());

        // 3. 立即重置悬浮面板 UI（解除枯竭红色警告）
        updatePanelUI();

        // 4. 延迟等待 B站 Vue 渲染新一轮首屏 DOM 后同步
        setTimeout(() => {
            syncInitialCardsToBvidMap();
            filterDOMElements();
            updatePanelUI();
        }, 350);
    }

    function setupUrlWatcher() {
        const rawPushState = history.pushState;
        history.pushState = function(...args) {
            const ret = rawPushState.apply(this, args);
            checkAndResetIfSearchChanged();
            return ret;
        };

        const rawReplaceState = history.replaceState;
        history.replaceState = function(...args) {
            const ret = rawReplaceState.apply(this, args);
            checkAndResetIfSearchChanged();
            return ret;
        };

        window.addEventListener('popstate', checkAndResetIfSearchChanged);
        window.addEventListener('hashchange', checkAndResetIfSearchChanged);
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
                    // 仅统计实际可见的卡片
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
        ) || (function() {
            const firstCard = document.querySelector('.video-list-item, div[class*="col_"]:has(a[href*="/video/BV"])');
            return firstCard ? firstCard.parentElement : null;
        })();
    }

    function createInjectedVideoCard(v) {
        const col = document.createElement('div');
        col.className = 'video-list-item col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40';
        col.dataset.bvid = v.bvid;
        col.dataset.tags = cleanText(v.tag || '');

        const cleanTitle = (v.title || '').replace(/<[^>]+>/g, '');
        const coverPic = v.pic.startsWith('http') ? v.pic : `https:${v.pic}`;
        const coverUrl = `${coverPic}@672w_378h_1c_!web-search-common-cover.avif`;
        const videoUrl = `https://www.bilibili.com/video/${v.bvid}`;
        const authorUrl = `https://space.bilibili.com/${v.mid}`;
        const pubDateStr = v.pubdate ? new Date(v.pubdate * 1000).toLocaleDateString() : '';

        col.innerHTML = `
            <div class="bili-video-card" style="box-sizing: border-box;">
                <div class="bili-video-card__wrap __scale-wrap">
                    <a href="${videoUrl}" target="_blank" rel="noopener noreferrer">
                        <div class="bili-video-card__image __scale-player-wrap">
                            <picture class="v-img bili-video-card__cover">
                                <img src="${coverUrl}" alt="${cleanTitle}" loading="lazy">
                            </picture>
                            <div class="bili-video-card__mask">
                                <span class="bili-video-card__stats--duration">${v.duration || '00:00'}</span>
                            </div>
                        </div>
                    </a>
                    <div class="bili-video-card__info __scale-disable">
                        <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" title="${cleanTitle}">
                            <h3 class="bili-video-card__info--tit" style="font-size: 14px; line-height: 20px; height: 40px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 6px;">
                                ${v.title}
                            </h3>
                        </a>
                        <div class="bili-video-card__info--bottom" style="font-size: 12px; color: #9499a0; display: flex; align-items: center; justify-content: space-between;">
                            <a class="bili-video-card__info--owner" href="${authorUrl}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">
                                <span class="bili-video-card__info--author">${v.author}</span>
                            </a>
                            <span class="bili-video-card__info--date">${pubDateStr}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return col;
    }

    // 核心：判定枯竭并展示终局劝退看板（消灭一切开盲盒侥幸心理）
    function markAsExhausted(reason) {
        if (streamState.isExhausted) return;
        streamState.isExhausted = true;
        streamState.isFetching = false;

        console.log(`[Bilibili 搜索净化] 终局判定：${reason}。全网合格总数: ${streamState.totalMatchesFound}`);

        // 1. 页面底部插入大型终局看板
        const container = getMainCardContainer();
        if (container && !document.querySelector('.bili-cleaner-stream-end-banner')) {
            const banner = document.createElement('div');
            banner.className = 'bili-cleaner-stream-end-banner';
            banner.innerHTML = `
                <div style="font-size: 16px; font-weight: bold; color: #18191c; margin-bottom: 8px;">
                    🏁 筛选结果已全部呈现（全网共匹配 ${streamState.totalMatchesFound} 个视频）
                </div>
                <div style="font-size: 13px; color: #61666d; line-height: 22px;">
                    ${reason}。<br>
                    <b style="color: #fa541c;">后续页面已无任何有效内容，请勿继续盲目下滑。</b><br>
                    建议精简筛选条件或微调关键词以扩展结果。
                </div>
            `;
            container.parentNode.insertBefore(banner, container.nextSibling);
        }

        // 2. 更新悬浮面板 UI
        updatePanelUI();
    }

    async function fetchNextPageViaAPI() {
        if (streamState.isFetching || streamState.isExhausted) return;

        const filters = getSearchKeywords();
        const apiKeyword = getCleanApiKeyword();
        if (!apiKeyword) {
            console.log('[Bilibili 搜索净化] 未提取到搜索词，暂不触发翻页');
            return;
        }

        // 模式分支判断
        if (streamState.mode === 'page') return;

        const targetPage = streamState.currentPage + 1;

        // 【只显示前三页】模式：达到第 3 页上限后立即主动终局收工
        if (streamState.mode === 'top3' && targetPage > 3) {
            markAsExhausted('已呈现前 3 页全部符合条件的视频（已达成“只显示前三页”上限）');
            return;
        }

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
                markAsExhausted('触发 B站 请求频控限制，已主动为您终止');
                return;
            }

            const rawList = json.data?.result || [];
            const numPages = json.data?.numPages || 50;

            // 物理到头判定
            if (rawList.length === 0 || targetPage > numPages) {
                markAsExhausted('已遍历至 B站 服务端全部物理结果的最末页');
                return;
            }

            const container = getMainCardContainer();
            if (!container) return;

            let addedCountThisPage = 0;

            for (const v of rawList) {
                const bvidLower = (v.bvid || '').toLowerCase();
                if (!bvidLower) continue;

                // 物理字典去重
                if (streamState.seenBvidMap[bvidLower]) continue;
                streamState.seenBvidMap[bvidLower] = true;

                // 存储 Tag 字典
                if (v.tag) videoTagMap.set(String(v.bvid), cleanText(v.tag));

                // 内存级精准安检：只有合格视频才创建 DOM 节点挂载！
                const isMatch = checkVideoMatch(v.title || '', v.tag || '', v.author || '', filters);
                if (isMatch) {
                    const cardEl = createInjectedVideoCard(v);
                    container.appendChild(cardEl);
                    addedCountThisPage++;
                }
            }

            streamState.currentPage = targetPage;
            streamState.totalMatchesFound += addedCountThisPage;

            console.log(`[Bilibili 搜索净化] 物理第 ${targetPage} 页扫描完成，命中并呈现 ${addedCountThisPage} 个视频`);

            // 智能枯竭与抽卡成瘾阻断逻辑：
            if (addedCountThisPage === 0) {
                streamState.consecutiveEmptyPagesCount++;
                console.log(`[Bilibili 搜索净化] 当前页未命中有效视频 (连续空页数: ${streamState.consecutiveEmptyPagesCount})`);

                if (streamState.consecutiveEmptyPagesCount >= streamState.MAX_EMPTY_PAGES_TO_EXHAUST) {
                    // 连续跨 5 页全军覆没，宣告数据枯竭，彻底打断用户侥幸心理！
                    markAsExhausted(`已连续检索 5 页但未发现任何符合规则的新视频，后续内容已完全枯竭`);
                    return;
                } else {
                    // 尚未达到 5 页阈值：脚本自动静默再往后探查下一页，绝不让用户处于猜疑断层中
                    streamState.isFetching = false;
                    fetchNextPageViaAPI();
                    return;
                }
            } else {
                // 成功获得合格数据，立即重置连续空页计数，重新获得完整的 5 页探测额度
                streamState.consecutiveEmptyPagesCount = 0;
                console.log(`[Bilibili 搜索净化] 🎯 本页发现 ${addedCountThisPage} 个新合格视频，空页计数器已清零重置，后续可重新跨 5 页深度探测`);
            }

        } catch (err) {
            console.error('[Bilibili 搜索净化] API 翻页异常:', err);
        } finally {
            streamState.isFetching = false;
            updatePanelUI();
        }
    }

    // =========================================================================
    // 7. 优雅常驻悬浮控制面板 (状态监视、Ctrl+F 提示与枯竭劝退交互)
    // =========================================================================
    function createFloatingControlBar() {
        const bar = document.createElement('div');
        bar.id = 'bili-cleaner-control-bar';
        bar.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #ffffff;
            border: 1px solid #e3e5e7;
            border-radius: 10px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.12);
            z-index: 999998;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #18191c;
            padding: 12px 14px;
            font-size: 12px;
            line-height: 18px;
            box-sizing: border-box;
            min-width: 270px;
            user-select: none;
        `;

        bar.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: bold; color: #00aeec; font-size: 13px;">🛡️ 搜索净化 v2.2.1</span>
                <span id="cleaner-stat-indicator" style="color: #61666d; font-size: 11px;">已呈现 ${streamState.totalMatchesFound} 个</span>
            </div>

            <!-- 展现方式（堵不如疏） -->
            <div style="margin-bottom: 8px; background: #f6f7f8; padding: 6px 10px; border-radius: 6px;">
                <div style="font-weight: bold; margin-bottom: 5px; color: #18191c; font-size: 11px;">展现方式（堵不如疏）：</div>
                <div style="display: flex; gap: 12px; font-size: 12px;">
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <input type="radio" name="cleaner-display-style" value="spotlight" ${currentDisplayStyle === 'spotlight' ? 'checked' : ''}>
                        <span><b>聚光灯高亮</b> (疏导)</span>
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <input type="radio" name="cleaner-display-style" value="hide" ${currentDisplayStyle === 'hide' ? 'checked' : ''}>
                        <span><b>物理隐藏</b> (堵塞)</span>
                    </label>
                </div>
            </div>

            <!-- 翻页模式选择 -->
            <div style="margin-bottom: 8px; background: #f6f7f8; padding: 6px 10px; border-radius: 6px;">
                <div style="font-weight: bold; margin-bottom: 5px; color: #18191c; font-size: 11px;">翻页模式：</div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px;">
                        <input type="radio" name="cleaner-browse-mode" value="top3" ${streamState.mode === 'top3' ? 'checked' : ''}>
                        <span><b>只显示前三页</b> (推荐 · 克制防沉迷)</span>
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px;">
                        <input type="radio" name="cleaner-browse-mode" value="page" ${streamState.mode === 'page' ? 'checked' : ''}>
                        <span><b>默认当前分页</b> (原生单页翻页)</span>
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px;">
                        <input type="radio" name="cleaner-browse-mode" value="waterfall" ${streamState.mode === 'waterfall' ? 'checked' : ''}>
                        <span><b>瀑布流</b> (滚动自动加载)</span>
                    </label>
                </div>
            </div>

            <button id="cleaner-btn-manual-fetch" style="width: 100%; height: 28px; background: #00aeec; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; margin-bottom: 6px; transition: background 0.2s;">
                🚀 手动拉取下一页
            </button>

            <div id="cleaner-exhausted-card" style="display: none; background: #fff2f0; border: 1px solid #ffccc7; padding: 8px 10px; border-radius: 6px; margin-top: 6px;">
                <div style="color: #cf1322; font-weight: bold; font-size: 12px; margin-bottom: 4px;">🛑 数据已枯竭 · 终局确认</div>
                <div style="color: #434343; font-size: 11px; line-height: 16px;">
                    后续页面已无匹配视频，已全部呈现。<br>
                    <b>请勿盲目翻页</b>，建议修改搜索词。
                </div>
            </div>
        `;

        document.body.appendChild(bar);

        // 交互逻辑：展现方式切换（聚光灯 vs 物理隐藏）
        bar.querySelectorAll('input[name="cleaner-display-style"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                currentDisplayStyle = e.target.value;
                localStorage.setItem('bili_cleaner_display_style', currentDisplayStyle);
                showToast(currentDisplayStyle === 'spotlight' ? '已开启【聚光灯高亮】模式（未匹配项半透明灰度，排版完好）' : '已开启【物理隐藏】模式');
                document.querySelectorAll('.video-list-item, div[class*="col_"], .bili-video-card').forEach(c => {
                    delete c.dataset.purifiedQuery;
                });
                filterDOMElements();
            });
        });

        // 交互逻辑：单选翻页模式切换
        bar.querySelectorAll('input[name="cleaner-browse-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                streamState.mode = e.target.value;
                localStorage.setItem('bili_cleaner_browse_mode', streamState.mode);
                const modeTips = {
                    top3: '已切换为：只显示前三页（自动聚合前 3 页后停止）',
                    page: '已切换为：默认当前分页（不自动合并）',
                    waterfall: '已切换为：瀑布流（触底自动合并）'
                };
                showToast(modeTips[streamState.mode] || '模式已切换');
                updatePanelUI();
                if (streamState.mode !== 'page') checkAndTriggerAutoFill();
            });
        });

        const btnManual = bar.querySelector('#cleaner-btn-manual-fetch');
        btnManual.addEventListener('click', () => {
            fetchNextPageViaAPI();
        });

        // 滚动触底与短页面自动补齐监听
        window.addEventListener('scroll', checkAndTriggerAutoFill, { passive: true });
        window.addEventListener('wheel', checkAndTriggerAutoFill, { passive: true });
    }

    function checkAndTriggerAutoFill() {
        if (streamState.mode === 'page' || streamState.isFetching || streamState.isExhausted) return;

        // 【只显示前三页】模式：达到第 3 页上限后立即主动终局收工
        if (streamState.mode === 'top3' && streamState.currentPage >= 3) {
            markAsExhausted('已呈现前 3 页全部符合条件的视频（已达成“只显示前三页”上限）');
            return;
        }

        const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        const clientHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
        const scrollBottom = scrollHeight - (scrollTop + clientHeight);

        // 距离底部 1200px 时，或页面内容过短（无滚动条无法滚轮滑动）时，自动触发翻页拉取
        if (scrollBottom < 1200 || scrollHeight <= clientHeight + 150) {
            fetchNextPageViaAPI();
        }
    }

    function updatePanelUI() {
        const ind = document.getElementById('cleaner-stat-indicator');
        const exBox = document.getElementById('cleaner-exhausted-card');
        const btnManual = document.getElementById('cleaner-btn-manual-fetch');

        if (ind) {
            if (streamState.isExhausted) {
                ind.textContent = `全网共 ${streamState.totalMatchesFound} 个 (已枯竭)`;
                ind.style.color = '#cf1322';
            } else if (streamState.isFetching) {
                if (streamState.consecutiveEmptyPagesCount > 0) {
                    ind.textContent = `探查中 (连续空页 ${streamState.consecutiveEmptyPagesCount}/5)...`;
                } else {
                    ind.textContent = '正在探查下一页...';
                }
                ind.style.color = '#00aeec';
            } else {
                ind.textContent = `已呈现 ${streamState.totalMatchesFound} 个`;
                ind.style.color = '#61666d';
            }
        }

        if (btnManual) {
            btnManual.disabled = streamState.isFetching || streamState.isExhausted;
            if (streamState.isExhausted) {
                btnManual.textContent = '🛑 数据已枯竭';
                btnManual.style.background = '#8c8c8c';
                btnManual.style.cursor = 'not-allowed';
            } else if (streamState.isFetching) {
                btnManual.textContent = '⏳ 正在请求 API...';
                btnManual.style.background = '#9499a0';
                btnManual.style.cursor = 'wait';
            } else {
                btnManual.textContent = `🚀 手动拉取下一页 (第 ${streamState.currentPage + 1} 页)`;
                btnManual.style.background = '#00aeec';
                btnManual.style.cursor = 'pointer';
            }
        }

        if (exBox) {
            exBox.style.display = streamState.isExhausted ? 'block' : 'none';
        }
    }

    // =========================================================================
    // 8. 启动与初始化装配
    // =========================================================================
    function init() {
        syncInitialCardsToBvidMap();
        createFloatingControlBar();
        updatePanelUI();
        setupUrlWatcher();
        // 首屏过滤后若视频极少导致不足一屏高，800ms 后自动补足一屏
        setTimeout(checkAndTriggerAutoFill, 800);
        console.log('[Bilibili 搜索净化] 2.2.0 正式就绪（含枯竭劝退与SPA监听）。');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }

})();
