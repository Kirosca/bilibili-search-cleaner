'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const TARGET_FILE = process.argv[2] || 'bilibili-search-cleaner-v2.1.0.user机搓.js';
const SCRIPT_PATH = path.isAbsolute(TARGET_FILE) ? TARGET_FILE : path.join(__dirname, TARGET_FILE);
const RAW_SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');

function createClassList(el) {
    const set = new Set();
    return {
        _syncFromString(str) {
            set.clear();
            String(str || '').split(/\s+/).filter(Boolean).forEach(c => set.add(c));
        },
        _toString() {
            return Array.from(set).join(' ');
        },
        add(...cls) {
            cls.filter(Boolean).forEach(c => set.add(c));
        },
        remove(...cls) {
            cls.forEach(c => set.delete(c));
        },
        contains(c) {
            return set.has(c);
        },
        toggle(c, force) {
            if (force === undefined) {
                if (set.has(c)) { set.delete(c); return false; }
                set.add(c); return true;
            }
            if (force) { set.add(c); return true; }
            set.delete(c); return false;
        }
    };
}

function createMockElement(tagName = 'div', ownerDoc = null) {
    const classList = createClassList();
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    const el = {
        nodeType: 1,
        tagName: tagName.toUpperCase(),
        parentNode: null,
        parentElement: null,
        children,
        get childNodes() { return children; },
        get firstChild() { return children[0] || null; },
        get lastElementChild() { return children[children.length - 1] || null; },
        get nextSibling() {
            if (!this.parentNode) return null;
            const idx = this.parentNode.children.indexOf(this);
            return idx >= 0 ? (this.parentNode.children[idx + 1] || null) : null;
        },
        get previousElementSibling() {
            if (!this.parentNode) return null;
            const idx = this.parentNode.children.indexOf(this);
            return idx > 0 ? this.parentNode.children[idx - 1] : null;
        },
        dataset: {},
        classList,
        style: {
            _props: new Map(),
            setProperty(k, v) { this._props.set(k, String(v)); this[k] = String(v); },
            removeProperty(k) { this._props.delete(k); delete this[k]; },
            getPropertyValue(k) { return this._props.get(k) || ''; }
        },
        get id() { return attrs.get('id') || ''; },
        set id(v) { attrs.set('id', String(v)); },
        get className() { return classList._toString(); },
        set className(v) { classList._syncFromString(v); },
        get title() { return attrs.get('title') || ''; },
        set title(v) { attrs.set('title', String(v)); },
        get href() { return attrs.get('href') || ''; },
        set href(v) { attrs.set('href', String(v)); },
        get src() { return attrs.get('src') || ''; },
        set src(v) { attrs.set('src', String(v)); },
        get alt() { return attrs.get('alt') || ''; },
        set alt(v) { attrs.set('alt', String(v)); },
        get attributes() {
            return Array.from(attrs.entries()).map(([name, value]) => ({ name, value }));
        },
        setAttribute(k, v) {
            const key = String(k);
            if (key === 'class') classList._syncFromString(v);
            else if (key.startsWith('data-')) {
                const camel = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                this.dataset[camel] = String(v);
            }
            attrs.set(key, String(v));
        },
        getAttribute(k) {
            const key = String(k);
            if (key === 'class') return this.className || null;
            return attrs.has(key) ? attrs.get(key) : null;
        },
        hasAttribute(k) {
            return attrs.has(String(k));
        },
        removeAttribute(k) {
            const key = String(k);
            if (key === 'style') {
                this.style._props.clear();
                delete this.style.display;
            }
            attrs.delete(key);
        },
        _textContent: '',
        get textContent() {
            if (children.length === 0) return this._textContent;
            return this._textContent + children.map(c => c.textContent).join('');
        },
        set textContent(v) {
            children.length = 0;
            this._textContent = String(v ?? '');
        },
        _innerHTML: '',
        get innerHTML() {
            if (children.length === 0) return this._innerHTML || this._textContent;
            return children.map(c => {
                if (c.nodeType === 3) return c.textContent;
                const cls = c.className ? ` class="${c.className}"` : '';
                const attrsStr = c.attributes
                    .filter(a => a.name !== 'class')
                    .map(a => ` ${a.name}="${a.value}"`)
                    .join('');
                return `<${c.tagName.toLowerCase()}${cls}${attrsStr}>${c.innerHTML}</${c.tagName.toLowerCase()}>`;
            }).join('');
        },
        set innerHTML(html) {
            children.length = 0;
            this._textContent = '';
            this._innerHTML = String(html ?? '');
            parseHtmlIntoChildren(this._innerHTML, this, ownerDoc);
        },
        appendChild(child) {
            if (!child) return child;
            if (child.nodeType === 11) {
                const list = [...child.children];
                list.forEach(c => this.appendChild(c));
                child.children.length = 0;
                return child;
            }
            if (child.parentNode && child.parentNode !== this) {
                const idx = child.parentNode.children.indexOf(child);
                if (idx >= 0) child.parentNode.children.splice(idx, 1);
            }
            if (!children.includes(child)) children.push(child);
            child.parentNode = this;
            child.parentElement = this;
            return child;
        },
        insertBefore(newNode, refNode) {
            if (!refNode) return this.appendChild(newNode);
            const idx = children.indexOf(refNode);
            if (idx === -1) return this.appendChild(newNode);
            if (newNode.parentNode) {
                const oldIdx = newNode.parentNode.children.indexOf(newNode);
                if (oldIdx >= 0) newNode.parentNode.children.splice(oldIdx, 1);
            }
            children.splice(idx, 0, newNode);
            newNode.parentNode = this;
            newNode.parentElement = this;
            return newNode;
        },
        remove() {
            if (this.parentNode) {
                const idx = this.parentNode.children.indexOf(this);
                if (idx >= 0) this.parentNode.children.splice(idx, 1);
                this.parentNode = null;
                this.parentElement = null;
            }
        },
        replaceWith(other) {
            if (this.parentNode) {
                const idx = this.parentNode.children.indexOf(this);
                if (idx >= 0) {
                    this.parentNode.children.splice(idx, 1, other);
                    other.parentNode = this.parentNode;
                    other.parentElement = this.parentElement;
                    this.parentNode = null;
                    this.parentElement = null;
                }
            }
        },
        cloneNode(deep = false) {
            const clone = createMockElement(this.tagName, ownerDoc);
            clone.className = this.className;
            attrs.forEach((v, k) => clone.setAttribute(k, v));
            Object.assign(clone.dataset, this.dataset);
            this.style._props.forEach((v, k) => clone.style.setProperty(k, v));
            clone._textContent = this._textContent;
            clone._innerHTML = this._innerHTML;
            if (deep) {
                children.forEach(ch => clone.appendChild(ch.cloneNode(true)));
            }
            return clone;
        },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const arr = listeners.get(type);
            if (!arr) return;
            const idx = arr.indexOf(fn);
            if (idx >= 0) arr.splice(idx, 1);
        },
        dispatchEvent(evt) {
            const event = { target: this, currentTarget: this, stopPropagation() {}, preventDefault() {}, ...evt };
            (listeners.get(evt.type) || []).slice().forEach(fn => fn.call(this, event));
        },
        click() {
            this.dispatchEvent({ type: 'click' });
        },
        focus() {},
        get isConnected() {
            let cur = this;
            while (cur) {
                if (cur === ownerDoc?.documentElement) return true;
                cur = cur.parentNode;
            }
            return false;
        },
        offsetWidth: 200,
        offsetHeight: 240,
        offsetTop: 0,
        clientWidth: 1000,
        getBoundingClientRect() {
            return { top: 0, bottom: 240, left: 0, right: 200, width: 200, height: 240 };
        },
        matches(selector) {
            return selector.split(',').some(part => matchSingleSelector(this, part.trim()));
        },
        closest(selector) {
            let cur = this;
            while (cur && cur.nodeType === 1) {
                if (cur.matches(selector)) return cur;
                cur = cur.parentNode;
            }
            return null;
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const results = [];
            const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
            const isScope = parts.some(p => p.startsWith(':scope >'));
            if (isScope) {
                const subSel = parts.map(p => p.replace(/^:scope\s*>\s*/, '')).join(', ');
                for (const child of children) {
                    if (child.nodeType === 1 && child.matches(subSel)) results.push(child);
                }
                return results;
            }
            function walk(node) {
                for (const ch of node.children) {
                    if (ch.nodeType !== 1) continue;
                    if (ch.matches(selector)) results.push(ch);
                    walk(ch);
                }
            }
            walk(this);
            return results;
        }
    };
    return el;
}

