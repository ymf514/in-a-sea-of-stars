// ============================================================================
//  In a Sea of Stars — tunable values  ·  可调参数总表
// ----------------------------------------------------------------------------
//  Every number / colour here is safe to change; the dev server reloads on save.
//  所有标 TUNE 的值都可以直接改，保存后页面会自动刷新。
//  Units: distances are Three.js world units (the boat is ~2.6 units long).
//  UI fonts, sizes and Polaroid colours live at the top of src/style.css (:root).
// ============================================================================

// ---------------------------------------------------------------- scene · 场景
export const SCENE = {
  background: '#0c1a4a',      // TUNE: 背景色 = 星空般的深蓝（和 VIEW.darkColor 一致）
  fogColor: '#0c1a4a',        // TUNE: 雾的颜色（远处融进深蓝）
  fogDensity: 0.012,          // TUNE: 雾浓度 · 越大远处越朦胧（0.006–0.02）
  exposure: 1.0,              // TUNE: 整体曝光 / 亮度
  skyLight: '#e6f1ff',        // TUNE: 天光颜色（从上方均匀照亮，柔和不刺眼）
  groundLight: '#4a72e8',     // TUNE: 海面反射光颜色（从下方补的蓝光）
  skyLightIntensity: 2.6,     // TUNE: 均匀环境光强度 · 主要的光
  sunColor: '#fff3df',        // TUNE: 方向光颜色
  sunIntensity: 0.9           // TUNE: 方向光强度 · 越小光越柔、影子越淡（原来 2.8，太直接）
};

// ---------------------------------------------------------------- post · 朦胧光晕
// 亮的东西（纸星星、纸船、光池）周围会晕开一层柔光，像参考图里那种淡淡的发光。
export const POST = {
  bloom: true,                // TUNE: false = 关闭光晕（性能更好）
  bloomStrength: 0.28,        // TUNE: 光晕强度
  bloomRadius: 0.4,           // TUNE: 光晕扩散范围 0–1 · 越大越朦胧
  bloomThreshold: 0.78,       // TUNE: 多亮才会发光 · 越低越多东西发光（太低整个画面会发白）
  maxPixelRatio: 1.5,         // TUNE: 渲染清晰度上限 · Retina 屏上 2 最清晰但最卡，1 最流畅但略糊（1–2）
  msaa: 4                     // TUNE: 抗锯齿采样 · 0 = 关闭（更流畅，边缘有锯齿），4 = 平滑
};

// ---------------------------------------------------------------- ocean · 海面
export const OCEAN = {
  deep: [0.014, 0.16, 0.57],  // TUNE: 深色水（RGB 0–1）
  shallow: [0.035, 0.36, 0.87], // TUNE: 亮色水（RGB 0–1）
  foam: [0.09, 0.17, 0.27],   // TUNE: 波光高光颜色（叠加）
  foamStrength: 0.65,         // TUNE: 波光强度
  waveSpeed: 1.0,             // TUNE: 水纹流动速度倍数
  glintCount: 340,            // TUNE: 水面小亮点数量
  glintColor: '#c2e8ff',      // TUNE: 小亮点颜色
  glintSize: 0.034            // TUNE: 小亮点大小
};

// ---------------------------------------------------------------- layout · 星星分布（密度）
export const LAYOUT = {
  seaRadius: 45,              // TUNE: 星星分布的圆形海域半径 · 越小越密集（800 颗、间距 2.1 时约 45；1200 颗约 55）
  minSpacing: 2.1,            // TUNE: 两颗星之间的最小距离 · 越小越密集（太小会重叠）
  harbourRadius: 4,           // TUNE: 船出发点周围留空的半径
  seed: 7                     // TUNE: 换一个数字 = 换一种随机分布（编号不变）
};

// ---------------------------------------------------------------- view · 船周围的可见范围
// 以船为中心：clearRadius 以内保持清晰；到 fadeRadius 逐渐被深蓝覆盖；
// fadeRadius 以外完全看不清，那里的星星也不再渲染（减轻画面和渲染负担）。
export const VIEW = {
  clearRadius: 8,             // TUNE: 完全清晰的半径
  fadeRadius: 17,             // TUNE: 完全融进留白的半径 · 两者之间是渐变（越宽过渡越柔和）
  darkColor: '#0c1a4a',       // TUNE: 远处覆盖的星空深蓝 · 船周围的海面自然比它亮，形成中间浅、四周深
  darkness: 1.0,              // TUNE: 远处被覆盖的程度 · 1 = 完全看不见，0.7 = 还能隐约看到
  curve: 1.4                  // TUNE: 渐变曲线 · 1 = 均匀，越大越晚才开始变暗
};

