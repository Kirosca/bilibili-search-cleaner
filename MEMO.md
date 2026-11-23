# 筛选语法备忘与规范：【三连模式】全字段泛搜

记录时间：2026-11-17
所属项目：Bilibili 搜索净化与自动化脚本

---

## 一、 语法体系全览

| 语法前缀 | 范例 | 作用域与逻辑 | 属性定位 |
| :--- | :--- | :--- | :--- |
| **无前缀普通词** | `Docker` | 仅限定在 **视频标题** 中包含（`Title.includes(k)`） | 默认精准过滤 |
| **`*`（星号）** | `*Python` | **【三连模式】**：同时检索 **标题 OR 标签 OR UP主**，命中其一即保留 | 全字段并集泛搜 |
| **`@`** | `@影视飓风` | 仅限定在 **UP主名称** 中包含（`Author.includes(k)`） | 强约束精准定位 |
| **`#`** | `#装机教程` | 仅限定在 **视频Tag标签** 中包含（`Tags.includes(k)`） | 强约束精准定位 |
| **`-`（减号）** | `-营销号` | 强制剔除包含该词的视频（`!Title.includes(k)`） | 一票否决 |

---

## 二、 【三连模式】设计规范与约束

1. **确定性心智原则**：
   - 普通词 `A` 保持纯粹，永远只代表标题，绝不隐式混淆；
   - 跨字段三连搜索必须通过显式符号 `*A` 触发。

2. **复合语法逻辑计算**：
   - 多个关键词之间保持 **逻辑与（AND）**：
     - 例：`*Python #教程 @老王 -入门`
     - 判定公式：
       $$\text{Pass} = (\text{Title} \ni \text{Python} \lor \text{Tags} \ni \text{Python} \lor \text{UP} \ni \text{Python}) \land (\text{Tags} \ni \text{教程}) \land (\text{UP} \ni \text{老王}) \land (\text{Title} \not\ni \text{入门})$$

3. **输入法容错规范（全角/半角自动归一化）**：
   - 中文全角星号 `＊` 自动映射为半角 `*`；
   - 中文全角井号 `＃` 自动映射为半角 `#`；
   - 中文全角艾特 `＠` 自动映射为半角 `@`；
   - 中文全角横杠 `－` 自动映射为半角 `-`。

4. **时序降级处理（Graceful Degradation）**：
   - 视频 Tag 数据依赖接口网络拦截（`videoTagMap`）；若网络数据延迟未就绪，三连判定自动优雅退化为 `Title || UP` 判定，等待拦截就绪后自动补正，避免页面报错。

---

## 三、 展现方式双轨设计（堵不如疏 · 聚光灯聚焦）

为解决强行物理隐藏（`display: none`）造成的页面排版破碎、底部分页条断层与盲盒成瘾问题，引入“堵不如疏”的聚光灯架构：

1. **【聚光灯高亮模式】（默认推荐 · 视觉疏导）**：
   - **商业广告**：依然坚决物理抹杀（`display: none`）；
   - **符合规则的视频**：100% 原始色彩与清晰度，添加蓝金微光光晕与 `[🎯 目标匹配]` 精致角标；
   - **未匹配普通视频**：不隐藏（不使用 `display: none`），保持 `opacity: 0.16`（半透明）与 `grayscale(85%)`（去饱和灰度化），视觉上自动被大脑忽略；
   - **悬停临时查阅**：鼠标 Hover 悬停在未匹配卡片上时，瞬间恢复 100% 亮度和色彩，零误杀焦虑；
   - **排版神级收益**：原生网格与底部分页组件 100% 完好，每页满额 30 个卡片，彻底消灭空白死页与断层。

2. **【物理隐藏模式】（传统堵塞 · 彻底抹除）**：
   - 传统 `display: none`，将所有未匹配卡片彻底移出渲染树。

---

## 四、 翻页模式三档架构与防沉迷机制

为兼顾“强筛选后每页视频极少、手动频繁翻页繁琐”的痛点，同时杜绝用户陷入“无脑长刷与开盲盒成瘾”，提供明确的三档单选模式：

1. **【只显示前三页】（默认推荐 · 理性克制）**：
   - 自动跨页聚合第 1~3 页的有效视频呈现给用户；
   - 达到第 3 页上限后**硬性停止（Hard Stop）**，展示终局横幅，彻底掐灭无休止寻找的多巴胺循环。

