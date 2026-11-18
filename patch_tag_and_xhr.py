import re

src_path = r'c:\Users\Admin（无密码）\Desktop\Bilibili 去掉搜索无关视频1.user.js'
with open(src_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update checkVideoMatch to handle #Tag gracefully with smart fallback
old_check_func = """        // 4. 显式标签筛选：必须全在视频标签库中
        if (filterTags.length && !filterTags.every(k => tags.includes(k))) return false;"""

new_check_func = """        // 4. 显式标签筛选：
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
        }"""

assert old_check_func in text, "old_check_func not found"
text = text.replace(old_check_func, new_check_func)
print("Step 1: checkVideoMatch enhanced with smart fallback")

# 2. Add XMLHttpRequest hook to Section 4 alongside window.fetch
old_network_hook = """    const originFetch = window.fetch;
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
    };"""

new_network_hook = """    // 拦截 XMLHttpRequest（覆盖 Axios 等 XHR 库，确保 /video 子页面的 Tag 字典无遗漏入库）
    const originXHR = window.XMLHttpRequest;
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
    window.XMLHttpRequest = CustomXHR;

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
    };"""

assert old_network_hook in text, "old_network_hook not found"
text = text.replace(old_network_hook, new_network_hook)
print("Step 2: XMLHttpRequest interceptor added")

# 3. Enhance cleanAdsOnly to register IDs in both raw and lowercase/uppercase
old_clean_ads = """            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = cleanText(v.tag || v.keywords || v.tags || '');
            if (id) videoTagMap.set(String(id), rawTags);"""

new_clean_ads = """            const id = v.bvid || v.aid || v.id || v.season_id || v.roomid;
            const rawTags = cleanText(v.tag || v.keywords || v.tags || '');
            if (id) {
                const sId = String(id);
                videoTagMap.set(sId, rawTags);
                videoTagMap.set(sId.toLowerCase(), rawTags);
                videoTagMap.set(sId.toUpperCase(), rawTags);
            }"""

assert old_clean_ads in text, "old_clean_ads not found"
text = text.replace(old_clean_ads, new_clean_ads)
print("Step 3: cleanAdsOnly tag registration normalized")

# Save to Desktop and Scratch
with open(src_path, 'w', encoding='utf-8') as f:
    f.write(text)

scratch_v220 = r'C:\Users\Admin（无密码）\.gemini\antigravity\scratch\bilibili-search-cleaner\bilibili-search-cleaner-v2.2.0.user.js'
with open(scratch_v220, 'w', encoding='utf-8') as f:
    f.write(text)

scratch_main = r'C:\Users\Admin（无密码）\.gemini\antigravity\scratch\bilibili-search-cleaner\bilibili-search-cleaner.user.js'
with open(scratch_main, 'w', encoding='utf-8') as f:
    f.write(text)

print("SUCCESS: Full update applied!")
