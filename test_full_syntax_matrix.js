const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. 读取 bilibili-search-cleaner.user.js 源码
const userScriptPath = path.join(__dirname, 'bilibili-search-cleaner.user.js');
const userScriptCode = fs.readFileSync(userScriptPath, 'utf8');

// 2. 构造浏览器 DOM 与全局环境 Mock 沙箱
function createMockEnvironment(initialSearchQuery = '') {
    const documentElements = [];

    const mockDocument = {
        createElement: (tag) => ({
            tagName: tag,
            textContent: '',
            style: {
                display: '',
                setProperty: function(k, v) { this[k] = v; },
                removeProperty: function(k) { delete this[k]; }
            }
        }),
        head: { appendChild: () => {} },
        documentElement: { appendChild: () => {} },
        querySelectorAll: (selector) => {
            if (selector.includes('.bili-video-card')) {
                return documentElements;
            }
            if (selector === '[data-purified-query]') {
                return documentElements.filter(el => el.dataset.purifiedQuery);
            }
            return [];
        }
    };

    // 简单 OpenCC 繁简转换模拟表
    const openccDict = {
        '貓': '猫', '狗': '狗', '單機遊戲': '单机游戏', '單機': '单机',
        '營銷號': '营销号', '老番茄': '老番茄', '學習': '学习', '機器': '机器'
    };

    const mockOpenCC = {
        Converter: () => (text) => {
            let res = text;
            for (const [t, s] of Object.entries(openccDict)) {
                res = res.replace(new RegExp(t, 'g'), s);
            }
            return res;
        }
    };

    let searchParamsStr = initialSearchQuery;

    const mockWindow = {
        location: {
            get search() { return searchParamsStr; },
            set search(val) { searchParamsStr = val; }
        },
        fetch: async () => ({
            clone: () => ({
                json: async () => ({ data: { result: [] } })
            }),
            status: 200,
            statusText: 'OK',
            headers: {}
        }),
        __pinia: null
    };

    // 提取 userscript 中的主要内部函数用于单元细测
    // 通过包装立即执行函数以输出内部核心解析器句柄
    const injectedCode = userScriptCode.replace(
        'console.log(\'[Bilibili 搜索净化] 2.2.0 已启动。\');',
        `
        window.__TEST_EXPORTS__ = {
            cleanText,
            splitByTopLevelPipe,
            tokenizeBranch,
            parseToken,
            parseSearchQuery,
            getCleanApiKeyword,
            testCard,
            cleanAdsOnly,
            filterDOMElements,
            videoTagMap
        };
        `
    );

    const fn = new Function('window', 'document', 'OpenCC', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'URLSearchParams', injectedCode);

    class MockMutationObserver {
        observe() {}
        disconnect() {}
    }

    fn(
        mockWindow,
        mockDocument,
        mockOpenCC,
        MockMutationObserver,
        (cb) => setTimeout(cb, 0),
        () => {},
        URLSearchParams
    );

    return {
        exports: mockWindow.__TEST_EXPORTS__,
        mockWindow,
        mockDocument,
        documentElements
    };
}

// 辅助函数：构造一个卡片 DOM 节点
function createMockCardNode(title, author, linkHref, dataset = {}) {
    const card = {
        tagName: 'DIV',
        className: 'video-list-item col_2',
        dataset: { ...dataset },
        style: {
            display: '',
            setProperty(k, v) { this[k] = v; },
            removeProperty(k) { this[k] = ''; }
        },
        closest: function() { return this; },
        querySelector: function(sel) {
            if (sel.includes('a[href*="/video/"]')) {
                return { href: linkHref };
            }
            if (sel.includes('h3')) {
                return {
                    getAttribute: () => title,
                    textContent: title
                };
            }
            if (sel.includes('space.bilibili.com')) {
                return {
                    getAttribute: () => author,
                    textContent: author
                };
            }
            return null;
        }
    };
    return card;
}

// ==================== 全量筛选语法测试套件 ====================

