const fs = require('fs');
const path = require('path');

const cilinPath = path.join(__dirname, 'cilin_temp.txt');
if (!fs.existsSync(cilinPath)) {
    console.error('cilin_temp.txt not found at', cilinPath);
    process.exit(1);
}

const content = fs.readFileSync(cilinPath, 'utf8');
const lines = content.split(/\r?\n/).filter(l => l && l[7] === '=');

const STOP_WORDS = new Set([
    '东西', '事情', '个人', '人员', '地方', '问题', '情况', '各个', '每人', '彼此',
    '我们', '你们', '他们', '大家', '大伙', '本人', '同志', '先生', '女士', '小姐',
    '家伙', '货色', '小子', '老头', '老汉', '老朽', '区区', '在下', '小子', '匹夫',
    '妾身', '民女', '卑职', '下官', '奴婢', '奴才', '吾侪', '吾辈', '斯人', '咱家',
    '千夫', '众生', '生人', '布衣', '白丁', '赤子', '群氓', '黔首', '庶人', '食指',
    '人丁', '口角', '是非', '崽子', '兔崽子', '狗崽子', '杂种', '畜生', '混蛋', '王八蛋',
    '它', '她', '其', '它们', '什么', '甚', '啥', '哪', '何', '啥子', '哪门子',
    '自己', '本身', '自身', '自我', '哪个', '哪位', '谁人', '谁个', '何人', '张三李四',
    '风中之烛', '枯木朽株', '朽木粪土', '白叟黄童', '半边天', '红装', '石女', '春姑娘',
    '贱人', '祸水', '娇客', '半子', '坦', '倩'
]);

// Categories B (物体/动植物/工具/机械/食品/电子/材料), D (科技/医疗/文体), H (活动/运动), I (状态/生理)
const validCats = new Set(['B', 'D', 'H', 'I']);

const groups = [];

for (const line of lines) {
    if (!validCats.has(line[0])) continue;

    const rawWords = line.slice(8).trim().split(/\s+/);
    // Keep words 2 to 5 chars, Chinese only
    const words = [...new Set(rawWords.filter(w => 
        w.length >= 2 && w.length <= 5 && 
        !STOP_WORDS.has(w) && 
        /^[\u4e00-\u9fa5]+$/.test(w)
    ))];
    if (words.length < 2 || words.length > 8) continue;

    // Filter out words that are purely substrings of other words in the same group
    const distinct = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (words.some(o => o !== w && !w.includes(o) && !o.includes(w))) {
            distinct.push(w);
        }
    }
    if (distinct.length >= 2) {
        groups.push(distinct);
    }
}

// Supplemental common modern synonym pairs
const EXTRA_MODERN_PAIRS = [
    ['西红柿', '番茄'],
    ['土豆', '马铃薯', '洋芋'],
    ['自行车', '单车', '脚踏车'],
    ['出租车', '计程车', '的士'],
    ['圆白菜', '包菜', '卷心菜', '甘蓝'],
    ['红薯', '地瓜', '山芋', '白薯'],
    ['玉米', '苞谷', '苞米', '棒子'],
    ['猕猴桃', '奇异果'],
    ['车厘子', '樱桃'],
    ['创可贴', '止血贴', '创口贴'],
    ['洗洁精', '洗涤灵', '洗洁净'],
    ['乒乓球', '桌球']
];

for (const extra of EXTRA_MODERN_PAIRS) {
    const exists = groups.some(g => extra.every(w => g.includes(w)));
    if (!exists) {
        groups.push(extra);
    }
}

// Dedup groups and normalize
const seen = new Set();
const finalGroups = [];
for (const g of groups) {
    const sorted = [...new Set(g)].sort();
    const key = sorted.join('=');
    if (!seen.has(key)) {
        seen.add(key);
        finalGroups.push(sorted);
    }
}

const compactData = finalGroups.map(g => g.join('=')).join('|');
console.log('Total extracted synonym groups:', finalGroups.length);
console.log('Compact data size (bytes):', Buffer.byteLength(compactData, 'utf8'));

fs.writeFileSync(path.join(__dirname, 'hit_thesaurus_compact.json'), JSON.stringify(compactData), 'utf8');
console.log('Successfully saved to hit_thesaurus_compact.json');
