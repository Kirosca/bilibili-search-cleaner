const assert = require('assert');

// 0. 简繁与文本清洗模拟
function toSimplified(text) { return text; }

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
        .replace(/[\u201C\u201D\uFF02]/g, '"')
        .replace(/\uFF5C/g, '|')
        .replace(/\uFF03/g, '#')
        .replace(/\uFF20/g, '@')
        .replace(/\uFF0D/g, '-')
        .trim()
        .toLowerCase();
}

function splitByTopLevelPipe(str) {
    const branches = [];
    let curr = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (inQuote) {
            curr += char;
            if (char === quoteChar) inQuote = false;
        } else {
            if (char === '"' || char === "'") {
                inQuote = true;
                quoteChar = char;
                curr += char;
            } else if (char === '|') {
                if (curr.trim()) branches.push(curr.trim());
                curr = '';
            } else {
                curr += char;
            }
        }
    }
    if (curr.trim()) branches.push(curr.trim());
    return branches;
}

function tokenizeBranch(branchStr) {
    const tokens = [];
    let curr = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < branchStr.length; i++) {
        const char = branchStr[i];
        if (inQuote) {
            curr += char;
            if (char === quoteChar) inQuote = false;
        } else {
            if (char === '"' || char === "'") {
                inQuote = true;
                quoteChar = char;
                curr += char;
            } else if (/\s/.test(char)) {
                if (curr.length > 0) {
                    tokens.push(curr);
                    curr = '';
                }
            } else {
                curr += char;
            }
        }
    }
    if (curr.length > 0) tokens.push(curr);
    return tokens;
}

function parseToken(rawToken) {
    let t = rawToken.trim();
    if (!t) return null;

    let isNeg = false;
    if (t.startsWith('-')) {
        isNeg = true;
        t = t.substring(1);
    }

    let target = 'title';
    if (t.startsWith('#')) {
        target = 'tag';
        t = t.substring(1);
    } else if (t.startsWith('@')) {
        target = 'author';
        t = t.substring(1);
    }

    let isExact = false;
    let val = t;
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
        isExact = true;
        val = val.slice(1, -1);
    }

    const cleanVal = cleanText(val);
    if (!cleanVal) return null;

    return { isNeg, target, isExact, val: cleanVal };
}

function parseSearchQuery(rawParam) {
    if (!rawParam) return { exclusions: [], branches: [], hasRules: false };
    const cleaned = cleanText(decodeURIComponent(rawParam.replace(/\+/g, ' ')));
    const branchStrings = splitByTopLevelPipe(cleaned);

    const exclusions = [];
    const branches = [];

    for (const bStr of branchStrings) {
        const rawTokens = tokenizeBranch(bStr);
        const posTokens = [];

        for (const rt of rawTokens) {
            const parsed = parseToken(rt);
            if (!parsed) continue;
            if (parsed.isNeg) {
                exclusions.push(parsed);
            } else {
                posTokens.push(parsed);
            }
        }
        if (posTokens.length > 0) {
            branches.push(posTokens);
        }
    }
    return { exclusions, branches, hasRules: exclusions.length > 0 || branches.length > 0 };
}

function testCard(parsedQuery, cardInfo) {
    if (!parsedQuery.hasRules) return true;
    const { title, author, tagList, tagSet, rawTags } = cardInfo;

    // 1. 任何一个排除规则命中，直接过滤隐藏
    for (const ex of parsedQuery.exclusions) {
        if (ex.target === 'title') {
            if (title.includes(ex.val)) return false;
        } else if (ex.target === 'author') {
            if (ex.isExact ? (author === ex.val) : author.includes(ex.val)) return false;
        } else if (ex.target === 'tag') {
            if (ex.isExact ? tagSet.has(ex.val) : (tagList.some(t => t.includes(ex.val)) || rawTags.includes(ex.val))) return false;
        }
    }

    // 2. 如果只有排除条件没有正向条件，排除通过即保留
    if (parsedQuery.branches.length === 0) {
        return true;
    }

    // 3. 正向条件：满足任一分支即可通过 (OR)
    return parsedQuery.branches.some(branch => {
        // 分支内所有正向条件必须同时满足 (AND)
        return branch.every(cond => {
            if (cond.target === 'title') {
                return title.includes(cond.val);
            } else if (cond.target === 'author') {
                return cond.isExact ? (author === cond.val) : author.includes(cond.val);
            } else if (cond.target === 'tag') {
                return cond.isExact ? tagSet.has(cond.val) : (tagList.some(t => t.includes(cond.val)) || rawTags.includes(cond.val));
            }
            return false;
        });
    });
}

