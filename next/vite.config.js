import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'Bilibili 去掉搜索无关视频（vite）',
        namespace: 'http://tampermonkey.net/',
        version: '3.0.0',
        description:
          '去掉搜索无关视频/12维视频品质分类/自动翻页：1.支持用【标题、-标题排除、#标签和@UP主】筛选视频 2.视频品质（神作/干货/宝藏/避坑等） 3.无缝瀑布流与筛选常驻（支持简繁）。',
        author: 'Kirosca',
        match: ['*://search.bilibili.com/*'],
        icon: 'https://www.bilibili.com/favicon.ico',
        require: ['https://cdn.jsdmirror.com/npm/opencc-js@1.4.2/dist/umd/t2cn.js'],
        'run-at': 'document-start',
        grant: ['GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'unsafeWindow'],
        license: 'MIT',
      },
      build: {
        fileName: 'bilibili-search-cleaner.user.js',
      },
    }),
  ],
});
