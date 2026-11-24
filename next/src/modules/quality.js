import { state, clearPurifiedMarks } from '../core/state.js';
import { formatStat, formatDuration, parseDurationMinutes, parseStatText } from '../core/text.js';

export const QUALITY_FILTER_OPTIONS = [
  {
    key: 'all',
    label: '全部',
    isAll: true,
    criteria: '不限制品质分类，展示当前搜索词下的全部有效视频',
  },
  {
    key: 'q-hall-of-fame',
    label: '🏆 殿堂神作',
    criteria:
      '时长 ≥ 90秒，且播放 ≥ 2万，赞播比*权重 ≥ 7%，藏播比*权重 ≥ 3.5%，赞 ≥ 1500，藏 ≥ 800\n【特点】长篇深度精作，双率断层爆棚，三连拉满的顶峰神作',
  },
  {
    key: 'q-hardcore',
    label: '💡 硬核干货',
    criteria:
      '时长 ≥ 90秒，且 ((播放 ≥ 5000 且 藏播比*权重 ≥ 4%，藏 ≥ 250) 或 (藏 ≥ 2000 且 藏播比*权重 ≥ 2.5%))\n【特点】收藏转化极高，深度实用干货与知识合集',
  },
  {
    key: 'q-high-reputation',
    label: '⭐ 高口碑佳作',
    criteria:
      '(播放 ≥ 5000 且 赞播比*权重 ≥ 7%，赞 ≥ 400) 或 (赞 ≥ 5000 且 赞播比*权重 ≥ 4.5%)\n【特点】观众清一色好评点赞，高认可度优质佳作（时长加权）',
  },
  {
    key: 'q-balanced-masterpiece',
    label: '🏅 综合标杆',
    criteria:
      '播放 ≥ 1万 且 赞播比*权重 ≥ 4.5%，藏播比*权重 ≥ 2.2%，赞 ≥ 600，藏 ≥ 300\n【特点】赞藏双优全面扎实，六边形无短板水准（时长加权）',
  },
  {
    key: 'q-hidden-gem',
    label: '💎 冷门宝藏',
    criteria:
      '播放 < 2万，赞 ≥ 200，藏 ≥ 80，且 (赞播比*权重 ≥ 8% 或 藏播比*权重 ≥ 4.5%)\n【特点】中小样本下的极高纯度遗珠，小众高分佳作（时长加权）',
  },
  {
    key: 'q-routine',
    label: '🍀 稳健良作',
    criteria:
      '播放 ≥ 3000，且未触碰避坑线 (赞播比≥1.2%或藏播比≥0.5%)，各项数据平稳均衡\n【特点】品质可靠健康，内容扎实的中流砥柱良品',
  },
  {
    key: 'q-opinion-storm',
    label: '💥 话题焦点',
    criteria:
      '弹幕密集 (密度≥15条/分且弹幕≥300，或弹幕≥3000且密度≥8) 且 评赞比 ≥ 10%\n【特点】弹幕刷屏与评论热议齐飞，全网热议/深度探讨',
  },
  {
    key: 'q-heated-debate',
    label: '💬 激辩热议',
    criteria:
      '评赞比 ≥ 10% 且 评论绝对量大 (评≥300且评播比≥0.35% 或 评≥1500且评播比≥0.2%)\n【特点】长篇评论密集对线，观点激烈深度碰撞',
  },
  {
    key: 'q-danmaku-carnival',
    label: '🔥 弹幕密集',
    criteria:
      '弹幕密度 ≥ 15条/分 且 弹幕 ≥ 300，或 弹幕总量 ≥ 3000 且密度 ≥ 8条/分\n【特点】弹幕高频如潮，高能互动、笑点或名场面聚集',
  },
  {
    key: 'q-viral-short',
    label: '⚡ 爆款短片',
    criteria:
      '时长 < 90秒，且 (播放 ≥ 2万 且 赞 ≥ 1500，赞播比 ≥ 6% 或 藏播比 ≥ 3%) 或 (播放 ≥ 1万 且 赞播比 ≥ 8%)\n【特点】高能快节奏短片，完播互动极高，爆款短视频精选',
  },
];

