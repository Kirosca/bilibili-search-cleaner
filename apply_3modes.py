import re

src_path = r'c:\Users\Admin（无密码）\Desktop\Bilibili 去掉搜索无关视频1.user.js'
with open(src_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update currentMode definition
old_style_def = "let currentDisplayStyle = localStorage.getItem('bili_cleaner_display_style') || 'spotlight';"
new_mode_def = """// 核心运行模式（三个平级选项：waterfall 瀑布流 | spotlight 聚光灯高亮 | hide 物理隐藏）
    // A【瀑布流】：翻页方式为瀑布流，展示方式为物理隐藏，不聚光灯高亮展示，拉取时不过滤视频全部注入
    // B【聚光灯高亮】：B站原生翻页不动，纯聚光灯高亮/暗化展示
    // C【物理隐藏】：B站原生翻页不动，B站原生卡片展示方式（无关视频 display:none 物理隐藏）
    let currentMode = localStorage.getItem('bili_cleaner_mode') || 'waterfall';"""

assert old_style_def in text, "old_style_def not found"
text = text.replace(old_style_def, new_mode_def)

# 2. Update applyCardFilterVisual
old_apply_func = """    function applyCardFilterVisual(card, isMatch) {
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
    }"""

new_apply_func = """    function applyCardFilterVisual(card, isMatch) {
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
    }"""

assert old_apply_func in text, "old_apply_func not found"
text = text.replace(old_apply_func, new_apply_func)

# 3. Update matchCount calibration in filterDOMElements
old_match_count = """            document.querySelectorAll('[class*="col_"], .video-list-item').forEach(c => {
                if (c.classList.contains('bili-cleaner-highlighted') || (currentDisplayStyle === 'hide' && c.style.display !== 'none' && c.querySelector('a[href*="/video/BV"]'))) {
                    matchCount++;
                }
            });"""

new_match_count = """            document.querySelectorAll('[class*="col_"], .video-list-item').forEach(c => {
                if (currentMode === 'spotlight') {
                    if (c.classList.contains('bili-cleaner-highlighted')) matchCount++;
                } else {
                    if (c.style.display !== 'none' && c.querySelector('a[href*="/video/BV"]')) matchCount++;
                }
            });"""

assert old_match_count in text, "old_match_count not found"
text = text.replace(old_match_count, new_match_count)

# 4. Replace Section 6 and Section 7 completely
pos_s6 = text.find('// 6. 跨页连续聚合流引擎')
pos_s8 = text.find('// 8. 启动与初始化装配')
assert pos_s6 != -1 and pos_s8 != -1, "Sections 6 or 8 not found"

new_s6_s7 = '''// 6. 跨页连续聚合流引擎（支持【瀑布流】、【聚光灯高亮】、【物理隐藏】三平级模式）
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

            let addedCountThisPage = 0;

            // 1. 【瀑布流】不过滤视频：接口返回的所有视频均挂载进 DOM
            for (const v of rawList) {
                const bvidLower = (v.bvid || '').toLowerCase();
                if (!bvidLower) continue;

                // 物理字典去重
                if (streamState.seenBvidMap[bvidLower]) continue;
                streamState.seenBvidMap[bvidLower] = true;

                // 存储 Tag 字典
                if (v.tag) videoTagMap.set(String(v.bvid), cleanText(v.tag));

                // 创建原生卡片 DOM
                const cardEl = createInjectedVideoCard(v);

                // 2. A【瀑布流】展示方式为【物理隐藏】，不【聚光灯高亮】展示
                const isMatch = checkVideoMatch(v.title || '', v.tag || '', v.author || '', filters);
                if (isMatch) {
                    cardEl.style.removeProperty('display');
                    addedCountThisPage++;
                } else {
                    cardEl.style.setProperty('display', 'none', 'important');
                }
                container.appendChild(cardEl);
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

    // =========================================================================
    // 7. 优雅常驻悬浮控制面板 (三平级单选模式)
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
            min-width: 260px;
            user-select: none;
        `;

        bar.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: bold; color: #00aeec; font-size: 13px;">🛡️ 搜索净化 v2.2.0</span>
                <span id="cleaner-stat-indicator" style="color: #61666d; font-size: 11px;">已呈现 ${streamState.totalMatchesFound} 个</span>
            </div>

            <!-- 三个平级单选选项 -->
            <div style="margin-bottom: 8px; background: #f6f7f8; padding: 8px 10px; border-radius: 6px;">
                <div style="font-weight: bold; margin-bottom: 6px; color: #18191c; font-size: 11px;">模式选择：</div>
                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px;">
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="cleaner-mode" value="waterfall" ${currentMode === 'waterfall' ? 'checked' : ''}>
                        <span><b>瀑布流</b> <span style="color: #61666d; font-size: 11px;">(瀑布流翻页 · 物理隐藏展示)</span></span>
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="cleaner-mode" value="spotlight" ${currentMode === 'spotlight' ? 'checked' : ''}>
                        <span><b>聚光灯高亮</b> <span style="color: #61666d; font-size: 11px;">(原生翻页 · 视觉聚焦暗化)</span></span>
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="cleaner-mode" value="hide" ${currentMode === 'hide' ? 'checked' : ''}>
                        <span><b>物理隐藏</b> <span style="color: #61666d; font-size: 11px;">(原生翻页 · 原生卡片隐藏)</span></span>
                    </label>
                </div>
            </div>

            <button id="cleaner-btn-manual-fetch" style="width: 100%; height: 28px; background: #00aeec; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; margin-bottom: 6px; transition: background 0.2s; display: ${currentMode === 'waterfall' ? 'block' : 'none'};">
                🚀 手动拉取下一页
            </button>

            <div style="color: #9499a0; font-size: 11px; text-align: center; margin-top: 4px;">
                💡 配合 <b>Ctrl + F</b> 查找当前页面结果
            </div>
        `;

        document.body.appendChild(bar);

        // 交互逻辑：平级模式单选切换
        bar.querySelectorAll('input[name="cleaner-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                currentMode = e.target.value;
                localStorage.setItem('bili_cleaner_mode', currentMode);

                const modeTips = {
                    waterfall: '已切换为【瀑布流】模式（翻页方式：瀑布流，展示方式：物理隐藏）',
                    spotlight: '已切换为【聚光灯高亮】模式（翻页方式：B站原生翻页，展示方式：聚光灯高亮）',
                    hide: '已切换为【物理隐藏】模式（翻页方式：B站原生翻页，展示方式：原生卡片物理隐藏）'
                };
                showToast(modeTips[currentMode] || '模式已切换');

                document.querySelectorAll('.video-list-item, div[class*="col_"], .bili-video-card').forEach(c => {
                    delete c.dataset.purifiedQuery;
                });
                filterDOMElements();
                updatePanelUI();

                if (currentMode === 'waterfall') {
                    checkAndTriggerAutoFill();
                }
            });
        });

        const btnManual = bar.querySelector('#cleaner-btn-manual-fetch');
        btnManual.addEventListener('click', () => {
            fetchNextPageViaAPI();
        });

        // 滚动触底与短页面自动补齐监听（仅在瀑布流模式下生效）
        window.addEventListener('scroll', checkAndTriggerAutoFill, { passive: true });
        window.addEventListener('wheel', checkAndTriggerAutoFill, { passive: true });
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
        const ind = document.getElementById('cleaner-stat-indicator');
        const btnManual = document.getElementById('cleaner-btn-manual-fetch');

        if (ind) {
            if (currentMode === 'waterfall') {
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
            } else {
                ind.textContent = `当页匹配 ${streamState.totalMatchesFound} 个`;
                ind.style.color = '#61666d';
            }
        }

        if (btnManual) {
            if (currentMode !== 'waterfall') {
                btnManual.style.display = 'none';
            } else {
                btnManual.style.display = 'block';
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
    }

    '''

text = text[:pos_s6] + new_s6_s7 + text[pos_s8:]

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

print("SUCCESS: 3-mode clean implementation updated!")