// ---------------------------------------------------------------- boundary · 海域边界
// 星星都在一个圆形海域里；船靠近边缘时会被温柔地挡回来，被推开的星星也不会漂出去。
export const BOUNDARY = {
  margin: 5,                  // TUNE: 边界在星星最外圈之外再留多远（边界半径 = seaRadius + margin）
  softness: 4,                // TUNE: 接近边界时开始减速的距离 · 越大越柔和
  showRing: false,            // TUNE: 是否在水面上画出一圈淡淡的光边（默认不画，边界只是把船和星星挤回来）
  ringColor: '#d8ecff',       // TUNE: 光边颜色
  ringOpacity: 0.35,          // TUNE: 光边透明度
  ringWidth: 0.35             // TUNE: 光边宽度
};

// ---------------------------------------------------------------- stars · 纸星星
export const STARS = {
  // 纸张颜色：按顺序循环分配给每颗星（想更淡就往白色靠，想更浓就提高饱和度）
  paperPalette: [
    '#f3b97c', // TUNE: 杏橙
    '#ec97b8', // TUNE: 玫瑰粉
    '#7fbbe0', // TUNE: 天蓝
    '#b49ae6', // TUNE: 薰衣草紫
    '#f2877a', // TUNE: 珊瑚红
    '#9fd28f', // TUNE: 薄荷绿
    '#f4d77a'  // TUNE: 奶油黄
  ],
  saturation: 1.0,            // TUNE: 整体颜色浓度倍数 · 0 = 全白灰，1 = 原色，1.3 = 更浓

  // Archive image on the paper · 星星表面的档案图片
  showImages: true,           // TUNE: false = 回到纯色纸星星
  // 星星表面 = 星星自己的光色 与 图片 混合。光色随模型结果变化（未揭示时是珍珠白）。
  imageOpacity: 0.5,          // TUNE: 图片的不透明度 · 0 = 只有光色，1 = 完全清晰的图片
  lightGlow: 0.3,             // TUNE: 星星表面以自身光色发光的强度 · 越大颜色越明显
  poolUsesImageColor: true,   // TUNE: 水面光池用图片的主色（false = 用纸张颜色）

  sizeMin: 0.74,              // TUNE: 星星最小尺寸
  sizeMax: 0.98,              // TUNE: 星星最大尺寸（每颗在两者之间随机）
  heightJitter: 0.12,         // TUNE: 每颗星“鼓起程度”的随机差异（手工感）

  // Shape of the folded lucky star · 星星形状
  shape: {
    outerRadius: 1.0,         // TUNE: 星角尖端到中心的距离
    innerRadius: 0.62,        // TUNE: 星角之间凹处到中心的距离 · 越大越胖、越像幸运星
    height: 0.5,              // TUNE: 上半部分鼓起高度 · 越大越鼓
    depth: 0.36,              // TUNE: 下半部分鼓起深度
    roundness: 0.45,          // TUNE: 圆润度 · 0.3 很圆像枕头，1.0 像尖锥
    tipPinch: 0.6,            // TUNE: 星角尖端被捏扁的程度 0–1
    rings: 5,                 // TUNE: 鼓面分层数 · 越多越平滑（折面越细）
    edgeSegments: 2           // TUNE: 每条边的细分 · 越多折面越多
  },

  floatHeight: 0.28,          // TUNE: 星星漂浮的基础高度
  bobAmount: 0.10,            // TUNE: 上下浮动幅度
  bobSpeed: 1.1,              // TUNE: 上下浮动速度
  spinSpeed: 0.14,            // TUNE: 自转速度
  tilt: 0.08,                 // TUNE: 左右摇晃幅度

  roughness: 0.96,            // TUNE: 纸面粗糙度 · 1 = 完全哑光

  shadowColor: '#051e76',     // TUNE: 水面倒影 / 阴影颜色
  shadowOpacity: 0.21         // TUNE: 阴影透明度
};