2. **【默认当前分页】（原生模式 · 零干扰）**：
   - 纯经典单页过滤，不触发任何跨页 API 自动合并；
   - 维持 B站 原生底部分页组件，适合喜欢传统逐页浏览的用户。

3. **【瀑布流】（流式长流 · 智能枯竭拦截）**：
   - 触底自动向下合并新页面；
   - 搭载**连续跨 5 页空页枯竭劝退机制**，一旦发现连续 5 页无合格视频立即彻底停火，并在命中新视频时动态重置 5 页探测配额。

---

## 四、 B站接口风控与反爬防御体系

针对直接调用 `/x/web-interface/wbi/search/type` 接口可能遇到的服务端风控（HTTP -403 / -412）：

1. **真实上下文继承**：
   - 运行在真实浏览器油猴环境中，天生携带合法 Cookie（SESSDATA, buvid3 等）、有效 UA 与 Referer，指纹完全真实。

2. **单通道串行排队 + 随机抖动（Jitter）**：
   - 严禁并发并发多页请求；
   - 采用单通道串行队列，每次请求间隔加入 `400ms ~ 700ms` 的随机延迟，完全模拟人类正常向下浏览滚动节奏。

3. **WBI 动态签名与密钥缓存**：
   - 本地计算 `w_rid` 与 `wts`，密钥定期自动同步刷新，保证每次签名绝对有效。

4. **风控熔断降级**：
   - 一旦捕获到 `code: -412`（请求过频）或 `-403`，立即彻底中断所有后续后台拉取，弹出明确 UI 提示引导用户完成验证或稍候重试，严禁盲目重试。

---

## 五、 聚光灯模式优化：非聚光灯视频禁止悬停动态加载 (v2.2.1)

在“聚光灯聚焦”展现模式下，未命中筛选规则的视频卡片会被视觉压暗（`opacity: 0.16`）。为避免鼠标滑过暗化卡片时 B站 原生脚本依然触发预览视频流加载与播放（消耗网络带宽、占用 CPU/GPU 算力并带来动态视觉干扰），实施三重无干扰拦截机制：

1. **CSS 层硬屏蔽**：
   - 针对 `.bili-cleaner-dimmed` 下的 `.bili-video-card__image--video`、`.bili-video-card__stats--preview`、`.bili-cover-card__video`、`video` 等容器设置 `display: none !important; pointer-events: none !important;`。
2. **JS 事件捕获拦截（Capture Phase）**：
   - 在 `window` 捕获阶段拦截 `mouseenter`、`mouseover`、`pointerenter`、`pointerover` 事件；
   - 一旦触发目标属于 `.bili-cleaner-dimmed` 的封面与缩放容器区域，立即执行 `stopImmediatePropagation()`，阻止事件下发给 B站 原生播放器预览逻辑。
3. **DOM 动态注入拦截与清理**：
   - MutationObserver 监听动态节点，若在 `.bili-cleaner-dimmed` 卡片内检测到注入的 `<video>` 元素，立即 `pause()`、清空 `src` 并移除节点。
4. **正常行为保留**：
   - 保留 CSS `:hover` 的半透明回显功能（用户特意悬停时仍可清晰辨识暗化卡片内容）；
   - 保留卡片链接与标题的点击跳转行为；
   - 目标匹配视频（`.bili-cleaner-highlighted`）不受影响，依旧支持原生视频流悬停预览。

---

## 六、 功能精简与重组（纯无限制瀑布流方案）

根据用户需求，在保留 2.2.0 既有核心能力（WBI 签名、高级语法解析、繁简归一化、聚光灯与暗化悬停防护）的基础上，对翻页流式引擎与 UI 进行精简与定向重构：

1. **移除【只显示前三页】与【默认当前分页】**：
   - 彻底移除了浏览模式单选切换逻辑，精简控制面板；
   - 默认且唯一采用连续流式追加架构。
2. **【瀑布流】解除页数限制**：
   - 移除 3 页硬中断限制，移除 34 页安全硬编码上限；
   - 支持沿页面无限制向下连续自动加载，直至拉取完 B站 官方搜索结果末页。
