// ==UserScript==
// @name         B站搜索 API 翻页与数据聚合 Demo
// @namespace    https://github.com/bilibili-search-cleaner
// @version      0.1.0
// @description  专为脚本猫/油猴定制的独立演示脚本：直接对接 B站 WBI 搜索接口，实现无 iframe 极速翻页、数据去重、三连模式过滤与卡片无缝追加
// @author       Antigravity
// @match        https://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    console.log('[B站 API Demo] 脚本已加载，正在初始化...');

    // ==========================================
    // 1. WBI 官方签名与轻量自包含 MD5 模块
    // ==========================================
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

    async function fetchWbiKeys() {
        const res = await window.fetch('https://api.bilibili.com/x/web-interface/nav', {
            credentials: 'include'
        });
        const json = await res.json();
        const wbiImg = json.data?.wbi_img;
        if (!wbiImg) throw new Error('未能从 nav 接口获取 wbi_img 配置');
        const imgKey = wbiImg.img_url.slice(wbiImg.img_url.lastIndexOf('/') + 1, wbiImg.img_url.lastIndexOf('.'));
        const subKey = wbiImg.sub_url.slice(wbiImg.sub_url.lastIndexOf('/') + 1, wbiImg.sub_url.lastIndexOf('.'));
        return { imgKey, subKey };
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

    // ==========================================
    // 2. 状态管理与去重字典 (键值对 Map)
    // ==========================================
    const state = {
        wbiKeys: null,
        currentPage: 1,
        totalCleanCount: 0,
        isFetching: false,
        isInfiniteScroll: false,
        enableTripleMatch: true, // 默认开启【三连模式】
        seenBvidMap: Object.create(null)
    };

    function getCurrentKeyword() {
        const params = new URLSearchParams(window.location.search);
        let kw = params.get('keyword') || '';
        if (!kw && window.location.hash.includes('keyword=')) {
            const hashParams = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?')));
            kw = hashParams.get('keyword') || '';
        }
        return decodeURIComponent(kw.replace(/\+/g, ' ')).trim();
    }

    // 将首屏原生已经存在的视频记入去重字典
    function syncInitialCards() {
        document.querySelectorAll('a[href*="/video/BV"]').forEach(a => {
            const m = a.href.match(/\b(BV[a-zA-Z0-9]{10})\b/i);
            if (m) {
                state.seenBvidMap[m[1].toLowerCase()] = true;
            }
        });
        state.totalCleanCount = Object.keys(state.seenBvidMap).length;
    }

    // 获取搜索结果卡片的父级网格容器
    function getCardContainer() {
        return document.querySelector('.video.search-all-list, .video.i_wrapper, .video-list.row')
            || document.querySelector('.search-page-wrapper .video-list')
            || document.querySelector('.video-list');
    }

    // ==========================================
    // 3. 卡片生成与 DOM 追加 (无 iframe 物理注入)
    // ==========================================
    function createVideoCardElement(v) {
        const col = document.createElement('div');
        col.className = 'video-list-item col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40';
        col.dataset.bvid = v.bvid;

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
                        <div style="margin-top: 4px; font-size: 11px; color: #00aeec; background: rgba(0,174,236,0.08); padding: 1px 4px; border-radius: 4px; display: inline-block;">
                            [API直连注入 · Tag: ${(v.tag || '').split(',')[0] || '默认'}]
                        </div>
                    </div>
                </div>
            </div>
        `;
        return col;
    }

    // ==========================================
    // 4. 核心：通过 API 抓取下一页并执行三连过滤与去重
    // ==========================================
    async function fetchAndAppendNextPage() {
        if (state.isFetching) return;
        state.isFetching = true;
        updatePanelUI();

        const logEl = document.getElementById('bili-api-demo-log');
        const appendLog = (msg) => {
            if (logEl) {
                logEl.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${msg}</div>`;
                logEl.scrollTop = logEl.scrollHeight;
            }
        };

        try {
            // 确保 WBI 密钥已拉取
            if (!state.wbiKeys) {
                appendLog('正在获取 B站 WBI 密钥对...');
                state.wbiKeys = await fetchWbiKeys();
                appendLog(`密钥就绪: img=${state.wbiKeys.imgKey.slice(0, 6)}...`);
            }

            const targetPage = state.currentPage + 1;
            const keyword = getCurrentKeyword();
            if (!keyword) {
                appendLog('⚠️ 未检测到有效搜索关键词');
                return;
            }

            appendLog(`🚀 发起请求: 第 ${targetPage} 页 (关键词: "${keyword}") ...`);
            const startTime = performance.now();

            const params = {
                keyword: keyword,
                page: targetPage,
                search_type: 'video',
                order: 'totalrank'
            };

            const queryString = signWbiParams(params, state.wbiKeys.imgKey, state.wbiKeys.subKey);
            const targetUrl = `https://api.bilibili.com/x/web-interface/wbi/search/type?${queryString}`;

            const res = await window.fetch(targetUrl, { credentials: 'include' });
            const json = await res.json();
            const elapsed = Math.round(performance.now() - startTime);

            if (json.code !== 0) {
                appendLog(`❌ 请求失败! Code: ${json.code}, 消息: ${json.message}`);
                return;
            }

            const rawList = json.data?.result || [];
            appendLog(`✅ 成功返回 ${rawList.length} 个视频 (耗时 ${elapsed}ms)`);

            // 执行去重与【三连模式】过滤
            const container = getCardContainer();
            if (!container) {
                appendLog('❌ 未在当前页面找到视频卡片容器 DOM');
                return;
            }

            let addedCount = 0;
            let duplicateCount = 0;
            let filteredCount = 0;

            for (const v of rawList) {
                const bvidLower = (v.bvid || '').toLowerCase();
                if (!bvidLower) continue;

                // 1. 去重检查
                if (state.seenBvidMap[bvidLower]) {
                    duplicateCount++;
                    continue;
                }

                // 2. 【三连模式】过滤（若开启）：标题 OR 标签 OR UP主中包含主关键词
                if (state.enableTripleMatch) {
                    const titleText = (v.title || '').replace(/<[^>]+>/g, '').toLowerCase();
                    const tagText = (v.tag || '').toLowerCase();
                    const authorText = (v.author || '').toLowerCase();
                    const kwLower = keyword.toLowerCase();

                    const match = titleText.includes(kwLower) || tagText.includes(kwLower) || authorText.includes(kwLower);
                    if (!match) {
                        filteredCount++;
                        continue;
                    }
                }

                // 3. 记入字典并挂载 DOM
                state.seenBvidMap[bvidLower] = true;
                const cardEl = createVideoCardElement(v);
                container.appendChild(cardEl);
                addedCount++;
            }

            state.currentPage = targetPage;
            state.totalCleanCount += addedCount;
            appendLog(`🎉 成功渲染 ${addedCount} 个新卡片 (去重跳过 ${duplicateCount}, 规则过滤 ${filteredCount})`);

        } catch (err) {
            appendLog(`❌ 发生异常: ${err.message}`);
            console.error('[B站 API Demo] 异常:', err);
        } finally {
            state.isFetching = false;
            updatePanelUI();
        }
    }

    // ==========================================
    // 5. 悬浮交互调试面板 (脚本猫专用 UI)
    // ==========================================
    function createDemoFloatingPanel() {
        const panel = document.createElement('div');
        panel.id = 'bili-api-demo-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 320px;
            background: #ffffff;
            border: 1px solid #e3e5e7;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #18191c;
            padding: 16px;
            box-sizing: border-box;
            font-size: 13px;
        `;

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f2f3; padding-bottom: 8px; margin-bottom: 12px;">
                <span style="font-weight: bold; font-size: 14px; color: #00aeec;">⚡ B站 API 直连翻页 Demo</span>
                <span style="font-size: 11px; color: #9499a0; background: #f6f7f8; padding: 2px 6px; border-radius: 4px;">v0.1.0</span>
            </div>
            
            <div style="margin-bottom: 10px; line-height: 20px;">
                <div>📄 已加载页码: <b id="demo-stat-page" style="color: #00aeec;">第 1 页</b></div>
                <div>📊 已聚合视频: <b id="demo-stat-count" style="color: #50a14f;">0 个</b></div>
            </div>

            <button id="demo-btn-next" style="width: 100%; height: 36px; background: #00aeec; color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; margin-bottom: 10px;">
                🚀 通过 API 请求下一页 (Page +1)
            </button>

            <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; background: #f6f7f8; padding: 8px; border-radius: 6px;">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    <input type="checkbox" id="demo-toggle-scroll">
                    <span>启用滚动触底自动合并 (瀑布流)</span>
                </label>
                <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    <input type="checkbox" id="demo-toggle-triple" checked>
                    <span>启用三连匹配 (标题/标签/UP主任一)</span>
                </label>
            </div>

            <div style="font-size: 11px; color: #9499a0; margin-bottom: 4px;">运行日志:</div>
            <div id="bili-api-demo-log" style="height: 120px; overflow-y: auto; background: #18191c; color: #00e676; font-family: monospace; font-size: 11px; padding: 6px; border-radius: 6px; line-height: 16px;">
                <div>[系统] 脚本就绪，点击上方按钮测试 API 翻页...</div>
            </div>
        `;

        document.body.appendChild(panel);

        // 事件监听
        const btnNext = panel.querySelector('#demo-btn-next');
        btnNext.addEventListener('click', () => {
            fetchAndAppendNextPage();
        });

        const toggleScroll = panel.querySelector('#demo-toggle-scroll');
        toggleScroll.addEventListener('change', (e) => {
            state.isInfiniteScroll = e.target.checked;
        });

        const toggleTriple = panel.querySelector('#demo-toggle-triple');
        toggleTriple.addEventListener('change', (e) => {
            state.enableTripleMatch = e.target.checked;
        });

        // 触底监听 (用于演示瀑布流)
        window.addEventListener('scroll', () => {
            if (!state.isInfiniteScroll || state.isFetching) return;
            const scrollBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
            if (scrollBottom < 1000) {
                fetchAndAppendNextPage();
            }
        });
    }

    function updatePanelUI() {
        const pageEl = document.getElementById('demo-stat-page');
        const countEl = document.getElementById('demo-stat-count');
        const btnNext = document.getElementById('demo-btn-next');
        if (pageEl) pageEl.textContent = `第 ${state.currentPage} 页`;
        if (countEl) countEl.textContent = `${state.totalCleanCount} 个`;
        if (btnNext) {
            btnNext.disabled = state.isFetching;
            btnNext.textContent = state.isFetching ? '⏳ 正在请求 API...' : `🚀 通过 API 请求下一页 (Page ${state.currentPage + 1})`;
            btnNext.style.background = state.isFetching ? '#9499a0' : '#00aeec';
        }
    }

    // ==========================================
    // 6. 启动初始化
    // ==========================================
    setTimeout(() => {
        syncInitialCards();
        createDemoFloatingPanel();
        updatePanelUI();
        console.log('[B站 API Demo] 悬浮面板与初始去重已就绪！当前初始视频数:', state.totalCleanCount);
    }, 1000);

})();
