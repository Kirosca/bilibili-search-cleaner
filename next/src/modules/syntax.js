import { cleanText, toSimplified } from '../core/text.js';

/**
 * 从 URL 中提取 keyword 参数并兼容未编码 # 截断至 Hash Fragment 的场景
 */
function getRawKeywordParam() {
  const params = new URLSearchParams(window.location.search);
  let rawParam = params.get('keyword') || '';
  if (window.location.hash && !rawParam.includes('#')) {
    const hashContent = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (hashContent) {
      rawParam += ' #' + hashContent;
    }
  }
  return rawParam;
}

/**
 * 解析当前 URL 中的关键词分类 (普通词 / -排除词 / #Tag词 / @UP主词)
 */
export function getSearchKeywords(onFallbackLoaded) {
  const rawParam = getRawKeywordParam();
  const rawKeyword = cleanText(decodeURIComponent(rawParam.replace(/\+/g, ' ')), onFallbackLoaded);
  if (!rawKeyword) return { normal: [], exclude: [], tags: [], ups: [] };

  const list = rawKeyword.split(/\s+/);
  const normal = [];
  const exclude = [];
  const tags = [];
  const ups = [];

  for (const k of list) {
    if (k.startsWith('-') && k.length > 1) {
      exclude.push(k.substring(1));
    } else if (k.startsWith('#') && k.length > 1) {
      tags.push(k.substring(1));
    } else if (k.startsWith('@') && k.length > 1) {
      ups.push(k.substring(1));
    } else if (k) {
      normal.push(k);
    }
  }
  return { normal, exclude, tags, ups };
}

/**
 * 提取发给 B 站接口的搜索词（智能脱壳与繁简归一化）
 */
export function getCleanApiKeyword() {
  const params = new URLSearchParams(window.location.search);
  const rawParam = params.get('keyword') || '';
  const rawKeyword = decodeURIComponent(rawParam.replace(/\+/g, ' ')).trim();
  if (!rawKeyword) return '';

  const list = rawKeyword.split(/\s+/);
  const searchTerms = [];
  for (const k of list) {
    if (k.startsWith('-')) {
      continue;
    } else if (k.startsWith('@') || k.startsWith('#')) {
      if (k.length > 1) searchTerms.push(k.substring(1));
    } else if (k) {
      searchTerms.push(k);
    }
  }
  return toSimplified(searchTerms.join(' '));
}