3. **移除【数据已枯竭】判定与劝退模块**：
   - 移除连续 5 页空页判定阀值（`MAX_EMPTY_PAGES_TO_EXHAUST`）及计数器；
   - 移除页面底部的终局阻断横幅（`.bili-cleaner-stream-end-banner`）；
   - 移除控制面板中的红色枯竭警告卡片（`#cleaner-exhausted-card`）；
   - 当遇到中间空页（30 个视频无一匹配）时，静默自动继续向下探测下一页，直至遇到新视频或到达物理终点。
4. **元数据完全保真**：
   - 严格维持 Userscript 原有元数据头（`@version 2.2.0`、原有描述、匹配项、授权协议与外部依赖等）。

---

## 七、 三平级模式架构重组整合 (v2.2.0 终版架构)

控制面板由多组繁复单选重构成**三个明确的平级单选选项**：

| 选项名称 | 翻页驱动机制 (Pagination) | 视觉展示方式 (Visual Display) | 核心特性说明 |
| :--- | :--- | :--- | :--- |
| **A.【瀑布流】** | **瀑布流连续加载**<br>（滚动触底拉取下一页接口，不过滤丢弃任何视频，完整注入 DOM） | **物理隐藏**<br>（未匹配项 `display: none`，匹配项原生展示，**不使用**聚光灯高亮） | 适合需要连续滚动浏览、免除手动翻页且只看精准合格结果的用户。 |
| **B.【聚光灯高亮】** | **B站 原生分页**<br>（完全不触发脚本 API 瀑布流翻页，保留底部分页器 1, 2, 3...） | **聚光灯高亮与暗化**<br>（匹配项青蓝光圈+徽章，未匹配项视觉压暗且禁止悬停预览） | “堵不如疏”视觉聚焦模式，保持 100% 页面网格完好与底部分页器稳定。 |
| **C.【物理隐藏】** | **B站 原生分页**<br>（完全不触发脚本 API 瀑布流翻页，保留底部分页器 1, 2, 3...） | **B站 原生卡片样式 + 物理隐藏**<br>（未匹配项 `display: none`，匹配项 100% 原生展示，不加聚光灯效果） | 经典单页过滤模式，最贴近 B站 原生单页操作体验与原生卡片外观。 |

---

## 八、 F5 刷新 #Tag 丢失与 getCleanApiKeyword 运行时异常修复

### 1. 故障根因分析
1. **浏览器 URL Fragment 特性导致 `#` 丢失**：
   - 当用户在地址栏或搜索框输入未转义的 `#`（如 `?keyword=python#教程` 或 `?keyword=#教程`）并按 F5 刷新时，浏览器遵循标准 URI 规范，将 `#` 之后的所有字符解析为 `window.location.hash`（锚点），而 `window.location.search` 中的 `keyword` 参数只剩下 `#` 之前的部分或为空；
   - 原脚本仅依赖 `new URLSearchParams(window.location.search)` 解析参数，导致 `#Tag` 规则在 F5 刷新后无法被捕获，页面丢失所有筛选。而 `-` 和 `@` 均为标准 query 字符，不受锚点截断影响，故此前只有 `-` 和 `@` 正常。
2. **`getCleanApiKeyword` 存在重复定义与字段名拼写错误**：
   - 脚本中存在重复定义的 `getCleanApiKeyword`，覆盖了原有的脱壳解析函数；
   - 重复定义的代码中使用了 `filters.triples.join(' ')`，而 `getSearchKeywords` 返回的结构字段名为 `triple`（单数），导致 `filters.triples` 值为 `undefined`；
   - 当用户只搜 `#Tag`（无普通词 `filters.normal`）并触发瀑布流触底翻页时，脚本尝试调用 `filters.triples.join(' ')`，抛出 `TypeError: Cannot read properties of undefined (reading 'join')`，阻断后续执行。

### 2. 修复方案
1. **重构 `getRawSearchKeyword()` 提取器**：
   - 串联 `window.location.search`、`window.location.hash`（自动拼接被浏览器截断的非路由锚点）以及 DOM 搜索输入框（`input.search-input-el` 等）三级容错体系，确保 F5 刷新后 100% 还原完整包含 `#`、`@`、`-`、`*` 的用户原始搜索词。