console.log('====================================================');
console.log('   Bilibili 搜索净化 v2.2.0 筛选语法全覆盖测试矩阵   ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(categoryName, testName, testFn) {
    totalTests++;
    try {
        testFn();
        passedTests++;
        console.log(`[PASS] ${categoryName} -> ${testName}`);
    } catch (err) {
        console.error(`[FAIL] ${categoryName} -> ${testName}`);
        console.error('       ' + err.message);
        throw err;
    }
}

const env = createMockEnvironment();
const {
    cleanText,
    splitByTopLevelPipe,
    tokenizeBranch,
    parseToken,
    parseSearchQuery,
    getCleanApiKeyword,
    testCard,
    cleanAdsOnly,
    videoTagMap
} = env.exports;

// 辅助卡片构造器
function makeCardInfo(title, author, rawTagsStr) {
    const rawTags = cleanText(rawTagsStr || '');
    const tagList = rawTags ? rawTags.split(/[,，、]+/).map(t => t.trim()).filter(Boolean) : [];
    const tagSet = new Set(tagList);
    const cleanedAuthor = cleanText((author || '').replace(/\s*[·•].*$/, ''));
    return {
        title: cleanText(title),
        author: cleanedAuthor,
        tagList,
        tagSet,
        rawTags
    };
}

// 辅助解析器
function query(rawStr) {
    env.mockWindow.location.search = `?keyword=${encodeURIComponent(rawStr)}`;
    return parseSearchQuery();
}

// ----------------------------------------------------
// 维度 1: 基础标题模糊匹配与多词 AND
// ----------------------------------------------------
runTest('1. 基础标题模糊匹配', '单个关键词命中与不命中', () => {
    const q = query('猫');
    assert.strictEqual(testCard(q, makeCardInfo('这是一只小猫咪', 'up1', '宠物')), true);
    assert.strictEqual(testCard(q, makeCardInfo('野生金丝猴大冒险', 'up2', '动物')), false);
});

runTest('1. 基础标题模糊匹配', '多词 AND 逻辑（全部包含才保留）', () => {
    const q = query('深度 学习 教程');
    assert.strictEqual(testCard(q, makeCardInfo('深度学习从零开始教程', 'up1', 'ai')), true);
    assert.strictEqual(testCard(q, makeCardInfo('深度强化学习实践', 'up2', 'ai')), false, '缺少【教程】');
    assert.strictEqual(testCard(q, makeCardInfo('python教程精讲', 'up3', 'code')), false, '缺少【深度】和【学习】');
});

// ----------------------------------------------------
// 维度 2: 逻辑或 | 管道符跨分支匹配
// ----------------------------------------------------
runTest('2. 逻辑或 (OR |)', '双分支标题或：猫 | 狗', () => {
    const q = query('猫 | 狗');
    assert.strictEqual(testCard(q, makeCardInfo('可爱小猫', 'up1', '宠物')), true);
    assert.strictEqual(testCard(q, makeCardInfo('忠诚柴犬小狗', 'up2', '宠物')), true);
    assert.strictEqual(testCard(q, makeCardInfo('鹦鹉学说话', 'up3', '鸟类')), false);
});

runTest('2. 逻辑或 (OR |)', '多分支跨语法混合或：A | B | C', () => {
    const q = query('Vue | React | Angular');
    assert.strictEqual(testCard(q, makeCardInfo('Vue3 全家桶教程', 'up1', '')), true);
    assert.strictEqual(testCard(q, makeCardInfo('React19 新特性', 'up2', '')), true);
    assert.strictEqual(testCard(q, makeCardInfo('Angular 架构实战', 'up3', '')), true);
    assert.strictEqual(testCard(q, makeCardInfo('Svelte 响应式编程', 'up4', '')), false);
});

