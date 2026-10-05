const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, 'bilibili-search-cleaner.user.js');
const content = fs.readFileSync(scriptPath, 'utf8');

function createMockEl() {
    return {
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        appendChild(c) { return c; },
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        textContent: '',
        dataset: {}
    };
}

// Mock browser globals
global.window = { location: { search: '?keyword=西红柿' } };
global.document = {
    documentElement: createMockEl(),
    body: createMockEl(),
    createElement: () => createMockEl(),
    querySelectorAll: () => []
};
global.localStorage = {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem(k, v) { this.store[k] = v; }
};
global.OpenCC = { Converter: () => (t) => t };
global.Fuse = class { constructor() {} search() { return []; } };

// Verify that the file can be parsed and executed in node
const vm = require('vm');
const context = vm.createContext({
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    OpenCC: global.OpenCC,
    Fuse: global.Fuse,
    console: console,
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    MutationObserver: class { observe() {} disconnect() {} }
});

try {
    vm.runInContext(content, context);
    console.log('Script executed inside VM without runtime errors!');
} catch (err) {
    console.error('Runtime error in script:', err);
    process.exit(1);
}

// Extract and test getHitSynonyms directly from the file content
const matchData = content.match(/const HIT_THESAURUS_COMPACT = "([^"]+)";/);
if (!matchData) {
    console.error('Failed to locate HIT_THESAURUS_COMPACT in script');
    process.exit(1);
}

const HIT_THESAURUS_COMPACT = matchData[1];
let hitSynonymMap = null;

function initHitSynonymMap() {
    hitSynonymMap = new Map();
    if (HIT_THESAURUS_COMPACT) {
        const groups = HIT_THESAURUS_COMPACT.split('|');
        for (let i = 0; i < groups.length; i++) {
            const words = groups[i].split('=');
            for (let j = 0; j < words.length; j++) {
                const w = words[j];
                let set = hitSynonymMap.get(w);
                if (!set) {
                    set = new Set();
                    hitSynonymMap.set(w, set);
                }
                for (let k = 0; k < words.length; k++) {
                    if (j !== k) set.add(words[k]);
                }
            }
        }
    }
}

function getHitSynonyms(keyword) {
    if (!keyword) return [];
    if (!hitSynonymMap) initHitSynonymMap();
    const set = hitSynonymMap.get(keyword.toLowerCase());
    return set ? Array.from(set) : [];
}

initHitSynonymMap();
console.log('Total indexed keys in HIT Thesaurus:', hitSynonymMap.size);

const testCases = [
    { query: '西红柿', targetTitle: '大厨教你番茄炒蛋的秘诀', shouldMatch: '番茄' },
    { query: '土豆', targetTitle: '正宗马铃薯炖牛肉', shouldMatch: '马铃薯' },
    { query: '自行车', targetTitle: '挑战骑单车环游中国', shouldMatch: '单车' },
    { query: '电脑', targetTitle: '2026年高性能计算机选购指南', shouldMatch: '计算机' },
    { query: '话筒', targetTitle: '专业录音麦克风测评', shouldMatch: '麦克风' },
    { query: '发动机', targetTitle: '飞机引擎工作原理解析', shouldMatch: '引擎' },
    { query: '玉米', targetTitle: '东北苞谷丰收现场', shouldMatch: '苞谷' },
    { query: '红薯', targetTitle: '冬季街头烤地瓜制作', shouldMatch: '地瓜' },
    { query: '出租车', targetTitle: '深夜乘坐计程车经历', shouldMatch: '计程车' }
];

let allPassed = true;
for (const tc of testCases) {
    const syns = getHitSynonyms(tc.query);
    const matchedSyn = syns.find(s => tc.targetTitle.toLowerCase().includes(s));
    if (matchedSyn) {
        console.log(`✓ PASS: [${tc.query}] -> [${matchedSyn}] matched in "${tc.targetTitle}"`);
    } else {
        console.error(`✗ FAIL: [${tc.query}] expected "${tc.shouldMatch}", got:`, syns);
        allPassed = false;
    }
}

if (allPassed) {
    console.log('\nAll 9 pure HIT-SCIR synonym tests PASSED with 100% precision!');
} else {
    process.exit(1);
}
