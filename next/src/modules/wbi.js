import { state, targetWindow } from '../core/state.js';

/**
 * 内联轻量 MD5 实现（自研自包含，无外部依赖）
 */
export function computeMd5(string) {
  function rotL(val, bits) {
    return (val << bits) | (val >>> (32 - bits));
  }
  function addU(x, y) {
    const x8 = x & 0x80000000;
    const y8 = y & 0x80000000;
    const x4 = x & 0x40000000;
    const y4 = y & 0x40000000;
    const res = (x & 0x3fffffff) + (y & 0x3fffffff);
    if (x4 & y4) return res ^ 0x80000000 ^ x8 ^ y8;
    if (x4 | y4) {
      if (res & 0x40000000) return res ^ 0xc0000000 ^ x8 ^ y8;
      return res ^ 0x40000000 ^ x8 ^ y8;
    }
    return res ^ x8 ^ y8;
  }
  function F(x, y, z) {
    return (x & y) | (~x & z);
  }
  function G(x, y, z) {
    return (x & z) | (y & ~z);
  }
  function H(x, y, z) {
    return x ^ y ^ z;
  }
  function I(x, y, z) {
    return y ^ (x | ~z);
  }
  function FF(a, b, c, d, x, s, ac) {
    return addU(rotL(addU(addU(a, F(b, c, d)), addU(x, ac)), s), b);
  }
  function GG(a, b, c, d, x, s, ac) {
    return addU(rotL(addU(addU(a, G(b, c, d)), addU(x, ac)), s), b);
  }
  function HH(a, b, c, d, x, s, ac) {
    return addU(rotL(addU(addU(a, H(b, c, d)), addU(x, ac)), s), b);
  }
  function II(a, b, c, d, x, s, ac) {
    return addU(rotL(addU(addU(a, I(b, c, d)), addU(x, ac)), s), b);
  }

  const str = unescape(encodeURIComponent(string));
  const len = str.length;
  const words = Array((((len + 8 - ((len + 8) % 64)) / 64 + 1) * 16) - 1);
  for (let i = 0; i < len; i++) {
    const idx = (i - (i % 4)) / 4;
    words[idx] = words[idx] | (str.charCodeAt(i) << ((i % 4) * 8));
  }
  const endIdx = (len - (len % 4)) / 4;
  words[endIdx] = words[endIdx] | (0x80 << ((len % 4) * 8));
  words[words.length - 2] = len << 3;
  words[words.length - 1] = len >>> 29;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let k = 0; k < words.length; k += 16) {
    const AA = a;
    const BB = b;
    const CC = c;
    const DD = d;
    a = FF(a, b, c, d, words[k + 0], 7, 0xd76aa478);
    d = FF(d, a, b, c, words[k + 1], 12, 0xe8c7b756);
    c = FF(c, d, a, b, words[k + 2], 17, 0x242070db);
    b = FF(b, c, d, a, words[k + 3], 22, 0xc1bdceee);
    a = FF(a, b, c, d, words[k + 4], 7, 0xf57c0faf);
    d = FF(d, a, b, c, words[k + 5], 12, 0x4787c62a);
    c = FF(c, d, a, b, words[k + 6], 17, 0xa8304613);
    b = FF(b, c, d, a, words[k + 7], 22, 0xfd469501);
    a = FF(a, b, c, d, words[k + 8], 7, 0x698098d8);
    d = FF(d, a, b, c, words[k + 9], 12, 0x8b44f7af);
    c = FF(c, d, a, b, words[k + 10], 17, 0xffff5bb1);
    b = FF(b, c, d, a, words[k + 11], 22, 0x895cd7be);
    a = FF(a, b, c, d, words[k + 12], 7, 0x6b901122);
    d = FF(d, a, b, c, words[k + 13], 12, 0xfd987193);
    c = FF(c, d, a, b, words[k + 14], 17, 0xa679438e);
    b = FF(b, c, d, a, words[k + 15], 22, 0x49b40821);

    a = GG(a, b, c, d, words[k + 1], 5, 0xf61e2562);
    d = GG(d, a, b, c, words[k + 6], 9, 0xc040b340);
    c = GG(c, d, a, b, words[k + 11], 14, 0x265e5a51);
    b = GG(b, c, d, a, words[k + 0], 20, 0xe9b6c7aa);
    a = GG(a, b, c, d, words[k + 5], 5, 0xd62f105d);
    d = GG(d, a, b, c, words[k + 10], 9, 0x02441453);
    c = GG(c, d, a, b, words[k + 15], 14, 0xd8a1e681);
    b = GG(b, c, d, a, words[k + 4], 20, 0xe7d3fbc8);
    a = GG(a, b, c, d, words[k + 9], 5, 0x21e1cde6);
    d = GG(d, a, b, c, words[k + 14], 9, 0xc33707d6);
    c = GG(c, d, a, b, words[k + 3], 14, 0xf4d50d87);
    b = GG(b, c, d, a, words[k + 8], 20, 0x455a14ed);
    a = GG(a, b, c, d, words[k + 13], 5, 0xa9e3e905);
    d = GG(d, a, b, c, words[k + 2], 9, 0xfcefa3f8);
    c = GG(c, d, a, b, words[k + 7], 14, 0x676f02d9);
    b = GG(b, c, d, a, words[k + 12], 20, 0x8d2a4c8a);

    a = HH(a, b, c, d, words[k + 5], 4, 0xfffa3942);
    d = HH(d, a, b, c, words[k + 8], 11, 0x8771f681);
    c = HH(c, d, a, b, words[k + 11], 16, 0x6d9d6122);
    b = HH(b, c, d, a, words[k + 14], 23, 0xfde5380c);
    a = HH(a, b, c, d, words[k + 1], 4, 0xa4beea44);
    d = HH(d, a, b, c, words[k + 4], 11, 0x4bdecfa9);
    c = HH(c, d, a, b, words[k + 7], 16, 0xf6bb4b60);
    b = HH(b, c, d, a, words[k + 10], 23, 0xbebfbc70);
    a = HH(a, b, c, d, words[k + 13], 4, 0x289b7ec6);
    d = HH(d, a, b, c, words[k + 0], 11, 0xeaa127fa);
    c = HH(c, d, a, b, words[k + 3], 16, 0xd4ef3085);
    b = HH(b, c, d, a, words[k + 6], 23, 0x04881d05);
    a = HH(a, b, c, d, words[k + 9], 4, 0xd9d4d039);
    d = HH(d, a, b, c, words[k + 12], 11, 0xe6db99e5);
    c = HH(c, d, a, b, words[k + 15], 16, 0x1fa27cf8);
    b = HH(b, c, d, a, words[k + 2], 23, 0xc4ac5665);

    a = II(a, b, c, d, words[k + 0], 6, 0xf4292244);
    d = II(d, a, b, c, words[k + 7], 10, 0x432aff97);
    c = II(c, d, a, b, words[k + 14], 15, 0xab9423a7);
    b = II(b, c, d, a, words[k + 5], 21, 0xfc93a039);
    a = II(a, b, c, d, words[k + 12], 6, 0x655b59c3);
    d = II(d, a, b, c, words[k + 3], 10, 0x8f0ccc92);
    c = II(c, d, a, b, words[k + 10], 15, 0xffeff47d);
    b = II(b, c, d, a, words[k + 1], 21, 0x85845dd1);
    a = II(a, b, c, d, words[k + 8], 6, 0x6fa87e4f);
    d = II(d, a, b, c, words[k + 15], 10, 0xfe2ce6e0);
    c = II(c, d, a, b, words[k + 6], 15, 0xa3014314);
    b = II(b, c, d, a, words[k + 13], 21, 0x4e0811a1);
    a = II(a, b, c, d, words[k + 4], 6, 0xf7537e82);
    d = II(d, a, b, c, words[k + 11], 10, 0xbd3af235);
    c = II(c, d, a, b, words[k + 2], 15, 0x2ad7d2bb);
    b = II(b, c, d, a, words[k + 9], 21, 0xeb86d391);

    a = addU(a, AA);
    b = addU(b, BB);
    c = addU(c, CC);
    d = addU(d, DD);
  }

  function toHex(val) {
    let h = '';
    for (let m = 0; m <= 3; m++) {
      const byte = (val >>> (m * 8)) & 255;
      h += ('0' + byte.toString(16)).slice(-2);
    }
    return h;
  }
  return (toHex(a) + toHex(b) + toHex(c) + toHex(d)).toLowerCase();
}

