// ==UserScript==
// @name         Bilibili 搜索筛选功能常驻
// @namespace    https://search.bilibili.com/
// @version      1.0.0
// @description  b站搜索筛选功能常驻
// @author       Kirosca
// @license      MIT
// @match        https://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    // 1 & 2: CSS 样式注入
    const css = `
        /* 1. 隐藏含有类 search-channel-item mt_sm ml_sm 的直接父级元素 */
        :has(> div.search-channel-item.mt_sm.ml_sm) {
            display: none !important;
        }

        /* 2. 隐藏指定的更多按钮 */
        button.vui_button.vui_button--active-shrink.i_button_more {
            display: none !important;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    // 3: JS 动态监听与状态强制维持
    function enforceConditions(element) {
        let changed = false;

        // 移除 ov_hidden 类
        if (element.classList.contains('ov_hidden')) {
            element.classList.remove('ov_hidden');
            changed = true;
        }

        // 移除 hide 类
        if (element.classList.contains('hide')) {
            element.classList.remove('hide');
            changed = true;
        }

        // 锁定行内 height 为 auto
        if (element.style.height !== 'auto') {
            element.style.setProperty('height', 'auto', 'important');
            changed = true;
        }

        return changed;
    }

    // 监听 DOM 树变化与属性修改
    const observer = new MutationObserver(() => {
        const targets = document.querySelectorAll('div.more-conditions');
        targets.forEach(enforceConditions);
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
    });

    // 页面初次加载校准
    window.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('div.more-conditions').forEach(enforceConditions);
    });
})();