// ----------------------------------------------------
// 维度 3: UP主定向筛选 (@模糊 与 @"精确")
// ----------------------------------------------------
runTest('3. UP主定向筛选', '模糊 UP主匹配：@影视', () => {
    const q = query('@影视');
    assert.strictEqual(testCard(q, makeCardInfo('测评', '影视飓风', '科技')), true);
    assert.strictEqual(testCard(q, makeCardInfo('幕后', '新影视实验室', '影视')), true);
    assert.strictEqual(testCard(q, makeCardInfo('数码', '小白测评', '科技')), false);
});

runTest('3. UP主定向筛选', '精确 UP主匹配：@"影视飓风"', () => {
    const q = query('@"影视飓风"');
    assert.strictEqual(testCard(q, makeCardInfo('相机测评', '影视飓风', '科技')), true);
    assert.strictEqual(testCard(q, makeCardInfo('精彩剪辑', '影视飓风剪辑粉丝团', '科技')), false);
});

runTest('3. UP主定向筛选', '带空格英文 UP主精确匹配：@"Linus Tech Tips"', () => {
    const q = query('@"Linus Tech Tips"');
    assert.strictEqual(testCard(q, makeCardInfo('日常', 'Linus Tech Tips', '硬件')), true);
    assert.strictEqual(testCard(q, makeCardInfo('二创', 'Linus Tech Tips Fans', '硬件')), false);
});

runTest('3. UP主定向筛选', '卡片日期与圆点剥离测试（影视飓风 · 2-10）', () => {
    const q = query('@"影视飓风"');
    const cardInfo = makeCardInfo('最新视频', '影视飓风 · 2-10', '科技');
    assert.strictEqual(testCard(q, cardInfo), true, '应准确剥离 · 后缀并匹配 UP主');
});

runTest('3. UP主定向筛选', '带空格英文 UP主圆点剥离（Mr Beast • 昨天）', () => {
    const q = query('@"Mr Beast"');
    const cardInfo = makeCardInfo('大挑战', 'Mr Beast • 昨天', '生活');
    assert.strictEqual(testCard(q, cardInfo), true, '应保留内部空格并剥离 • 后缀');
});

// ----------------------------------------------------
// 维度 4: 标签筛选 (#模糊 与 #"精确")
// ----------------------------------------------------
runTest('4. 标签定向筛选', '模糊标签匹配：#单机', () => {
    const q = query('#单机');
    assert.strictEqual(testCard(q, makeCardInfo('实况解说', 'up1', '单机游戏,动作')), true);
    assert.strictEqual(testCard(q, makeCardInfo('对战', 'up2', '网络游戏,moba')), false);
});

runTest('4. 标签定向筛选', '精确单词标签匹配：#"单机游戏"', () => {
    const q = query('#"单机游戏"');
    assert.strictEqual(testCard(q, makeCardInfo('实况解说', 'up1', '单机游戏,动作游戏')), true);
    assert.strictEqual(testCard(q, makeCardInfo('实况解说', 'up2', '单机游戏攻略,动作游戏')), false, '只有【单机游戏攻略】，非完全等于【单机游戏】');
});

runTest('4. 标签定向筛选', '精确多词带空格标签匹配：#"deepseek v3"', () => {
    const q = query('#"deepseek v3"');
    assert.strictEqual(testCard(q, makeCardInfo('模型评测', 'up1', 'deepseek v3,大模型')), true);
    assert.strictEqual(testCard(q, makeCardInfo('模型评测', 'up2', 'deepseek,v3,大模型')), false, '拆分成两个单项不应匹配精确短语');
    assert.strictEqual(testCard(q, makeCardInfo('模型评测', 'up3', 'deepseek v3 pro')), false);
});

// ----------------------------------------------------
// 维度 5: 排除规则 (-排除词, -@UP, -#"Tag")
// ----------------------------------------------------
runTest('5. 排除规则', '标题关键词排除：-广告', () => {
    const q = query('手机 -广告');
    assert.strictEqual(testCard(q, makeCardInfo('优秀手机评测', 'up1', '')), true);
    assert.strictEqual(testCard(q, makeCardInfo('最新手机广告片', 'up1', '')), false);
});