export const QUALITY_CATEGORY_KEYS = [
  'q-hall-of-fame',
  'q-hardcore',
  'q-high-reputation',
  'q-balanced-masterpiece',
  'q-hidden-gem',
  'q-routine',
  'q-opinion-storm',
  'q-heated-debate',
  'q-danmaku-carnival',
  'q-viral-short',
];

const qualityHandlers = {
  filterDOMElements: () => {},
  checkWaterfallFillScreen: () => {},
};

export function setQualityHandlers(nextHandlers) {
  Object.assign(qualityHandlers, nextHandlers);
}

/**
 * 更新药丸按钮 active 高亮样式
 */
export function updateQualityFilterButtons(filterRow) {
  if (!filterRow) return;
  const btns = filterRow.querySelectorAll('.bili-cleaner-filter-pill-btn');
  const isAllSelected = state.activeQualityFilters.size === 0;

  btns.forEach((btn) => {
    const key = btn.dataset.key;
    if (key === 'all') {
      btn.classList.toggle('active', isAllSelected);
    } else {
      btn.classList.toggle('active', state.activeQualityFilters.has(key));
    }
  });
}

/**
 * 切换品质筛选状态（类文件夹式交互：默认单选，Ctrl多选，Shift范围连选）
 */
export function toggleQualityFilter(key, event) {
  const isCtrl = !!(event && (event.ctrlKey || event.metaKey));
  const isShift = !!(event && event.shiftKey);

  if (key === 'all') {
    state.activeQualityFilters.clear();
    state.lastQualityAnchorKey = null;
  } else if (QUALITY_CATEGORY_KEYS.includes(key)) {
    if (isShift) {
      let anchorKey = state.lastQualityAnchorKey;
      if (!anchorKey || !QUALITY_CATEGORY_KEYS.includes(anchorKey)) {
        const firstSelected = QUALITY_CATEGORY_KEYS.find((k) => state.activeQualityFilters.has(k));
        anchorKey = firstSelected || QUALITY_CATEGORY_KEYS[0];
      }
      const startIdx = QUALITY_CATEGORY_KEYS.indexOf(anchorKey);
      const targetIdx = QUALITY_CATEGORY_KEYS.indexOf(key);
      const minIdx = Math.min(startIdx, targetIdx);
      const maxIdx = Math.max(startIdx, targetIdx);

      if (!isCtrl) {
        QUALITY_CATEGORY_KEYS.forEach((k) => state.activeQualityFilters.delete(k));
      }
      for (let i = minIdx; i <= maxIdx; i++) {
        state.activeQualityFilters.add(QUALITY_CATEGORY_KEYS[i]);
      }
      if (!state.lastQualityAnchorKey) state.lastQualityAnchorKey = anchorKey;
    } else if (isCtrl) {
      if (state.activeQualityFilters.has(key)) {
        state.activeQualityFilters.delete(key);
      } else {
        state.activeQualityFilters.add(key);
      }
      state.lastQualityAnchorKey = key;
    } else {
      QUALITY_CATEGORY_KEYS.forEach((k) => state.activeQualityFilters.delete(k));
      state.activeQualityFilters.add(key);
      state.lastQualityAnchorKey = key;
    }
  }

  try {
    localStorage.setItem('bili_cleaner_active_quality_filters', JSON.stringify([...state.activeQualityFilters]));
  } catch {}

  document.querySelectorAll('.bili-cleaner-quality-filter-row').forEach(updateQualityFilterButtons);

  clearPurifiedMarks();
  qualityHandlers.filterDOMElements();

  if (state.isWaterfall) {
    qualityHandlers.checkWaterfallFillScreen();
  }
}