// ---------------------------------------------------------------- glow · 星星发光
// score = 三个模型的平均 Star 相关度（0–1）；没有模型读数时 = 未解析
// 光晕是一圈铺在水面上的光池（不会再被海面切掉）。
export const GLOW = {
  // 这批档案的综合分数大多偏高（中位数约 0.84），直接用会让星星亮度差不多。
  // 先把 scoreRange 之间的分数拉伸到 0–1，再用 contrast 拉开高分段的差距。
  scoreRange: [0.2, 1.0],     // TUNE: 分数的有效范围 [最暗, 最亮]
  contrast: 1.8,              // TUNE: 亮度对比 · 1 = 线性，越大只有最高分的星星最亮

  opacityBase: 0.12,          // TUNE: 光晕最低透明度（分数最低时 · 仍然可见）
  opacityRange: 0.42,         // TUNE: 光晕随亮度增加的透明度
  sizeBase: 2.4,              // TUNE: 光晕最小直径
  sizeRange: 2.2,             // TUNE: 光晕随亮度增加的直径
  pulse: 0.11,                // TUNE: 呼吸闪烁幅度（0 = 不闪）
  pulseSpeed: 1.7,            // TUNE: 呼吸速度

  // 每颗星的光色取自它图片的主色，再调成柔和的版本：
  saturationBoost: 0.9,       // TUNE: 把图片主色的饱和度放大几倍 · 越大星星之间颜色差别越明显
  minSaturation: 0.28,        // TUNE: 光色最低饱和度 · 越大颜色越鲜明
  lightness: [0.62, 0.8],      // TUNE: 光色亮度范围 [最深, 最浅] · 越低颜色越浓，越高越粉彩
  brightColor: '#f6dea0',     // TUNE: 高分星星的光会往这个颜色偏（月光金）
  brightBlend: 0.15,          // TUNE: 高分时偏向月光金的程度 0–1（太大会让所有亮星都变成同一种暖色）
  fadeSpeed: 1.2,             // TUNE: 星星从“未揭示”过渡到自己的光的速度

  // Disagreement · 模型分歧：光色在两种柔和颜色之间缓慢漂移，呼吸不规则
  disagreeColors: ['#cbbfd6', '#b3c7d2'], // TUNE: 分歧时漂移到的颜色（薰衣草紫、雾蓝）
  disagreeDrift: 0.55,        // TUNE: 漂移程度 0–1
  disagreeSpeed: 0.45,        // TUNE: 漂移速度（越小越慢越梦幻）
  disagreePulse: 0.18,        // TUNE: 分歧时额外的不规则呼吸幅度

  // Analysing · 正在被模型读取时的微光闪烁
  shimmer: 0.35,              // TUNE: 闪烁幅度
  shimmerSpeed: 6,            // TUNE: 闪烁速度

  unresolvedColor: '#eef2ff', // TUNE: 未被模型读取的星星的光色（中性珍珠白）
  unresolvedOpacity: 0.2,     // TUNE: 未解析星星的光晕透明度
  unresolvedLevel: 0.5        // TUNE: 未解析星星的光晕尺寸 / 自发光（相当于分数 0.5）
};

// ---------------------------------------------------------------- reveal · 靠近时揭示
// 星星一开始都是同样柔和的珍珠光；船第一次靠近时，它才显现出模型给它的光。
// 已经算好的结果直接显现（不会假装在计算）；没有结果的星星（访客放入的）
// 会请求本地推理服务（npm run inference），计算时微微闪烁。
export const REVEAL = {
  onApproach: true,           // TUNE: false = 一开始就显示所有星星的光
  remember: true,             // TUNE: 记住这个浏览器已经揭示过的星星（刷新后不用重新靠近）
  radius: 8                   // TUNE: 多近会触发揭示 · 默认等于 VIEW.clearRadius：进入清晰范围的星星就显出自己的光
};

// ---------------------------------------------------------------- boat · 船
export const BOAT = {
  scale: 2.5,                 // TUNE: 船的大小
  speed: 5.8,                 // TUNE: 航行速度
  turnSpeed: 3,               // TUNE: 转向灵敏度
  // Folded paper boat · 纸折小船（参考方格纸折的经典小船）
  paperColor: '#f8f6f1',      // TUNE: 纸的颜色
  lineColor: '#7d8fc4',       // TUNE: 折痕描边颜色（像蜡笔勾的线）
  lineOpacity: 0.55,          // TUNE: 折痕描边透明度 · 0 = 不画线
  showGrid: true,             // TUNE: 纸上的方格（像作业本）
  gridColor: 'rgba(80,92,120,0.5)', // TUNE: 方格线颜色
  gridScale: 0.9,             // TUNE: 方格大小 · 越大格子越小越密
  length: 2.3,                // TUNE: 船长（尖到尖）
  width: 0.96,                // TUNE: 船宽
  rimHeight: 0.5,             // TUNE: 船舷高度
  tipHeight: 0.82,            // TUNE: 船头船尾翘起的高度
  sailHeight: 1.25,           // TUNE: 中间三角尖顶的高度
  sailOpen: 0.3,              // TUNE: 尖顶底部的半宽 · 越大越饱满（不超过船宽的一半）
  floatY: -0.3                // TUNE: 船在水里的高度 · 越小吃水越深
};

