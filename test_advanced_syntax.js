const assert = require('assert');

// 0. 简繁与文本清洗（当前 2.2.0 精简规范：去除双引号，管道符转为空格）
function toSimplified(text) { return text; }

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

// 1. 关键词解析
function getSearchKeywords(rawKeyword) {
    const cleaned = cleanText(rawKeyword);
    if (!cleaned) return { normal: [], exclude: [], tags: [], ups: [], hasRules: false };

    const list = cleaned.split(/\s+/);
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

// 2. 视频匹配判定
function checkVideoMatch(titleRaw, tagsRaw, authorRaw, filters) {
    const title = cleanText(titleRaw);
    const tags = cleanText(tagsRaw);
    const author = cleanText((authorRaw || '').trim().replace(/\s*[·•][\s\S]*$/, '').trim());

    const { normal, exclude, tags: filterTags, ups } = filters;

    // 1. 排除词一票否决
    if (exclude.some(k => title.includes(k))) return false;
    // 2. 普通词：标题严格包含 (AND)
    if (normal.length && !normal.every(k => title.includes(k))) return false;
    // 3. 显式标签筛选
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
    // 4. 显式UP主筛选
    if (ups.length && !ups.some(k => author.includes(k))) return false;

    return true;
}

function getCleanApiKeyword(rawKeyword) {
    if (!rawKeyword) return '';
    const list = cleanText(rawKeyword).split(/\s+/);
    const searchTerms = [];
    for (let k of list) {
        k = k.replace(/^[\*＊]+/, '')
             .replace(/^[\#＃]/, '#')
             .replace(/^[\@＠]/, '@')
             .replace(/^[\-－]/, '-');

        if (k.startsWith('-')) {
            continue;
        } else if (k.startsWith('@') || k.startsWith('#')) {
            if (k.length > 1) searchTerms.push(k.substring(1));
        } else if (k) {
            searchTerms.push(k);
        }
    }
    return toSimplified(searchTerms.join(' ')) || rawKeyword.replace(/^[\#\@\-]/gm, '').trim();
}

console.log('Running v2.2.0 Syntax Tests (No Pipe, No Quotes, No Star)...\n');

// 测试 1: 普通关键词 AND 逻辑
{
    const filters = getSearchKeywords('python 教程');
    assert.deepStrictEqual(filters.normal, ['python', '教程']);
    assert.strictEqual(checkVideoMatch('Python基础教程从入门到精通', '编程', 'UP1', filters), true);
    assert.strictEqual(checkVideoMatch('Python从零开始', '编程', 'UP1', filters), false); // 缺"教程"
    console.log('✓ PASS: 普通词 AND 包含匹配');
}

// 测试 2: 负向排除词 -
{
    const filters = getSearchKeywords('手机测评 -广告 -开箱');
    assert.deepStrictEqual(filters.normal, ['手机测评']);
    assert.deepStrictEqual(filters.exclude, ['广告', '开箱']);
    assert.strictEqual(checkVideoMatch('2024最新手机测评深度对比', '数码', 'UP1', filters), true);
    assert.strictEqual(checkVideoMatch('手机测评 广告植入', '数码', 'UP1', filters), false);
    assert.strictEqual(checkVideoMatch('手机测评 开箱上手', '数码', 'UP1', filters), false);
    console.log('✓ PASS: 负向排除词 - 过滤');
}

// 测试 3: #Tag 标签专搜
{
    const filters = getSearchKeywords('#搞笑研究所');
    assert.deepStrictEqual(filters.tags, ['搞笑研究所']);
    assert.strictEqual(checkVideoMatch('这面是卖10块呀', '搞笑研究所,搞笑', '甜蜜老张', filters), true);
    assert.strictEqual(checkVideoMatch('普通炒面', '美食,日常', '甜蜜老张', filters), false);
    console.log('✓ PASS: #Tag 标签专搜');
}

// 测试 4: @UP主 定向筛选
{
    const filters = getSearchKeywords('@影视飓风');
    assert.deepStrictEqual(filters.ups, ['影视飓风']);
    assert.strictEqual(checkVideoMatch('摄影器材全解析', '摄影', '影视飓风', filters), true);
    assert.strictEqual(checkVideoMatch('摄影器材全解析', '摄影', '影视飓风 · 2024年1月', filters), true);
    assert.strictEqual(checkVideoMatch('摄影器材全解析', '摄影', '其他UP主', filters), false);
    console.log('✓ PASS: @UP主 定向筛选与日期剥离');
}

// 测试 5: 去掉【双引号“”】功能：引号自动剥离为普通字符处理
{
    const filters = getSearchKeywords('"Python" @"影视飓风"');
    assert.deepStrictEqual(filters.normal, ['python']);
    assert.deepStrictEqual(filters.ups, ['影视飓风']);
    assert.strictEqual(checkVideoMatch('Python视频', 'vue', '影视飓风', filters), true);
    console.log('✓ PASS: 去掉【双引号“”】功能（双引号自动平滑剥离）');
}

// 测试 6: 去掉【管道符|】功能：管道符转为空格，不作分支或运算
{
    const filters = getSearchKeywords('猫 | 狗');
    assert.deepStrictEqual(filters.normal, ['猫', '狗']);
    // 此时属于普通词 AND，必须同时含有猫和狗
    assert.strictEqual(checkVideoMatch('猫与狗的一天', '宠物', 'UP1', filters), true);
    assert.strictEqual(checkVideoMatch('可爱的小猫', '宠物', 'UP1', filters), false); // 缺狗
    console.log('✓ PASS: 去掉【管道符|】功能（管道符转为空格分隔）');
}

// 测试 7: 去掉【*前缀】功能：* 符号自动剥离，不再触发三连全字段泛搜
{
    const filters = getSearchKeywords('*甜蜜老张');
    assert.deepStrictEqual(filters.normal, ['甜蜜老张']);
    assert.strictEqual(filters.triple, undefined);
    // 普通词只匹配标题，不再通过作者维度泛搜
    assert.strictEqual(checkVideoMatch('暴跌光速甩卖', '短剧', '甜蜜老张', filters), false);
    assert.strictEqual(checkVideoMatch('甜蜜老张爆笑日常', '短剧', '甜蜜老张', filters), true);
    console.log('✓ PASS: 去掉【*前缀】功能（* 剥离为普通标题词）');
}

// 测试 8: 全角中文标点归一化（＃、＠、－）
{
    const filters = getSearchKeywords('手机 ＃搞笑 ＠老番茄 －营销号');
    assert.deepStrictEqual(filters.normal, ['手机']);
    assert.deepStrictEqual(filters.tags, ['搞笑']);
    assert.deepStrictEqual(filters.ups, ['老番茄']);
    assert.deepStrictEqual(filters.exclude, ['营销号']);
    console.log('✓ PASS: 全角中文标点归一化');
}

// 测试 9: API 搜索词脱壳（剥离 -排除词 与 @/# 前缀）
{
    assert.strictEqual(getCleanApiKeyword('手机测评 -广告 -开箱'), '手机测评');
    assert.strictEqual(getCleanApiKeyword('@影视飓风 #摄影'), '影视飓风 摄影');
    assert.strictEqual(getCleanApiKeyword('*甜蜜老张'), '甜蜜老张');
    console.log('✓ PASS: API 搜索词安全脱壳');
}

// 测试 10: UP主带换行与日期剥离
{
    const filters = getSearchKeywords('@影视飓风');
    assert.deepStrictEqual(filters.ups, ['影视飓风']);
    const domAuthor = '\n  影视飓风\n  · 2024年2月10日\n';
    assert.strictEqual(checkVideoMatch('科技杂谈', '科技', domAuthor, filters), true);
    console.log('✓ PASS: UP主换行与缩进首字符防吞');
}

console.log('\nAll 10 unit test suites PASSED with 100% precision!');