/**
 * 挂载/更新品质药丸筛选行（嵌入 .more-conditions）
 */
export function injectQualityFilterRow(container) {
  if (!container || !container.isConnected) return;
  if (!state.isEvaluationBadge) {
    const oldRow = container.querySelector('.bili-cleaner-quality-filter-row');
    if (oldRow) oldRow.remove();
    return;
  }

  let filterRow = container.querySelector(':scope > .bili-cleaner-quality-filter-row');
  if (!filterRow) {
    filterRow = document.createElement('div');
    filterRow.className = 'search-condition-row bili-cleaner-quality-filter-row';
    container.appendChild(filterRow);
  }

  if (!filterRow.dataset.rendered) {
    filterRow.dataset.rendered = 'true';
    filterRow.innerHTML = `
      <div class="bili-cleaner-filter-label" title="点击单选，支持按住 Ctrl 多选、按住 Shift 范围连选">🏷️ 视频品质:</div>
      <div class="bili-cleaner-filter-pills-box"></div>
    `;
    const box = filterRow.querySelector('.bili-cleaner-filter-pills-box');
    QUALITY_FILTER_OPTIONS.forEach((opt) => {
      const btn = document.createElement('div');
      btn.className = 'bili-cleaner-filter-pill-btn';
      if (opt.isAll) btn.classList.add('pill-all');
      btn.dataset.key = opt.key;
      btn.textContent = opt.label;
      if (opt.criteria) {
        const actionTip = opt.isAll
          ? '点击重置为全部'
          : '点击单选 | 按住 Ctrl 点击多选 | 按住 Shift 点击范围连选';
        btn.title = `【${opt.label}】筛选标准：\n${opt.criteria}\n────────────────────\n💡 ${actionTip}`;
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleQualityFilter(opt.key, e);
      });
      box.appendChild(btn);
    });
  }

  updateQualityFilterButtons(filterRow);
}

/**
 * 从 DOM 卡片节点回退提取播放量、弹幕与时长
 */
export function extractStatFromCard(card) {
  let play = 0;
  let danmaku = 0;
  let duration = '';
  const statItems = card.querySelectorAll('.bili-video-card__stats--item');
  if (statItems.length >= 1) {
    play = parseStatText(statItems[0].textContent);
  }
  if (statItems.length >= 2) {
    danmaku = parseStatText(statItems[1].textContent);
  }
  const durEl = card.querySelector('.bili-video-card__stats__duration');
  if (durEl) {
    duration = durEl.textContent.trim();
  }
  return { play, like: 0, favorites: 0, danmaku, duration, review: 0, isPartial: true };
}

/**
 * 纯视频品质象限判定函数（返回命中象限对象）
 */
