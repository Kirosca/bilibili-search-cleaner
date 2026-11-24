import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'Bilibili 去掉搜索无关视频',
        namespace: 'http://tampermonkey.net/',
        version: '3.0.0',
        description:
          '自动隐藏 Bilibili 搜索结果中不包含关键词的无关视频，支持 @UP主 定向筛选、-排除词 与 #Tag 专项筛选，内置 WBI 签名协议栈与无缝瀑布流，彻底净化搜索体验。（支持简繁归一化）',
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
