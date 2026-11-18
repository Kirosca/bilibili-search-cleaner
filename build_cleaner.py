import re

src_path = r'c:\Users\Admin（无密码）\Desktop\Bilibili 去掉搜索无关视频1.user.js.bak'
with open(src_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. CSS adjustments: replace banner css with dimmed hover preview protection css
target_css = """        .bili-cleaner-stream-end-banner {
            width: 100%;
            text-align: center;
            padding: 28px 16px;
            margin: 30px auto;
            background: #fafafa;
            border: 1px dashed #d9d9d9;
            border-radius: 8px;
            box-sizing: border-box;
            clear: both;
        }"""

replacement_css = """        /* 非聚光灯视频：禁止动态视频预览层渲染与播放器资源加载 */
        .bili-cleaner-dimmed .bili-video-card__image--video,
        .bili-cleaner-dimmed .bili-video-card__stats--preview,
        .bili-cleaner-dimmed .bili-cover-card__video,
        .bili-cleaner-dimmed .preview-video,
        .bili-cleaner-dimmed video {
            display: none !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }"""

assert target_css in text, "Target CSS not found"
text = text.replace(target_css, replacement_css)

# 2. Add mouseenter capture protection before MutationObserver
target_observer = """    let rafId = null;
    const observer = new MutationObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            checkAndResetIfSearchChanged();
            filterDOMElements();
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });"""

replacement_observer = """    // 拦截非聚光灯（暗化）卡片的鼠标悬停动态视频加载与播放
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
    observer.observe(document.documentElement, { childList: true, subtree: true });"""

assert target_observer in text, "Target observer not found"
text = text.replace(target_observer, replacement_observer)

# 3. Clean up matchCount check
text = text.replace('if (matchCount > 0 && !streamState.isExhausted)', 'if (matchCount > 0)')

# 4. Replace Section 6 and Section 7 completely
pos_s6 = text.find('// 6. 跨页连续聚合流引擎')
pos_s8 = text.find('// 8. 启动与初始化装配')
assert pos_s6 != -1 and pos_s8 != -1, "Sections 6 or 8 not found"

new_s6_s7 = '''// 6. 跨页连续聚合流引擎（无限制瀑布流模式）
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

        console.log('[Bilibili 搜索净化] 发现搜索词/路由变更，重置控制栏与聚合状态:', currentQuery);
        lastKnownSearchQuery = currentQuery;

        // 1. 重置跨页流式状态
        streamState.currentPage = 1;
        streamState.isFetching = false;
        streamState.hasMore = true;
        streamState.totalMatchesFound = 0;
        streamState.seenBvidMap = Object.create(null);

        // 2. 立即重置悬浮面板 UI
        updatePanelUI();

        // 3. 延迟等待 B站 Vue 渲染新一轮首屏 DOM 后同步
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
            const m = a.href.match(/\\b(BV[a-zA-Z0-9]{10})\\b/i);
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

    function getCleanApiKeyword() {
        const filters = getSearchKeywords();
        return filters.normal.join(' ') || filters.triples.join(' ') || (new URLSearchParams(window.location.search).get('keyword') || '').trim();
    }

    function createInjectedVideoCard(v) {
        const col = document.createElement('div');
        col.className = 'col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40';

        const cleanTitle = (v.title || '').replace(/<[^>]+>/g, '');
        const videoUrl = `https://www.bilibili.com/video/${v.bvid}`;
        let coverUrl = v.pic || '';
        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;

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

    async function fetchNextPageViaAPI() {
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

            let addedCountThisPage = 0;

            for (const v of rawList) {
                const bvidLower = (v.bvid || '').toLowerCase();
                if (!bvidLower) continue;

                // 物理字典去重
                if (streamState.seenBvidMap[bvidLower]) continue;
                streamState.seenBvidMap[bvidLower] = true;

                // 存储 Tag 字典
                if (v.tag) videoTagMap.set(String(v.bvid), cleanText(v.tag));

                // 内存级精准安检：只有合格视频才创建 DOM 节点挂载
                const isMatch = checkVideoMatch(v.title || '', v.tag || '', v.author || '', filters);
                if (isMatch) {
                    const cardEl = createInjectedVideoCard(v);
                    container.appendChild(cardEl);
                    addedCountThisPage++;
                }
            }

            streamState.currentPage = targetPage;
            streamState.totalMatchesFound += addedCountThisPage;

            console.log(`[Bilibili 搜索净化] 物理第 ${targetPage} 页扫描完成，呈现 ${addedCountThisPage} 个视频`);

            // 若本页无匹配视频，继续自动检索下一页（瀑布流不限制页数，直到匹配到内容或到头）
            if (addedCountThisPage === 0) {
                console.log(`[Bilibili 搜索净化] 物理第 ${targetPage} 页无匹配视频，继续检索下一页...`);
                streamState.isFetching = false;
                setTimeout(fetchNextPageViaAPI, 350);
                return;
            }

        } catch (err) {
            console.error('[Bilibili 搜索净化] API 翻页异常:', err);
        } finally {
            streamState.isFetching = false;
            updatePanelUI();
        }
    }

    // =========================================================================
    // 7. 优雅常驻悬浮控制面板 (状态监视与展现模式切换)
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
            min-width: 250px;
            user-select: none;
        `;

        bar.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: bold; color: #00aeec; font-size: 13px;">🛡️ 搜索净化 v2.2.0</span>
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

            <!-- 翻页模式提示 -->
            <div style="margin-bottom: 8px; font-size: 11px; color: #61666d; display: flex; justify-content: space-between; align-items: center;">
                <span>翻页模式：<b style="color: #00aeec;">瀑布流 (无限制)</b></span>
                <span style="color: #9499a0;">触底自动加载</span>
            </div>

            <button id="cleaner-btn-manual-fetch" style="width: 100%; height: 28px; background: #00aeec; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; margin-bottom: 6px; transition: background 0.2s;">
                🚀 手动拉取下一页
            </button>

            <div style="color: #9499a0; font-size: 11px; text-align: center; margin-top: 4px;">
                💡 配合 <b>Ctrl + F</b> 查找当前聚合结果
            </div>
        `;

        document.body.appendChild(bar);

        // 交互逻辑：单选展现方式切换
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

        const btnManual = bar.querySelector('#cleaner-btn-manual-fetch');
        btnManual.addEventListener('click', () => {
            fetchNextPageViaAPI();
        });

        // 滚动触底与短页面自动补齐监听
        window.addEventListener('scroll', checkAndTriggerAutoFill, { passive: true });
        window.addEventListener('wheel', checkAndTriggerAutoFill, { passive: true });
    }

    function checkAndTriggerAutoFill() {
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
        const ind = document.getElementById('cleaner-stat-indicator');
        const btnManual = document.getElementById('cleaner-btn-manual-fetch');

        if (ind) {
            if (streamState.isFetching) {
                ind.textContent = `加载中 (第 ${streamState.currentPage + 1} 页)...`;
                ind.style.color = '#00aeec';
            } else if (!streamState.hasMore) {
                ind.textContent = `已到末页 (共 ${streamState.totalMatchesFound} 个)`;
                ind.style.color = '#61666d';
            } else {
                ind.textContent = `已呈现 ${streamState.totalMatchesFound} 个`;
                ind.style.color = '#61666d';
            }
        }

        if (btnManual) {
            btnManual.disabled = streamState.isFetching || !streamState.hasMore;
            if (!streamState.hasMore) {
                btnManual.textContent = '🏁 已到达最末页';
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
    }

    '''

text = text[:pos_s6] + new_s6_s7 + text[pos_s8:]

# 5. Check console log in init
text = text.replace('2.2.0 正式就绪（含枯竭劝退与SPA监听）。', '2.2.0 正式就绪（无限制瀑布流模式）。')

# Save to Desktop and Scratch
desktop_path = r'c:\Users\Admin（无密码）\Desktop\Bilibili 去掉搜索无关视频1.user.js'
with open(desktop_path, 'w', encoding='utf-8') as f:
    f.write(text)

scratch_v220 = r'C:\Users\Admin（无密码）\.gemini\antigravity\scratch\bilibili-search-cleaner\bilibili-search-cleaner-v2.2.0.user.js'
with open(scratch_v220, 'w', encoding='utf-8') as f:
    f.write(text)

scratch_main = r'C:\Users\Admin（无密码）\.gemini\antigravity\scratch\bilibili-search-cleaner\bilibili-search-cleaner.user.js'
with open(scratch_main, 'w', encoding='utf-8') as f:
    f.write(text)

print("SUCCESS: Files successfully updated!")