const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

/**
 * 对编码密钥进行重排映射计算生成 Wbi mixin_key
 */
export function getMixinKey(orig) {
  let temp = '';
  mixinKeyEncTab.forEach((n) => {
    temp += orig[n] || '';
  });
  return temp.slice(0, 32);
}

/**
 * 获取 B 站当前会话的 Wbi 签名密钥（优先从首屏状态读取，次选接口请求）
 */
export async function getWbiKeys() {
  if (state.cachedWbiKeys) return state.cachedWbiKeys;
  try {
    const initState = targetWindow.__INITIAL_STATE__;
    if (initState?.wbi_img?.img_url && initState?.wbi_img?.sub_url) {
      const img_url = initState.wbi_img.img_url;
      const sub_url = initState.wbi_img.sub_url;
      const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
      const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
      state.cachedWbiKeys = { img_key, sub_key };
      return state.cachedWbiKeys;
    }
    const navRes = await targetWindow.fetch('https://api.bilibili.com/x/web-interface/nav');
    const navData = await navRes.json();
    if (navData?.data?.wbi_img) {
      const img_url = navData.data.wbi_img.img_url;
      const sub_url = navData.data.wbi_img.sub_url;
      const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
      const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));
      state.cachedWbiKeys = { img_key, sub_key };
      return state.cachedWbiKeys;
    }
  } catch {}
  return null;
}

/**
 * 对请求参数进行 Wbi 签名并生成带 wts 与 w_rid 的查询字符串
 */
export function signWbi(params, img_key, sub_key) {
  const mixin_key = getMixinKey(img_key + sub_key);
  const curr_time = Math.round(Date.now() / 1000);
  const chr_filter = /[!'()*]/g;
  const query = [];
  const signedObj = { ...params, wts: curr_time };
  Object.keys(signedObj)
    .sort()
    .forEach((k) => {
      const val = String(signedObj[k]).replace(chr_filter, '');
      query.push(`${encodeURIComponent(k)}=${encodeURIComponent(val)}`);
    });
  const query_str = query.join('&');
  const w_rid = computeMd5(query_str + mixin_key);
  return query_str + '&w_rid=' + w_rid;
}