// ---------------------------------------------------------------- collision · 碰撞
// 船被近似成沿船身排列的两个圆；星星是一个圆。船撞到星星时把它推开，
// 被推开的星星还会轻轻挤开旁边的星星，然后慢慢停下。
export const COLLISION = {
  boatRadius: 1.05,           // TUNE: 船的碰撞半径（每个圆）
  boatLength: 1.0,            // TUNE: 两个圆离船中心的前后距离 · 越大船身越长
  starRadius: 0.85,           // TUNE: 星星的碰撞半径（会再乘以星星自身大小）
  push: 1.15,                 // TUNE: 被船撞开时得到的速度倍数 · 越大推得越远
  sideways: 1.2,              // TUNE: 往船两侧挤开的倾向 · 0 = 被船顶着往前推，越大越往旁边滑开
  friction: 1.6,              // TUNE: 星星在水上滑行的阻力 · 越大停得越快
  starBounce: 0.5,            // TUNE: 星星互相挤时传递的速度比例 0–1
  wobble: 0.25,               // TUNE: 被撞时星星的摇晃幅度
  boatDrag: 0.15,             // TUNE: 推星星时船减速的比例 0–1
  homeSpring: 0.6             // TUNE: 被推开后漂回原位的力度 · 0 = 不回去，越大回得越快（太大会来回晃）
};

// ---------------------------------------------------------------- camera · 镜头
export const CAMERA = {
  fov: 44,                    // TUNE: 视野角度 · 越大看得越广
  height: 18.5,               // TUNE: 镜头离海面的高度
  distance: 17.2,             // TUNE: 镜头在船后方的距离
  follow: 2.6                 // TUNE: 跟随速度 · 越大越紧跟
};

// ---------------------------------------------------------------- interaction · 交互
export const INTERACTION = {
  reach: 5.5,                 // TUNE: 能打捞星星的距离
  nearRippleEvery: 2.6,       // TUNE: 附近星星每隔几秒荡一圈波纹
  nearRippleColor: '#cce9ff', // TUNE: 附近波纹颜色
  dropRippleColor: '#e7f8ff', // TUNE: 新星星落水波纹颜色
  dropHeight: 8,              // TUNE: 新星星从多高落下
  dropBounces: [5, 2.8],      // TUNE: 每次弹起的速度（数量 = 弹跳次数）
  gravity: 19,                // TUNE: 下落重力
  releaseDistance: [7, 15],   // TUNE: 新星星落在离船多远的范围内 [最近, 最远]
  maxUploadMB: 12             // TUNE: 上传图片大小上限
};

// ---------------------------------------------------------------- wake · 船划过的水波
export const WAKE = {
  spacing: 0.7,               // TUNE: 每航行多远留下一圈 · 越小波纹越密
  size: 0.55,                 // TUNE: 波纹大小（相对于星星的波纹）
  opacity: 0.3,               // TUNE: 波纹透明度
  speed: 1.1,                 // TUNE: 扩散速度
  color: '#d6ecff',           // TUNE: 波纹颜色
  bowWaves: true              // TUNE: 船头两侧也留下小波纹
};

// ---------------------------------------------------------------- ripples · 波纹
export const RIPPLES = {
  opacity: 0.38,              // TUNE: 波纹最初透明度
  growth: 4.3,                // TUNE: 波纹扩散速度
  life: 1.6                   // TUNE: 波纹持续时间
};

// ---------------------------------------------------------------- models · 三个模型
// 打分逻辑沿用 Is It a Star? 原型：TM 和 CLIP 的 Star 分数 = 1 − P(Unrelated)；
// MobileNet 只用词表里匹配到的标签，没匹配到 = “尚未命名”，不算 0 分。
export const MODELS = {
  weights: { tm: 0.4, clip: 0.4, mn: 0.2 },   // TUNE: 三个模型在总亮度里的权重（会自动归一）
  disagreement: 0.35,         // TUNE: 模型分数最大差 ≥ 这个值 = “分歧”（星星会变色呼吸）
  partialAgreement: 0.15,     // TUNE: 差值 ≥ 这个值 = 部分一致
  mobilenetTopK: 3            // TUNE: MobileNet 取前几个标签
};
