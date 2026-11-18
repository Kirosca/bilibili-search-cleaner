import re

src_path = r'c:\Users\Admin（无密码）\Desktop\Bilibili 去掉搜索无关视频1.user.js'
with open(src_path, 'r', encoding='utf-8') as f:
    text = f.read()

pos_s3 = text.find('// 3. 高级语法解析引擎')
pos_s4 = text.find('// 4. 网络层拦截与存储')
assert pos_s3 != -1 and pos_s4 != -1, "pos_s3 or pos_s4 not found"

new_s3 = """// 3. 高级语法解析引擎（支持普通词 / *三连泛搜 / -排除 / #Tag / @UP主）
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
                        kw = decodeURIComponent(kw.replace(/\\+/g, ' ')) + ' #' + tagFragment;
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
            if (domVal.includes('#') || domVal.includes('@') || domVal.includes('-') || domVal.includes('*')) {
                kw = domVal;
            } else if (!kw) {
                kw = domVal;
            }
        }

        try {
            return decodeURIComponent(kw.replace(/\\+/g, ' ')).trim();
        } catch (e) {
            return kw.replace(/\\+/g, ' ').trim();
        }
    }

    // 解析关键词分类 (普通词 / *三连词 / -排除词 / #Tag词 / @UP主词)
    function getSearchKeywords() {
        const rawKeyword = cleanText(getRawSearchKeyword());
        if (!rawKeyword) return { normal: [], triple: [], exclude: [], tags: [], ups: [], hasRules: false };

        const list = rawKeyword.split(/\\s+/);
        const normal = [];
        const triple = [];
        const exclude = [];
        const tags = [];
        const ups = [];

        for (let k of list) {
            // 输入法全角归一化容错
            k = k.replace(/^[\\*＊]/, '*')
                 .replace(/^[\\#＃]/, '#')
                 .replace(/^[\\@＠]/, '@')
                 .replace(/^[\\-－]/, '-');

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
        const rawKeyword = getRawSearchKeyword();
        if (!rawKeyword) return '';

        const list = rawKeyword.split(/\\s+/);
        const searchTerms = [];
        for (let k of list) {
            k = k.replace(/^[\\*＊]/, '*')
                 .replace(/^[\\#＃]/, '#')
                 .replace(/^[\\@＠]/, '@')
                 .replace(/^[\\-－]/, '-');

            if (k.startsWith('-')) {
                continue; // 负向排除词不发送给 B站 API
            } else if (k.startsWith('*') || k.startsWith('@') || k.startsWith('#')) {
                if (k.length > 1) searchTerms.push(k.substring(1));
            } else if (k) {
                searchTerms.push(k);
            }
        }
        return toSimplified(searchTerms.join(' ')) || rawKeyword.replace(/^[\\*\\#\\@\\-]/gm, '').trim();
    }

    // =========================================================================
    """

text = text[:pos_s3] + new_s3 + text[pos_s4:]
print("Step 1: Section 3 updated successfully")

# 2. Remove buggy duplicate getCleanApiKeyword in Section 6
old_dup = """    function getCleanApiKeyword() {
        const filters = getSearchKeywords();
        return filters.normal.join(' ') || filters.triples.join(' ') || (new URLSearchParams(window.location.search).get('keyword') || '').trim();
    }"""

assert old_dup in text, "old_dup block not found"
text = text.replace(old_dup, "")
print("Step 2: Removed buggy duplicate getCleanApiKeyword")

# 3. Update currentSearchQuery in filterDOMElements
old_query_check = "const currentSearchQuery = window.location.search;"
new_query_check = "const currentSearchQuery = getRawSearchKeyword() + '_' + currentMode;"
assert old_query_check in text, "old_query_check not found"
text = text.replace(old_query_check, new_query_check)
print("Step 3: currentSearchQuery updated to use getRawSearchKeyword + currentMode")

# 4. Save to files
with open(src_path, 'w', encoding='utf-8') as f:
    f.write(text)

scratch_v220 = r'C:\Users\Admin（无密码）\.gemini\antigravity\scratch\bilibili-search-cleaner\bilibili-search-cleaner-v2.2.0.user.js'
with open(scratch_v220, 'w', encoding='utf-8') as f:
    f.write(text)

scratch_main = r'C:\Users\Admin（无密码）\.gemini\antigravity\scratch\bilibili-search-cleaner\bilibili-search-cleaner.user.js'
with open(scratch_main, 'w', encoding='utf-8') as f:
    f.write(text)

print("SUCCESS: Bug fixes applied to Desktop and Scratch files!")