function matchSingleSelector(el, sel) {
    if (!sel || !el || el.nodeType !== 1) return false;
    // Handle :not(:has(...)) and :has(...)
    let base = sel;
    const notHasMatch = base.match(/:not\(:has\(([^)]+)\)\)/);
    if (notHasMatch) {
        if (el.querySelector(notHasMatch[1])) return false;
        base = base.replace(notHasMatch[0], '');
    }
    const hasMatch = base.match(/:has\(([^)]+)\)/);
    if (hasMatch) {
        if (!el.querySelector(hasMatch[1])) return false;
        base = base.replace(hasMatch[0], '');
    }
    const tokens = base.trim().split(/\s+/);
    if (tokens.length > 1) {
        const last = tokens[tokens.length - 1];
        if (!matchSimpleToken(el, last)) return false;
        let cur = el.parentNode;
        let ti = tokens.length - 2;
        if (tokens[ti] === '>') ti--;
        while (cur && cur.nodeType === 1 && ti >= 0) {
            if (matchSimpleToken(cur, tokens[ti])) {
                ti--;
                if (ti >= 0 && tokens[ti] === '>') ti--;
            }
            cur = cur.parentNode;
        }
        return ti < 0;
    }
    return matchSimpleToken(el, base);
}

function matchSimpleToken(el, token) {
    if (!token) return true;
    let rest = token;
    const tagMatch = rest.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch) {
        if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
        rest = rest.slice(tagMatch[0].length);
    }
    const attrMatches = [...rest.matchAll(/\[([a-zA-Z0-9_-]+)(?:([*^]?=)"([^"]*)")?\]/g)];
    for (const m of attrMatches) {
        rest = rest.replace(m[0], '');
        const attrName = m[1];
        const op = m[2];
        const expected = m[3];
        const val = el.getAttribute(attrName) ?? (attrName.startsWith('data-') ? el.dataset[attrName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : undefined);
        if (val === null || val === undefined) return false;
        if (op === '*=' && !String(val).includes(expected)) return false;
        if (op === '^=' && !String(val).startsWith(expected)) return false;
        if (op === '=' && String(val) !== expected) return false;
    }
    const idMatches = [...rest.matchAll(/#([a-zA-Z0-9_-]+)/g)];
    for (const m of idMatches) {
        if (el.id !== m[1]) return false;
    }
    const clsMatches = [...rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
    for (const m of clsMatches) {
        if (!el.classList.contains(m[1])) return false;
    }
    return true;
}

function parseHtmlIntoChildren(html, parent, ownerDoc) {
    // Minimal deterministic HTML parser for test fixtures and template innerHTML
    const stack = [parent];
    const tokenRe = /(<\/?[a-zA-Z0-9_-]+(?:\s+[^>]*)?>)|([^<]+)/g;
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
        const curParent = stack[stack.length - 1];
        if (m[2]) {
            const txt = m[2];
            if (curParent === parent && txt.trim() === '') continue;
            curParent.children.push({
                nodeType: 3,
                textContent: txt,
                parentNode: curParent,
                cloneNode() {
                    return { nodeType: 3, textContent: this.textContent, parentNode: null, cloneNode: this.cloneNode };
                }
            });
            continue;
        }
        const tagToken = m[1];
        if (tagToken.startsWith('</')) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        const selfClose = tagToken.endsWith('/>') || /^<(img|br|hr|input|source)\b/i.test(tagToken);
        const nameMatch = tagToken.match(/^<([a-zA-Z0-9_-]+)/);
        const tag = nameMatch ? nameMatch[1] : 'div';
        const node = createMockElement(tag, ownerDoc);
        const attrRe = /([a-zA-Z0-9_:-]+)(?:="([^"]*)")?/g;
        const attrPart = tagToken.slice(tag.length + 1, selfClose ? -2 : -1);
        let am;
        while ((am = attrRe.exec(attrPart)) !== null) {
            node.setAttribute(am[1], am[2] !== undefined ? am[2] : '');
        }
        curParent.appendChild(node);
        if (!selfClose) stack.push(node);
    }
}

function createTestEnv(options = {}) {
    const storageData = new Map(Object.entries(options.storage || {}));
    const localStorage = {
        getItem(k) { return storageData.has(k) ? storageData.get(k) : null; },
        setItem(k, v) { storageData.set(k, String(v)); },
        removeItem(k) { storageData.delete(k); },
        clear() { storageData.clear(); }
    };

    const mockDoc = {
        readyState: options.readyState || 'complete',
        documentElement: null,
        head: null,
        body: null,
        activeElement: null,
        _listeners: new Map(),
        createElement(tag) { return createMockElement(tag, mockDoc); },
        createTextNode(txt) {
            return {
                nodeType: 3,
                textContent: String(txt ?? ''),
                parentNode: null,
                cloneNode() { return mockDoc.createTextNode(this.textContent); }
            };
        },
        createDocumentFragment() {
            const frag = { nodeType: 11, children: [], appendChild(c) { this.children.push(c); return c; } };
            return frag;
        },
        getElementById(id) {
            return mockDoc.documentElement.querySelector(`#${id}`);
        },
        querySelector(sel) {
            return mockDoc.documentElement.querySelector(sel);
        },
        querySelectorAll(sel) {
            return mockDoc.documentElement.querySelectorAll(sel);
        },
        addEventListener(type, fn) {
            if (!this._listeners.has(type)) this._listeners.set(type, []);
            this._listeners.get(type).push(fn);
        }
    };
    mockDoc.documentElement = createMockElement('html', mockDoc);
    mockDoc.head = createMockElement('head', mockDoc);
    mockDoc.body = createMockElement('body', mockDoc);
    mockDoc.documentElement.appendChild(mockDoc.head);
    mockDoc.documentElement.appendChild(mockDoc.body);

    const openccDict = {
        '貓': '猫', '狗': '狗', '教程': '教程', '繁體': '繁体', '影視': '影视',
        '單機': '单机', '遊戲': '游戏', '廣告': '广告', '營銷號': '营销号'
    };
    const mockOpenCC = {
        Converter: () => (text) => {
            let out = String(text);
            for (const [t, s] of Object.entries(openccDict)) {
                out = out.split(t).join(s);
            }
            return out;
        }
    };

    const locationObj = {
        href: options.href || 'https://search.bilibili.com/all?keyword=python',
        pathname: options.pathname || '/all',
        search: options.search !== undefined ? options.search : '?keyword=python',
        hash: options.hash || '',
        origin: 'https://search.bilibili.com',
        reload() { locationObj._reloaded = true; },
        replace(u) { locationObj._replaced = u; }
    };

    const fetchCalls = [];
    const originFetch = options.fetchImpl || (async (url, init) => {
        fetchCalls.push({ url: typeof url === 'string' ? url : url.url, init, req: url });
        if (String(typeof url === 'string' ? url : url.url).includes('/x/web-interface/nav')) {
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: {},
                clone() { return this; },
                async json() {
                    return {
                        code: 0,
                        data: {
                            wbi_img: {
                                img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                                sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
                            }
                        }
                    };
                }
            };
        }
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: {},
            clone() { return this; },
            async json() { return { code: 0, data: { result: [] } }; }
        };
    });

    class MockXHR {
        constructor() {
            this._listeners = {};
            this.responseType = '';
            this.responseText = '';
            this.response = null;
        }
        open(method, url) {
            this._openedMethod = method;
            this._openedUrl = url;
        }
        send() {
            if (options.xhrResponder) {
                options.xhrResponder(this);
            }
            (this._listeners.load || []).forEach(fn => fn.call(this));
        }
        addEventListener(type, fn) {
            if (!this._listeners[type]) this._listeners[type] = [];
            this._listeners[type].push(fn);
        }
    }
    MockXHR.DONE = 4;

    const menuItems = [];
    let nextMenuId = 1;
    const windowObj = {
        location: locationObj,
        fetch: originFetch,
        XMLHttpRequest: MockXHR,
        history: {
            pushState(_s, _t, u) { if (u) locationObj.href = u; },
            replaceState(_s, _t, u) { if (u) locationObj.href = u; }
        },
        innerHeight: 900,
        scrollTo() {},
        addEventListener() {},
        __pinia: options.__pinia || null,
        __INITIAL_STATE__: options.__INITIAL_STATE__ || null,
        OpenCC: options.noGlobalOpenCC ? undefined : mockOpenCC
    };
    windowObj.self = windowObj;
    windowObj.top = windowObj;

    class MockMutationObserver {
        observe() {}
        disconnect() {}
    }
    class MockIntersectionObserver {
        observe() {}
        disconnect() {}
    }
    class MockRequest {
        constructor(url, init = {}) {
            this.url = url;
            this.method = init.method || 'GET';
            this.headers = init.headers || {};
        }
    }
    class MockResponse {
        constructor(body, init = {}) {
            this._body = body;
            this.status = init.status || 200;
            this.statusText = init.statusText || 'OK';
            this.headers = init.headers || {};
            this.ok = this.status >= 200 && this.status < 300;
        }
        clone() { return new MockResponse(this._body, this); }
        async json() { return JSON.parse(this._body); }
    }

    const injectedMarker = "console.log('[Bilibili 搜索净化] 3.0.0 已启动。');";
    assert(RAW_SCRIPT.includes(injectedMarker), 'Userscript entry marker missing');
    const instrumentedCode = RAW_SCRIPT.replace(
        injectedMarker,
        `
        window.__TEST__ = {
            getState: () => ({
                isDimmed, isFilterSticky, isWaterfall, isEvaluationBadge, isEvalFullMode, isSyntaxFilter,
                activeQualityFilters: Array.from(activeQualityFilters),
                isAllLoaded, currentRequestedPage, maxWaterfallPage, totalRequestedVideos,
                seenBvidMap, videoTagMap, videoStatMap, cachedWbiKeys
            }),
            setState: (patch) => {
                if ('isWaterfall' in patch) isWaterfall = patch.isWaterfall;
                if ('isWaterfallPaused' in patch) isWaterfallPaused = patch.isWaterfallPaused;
                if ('isAllLoaded' in patch) isAllLoaded = patch.isAllLoaded;
                if ('currentRequestedPage' in patch) currentRequestedPage = patch.currentRequestedPage;
                if ('maxWaterfallPage' in patch) maxWaterfallPage = patch.maxWaterfallPage;
                if ('isSyntaxFilter' in patch) isSyntaxFilter = patch.isSyntaxFilter;
                if ('isDimmed' in patch) isDimmed = patch.isDimmed;
                if ('isEvaluationBadge' in patch) isEvaluationBadge = patch.isEvaluationBadge;
                if ('isEvalFullMode' in patch) isEvalFullMode = patch.isEvalFullMode;
                if ('cachedCardTemplate' in patch) cachedCardTemplate = patch.cachedCardTemplate;
                if ('cachedWbiKeys' in patch) cachedWbiKeys = patch.cachedWbiKeys;
            },
            toSimplified, cleanText, getRawSearchKeyword, getSearchKeywords, getCleanApiKeyword,
            cleanAdsOnly, scanInitialState, filterDOMElements, isOnlyCleanerMutations,
            computeMd5, getMixinKey, getWbiKeys, signWbi,
            formatStat, formatDuration, parseDurationMinutes, parseStatText,
            computeQualityMetrics, computeHealthScore, formatTrackWeights, getQualityQuadrant,
            renderBadgeColumn, injectQualityFilterRow, toggleQualityFilter,
            getCardTemplate, createCardElement, appendCards, triggerLoadNextPage,
            resetWaterfallForNewSearch, refreshSeenBvidsFromDOM, getGridColumnCount,
            toggleSyntaxFilter, toggleDimmed, toggleEvaluationBadge, toggleEvalMode,
            registerMenu
        };
        `
    );

    const timers = [];
    const sandbox = {
        window: windowObj,
        unsafeWindow: windowObj,
        document: mockDoc,
        localStorage,
        OpenCC: options.noGlobalOpenCC ? undefined : mockOpenCC,
        MutationObserver: MockMutationObserver,
        IntersectionObserver: MockIntersectionObserver,
        Request: MockRequest,
        Response: MockResponse,
        AbortController,
        URL,
        URLSearchParams,
        TextEncoder,
        setTimeout: (fn, ms) => { const id = timers.push(fn); return id; },
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        requestAnimationFrame: (fn) => { fn(); return 1; },
        cancelAnimationFrame: () => {},
        getComputedStyle: () => ({ display: 'block' }),
        GM_registerMenuCommand: (label, cb) => {
            const id = nextMenuId++;
            menuItems.push({ id, label, cb });
            return id;
        },
        GM_unregisterMenuCommand: (id) => {
            const idx = menuItems.findIndex(m => m.id === id);
            if (idx >= 0) menuItems.splice(idx, 1);
        },
        console: { log() {}, error() {}, warn() {} }
    };

    vm.runInNewContext(instrumentedCode, sandbox, { filename: 'bilibili-search-cleaner.vm.js' });

    return {
        api: windowObj.__TEST__,
        window: windowObj,
        document: mockDoc,
        localStorage,
        location: locationObj,
        fetchCalls,
        menuItems,
        mockOpenCC,
        MockXHR
    };
}

let passed = 0;
function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => {
            passed++;
            console.log(`✓ PASS: ${name}`);
        })
        .catch(err => {
            console.error(`✗ FAIL: ${name}`);
            console.error(err);
            process.exitCode = 1;
        });
}

