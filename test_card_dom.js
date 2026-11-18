const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\Admin（无密码）\\Desktop\\Bilibili 去掉搜索无关视频1.user.js', 'utf-8');

// 1. Check template cloning & creation functions exist
if (!code.includes('function getNativeCardTemplate')) throw new Error('getNativeCardTemplate missing');
if (!code.includes('function createVideoCardFromTemplate')) throw new Error('createVideoCardFromTemplate missing');

// 2. Check requirement: non-matching videos are NOT appended in waterfall
if (!code.includes('const isMatch = checkVideoMatch(v.title || \'\', v.tag || \'\', v.author || \'\', filters);')) {
    throw new Error('checkVideoMatch missing in waterfall loop');
}
if (!/if\s*\(!isMatch\)\s*\{\s*continue;\s*\}/.test(code)) {
    throw new Error('if (!isMatch) continue missing');
}

// 3. Check requirement: toast tips removed from mode radio change
if (code.includes('showToast(modeTips[currentMode]')) {
    throw new Error('modeTips toast should be removed');
}

// 4. Check requirement: click page 1 pagination button
if (!code.includes('function clickPageOnePaginationButton')) {
    throw new Error('clickPageOnePaginationButton function missing');
}
if (!code.includes('clickPageOnePaginationButton()')) {
    throw new Error('clickPageOnePaginationButton call missing');
}
if (!code.includes('vui_pagenation--btn-num')) {
    throw new Error('vui_pagenation--btn-num selector missing');
}

console.log('All validations PASSED successfully!');