2. **彻底移除多余的重复函数定义**：
   - 保留唯一的、鲁棒的 `getCleanApiKeyword()` 规则脱壳函数；
   - 修正字段引用，全面防护 `undefined.join` 异常；
   - 当只有 `#Tag` 规则时，自动脱除 `#` 符号并作为 API 请求词，保证瀑布流能够正确拉取相关视频。

---

## 九、 `/video` 分类路由适配与 `#Tag` 字典异步容错兜底

针对类似 `https://search.bilibili.com/video?vt=50461778&keyword=%23c%E5%90%9B&from_source=web_search`（单独搜 `#c君` 话题）场景的深度修复：

1. **同时拦截 `XMLHttpRequest` 与 `fetch`**：
   - B站 的 `/video` 路由或 Axios 请求默认使用原生 `XMLHttpRequest`；
   - 补齐了对 `XMLHttpRequest` 的全局劫持，确保不论 B站 采用 Fetch 还是 XHR，搜索接口的 JSON 响应均能被正确捕获并写入 `videoTagMap` 标签字典。
2. **字典大小写全格式归一化存储**：
   - 将 BVID 及各类唯一 ID（BV号、AV号、纯数字）同时存储原始值、小写与大写形式，避免因 DOM 中的 URL 格式（如 `BV...`）与 API 响应不匹配导致标签查找失效。
3. **`#Tag` 判定容错与首屏防误杀回退**：
   - 在首屏卡片刚渲染、网络请求可能尚未完成写入 `videoTagMap` 时，若视频标签库为空，自动容错检查视频的**标题与 UP 主名字**；
   - 只要标题或作者中明确包含该标签词（例如标题为 `【C菌】...` 或作者为 `渗透之C君`），即视为符合条件的有效结果，彻底杜绝首屏因异步网络延迟而导致全部视频被一票否决全部隐藏的假死现象。

---

## 十、 瀑布流卡片 DOM 原生像素级对齐与模式切换联动

### 1. 瀑布流卡片 DOM 结构与 class 原生一致化
为保证通过 API 动态追加注入的视频卡片在排版、响应式栅格、字体层级、图标以及悬停交互上与 B站 原生卡片完全无差别：
1. **容器类名与属性对齐**：
   - 容器 div 增加 `.video-list-item` 关键原生类：`class="video-list-item col_3 col_xs_1_5 col_md_2 col_xl_1_7 mb_x40"`；
   - 统一附加 `data-bsb-bvid="${v.bvid}"` 与内部追踪属性 `data-injected="true"`。
2. **状态数据与原生矢量 SVG 图标集成**：
   - **播放量**：提取 `v.play`，内置原生播放图标 SVG 与中文数值单位换算（万/亿，如 `974.6万`）；
   - **弹幕量**：提取 `v.danmaku` / `v.video_review`，内置原生弹幕图标 SVG 与数值换算（如 `1.6万`）；
   - **时长**：提取 `v.duration`，支持秒数与字符串时分秒自适应对齐（如 `07:59`）；
   - **UP主与发布日期**：UP主专属矢量图标 SVG + UP主昵称 + 发布日期格式化（如 ` · 2023年10月28日`）。
3. **响应式高清画质封面流水线**：
   - 使用标准 `<picture class="v-img bili-video-card__cover">` 配合 AVIF 与 WebP 渐进式 `<source srcset="...">` 以及兜底 `<img>`，完全承袭 B站 原生搜索封面图片 CDN 规范。

### 2. 模式切换自动点击原生搜索按钮联动
在悬浮控制栏的【模式选择】切换中：
1. **选入瀑布流（从【聚光灯高亮】或【物理隐藏】切换到【瀑布流】）**：
   - 重置分页状态从第 1 页开始；
   - 自动查询并点击原生搜索按钮 `<button class="vui_button vui_button--blue vui_button--lg search-button">搜索</button>`，重新发起首屏搜索，保证从纯净状态开启瀑布流滚动。
2. **选出瀑布流（从【瀑布流】切换到【聚光灯高亮】或【物理隐藏】）**：
   - 立即清空并移除当前页面中所有由瀑布流追加注入的 DOM 节点（`[data-injected="true"]`）；
   - 重置内部缓存字典与统计计数；
   - 自动触发点击原生搜索按钮，恢复 B站 原生态首屏与底部分页导航栏组件。