function extractCardTags(raw) {
    const rawTags = cleanText(raw || '');
    const tagList = rawTags ? rawTags.split(/[,，、]+/).map(t => t.trim()).filter(Boolean) : [];
    const tagSet = new Set(tagList);
    return { rawTags, tagList, tagSet };
}

function makeCard(title, author, rawTags) {
    const tagData = extractCardTags(rawTags);
    return {
        title: cleanText(title),
        author: cleanText(author),
        ...tagData
    };
}

// ==================== 单元测试集 ====================

console.log('Running Advanced Filter Syntax Tests...\n');

// 1. 测试 A | B 标题或匹配
{
    const q = parseSearchQuery('猫 | 狗');
    const c1 = makeCard('这是一只可爱的小猫', 'up1', '宠物');
    const c2 = makeCard('小狗在草地上奔跑', 'up2', '宠物');
    const c3 = makeCard('野生动物大冒险', 'up3', '纪录片');
    assert.strictEqual(testCard(q, c1), true, 'c1 should match 猫');
    assert.strictEqual(testCard(q, c2), true, 'c2 should match 狗');
    assert.strictEqual(testCard(q, c3), false, 'c3 should be filtered');
    console.log('✓ PASS: A | B (标题或者匹配)');
}

// 2. 测试 #"A B" 标签完全匹配
{
    const q = parseSearchQuery('#"deepseek v3"');
    const c1 = makeCard('AI新发布', 'up1', 'deepseek v3,大模型');
    const c2 = makeCard('AI新发布', 'up1', 'deepseek v3 pro,大模型');
    const c3 = makeCard('AI新发布', 'up1', 'deepseek,v3');
    assert.strictEqual(testCard(q, c1), true, 'c1 should exactly match tag "deepseek v3"');
    assert.strictEqual(testCard(q, c2), false, 'c2 has "deepseek v3 pro", not "deepseek v3"');
    assert.strictEqual(testCard(q, c3), false, 'c3 has "deepseek" and "v3" separate');
    console.log('✓ PASS: #"A B" (标签完全匹配)');
}

// 3. 测试 -#A 排除含 A 的标签
{
    const q = parseSearchQuery('-#手游');
    const c1 = makeCard('原神日常', 'up1', '原神手游,开放世界');
    const c2 = makeCard('单机大作', 'up2', '主机游戏,3a');
    assert.strictEqual(testCard(q, c1), false, 'c1 has tag with "手游", should be excluded');
    assert.strictEqual(testCard(q, c2), true, 'c2 should pass');
    console.log('✓ PASS: -#A (排除含A标签)');
}

// 4. 测试 -#"A B" 排除完全匹配 A B 的标签
{
    const q = parseSearchQuery('-#"英雄联盟"');
    const c1 = makeCard('精彩时刻', 'up1', '英雄联盟,moba');
    const c2 = makeCard('手游精彩时刻', 'up1', '英雄联盟手游,moba');
    assert.strictEqual(testCard(q, c1), false, 'c1 has exact tag "英雄联盟", should be excluded');
    assert.strictEqual(testCard(q, c2), true, 'c2 has "英雄联盟手游", exact match should not exclude');
    console.log('✓ PASS: -#"A B" (排除完全匹配【A B】标签)');
}

// 5. 测试 -@A 排除 up 名字包含 A
{
    const q = parseSearchQuery('-@营销号');
    const c1 = makeCard('震惊视频', '娱乐营销号二号', '搞笑');
    const c2 = makeCard('正经视频', '小红书官方', '生活');
    assert.strictEqual(testCard(q, c1), false, 'c1 up has "营销号", should be excluded');
    assert.strictEqual(testCard(q, c2), true, 'c2 should pass');
    console.log('✓ PASS: -@A (排除UP名字包含A)');
}

// 6. 测试 @"A" UP主名字完全匹配
{
    const q = parseSearchQuery('@"老番茄"');
    const c1 = makeCard('杀手47', '老番茄', '游戏');
    const c2 = makeCard('游戏解说', '老番茄的粉丝小李', '游戏');
    assert.strictEqual(testCard(q, c1), true, 'c1 author exactly equals "老番茄"');
    assert.strictEqual(testCard(q, c2), false, 'c2 author contains "老番茄" but is not equal');
    console.log('✓ PASS: @"A" (UP主名字完全匹配)');
}