function buildVideoCardDOM(doc, { bvid, title, author, play = '10万', danmaku = '500', duration = '10:00', isLive = false }) {
    const col = doc.createElement('div');
    col.className = isLive ? 'col_3 bili-live-card' : 'col_3 video-list-item';

    const card = doc.createElement('div');
    card.className = isLive ? 'bili-live-card' : 'bili-video-card';
    card.setAttribute('data-bsb-bvid', bvid);

    const a = doc.createElement('a');
    a.href = isLive ? `https://live.bilibili.com/${bvid}` : `https://www.bilibili.com/video/${bvid}`;

    const cover = doc.createElement('picture');
    cover.className = 'v-img bili-video-card__cover';
    const img = doc.createElement('img');
    img.src = 'https://i0.hdslb.com/sample.jpg';
    cover.appendChild(img);
    a.appendChild(cover);

    const stats = doc.createElement('div');
    stats.className = 'bili-video-card__stats';
    const itemPlay = doc.createElement('span');
    itemPlay.className = 'bili-video-card__stats--item';
    const playSpan = doc.createElement('span');
    playSpan.textContent = play;
    itemPlay.appendChild(playSpan);
    const itemDm = doc.createElement('span');
    itemDm.className = 'bili-video-card__stats--item';
    const dmSpan = doc.createElement('span');
    dmSpan.textContent = danmaku;
    itemDm.appendChild(dmSpan);
    const durSpan = doc.createElement('span');
    durSpan.className = 'bili-video-card__stats__duration';
    durSpan.textContent = duration;
    stats.appendChild(itemPlay);
    stats.appendChild(itemDm);
    stats.appendChild(durSpan);

    const h3 = doc.createElement('h3');
    h3.className = isLive ? 'bili-live-card__info--tit' : 'bili-video-card__info--tit';
    h3.setAttribute('title', title);
    h3.textContent = title;

    const ownerA = doc.createElement('a');
    ownerA.href = 'https://space.bilibili.com/12345';
    ownerA.className = 'bili-video-card__info--owner';
    const authorSpan = doc.createElement('span');
    authorSpan.className = 'bili-video-card__info--author';
    authorSpan.textContent = author;
    const dateSpan = doc.createElement('span');
    dateSpan.className = 'bili-video-card__info--date';
    dateSpan.textContent = ' · 10-01';
    ownerA.appendChild(authorSpan);
    ownerA.appendChild(dateSpan);

    card.appendChild(a);
    card.appendChild(stats);
    card.appendChild(h3);
    card.appendChild(ownerA);
    col.appendChild(card);
    return col;
}