3. **高亮与隐藏之间切换**：
   - 仅在前端即时更新各卡片类名与展示样式（高亮/暗化 vs `display: none`），不触发重复的网络搜索请求。

---

## 十一、 瀑布流原生子 DOM 模板克隆与严格准入控制

### 1. 严格准入过滤：不符合规则视频禁止入库
- 改变此前“拉取后全部追加至 DOM 再设 `display: none`”的机制，重构为**拉取后先过滤、命中后才挂载**；
- 在遍历 API 响应列表时执行 `checkVideoMatch` 判定，若不符合当前搜索筛选条件，直接执行 `continue` 跳过，从源头杜绝向页面 DOM 树插入无意义隐藏节点，大幅减轻浏览器渲染树与内存开销。

### 2. `div.video-list.row` 原生子 DOM 模板克隆机制
- 解决通过字符串拼接无法 100% 完整继承 Vue 作用域属性（`data-v-xxx`）、排版间距及原生交互样式的痛点；
- 在执行瀑布流追加前，动态捕获 `div.video-list.row` 下首个未被注入的原生视频卡片作为母版（`getNativeCardTemplate()`），调用 `cloneNode(true)`；
- 彻底清理母版可能携带的悬停临时播放器（`.v-inline-player`、`video` 等标签）；
- 依托原生母版结构，精准替换 BVID、各级跳转 `href`、封面图片源（AVIF/WebP）、播放量与弹幕量数值、时长、高亮标题、UP主与发布日期；
- 确保后续追加生成的瀑布流视频卡片与首屏原生卡片在 UI、布局、间距与样式上达到 100% 真实统一。

---

## 十二、 聚光灯模式全面纯样式化与原生事件解耦

### 1. 彻底移除鼠标事件拦截层
- 移除此前在 `document` 上注册的捕获阶段 `mouseenter`、`mouseover`、`pointerenter`、`pointerover` 监听器；
- 彻底移除对原生事件的 `e.stopImmediatePropagation()` 截断调用；
- 移除针对 `<video>` 标签的强制 `pause()` 和 `remove()` 销毁逻辑，以及 `MutationObserver` 中的视频标签清理循环。

### 2. 纯 CSS 视觉聚焦架构
- **零 JavaScript 事件干预**：聚光灯聚焦模式完全退化为纯 CSS 类分发；
- **未匹配项**：仅挂载 `.bili-cleaner-dimmed`（透明度 `opacity: 0.16` + 灰度滤镜），鼠标悬停（`:hover`）平滑过渡为 `opacity: 1` 与原生色彩；
- **匹配项**：挂载 `.bili-cleaner-highlighted`（高亮发光边框与角标）；
- **100% 维持原生交互体验**：B站 原生的动态封面播放、稍后再看按钮点击、标题悬浮 Tooltip 及点击跳转行为均保持与未安装脚本时完全一致。

---

## 十三、 选项切换提示精简与瀑布流切入/切出 page=1 页面重定向

### 1. 移除选项切换浮层提示（Toast）
- 彻底移除单选框 `change` 事件中的 `showToast(...)` 提示与 `modeTips` 文本字典；
- 点击切换模式时即选即生效，不再弹出遮挡视觉的居中黑底气泡通知。

### 2. 选入/选出【瀑布流】改为点击原生第 1 页分页按钮
- 将重定向进入 `page=1` 改为**触发点击 B站 原生第 1 页分页按钮**：
  `<button class="vui_button ... vui_pagenation--btn-num" aria-label="第 1 页，当前页" aria-current="page">1</button>`；
- 实现流程：
  1. 选入/选出瀑布流时，首先将模式保存至 `localStorage`；
  2. 若从瀑布流选出，立即清空页面上所有瀑布流追加的动态卡片（`[data-injected="true"]`），重置去重字典；
  3. 通过 `clickPageOnePaginationButton()` 精准查找带有 `aria-label*="第 1 页"` 或文本为 `1` 的 `vui_pagenation--btn-num` 按钮并触发原生 `click()`；
  4. 触发 B站 原生 Vue 分页逻辑重新拉取并挂载原生态首屏；若由于单页无分页器而未找到该按钮，则平滑回退触发原生搜索按钮；