export function getQualityQuadrant(stat) {
  if (!stat) return null;
  if (stat.isPartial) return null;

  const play = stat?.play || 0;
  const like = stat?.like || 0;
  const favorites = stat?.favorites || 0;
  const danmaku = stat?.danmaku || 0;
  const review = stat?.review || 0;
  const durationMinutes = parseDurationMinutes(stat?.duration);

  const likeRatio = play > 0 ? like / play : 0;
  const favRatio = play > 0 ? favorites / play : 0;
  const reviewRatio = play > 0 ? review / play : 0;
  const reviewLikeRatio = like > 0 ? review / like : review > 0 ? 1 : 0;
  const danmakuDensity = durationMinutes > 0 ? danmaku / durationMinutes : 0;

  const durFactor =
    durationMinutes > 0 ? Math.min(2.0, Math.max(0.4, Math.sqrt(durationMinutes / 5.0))) : 1.0;
  const normLikeRatio = likeRatio * durFactor;
  const normFavRatio = favRatio * durFactor;

  const isDanmakuHigh =
    (danmakuDensity >= 15 && danmaku >= 300) || (danmaku >= 3000 && danmakuDensity >= 8);
  const isReviewDebated =
    reviewLikeRatio >= 0.1 &&
    ((review >= 300 && reviewRatio >= 0.0035) || (review >= 1500 && reviewRatio >= 0.002));

  if (play < 3000) {
    if (
      play >= 1000 &&
      (like >= 150 || favorites >= 80) &&
      (normLikeRatio >= 0.08 || normFavRatio >= 0.045)
    ) {
      return {
        className: 'q-hidden-gem',
        tag: '💎 冷门宝藏',
        desc: '小众高纯度佳品，播放虽少但互动扎实',
      };
    }
    return {
      className: 'q-low-sample',
      tag: '🌱 样本较少',
      desc: '数据样本量较少（播放量 < 3000），暂不作定性评级',
    };
  } else if (
    play >= 20000 &&
    like > 0 &&
    likeRatio < 0.012 &&
    favRatio < 0.005 &&
    (durationMinutes <= 15 || durationMinutes === 0)
  ) {
    return {
      className: 'q-warning',
      tag: '⚠️ 谨慎观看',
      desc: '高播放低评价，含金量较低谨慎点击',
    };
  } else if (
    durationMinutes >= 1.5 &&
    play >= 20000 &&
    normLikeRatio >= 0.07 &&
    normFavRatio >= 0.035 &&
    like >= 1500 &&
    favorites >= 800
  ) {
    return {
      className: 'q-hall-of-fame',
      tag: '🏆 殿堂神作',
      desc: '殿堂级神作，三连爆满无需犹豫',
    };
  } else if (
    durationMinutes > 0 &&
    durationMinutes < 1.5 &&
    ((play >= 20000 && like >= 1500 && (likeRatio >= 0.06 || favRatio >= 0.03)) ||
      (play >= 10000 && like >= 1000 && likeRatio >= 0.08))
  ) {
    return {
      className: 'q-viral-short',
      tag: '⚡ 爆款短片',
      desc: '高能快节奏短片，互动爆棚完播极高',
    };
  } else if (
    play < 20000 &&
    like >= 200 &&
    favorites >= 80 &&
    (normLikeRatio >= 0.08 || normFavRatio >= 0.045)
  ) {
    return {
      className: 'q-hidden-gem',
      tag: '💎 冷门宝藏',
      desc: '小众冷门宝藏，播放虽少但纯度极高',
    };
  } else if (
    durationMinutes >= 1.5 &&
    ((play >= 5000 && normFavRatio >= 0.04 && favorites >= 250) ||
      (favorites >= 2000 && normFavRatio >= 0.025))
  ) {
    return {
      className: 'q-hardcore',
      tag: '💡 硬核干货',
      desc: '顶级实用干货，建议立即收藏备用',
    };
  } else if (
    (play >= 5000 && normLikeRatio >= 0.07 && like >= 400) ||
    (like >= 5000 && normLikeRatio >= 0.045)
  ) {
    return {
      className: 'q-high-reputation',
      tag: '⭐ 高口碑佳作',
      desc: '观众清一色好评，极高品质无踩雷',
    };
  } else if (
    play >= 10000 &&
    normLikeRatio >= 0.045 &&
    normFavRatio >= 0.022 &&
    like >= 600 &&
    favorites >= 300
  ) {
    return {
      className: 'q-balanced-masterpiece',
      tag: '🏅 综合标杆',
      desc: '赞藏双优全面扎实，六边形无短板综合标杆',
    };
  } else if (isDanmakuHigh && isReviewDebated) {
    return {
      className: 'q-opinion-storm',
      tag: '💥 话题焦点',
      desc: '弹幕刷屏与评论热议齐飞，全网热议/深度探讨话题焦点',
    };
  } else if (isReviewDebated) {
    return {
      className: 'q-heated-debate',
      tag: '💬 激辩热议',
      desc: '评论区高密度交锋对线，观点碰撞引发深度热议',
    };
  } else if (isDanmakuHigh) {
    return {
      className: 'q-danmaku-carnival',
      tag: '🔥 弹幕密集',
      desc: '弹幕密集高频，高能互动、乐子或热议焦点',
    };
  }

  return {
    className: 'q-routine',
    tag: '🍀 稳健良作',
    desc: '各项数据均衡扎实，品质稳健可靠',
  };
}