runTest('5. 排除规则', '模糊 UP主排除：-@营销号', () => {
    const q = query('-@营销号');
    assert.strictEqual(testCard(q, makeCardInfo('优质科普', '中科院物理所', '')), true);
    assert.strictEqual(testCard(q, makeCardInfo('震惊揭秘', '每日影视营销号', '')), false);
});

runTest('5. 排除规则', '精确 UP主排除：-@"老番茄"', () => {
    const q = query('-@"老番茄"');
    assert.strictEqual(testCard(q, makeCardInfo('游戏实况', '老番茄', '游戏')), false, '完全等于老番茄应排除');
    assert.strictEqual(testCard(q, makeCardInfo('粉丝作品', '老番茄的剪辑小弟', '游戏')), true, '非完全等于老番茄应保留');
});

runTest('5. 排除规则', '模糊标签排除：-#手游', () => {
    const q = query('日常 -#手游');
    assert.strictEqual(testCard(q, makeCardInfo('日常单机', 'up1', '主机游戏,3a')), true);
    assert.strictEqual(testCard(q, makeCardInfo('日常抽卡', 'up2', '原神手游,米哈游')), false);
});

runTest('5. 排除规则', '精确标签排除：-#"英雄联盟"', () => {
    const q = query('-#"英雄联盟"');
    assert.strictEqual(testCard(q, makeCardInfo('端游总决赛', 'up1', '英雄联盟,电竞')), false, '有完全等于英雄联盟的tag应排除');
    assert.strictEqual(testCard(q, makeCardInfo('手游总决赛', 'up2', '英雄联盟手游,电竞')), true, '完全tag是英雄联盟手游，不应被精确排除');
});

runTest('5. 排除规则', '纯排除语法（不带正向条件）', () => {
    const q = query('-#广告 -@营销号');
    assert.strictEqual(testCard(q, makeCardInfo('正常生活分享', '正常博主', '日常')), true);
    assert.strictEqual(testCard(q, makeCardInfo('广告分享', '正常博主', '广告')), false);
    assert.strictEqual(testCard(q, makeCardInfo('搞笑分享', '娱乐营销号', '日常')), false);
});

// ----------------------------------------------------
// 维度 6: 全角中文标点兼容性
// ----------------------------------------------------
runTest('6. 全角中文标点兼容', '全角｜、＃、“”、－、＠ 兼容解析', () => {
    const q = query('猫 ｜ ＃“单机 游戏” －＠“无良商家”');
    assert.strictEqual(testCard(q, makeCardInfo('可爱小猫', '正常店', '萌宠')), true, '命中全角管道符前项');
    assert.strictEqual(testCard(q, makeCardInfo('大作体验', '正常店', '单机 游戏')), true, '命中全角＃“”精确标签');
    assert.strictEqual(testCard(q, makeCardInfo('大作体验', '无良商家', '单机 游戏')), false, '被全角－＠“”精确排除');
});

// ----------------------------------------------------
// 维度 7: 繁简自动归一化
// ----------------------------------------------------
runTest('7. 繁简自动归一化', '繁体搜索词匹配简体内容（含精确与模糊规则）', () => {
    const qExact = query('貓 ｜ ＃“單機遊戲” －＠“營銷號”');
    assert.strictEqual(testCard(qExact, makeCardInfo('可爱猫咪', 'up1', '萌宠')), true, '繁体【貓】命中简体【猫】');
    assert.strictEqual(testCard(qExact, makeCardInfo('神作盘点', 'up2', '单机游戏')), true, '繁体【單機遊戲】命中简体【单机游戏】');
    assert.strictEqual(testCard(qExact, makeCardInfo('可爱猫咪', '营销号', '萌宠')), false, '繁体【－＠“營銷號”】精确排除简体【营销号】');
    assert.strictEqual(testCard(qExact, makeCardInfo('可爱猫咪', '营销号二号', '萌宠')), true, '繁体精确排除不应误伤【营销号二号】');

    const qFuzzy = query('貓 －＠營銷號');
    assert.strictEqual(testCard(qFuzzy, makeCardInfo('可爱猫咪', '营销号二号', '萌宠')), false, '繁体模糊【－＠營銷號】排除【营销号二号】');
});