- 在【聚光灯高亮】与【物理隐藏】之间切换时，不触发重新翻页，直接在当前页面即时更新 CSS 呈现样式。

---

## 十四、 性能与渲染架构深度优化（消除卡顿与强制同步回流）

### 1. 消除滚动事件中的高频强制同步回流（Reflow）
- **移除 `wheel` 监听**：彻底剥离高频且重复的 `wheel` 滚轮监听器；
- **滚动 180ms 节流（Throttle）**：在 `window.scroll` 上增加 180ms 节流定时器，避免在快速滚动时以 60~120fps 高频连续读取 `scrollHeight`、`clientHeight`、`scrollTop` 所引发的浏览器 Forced Synchronous Layout（强制同步回流）。

### 2. 聚光灯视觉样式回滚（保留经典高对比灰度与发光特效）
- **恢复灰度对比滤镜**：虚化卡片 `.bili-cleaner-dimmed` 恢复为 `filter: grayscale(85%) contrast(85%) !important; opacity: 0.16 !important;`；
- **恢复原版高亮样式**：`.bili-cleaner-highlighted` 恢复 `box-shadow: 0 0 0 2px #00aeec, 0 8px 24px rgba(0, 174, 236, 0.22) !important`，保留角标渐变效果，还原视觉聚焦层次。

### 3. 单一容器层级选择器与单遍匹配统计
- **消除选择器笛卡尔积重复**：将原有的混合选择器统一精简为容器级选择器 `.video-list-item, div.video-list > div[class*="col_"], .bili-live-card`，消除每个卡片因父子容器同时命中而导致的 3x 冗余遍历；
- **骨架屏状态空标题保护**：增加 `if (!rawTitle.trim()) continue;`，防止卡片骨架屏尚未挂载标题数据时过早打标并误杀；
- **单遍合并统计**：在遍历卡片判定条件的同时计算合格匹配数，彻底废除二次循环中的 `document.querySelectorAll` 与每个卡片内的 `querySelector('a[href*="/video/BV"]')` 耗时查询；
- **无状态变更抑制重绘**：仅在 `totalMatchesFound` 实际数值变化时才调用 `updatePanelUI()` 更新 DOM 控制栏。

### 4. MutationObserver 精准过滤与 80ms 防抖
- **相关节点类型初筛**：检查变动记录中的 `addedNodes` 与 `removedNodes`，仅在变动节点为视频卡片、视频容器或内部含有 `.bili-video-card` 时才响应，彻底屏蔽 B站 播放器进度缓冲、浮层弹窗、未读消息红点及数据打点引发的无关变更事件风暴；
- **80ms 防抖合并**：通过 80ms `setTimeout` 配合 `requestAnimationFrame` 合并短时间内的批量 DOM 挂载，使得连续注入的卡片在单次动画帧中批量完成过滤。

---

## 十五、 筛选语法 `*三连泛搜` 机制与 F5 刷新状态解析

### 1. 筛选语法 `*词` 代码层含义
- **分词归类**：以 `*` 开头的词在 `getSearchKeywords()` 中被识别并提取入 `filters.triple`（三连模式全字段词池）；
- **全字段匹配（标题 OR 标签 OR UP主）**：在 `checkVideoMatch()` 中，普通词严格要求命中视频标题；而带有 `*` 的词放宽为 `title.includes(k) || tags.includes(k) || author.includes(k)`；
- **解决场景**：针对“甜蜜老张”这类剧情类 UP 主，投稿标题通常是剧情短名（如《暴跌光速甩卖》），标题中完全不包含 UP 主名称。使用 `*甜蜜老张` 可凭借作者维度（`author.includes('甜蜜老张')`）精准命中并展示其所有投稿。