// 7. 测试 -@"A" 排除 UP主名字完全匹配
{
    const q = parseSearchQuery('-@"老番茄"');
    const c1 = makeCard('杀手47', '老番茄', '游戏');
    const c2 = makeCard('游戏解说', '老番茄的粉丝小李', '游戏');
    assert.strictEqual(testCard(q, c1), false, 'c1 author exactly equals "老番茄", should be excluded');
    assert.strictEqual(testCard(q, c2), true, 'c2 author is not strictly "老番茄", should pass');
    console.log('✓ PASS: -@"A" (排除UP名字完全匹配)');
}

// 8. 测试 | 在多种语法中混合生效及多个 |
{
    const q = parseSearchQuery('@"老番茄" | @"影视飓风" | #"数码评测"');
    const c1 = makeCard('视频A', '老番茄', '游戏');
    const c2 = makeCard('视频B', '影视飓风', '摄影');
    const c3 = makeCard('视频C', '某路人', '数码评测,科技');
    const c4 = makeCard('视频D', '某路人', '数码,科技');
    assert.strictEqual(testCard(q, c1), true, 'c1 matches branch 1 (@"老番茄")');
    assert.strictEqual(testCard(q, c2), true, 'c2 matches branch 2 (@"影视飓风")');
    assert.strictEqual(testCard(q, c3), true, 'c3 matches branch 3 (#"数码评测")');
    assert.strictEqual(testCard(q, c4), false, 'c4 matches none of the 3 branches');
    console.log('✓ PASS: | 跨语法多分支 (UP完全匹配 OR UP完全匹配 OR Tag完全匹配)');
}

// 9. 测试复合条件：A B | C D 且带全局排除 -E
{
    const q = parseSearchQuery('深度 学习 | 机器 学习 -#少儿编程');
    const c1 = makeCard('深度学习入门教程', 'up1', '人工智能');
    const c2 = makeCard('机器学习实战', 'up2', '人工智能');
    const c3 = makeCard('深度学习少儿版', 'up3', '少儿编程');
    const c4 = makeCard('深度科普', 'up4', '科技');
    assert.strictEqual(testCard(q, c1), true, 'c1 matches "深度" and "学习"');
    assert.strictEqual(testCard(q, c2), true, 'c2 matches "机器" and "学习"');
    assert.strictEqual(testCard(q, c3), false, 'c3 has excluded tag "少儿编程"');
    assert.strictEqual(testCard(q, c4), false, 'c4 has "深度" but not "学习"');
    console.log('✓ PASS: 复合条件 (A B | C D -#E)');
}

// 10. 测试中文全角标点兼容（“”、｜、＃、＠、－）
{
    const q = parseSearchQuery('猫 ｜ ＃“宠物 猫” －＠“无良商家”');
    const c1 = makeCard('可爱小猫咪', '正常商家', '日常生活');
    const c2 = makeCard('宠物集锦', '正常商家', '宠物 猫');
    const c3 = makeCard('宠物集锦', '无良商家', '宠物 猫');
    assert.strictEqual(testCard(q, c1), true, 'c1 matches branch 1 (猫)');
    assert.strictEqual(testCard(q, c2), true, 'c2 matches branch 2 (＃“宠物 猫”)');
    assert.strictEqual(testCard(q, c3), false, 'c3 has excluded UP －＠“无良商家”');
    console.log('✓ PASS: 中文全角标点容错兼容');
}

// 11. 测试发给 B 站接口的搜索词脱壳（智能脱壳与负向规则移除）
function getCleanApiKeyword(rawParam) {
    if (!rawParam) return '';
    const parsedQuery = parseSearchQuery(rawParam);
    if (!parsedQuery.hasRules) return '';

    const positiveTerms = [];
    for (const branch of parsedQuery.branches) {
        for (const cond of branch) {
            if (cond.val) {
                positiveTerms.push(cond.val);
            }
        }
    }
    return toSimplified(positiveTerms.join(' '));
}

{
    assert.strictEqual(getCleanApiKeyword('猫 | 狗'), '猫 狗');
    assert.strictEqual(getCleanApiKeyword('#"deepseek v3" -#广告'), 'deepseek v3');
    assert.strictEqual(getCleanApiKeyword('@"老番茄" | @"影视飓风"'), '老番茄 影视飓风');
    assert.strictEqual(getCleanApiKeyword('-#广告 -@营销号'), '');
    console.log('✓ PASS: API 搜索词脱壳与负向规则剥离');
}

console.log('\nAll 11 unit test suites PASSED with 100% precision!');