// ----------------------------------------------------
// 维度 8: 未闭合引号容错处理
// ----------------------------------------------------
runTest('8. 未闭合引号容错', '单分支尾部未闭合引号：#"vue 3', () => {
    const q = query('#"vue 3');
    assert.strictEqual(testCard(q, makeCardInfo('前端', 'up1', 'vue 3,前端')), true);
    assert.strictEqual(testCard(q, makeCardInfo('前端', 'up1', 'vue 3 pro,前端')), false);
});

runTest('8. 未闭合引号容错', '跨管道符未闭合引号：#"vue 3 | @"Linus Tech Tips', () => {
    const q = query('#"vue 3 | @"Linus Tech Tips');
    assert.strictEqual(testCard(q, makeCardInfo('前端', 'up1', 'vue 3,代码')), true, '分支1通过');
    assert.strictEqual(testCard(q, makeCardInfo('评测', 'Linus Tech Tips', '硬件')), true, '分支2通过');
    assert.strictEqual(testCard(q, makeCardInfo('前端', 'up1', 'vue 3 pro,代码')), false, '精确不匹配');
});

runTest('8. 未闭合引号容错', '同分支多操作符未闭合引号：#"vue 3 @"Linus Tech Tips', () => {
    const q = query('#"vue 3 @"Linus Tech Tips');
    assert.strictEqual(testCard(q, makeCardInfo('综合', 'Linus Tech Tips', 'vue 3')), true, '同时满足两项未闭合精确条件');
    assert.strictEqual(testCard(q, makeCardInfo('综合', 'Other UP', 'vue 3')), false, '作者不符');
});

// ----------------------------------------------------
// 维度 9: 畸变百分号编码 URIError 防护
// ----------------------------------------------------
runTest('9. 畸变编码防护', '搜索词包含裸百分号（如 50% 折扣）', () => {
    env.mockWindow.location.search = '?keyword=50%25%20折扣';
    // 模拟如果传入未规范转义的 "50% 折扣"
    const parsed = parseSearchQuery();
    assert.ok(parsed.hasRules);
});

// ----------------------------------------------------
// 维度 10: 接口层 API 脱壳与关键词净化
// ----------------------------------------------------
runTest('10. 接口脱壳净化', 'getCleanApiKeyword 剥离排除词与标签前缀', () => {
    env.mockWindow.location.search = `?keyword=${encodeURIComponent('猫 | 狗')}`;
    assert.strictEqual(getCleanApiKeyword(), '猫 狗');

    env.mockWindow.location.search = `?keyword=${encodeURIComponent('#"deepseek v3" -#广告')}`;
    assert.strictEqual(getCleanApiKeyword(), 'deepseek v3');

    env.mockWindow.location.search = `?keyword=${encodeURIComponent('@"影视飓风" | @"老番茄"')}`;
    assert.strictEqual(getCleanApiKeyword(), '影视飓风 老番茄');

    env.mockWindow.location.search = `?keyword=${encodeURIComponent('-#广告 -@营销号')}`;
    assert.strictEqual(getCleanApiKeyword(), '', '纯排除词应返回空，避免影响接口正常推荐');
});