### 2. 搜索框有词但 F5 刷新无视频、点击【搜索】才有视频的机制剖析
- **URL 参数与搜索框失步**：在 B站 网页中仅在搜索框键盘输入词句，浏览器的 URL 并未更新（仍为上一个搜索词或初始空白）。
- **F5 刷新恢复未提交表单**：按下 F5 时，B站 服务端/SPA 按照旧的 URL 返回旧视频；而浏览器表单记忆机制将未提交的 `*甜蜜老张` 填回了搜索框。
- **脚本读取输入框造成误杀**：脚本优先读取输入框的 `*甜蜜老张` 去校验旧视频，旧视频标题/作者均不匹配该词，因此被 100% 隐藏，导致首屏为空白；
- **点击【搜索】发起真实请求**：点击【搜索】触发 B站 真正发起对该词的后端搜索请求，重新拉取匹配视频并渲染，从而正常显示。

---

## 十六、 F5 刷新下 `*三连泛搜` 判定失效彻底修复

### 1. UP 主名称提取正则空字符吞噬 Bug 修复
- **历史隐患**：原代码 `authorRaw.replace(/[\s·•].*$/, '')` 中，`[\s·•]` 能够匹配首字符的任何空白符（空格或 `\n`）。在 F5 刷新进行首屏 DOM 解析时，若卡片容器内带有缩进或换行，该正则会从位置 0 开始匹配空白并将后续整串文本完全清空，导致 `author` 永远解析为 `""`；
- **健壮修复**：改为 `(authorRaw || '').trim().replace(/\s*[·•][\s\S]*$/, '').trim()`。先执行首尾 `trim()`，再通过严格定位日期分隔符 `[·•]` 剔除日期，即使节点带有换行或缩进也能 100% 提取出真实 UP 主名称。

### 2. 首屏骨架屏与水合竞态阻断
- **空作者注水守卫**：在 `filterDOMElements()` 中，当规则包含 `@UP主` 或 `*三连泛搜` 时，若检测到卡片作者节点尚未注水填充文本（`!rawAuthor.trim()`），不提前打上 `data-purified-query` 标记，也不执行隐藏，直接 `continue` 跳过，等待 Vue 在下一帧将作者数据完整挂载后再统一裁决与打标。

---

## 十七、 2.2.0 版本语法精简化（彻底移除 `|`、`""` 与 `*前缀`）

### 1. 语法精简目标
- 彻底剔除复杂且易引发歧义的次级高级语法，使筛选核心聚焦于最直观稳定的 4 种基础规则：
  1. **普通关键词**：标题 AND 包含匹配；
  2. **`-` 排除词**：标题 NOT 排除；
  3. **`#` 标签词**：Tag 包含匹配；
  4. **`@` UP主词**：Author 包含匹配。

### 2. 代码级调整详情
- **移除 `*前缀`（三连模式）**：
  - 移除 `getSearchKeywords` 和 `checkVideoMatch` 中的 `triple` 逻辑与正则匹配分支；
  - 自动剥离词首的 `*` 和 `＊`，避免用户键入此类字符时导致非预期的空匹配；
  - DOM 安检水合守卫精简为仅在 `filters.ups.length` 时检测作者注水。
- **移除 `""`（双引号精确匹配）**：
  - 在 `cleanText` 中直接剥离半角双引号 `"` 与全角中文引号 `“”`、`＂`，所有词条统一按直观的子串模糊包含处理，不再维护复杂的成对引号词法状态机。
- **移除 `|`（管道符多分支）**：
  - 在 `cleanText` 中将 `|` 和全角 `｜` 替换为空格分隔符，退化为普通单词间隔，不再执行多分支笛卡尔积判定。

---

## 十八、 页面控制面板彻底移除与油猴扩展菜单单选集成

### 1. 彻底移除页面悬浮控制面板
- 移除 DOM 中 `#bili-cleaner-control-bar` 的创建函数 `createFloatingControlBar()`、悬浮 UI 样式及手动拉取按钮；
- 页面不再出现右下角遮挡视频卡片的浮动白底控制面板，恢复 100% 纯净的原生页面视觉；
- 原本绑定在控制面板上的 180ms 节流滚动触底监听器（`onThrottledScroll`）独立挂载至全局初始化流程（`init()`）。

