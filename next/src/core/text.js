/* global OpenCC */

let sConverter = null;
let fallbackScriptInjected = false;

/**
 * 将文本由繁体中文转换为简体中文（由 @require 驱动，失败时动态加载保底脚本）
 */
export function toSimplified(text, onFallbackLoaded) {
  if (!text) return '';
  try {
    const opencc = typeof OpenCC !== 'undefined' ? OpenCC : typeof window !== 'undefined' ? window.OpenCC : null;
    if (opencc && typeof opencc.Converter === 'function') {
      if (!sConverter) {
        sConverter = opencc.Converter({ from: 't', to: 'cn' });
      }
      return sConverter(text);
    } else if (!fallbackScriptInjected && typeof document !== 'undefined') {
      fallbackScriptInjected = true;
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/umd/t2cn.js';
      script.onload = () => {
        if (typeof onFallbackLoaded === 'function') onFallbackLoaded();
      };
      (document.head || document.documentElement).appendChild(script);
    }
  } catch {}
  return text;
}

/**
 * 通用文本清洗：繁简归一化、HTML 实体反转义与标点规范化
 */
export function cleanText(str, onFallbackLoaded) {
  if (!str) return '';
  const simplified = toSimplified(str, onFallbackLoaded);
  return simplified
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\u2018\u2019\u201A\u201B\uFF07`]/g, "'")
    .trim()
    .toLowerCase();
}

/**
 * 格式化播放量与弹幕数统计数字（支持万/亿转换）
 */
export function formatStat(n) {
  if (!n && n !== 0) return '';
  if (typeof n === 'string' && (n.includes('万') || n.includes('亿'))) return n;
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return String(num);
}

/**
 * 格式化视频时长（对齐 mm:ss 或 hh:mm:ss 格式规范）
 */
export function formatDuration(val) {
  if (!val && val !== 0) return '';
  const str = String(val).trim();
  if (!str) return '';

  if (/^\d+$/.test(str)) {
    const totalSeconds = parseInt(str, 10);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
  }

  if (str.includes(':')) {
    const parts = str.split(':').map((p) => parseInt(p.trim(), 10) || 0);
    if (parts.length === 2) {
      const [totalM, s] = parts;
      if (totalM >= 60) {
        const h = Math.floor(totalM / 60);
        const m = totalM % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
      return `${String(totalM).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else if (parts.length >= 3) {
      const [h, m, s] = parts;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  }

  return str;
}

/**
 * 解析时间时长为分钟浮点数（用于计算弹幕密度与时长权重）
 */
export function parseDurationMinutes(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return val > 0 ? val / 60 : 0;
  const parts = String(val).trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  const num = parseFloat(val);
  return !isNaN(num) && num > 0 ? num / 60 : 0;
}

/**
 * 从 DOM 节点文本解析数值（支持万/亿/k/w 缩写，如 '62.3万' -> 623000）
 */
export function parseStatText(text) {
  if (!text) return 0;
  const clean = String(text).replace(/[^\d.万亿wWkK]/g, '').trim();
  if (!clean) return 0;
  if (clean.includes('万') || clean.toLowerCase().endsWith('w')) {
    return parseFloat(clean) * 10000;
  }
  if (clean.includes('亿')) {
    return parseFloat(clean) * 100000000;
  }
  if (clean.toLowerCase().endsWith('k')) {
    return parseFloat(clean) * 1000;
  }
  return parseFloat(clean) || 0;
}