(async function main() {
    await test('1. computeMd5 matches Node crypto across boundary lengths and UTF-8', () => {
        const env = createTestEnv();
        const inputs = [
            '', 'a', 'abc', 'message digest',
            'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65),
            'keyword=%E4%B8%AD%E6%96%87&page=2&wts=1700000000',
            '繁體中文测试🔥emoji'
        ];
        for (const s of inputs) {
            const actual = env.api.computeMd5(s);
            const expected = crypto.createHash('md5').update(s, 'utf8').digest('hex');
            assert.strictEqual(actual, expected, `MD5 mismatch for ${JSON.stringify(s)}`);
        }
    });

    await test('2. signWbi sorts params, filters special chars, and signs accurately', () => {
        const env = createTestEnv();
        const img_key = '7cd084941338484aae1ad9425b84077c';
        const sub_key = '4932caff0ff746eab6f01bf08b70ac45';
        const qs = env.api.signWbi({ b: "hello!'()*world", a: '123' }, img_key, sub_key);
        const params = new URLSearchParams(qs);
        assert.strictEqual(params.get('a'), '123');
        assert.strictEqual(params.get('b'), 'helloworld');
        assert.ok(params.get('wts'));
        assert.ok(/^[0-9a-f]{32}$/.test(params.get('w_rid')));
        const rawWithoutRid = qs.replace(/&w_rid=[^&]+$/, '');
        const expectedRid = crypto.createHash('md5')
            .update(rawWithoutRid + env.api.getMixinKey(img_key + sub_key), 'utf8')
            .digest('hex');
        assert.strictEqual(params.get('w_rid'), expectedRid);
    });

    await test('3. URL keyword parsing handles %, C++, C#, fullwidth prefixes, bare ops, and hash recovery', () => {
        const env = createTestEnv({ search: '?keyword=C%2B%2B%2050%25%20C%23%20%EF%BC%8D%E5%BB%A3%E5%91%8A%20%EF%BC%83%E6%95%99%E7%A8%8B%20%EF%BC%A0%E5%BD%B1%E8%A6%96%20-%20%23%20%40' });
        const kw = env.api.getSearchKeywords();
        assert.deepStrictEqual(Array.from(kw.normal), ['c++', '50%', 'c#']);
        assert.deepStrictEqual(Array.from(kw.exclude), ['广告']);
        assert.deepStrictEqual(Array.from(kw.tags), ['教程']);
        assert.deepStrictEqual(Array.from(kw.ups), ['影视']);
        assert.strictEqual(env.api.getCleanApiKeyword(), 'C++ 50% C# 教程 影视');

        // Solo unencoded #tag split into hash on F5 refresh
        env.location.search = '?keyword=';
        env.location.hash = '#教程';
        assert.strictEqual(env.api.getRawSearchKeyword(), '#教程');
        assert.deepStrictEqual(Array.from(env.api.getSearchKeywords().tags), ['教程']);
        assert.strictEqual(env.api.getCleanApiKeyword(), '教程');

        // Malformed % in hash does not throw URIError, and SPA route hash #/video is ignored
        env.location.search = '?keyword=python';
        env.location.hash = '#100%';
        assert.strictEqual(env.api.getRawSearchKeyword(), 'python #100%');
        env.location.hash = '#/video';
        assert.strictEqual(env.api.getRawSearchKeyword(), 'python');
    });

    await test('4. OpenCC fallback works via targetWindow.OpenCC when sandbox global is absent', () => {
        const env = createTestEnv({ noGlobalOpenCC: true });
        env.window.OpenCC = env.mockOpenCC;
        assert.strictEqual(env.api.toSimplified('繁體貓'), '繁体猫');
    });

    await test('5. Author extraction preserves spaces, handles multiline whitespace, and waits for hydration', () => {
        const env = createTestEnv({ search: '?keyword=@Tips' });
        const listWrap = env.document.createElement('div');
        listWrap.className = 'video i_wrapper search-all-list';
        const grid = env.document.createElement('div');
        grid.className = 'video-list row';
        listWrap.appendChild(grid);
        env.document.body.appendChild(listWrap);

        const card1 = buildVideoCardDOM(env.document, {
            bvid: 'BV1AAAA1111',
            title: 'GPU Review',
            author: '\n  Linus Tech Tips\n  · 2026-10-01\n'
        });
        const card2 = buildVideoCardDOM(env.document, {
            bvid: 'BV1BBBB2222',
            title: 'Other Video',
            author: 'Linus Media'
        });
        const cardUnHydrated = buildVideoCardDOM(env.document, {
            bvid: 'BV1CCCC3333',
            title: 'Pending Video',
            author: ''
        });
        // Clear the date span in unhydrated card so rawAuthor is truly empty
        cardUnHydrated.querySelector('.bili-video-card__info--owner').textContent = '';

        grid.appendChild(card1);
        grid.appendChild(card2);
        grid.appendChild(cardUnHydrated);

        env.api.cleanAdsOnly([
            { bvid: 'BV1AAAA1111', play: 10000, like: 500, favorites: 200, danmaku: 40, duration: '05:00' },
            { bvid: 'BV1BBBB2222', play: 10000, like: 500, favorites: 200, danmaku: 40, duration: '05:00' },
            { bvid: 'BV1CCCC3333', play: 10000, like: 500, favorites: 200, danmaku: 40, duration: '05:00' }
        ]);

        env.api.filterDOMElements();
        assert.strictEqual(card1.dataset.syntaxPass, '1', 'Multiline author with spaces should match @Tips');
        assert.ok(card1.dataset.purifiedQuery, 'Ready card with full stat and author gets cached');
        assert.strictEqual(card2.dataset.syntaxPass, '0', 'Different author should fail');
        assert.strictEqual(cardUnHydrated.dataset.purifiedQuery, undefined, 'Unhydrated empty author must not cache purifiedQuery');

        // Hydrate author and re-run
        cardUnHydrated.querySelector('.bili-video-card__info--owner').textContent = 'Linus Tech Tips · 今天';
        env.api.filterDOMElements();
        assert.strictEqual(cardUnHydrated.dataset.syntaxPass, '1');
        assert.ok(cardUnHydrated.dataset.purifiedQuery, 'Hydrated card caches purifiedQuery once author & stats are ready');
    });

    await test('6. Quality-only filtering works when keyword is empty & stale localStorage key is ignored', () => {
        const env = createTestEnv({
            search: '',
            storage: {
                bili_cleaner_active_quality_filters: JSON.stringify(['obsolete_invalid_key', 'q-hall-of-fame'])
            }
        });
        assert.deepStrictEqual(Array.from(env.api.getState().activeQualityFilters), ['q-hall-of-fame']);

        const listWrap = env.document.createElement('div');
        listWrap.className = 'video i_wrapper search-all-list';
        const grid = env.document.createElement('div');
        grid.className = 'video-list row';
        listWrap.appendChild(grid);
        env.document.body.appendChild(listWrap);

        env.api.cleanAdsOnly([
            { bvid: 'BV1GOD0001', play: 100000, like: 10000, favorites: 5000, danmaku: 1200, duration: '10:00', review: 300 },
            { bvid: 'BV1LOW0002', play: 500, like: 10, favorites: 2, danmaku: 1, duration: '03:00', review: 0 },
            { bvid: 'BV1LIVE003', roomid: 9999, type: 'live_room', play: 50000 }
        ]);

        const cardGod = buildVideoCardDOM(env.document, { bvid: 'BV1GOD0001', title: 'Masterpiece', author: 'UP1' });
        const cardLow = buildVideoCardDOM(env.document, { bvid: 'BV1LOW0002', title: 'Small sample', author: 'UP2' });
        const cardLive = buildVideoCardDOM(env.document, { bvid: 'BV1LIVE003', title: 'Live Room', author: 'UP3', isLive: true });
        grid.appendChild(cardGod);
        grid.appendChild(cardLow);
        grid.appendChild(cardLive);

        env.api.filterDOMElements();
        assert.strictEqual(cardGod.style.display || '', '', 'Hall of fame card remains visible');
        assert.strictEqual(cardGod.dataset.qualityClass, 'q-hall-of-fame');
        assert.strictEqual(cardLow.style.display, 'none', 'Non-matching quality card is hidden even with empty keyword');
        assert.strictEqual(cardLive.dataset.isLive, '1');
        assert.strictEqual(cardLive.querySelector('.bili-cleaner-badge-col'), null, 'Live card receives no video quality badge');
    });

    await test('7. Quality scoring, all 12 tiers, and NaN/negative math guards', () => {
        const env = createTestEnv();
        assert.strictEqual(env.api.parseDurationMinutes('invalid:xx'), 0);
        assert.strictEqual(env.api.parseDurationMinutes('403:22'), 403 + 22 / 60);
        assert.strictEqual(env.api.formatDuration('403:22'), '06:43:22');
        assert.strictEqual(env.api.parseStatText('万'), 0);
        assert.strictEqual(env.api.parseStatText('62.3万'), 623000);

        const q = (s) => env.api.getQualityQuadrant(s)?.className;
        assert.strictEqual(env.api.getQualityQuadrant({ play: 1000, isPartial: true }), null);
        assert.strictEqual(q({ play: 1000, like: 10, favorites: 1, danmaku: 0, review: 0, duration: '03:00' }), 'q-low-sample');
        assert.strictEqual(q({ play: 1500, like: 200, favorites: 80, danmaku: 10, review: 5, duration: '05:00' }), 'q-hidden-gem');
        assert.strictEqual(q({ play: 100000, like: 500, favorites: 100, danmaku: 20, review: 10, duration: '05:00' }), 'q-warning');
        assert.strictEqual(q({ play: 50000, like: 5000, favorites: 2500, danmaku: 400, review: 100, duration: '06:00' }), 'q-hall-of-fame');
        assert.strictEqual(q({ play: 40000, like: 3500, favorites: 500, danmaku: 100, review: 50, duration: '00:45' }), 'q-viral-short');
        assert.strictEqual(q({ play: 30000, like: 500, favorites: 1200, danmaku: 50, review: 20, duration: '10:00' }), 'q-hardcore');
        assert.strictEqual(q({ play: 25000, like: 2200, favorites: 200, danmaku: 50, review: 20, duration: '05:00' }), 'q-high-reputation');
        assert.strictEqual(q({ play: 20000, like: 1000, favorites: 500, danmaku: 80, review: 40, duration: '05:00' }), 'q-balanced-masterpiece');
        assert.strictEqual(q({ play: 50000, like: 1500, favorites: 300, danmaku: 500, review: 300, duration: '05:00' }), 'q-opinion-storm');
        assert.strictEqual(q({ play: 50000, like: 1500, favorites: 300, danmaku: 10, review: 400, duration: '05:00' }), 'q-heated-debate');
        assert.strictEqual(q({ play: 50000, like: 1500, favorites: 300, danmaku: 500, review: 20, duration: '05:00' }), 'q-danmaku-carnival');
        assert.strictEqual(q({ play: 10000, like: 300, favorites: 100, danmaku: 30, review: 10, duration: '05:00' }), 'q-routine');
    });

    await test('8. Card template cloning strips hidden styles and prevents XSS in titles/authors', () => {
        const env = createTestEnv({ search: '?keyword=test' });
        const listWrap = env.document.createElement('div');
        listWrap.className = 'video i_wrapper search-all-list';
        const grid = env.document.createElement('div');
        grid.className = 'video-list row';
        listWrap.appendChild(grid);
        env.document.body.appendChild(listWrap);

        // Make sample card previously hidden by quality filter & carrying stale dataset
        const sample = buildVideoCardDOM(env.document, { bvid: 'BV1SAMPLE0', title: 'Old', author: 'OldUP', duration: '99:99' });
        sample.style.setProperty('display', 'none', 'important');
        sample.dataset.purifiedQuery = 'stale';
        sample.dataset.qualityClass = 'q-routine';
        sample.dataset.syntaxPass = '0';
        grid.appendChild(sample);

        const tpl = env.api.getCardTemplate();
        assert.ok(tpl);
        assert.strictEqual(tpl.style.display, undefined, 'Cloned template must strip display:none');
        assert.strictEqual(tpl.dataset.purifiedQuery, undefined);
        assert.strictEqual(tpl.dataset.qualityClass, undefined);

        const card = env.api.createCardElement({
            bvid: 'BV1XSS999',
            title: 'Safe <em class="keyword">Term</em> &amp; <img src=x onerror=alert(1)> "Quote"',
            author: '<script>alert(2)</script>UP',
            mid: '42',
            pic: '',
            play: 12000,
            like: 1000,
            favorites: 400,
            danmaku: 100,
            duration: '',
            pubdate: 0
        });
        assert.strictEqual(card.querySelectorAll('img').length, 1, 'Only cover img allowed, injected <img> stripped');
        assert.strictEqual(card.querySelectorAll('script').length, 0, 'Injected <script> not parsed as element');
        assert.strictEqual(card.querySelectorAll('em.keyword').length, 1, 'Search highlight <em> preserved');
        assert.strictEqual(card.querySelector('img').src, '', 'Empty pic yields empty src instead of @672w...');
        assert.strictEqual(card.querySelector('.bili-video-card__stats__duration').textContent, '', 'Missing duration does not inherit sample 99:99');

        // Fallback card without template also escapes attributes/HTML safely
        env.api.setState({ cachedCardTemplate: null });
        grid.children.length = 0;
        const fallbackCard = env.api.createCardElement({
            bvid: 'BV1FALLBACK',
            title: 'Title "with" <script>x</script> <em class="keyword">Hit</em>',
            author: '<b>Bad</b>',
            mid: '77',
            pic: '',
            play: 5000,
            danmaku: 20,
            duration: '03:00'
        });
        assert.strictEqual(fallbackCard.querySelectorAll('script').length, 0);
        assert.strictEqual(fallbackCard.querySelectorAll('b').length, 0);
        assert.strictEqual(fallbackCard.querySelectorAll('em.keyword').length, 1);
        assert.strictEqual(fallbackCard.querySelector('img').src, '');
    });

    await test('9. Network fetch re-signs WBI keyword, XHR captures tags, and -352 risk code stays retryable', async () => {
        const env = createTestEnv({
            search: '?keyword=python%20-%E5%B9%BF%E5%91%8A%20%23%E6%95%99%E7%A8%8B',
            __INITIAL_STATE__: {
                wbi_img: {
                    img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                    sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
                }
            },
            xhrResponder(xhr) {
                xhr.responseType = 'json';
                xhr.response = {
                    code: 0,
                    data: {
                        result: [{ bvid: 'BV1XHR123', tag: '教程,Python', play: 20000, like: 2000, favorites: 900, danmaku: 200, duration: '08:00' }]
                    }
                };
            }
        });

        // 1) Fetch WBI rewrite test
        await env.window.fetch('https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=python%20-%E5%B9%BF%E5%91%8A%20%23%E6%95%99%E7%A8%8B&page=1&wts=1700000000&w_rid=deadbeef');
        assert.strictEqual(env.fetchCalls.length, 1);
        const sentUrl = new URL(env.fetchCalls[0].url);
        assert.strictEqual(sentUrl.searchParams.get('keyword'), 'python 教程');
        assert.notStrictEqual(sentUrl.searchParams.get('w_rid'), 'deadbeef', 'w_rid must be re-signed when keyword changes');

        // 2) XHR tag capture + case-insensitive lookup
        const xhr = new env.window.XMLHttpRequest();
        assert.ok(xhr instanceof env.MockXHR, 'XHR prototype preserved');
        xhr.open('GET', 'https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=python');
        xhr.send();
        assert.strictEqual(env.api.getState().videoTagMap.get('bv1xhr123'), '教程,python');

        // 3) Waterfall -352 risk code must NOT set isAllLoaded=true
        const envRisk = createTestEnv({
            search: '?keyword=',
            hash: '#教程',
            storage: { bili_cleaner_waterfall: 'true' },
            __INITIAL_STATE__: {
                wbi_img: {
                    img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                    sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
                }
            },
            fetchImpl: async (url, init) => {
                return {
                    ok: true,
                    status: 200,
                    async json() { return { code: -352, message: '风控校验' }; }
                };
            }
        });
        const listWrap = envRisk.document.createElement('div');
        listWrap.className = 'video i_wrapper search-all-list';
        const pager = envRisk.document.createElement('div');
        pager.className = 'vui_pagenation';
        const btn1 = envRisk.document.createElement('button');
        btn1.className = 'vui_pagenation--btn-num';
        btn1.textContent = '1';
        const btn5 = envRisk.document.createElement('button');
        btn5.className = 'vui_pagenation--btn-num';
        btn5.textContent = '5';
        pager.appendChild(btn1);
        pager.appendChild(btn5);
        envRisk.document.body.appendChild(listWrap);
        envRisk.document.body.appendChild(pager);

        envRisk.api.setState({ isWaterfall: true, isAllLoaded: false, currentRequestedPage: 1, maxWaterfallPage: 5 });
        await envRisk.api.triggerLoadNextPage();
        const st = envRisk.api.getState();
        assert.strictEqual(st.isAllLoaded, false, '-352 must not lock isAllLoaded=true');
        const retryBtn = envRisk.document.querySelector('.bili-waterfall-retry-btn');
        assert.ok(retryBtn && retryBtn.textContent.includes('-352'), 'Retry banner displays -352 risk code');
    });

    await test('10. Empty-array scanInitialState guard & resetWaterfallForNewSearch inactive guard', () => {
        const env = createTestEnv({
            search: '?keyword=test&page=3',
            href: 'https://search.bilibili.com/all?keyword=test&page=3',
            __pinia: {
                searchTypeResponse: { searchTypeResponse: { result: [] } }
            }
        });
        assert.strictEqual(env.api.scanInitialState(), false, 'Empty Pinia array should return false so polling continues');

        // resetWaterfallForNewSearch must not alter URL when isWaterfall is false
        env.api.setState({ isWaterfall: false });
        env.api.resetWaterfallForNewSearch(true);
        assert.ok(env.location.href.includes('page=3'), 'URL page=3 must remain untouched when waterfall is disabled');
    });

    await test('11. Quality pill selection (single, Ctrl multi-select, Shift range-select) and self-mutation filter', () => {
        const env = createTestEnv();
        env.api.toggleQualityFilter('q-hall-of-fame');
        assert.deepStrictEqual(Array.from(env.api.getState().activeQualityFilters), ['q-hall-of-fame']);

        // Shift range select from q-hall-of-fame to q-high-reputation
        env.api.toggleQualityFilter('q-high-reputation', { shiftKey: true });
        assert.deepStrictEqual(
            Array.from(env.api.getState().activeQualityFilters),
            ['q-hall-of-fame', 'q-hardcore', 'q-high-reputation']
        );

        // Ctrl toggle removes q-hardcore
        env.api.toggleQualityFilter('q-hardcore', { ctrlKey: true });
        assert.deepStrictEqual(
            Array.from(env.api.getState().activeQualityFilters),
            ['q-hall-of-fame', 'q-high-reputation']
        );

        // Self-mutation filter skips cleaner badge mutations and accepts new video cards
        const badgeCol = env.document.createElement('div');
        badgeCol.className = 'bili-cleaner-badge-col';
        const videoCard = env.document.createElement('div');
        videoCard.className = 'bili-video-card';
        assert.strictEqual(env.api.isOnlyCleanerMutations([{ target: badgeCol, addedNodes: [], removedNodes: [] }]), true);
        assert.strictEqual(env.api.isOnlyCleanerMutations([{ target: env.document.body, addedNodes: [badgeCol], removedNodes: [] }]), true);
        assert.strictEqual(env.api.isOnlyCleanerMutations([{ target: env.document.body, addedNodes: [videoCard], removedNodes: [] }]), false);
    });

    if (process.exitCode) {
        process.exit(process.exitCode);
    }
    console.log(`\nAll ${passed}/11 test suites on ${path.basename(SCRIPT_PATH)} PASSED!`);
})();