### 2. 插件管理器扩展菜单（GM Menu）单选接入
- **授权声明**：脚本头部元数据补充 `// @grant GM_registerMenuCommand`、`// @grant GM_unregisterMenuCommand` 与 `// @grant unsafeWindow`；
- **动态单选状态呈现**：
  - 通过 `registerPluginMenus()` 将三个平级模式挂载至 Tampermonkey / 脚本管理器扩展弹窗中：
    - `🔘 瀑布流 (瀑布流翻页 · 物理隐藏展示)`（或未选中时的 `⚪`）
    - `🔘 聚光灯高亮 (原生翻页 · 视觉聚焦暗化)`（或未选中时的 `⚪`）
    - `🔘 物理隐藏 (原生翻页 · 原生卡片隐藏)`（或未选中时的 `⚪`）
  - 用户在插件菜单中点击任一模式时，通过 `switchMode()` 更新 `currentMode`、保存至 `localStorage` 并调用 `GM_unregisterMenuCommand` 重新注册菜单，实时刷新单选勾选圆点；
  - 切换模式时自动重置/触发首屏重整逻辑，从瀑布流切出时清理动态卡片并点击原生第 1 页按钮。
- **沙箱环境网络钩子隔离兼容**：引入 `targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window`，确保在非 `none` 的 GM 授权模式下，页面上下文与扩展沙箱上下文的 `XMLHttpRequest`、`fetch` 和 `history` 路由监听 100% 同步生效。

---

## 十九、 视频详情页品质展示扩展与 DOM 精细化隔离备忘

### 1. 设计目标与背景
为了在未来将【视频品质】评级系统（殿堂神作、硬核干货、综合标杆等）无缝拓展至 **B 站视频详情播放页（`*://www.bilibili.com/video/*`）**，同时确保搜索页（`search.bilibili.com`）与详情页逻辑 100% 独立解耦、零样式冲突、零相互污染。

### 2. 页面路由级严格隔离（Page Context Router）
在脚本执行入口明确划分运行环境守卫：
```javascript
const IS_SEARCH_PAGE = location.hostname === 'search.bilibili.com';
const IS_VIDEO_DETAIL_PAGE = location.hostname.endsWith('bilibili.com') && location.pathname.startsWith('/video/');
```
- **详情页严禁执行的搜索页逻辑清单**：
  1. ❌ **严禁执行无缝瀑布流（`isWaterfall`）**：不得接管页面滚动与网络翻页；
  2. ❌ **严禁挂载顶部筛选面板（`.more-conditions`）**：搜索页药丸栏仅限搜索页；
  3. ❌ **严禁执行关键词语法过滤与卡片隐藏/虚化**：详情页的主播放器、推荐流不按搜索词淘汰；
  4. ❌ **严禁全局 MutationObserver 无差别扫描**：避免全局监听影响播放器性能。

### 3. 搜索页现有 DOM 选择器的作用域收拢（Scope Containment）
- **现状**：目前直接使用 `document.querySelectorAll('.bili-video-card, div[class*="col_"]')` 全页面查询；
- **优化改造**：为搜索页逻辑添加容器作用域限定，收敛在主搜索区域内部，杜绝波及非搜索 DOM：
  ```javascript
  const searchRoot = document.querySelector('.search-page, .search-page-wrapper, .search-layout') || document.body;
  searchRoot.querySelectorAll(...)
  ```

### 4. 详情页极速原生数据源与精准挂载方案
与搜索页需要拦截 `wbi/search/all/v2` 不同，视频详情页拥有更强、更稳定的原生数据：
- **原生极速数据源**：
  直接同步读取 B 站官方注水数据对象，毫秒级就绪且 100% 全量精准：
  ```javascript
  const stat = window.__INITIAL_STATE__?.videoData?.stat;
  // 包含: stat.view(播放), stat.like(点赞), stat.favorite(收藏), stat.danmaku(弹幕), stat.reply(评论) 等
  ```
- **主视频品质勋章挂载点（二选一或组合）**：
  1. **标题右侧 / 下方**：挂载于 `h1.video-title` 旁或 `#viewbox_report .video-data` 前后；
  2. **点赞工具栏左侧**：挂载于 `.video-toolbar-left` 或 `.video-toolbar-v1` 中；
  3. 享受与搜索卡片相同的赞播比、藏播比及详细 Tooltip 交互。

- **右侧推荐流小卡片品质挂载（可选）**：
  仅限定查询右侧推荐容器：`.recommend-list-v1 .video-page-card-small, .rec-list .video-page-card-small`，精准为推荐卡片封面注入小勋章，不影响主播放器与评论区。