/**
 * 在视频封面 .v-img.bili-video-card__cover 内挂载/更新评价勋章列
 */
export function renderBadgeColumn(coverEl, stat) {
  if (!coverEl) return;
  if (!state.isEvaluationBadge) {
    const existing = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
    if (existing) existing.remove();
    return;
  }

  const quadrant = getQualityQuadrant(stat);
  if (!quadrant) {
    const existing = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
    if (existing) existing.remove();
    return;
  }

  const play = stat?.play || 0;
  const like = stat?.like || 0;
  const favorites = stat?.favorites || 0;
  const danmaku = stat?.danmaku || 0;
  const review = stat?.review || 0;
  const durationMinutes = parseDurationMinutes(stat?.duration);
  const durFactor =
    durationMinutes > 0 ? Math.min(2.0, Math.max(0.4, Math.sqrt(durationMinutes / 5.0))) : 1.0;

  const likeRatio = play > 0 ? like / play : 0;
  const favRatio = play > 0 ? favorites / play : 0;
  const reviewRatio = play > 0 ? review / play : 0;
  const danmakuDensity = durationMinutes > 0 ? danmaku / durationMinutes : 0;

  if (!state.isEvalFullMode && (quadrant.className === 'q-routine' || quadrant.className === 'q-low-sample')) {
    const existing = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
    if (existing) existing.remove();
    return;
  }

  let badgeCol = coverEl.querySelector(':scope > .bili-cleaner-badge-col');
  if (!badgeCol) {
    badgeCol = document.createElement('div');
    badgeCol.className = 'bili-cleaner-badge-col';
    coverEl.appendChild(badgeCol);
  }

  const tipLines = [`【${quadrant.tag}】${quadrant.desc}`, '────────────────────'];
  if (like > 0) {
    tipLines.push(`👍 赞播比: ${(likeRatio * 100).toFixed(1)}% (${formatStat(like)})`);
  }
  if (favorites > 0) {
    tipLines.push(`⭐ 藏播比: ${(favRatio * 100).toFixed(1)}% (${formatStat(favorites)})`);
  }
  if (play > 0) {
    tipLines.push(`▶️ 播放量: ${formatStat(play)}`);
  }
  if (danmaku > 0) {
    const densityText = durationMinutes > 0 ? ` (${danmakuDensity.toFixed(1)}条/分)` : '';
    tipLines.push(`💬 弹幕数: ${formatStat(danmaku)}${densityText}`);
  }
  if (review > 0) {
    tipLines.push(`📝 评论数: ${formatStat(review)} (评播比 ${(reviewRatio * 100).toFixed(2)}%)`);
  }
  if (stat?.duration) {
    const factorText =
      durationMinutes > 0 && Math.abs(durFactor - 1.0) >= 0.05
        ? ` (时长权重 ${durFactor.toFixed(2)}x)`
        : '';
    tipLines.push(`⏱️ 视频时长: ${formatDuration(stat.duration)}${factorText}`);
  }

  const tip = tipLines.join('\n');

  const pill = badgeCol.querySelector('.bili-cleaner-badge-pill');
  if (pill && pill.classList.contains(quadrant.className)) {
    if (pill.title !== tip) pill.title = tip;
    return;
  }

  badgeCol.innerHTML = `
    <div class="bili-cleaner-badge-pill ${quadrant.className}" title="${tip}">
      <span class="bili-cleaner-badge-tag">${quadrant.tag}</span>
    </div>
  `;
}