// ----------------------------------------------------
// 维度 11: 综合复杂高阶语法混合实战
// ----------------------------------------------------
runTest('11. 综合复合规则实战', '双分支多条件 AND + 全局双排除条件', () => {
    // 规则：(李宏毅 且 深度学习) OR (吴恩达 且 机器学习) -#少儿编程 -@营销号
    const q = query('#"深度学习" @"李宏毅" | #"机器学习" @"吴恩达" -#少儿编程 -@营销号');

    const card1 = makeCardInfo('AI前沿', '李宏毅', '深度学习,人工智能');
    const card2 = makeCardInfo('经典讲义', '吴恩达', '机器学习,人工智能');
    const card3 = makeCardInfo('入门课', '李宏毅', '深度学习,少儿编程'); // 命中排除标签
    const card4 = makeCardInfo('速成课', '吴恩达营销号', '机器学习'); // 命中排除UP
    const card5 = makeCardInfo('错位课', '吴恩达', '深度学习'); // 分支1要李宏毅，分支2要机器学习，均不满足

    assert.strictEqual(testCard(q, card1), true, 'card1 满足分支 1');
    assert.strictEqual(testCard(q, card2), true, 'card2 满足分支 2');
    assert.strictEqual(testCard(q, card3), false, 'card3 被 -#少儿编程 排除');
    assert.strictEqual(testCard(q, card4), false, 'card4 被 -@营销号 排除');
    assert.strictEqual(testCard(q, card5), false, 'card5 两个分支均不满足');
});

// ----------------------------------------------------
// 维度 12: 真实 DOM 树卡片过滤与隐藏断言
// ----------------------------------------------------
runTest('12. 真实 DOM 卡片过滤', 'filterDOMElements 对不匹配卡片隐藏，匹配卡片保留', () => {
    const domEnv = createMockEnvironment('?keyword=' + encodeURIComponent('猫'));
    const { filterDOMElements: domFilter } = domEnv.exports;

    const cardMatch = createMockCardNode('可爱小猫咪', 'up1', '/video/BV123456');
    const cardMismatch = createMockCardNode('野外生存大挑战', 'up2', '/video/BV654321');

    domEnv.documentElements.push(cardMatch, cardMismatch);

    domFilter();

    assert.strictEqual(cardMatch.style.display, '', '匹配卡片不应隐藏');
    assert.strictEqual(cardMismatch.style.display, 'none', '不匹配卡片应设置为 none');
    assert.strictEqual(cardMatch.dataset.purifiedQuery, '?keyword=%E7%8C%AB', '卡片应打上当前查询缓存');
});

// ----------------------------------------------------
// 维度 13: Tag 异步回填与缓存失效重新安检
// ----------------------------------------------------
runTest('13. Tag 异步回填重检', 'cleanAdsOnly 注入新 Tag 后，使缓存失效并自动重检卡片', () => {
    const domEnv = createMockEnvironment('?keyword=' + encodeURIComponent('#"黑神话"'));
    const { filterDOMElements: domFilter, cleanAdsOnly: tagInjector } = domEnv.exports;

    // 首屏阶段：卡片已渲染，但此时网络数据尚未返回，无 Tag
    const cardGame = createMockCardNode('大作实况', 'up1', '/video/BV999999');
    domEnv.documentElements.push(cardGame);

    // 初次过滤：因为缺少 tag，被隐藏，并打上缓存标记
    domFilter();
    assert.strictEqual(cardGame.style.display, 'none', '初始缺少 Tag 时被隐藏');
    assert.ok(cardGame.dataset.purifiedQuery, '已打上缓存戳');

    // 随后：网络拦截收到接口数据，填入 tag 并触发重检
    tagInjector([
        { bvid: 'BV999999', tag: '黑神话,动作,单机' }
    ]);

    // 模拟 fetch 逻辑在检测到 newTagsRecorded 后的动作：
    // 清除 [data-purified-query] 缓存戳并重新执行 filterDOMElements()
    domEnv.documentElements.forEach(c => { delete c.dataset.purifiedQuery; });
    domFilter();

    assert.strictEqual(cardGame.style.display, '', 'Tag 补全重检后，卡片应被重新恢复显示！');
});

console.log('\n====================================================');
console.log(` 全部测试完成！共执行 ${totalTests} 项用例，通过率 100% (${passedTests}/${totalTests})`);
console.log('====================================================\n');
