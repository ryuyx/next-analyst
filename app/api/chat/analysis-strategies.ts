/**
 * Dataset Classification & Analysis Strategy Engine
 *
 * Analyzes a dataset's structural profile (from the preview step) and produces:
 *   1. A DatasetProfile — high-level characteristics of the data
 *   2. A list of recommended AnalysisStrategies with concrete guidance
 *
 * The output is injected into the system prompt so the LLM operates
 * with a domain-expert "playbook" rather than relying on generic knowledge.
 */

import type { FileInfo } from "./agent";

// ============================================================
// Types
// ============================================================

/** High-level category of a dataset. */
export type DatasetCategory =
  | "time_series"
  | "cross_sectional"
  | "text_heavy"
  | "geospatial"
  | "transactional"
  | "high_dimensional"
  | "general";

/** Structural profile derived from the rich preview. */
export interface DatasetProfile {
  category: DatasetCategory;
  /** Secondary tags — a dataset can have multiple traits */
  tags: string[];
  /** Human-readable one-liner */
  summary: string;
  /** Ratio of numeric columns */
  numericRatio: number;
  /** Ratio of categorical (object/string) columns */
  categoricalRatio: number;
  /** Whether datetime columns are detected */
  hasDatetime: boolean;
  /** Whether there are likely text (long-string) columns */
  hasText: boolean;
  /** Whether significant missing data exists */
  hasMissingData: boolean;
  /** Approx row count */
  rowCount: number;
  /** Column count */
  colCount: number;
}

/** A concrete analysis strategy recommendation. */
export interface AnalysisStrategy {
  /** Short label, e.g. "Time Series Decomposition" */
  name: string;
  /** Why this strategy applies */
  reason: string;
  /** Step-by-step guidance for the LLM */
  steps: string[];
  /** Suggested Python libraries / functions */
  tools: string[];
  /** Priority: higher = more relevant (1-10) */
  priority: number;
}

// ============================================================
// Column-Type Heuristics
// ============================================================

const DATETIME_PATTERNS =
  /date|time|timestamp|datetime|日期|时间|created|updated|year|month|day/i;
const GEO_PATTERNS =
  /latitude|longitude|lat|lng|lon|geo|coord|经度|纬度|address|城市|city|province|country|region/i;
const TEXT_PATTERNS =
  /description|desc|comment|review|text|body|content|abstract|summary|title|名称|描述|评论|简介/i;
const ID_PATTERNS =
  /^id$|_id$|^uid$|^key$|^index$|编号|序号|code/i;
const AMOUNT_PATTERNS =
  /amount|price|cost|revenue|salary|value|total|sum|金额|价格|费用|收入|销售/i;

/** Dtype strings returned by pandas that count as numeric. */
const NUMERIC_DTYPES = new Set([
  "int64", "int32", "int16", "int8",
  "float64", "float32", "float16",
  "uint8", "uint16", "uint32", "uint64",
  "Int64", "Int32", "Float64", "Float32",
]);
const DATETIME_DTYPES = new Set([
  "datetime64[ns]", "datetime64", "datetime64[ns, UTC]",
  "datetime64[us]", "datetime64[ms]",
]);
const CATEGORICAL_DTYPES = new Set(["object", "category", "string", "bool"]);

// ============================================================
// Classification Logic
// ============================================================

export function classifyDataset(
  file: FileInfo
): { profile: DatasetProfile; strategies: AnalysisStrategy[] } | null {
  const rp = file.richPreview;
  if (!rp || !rp.columns || rp.columns.length === 0) return null;

  const cols = rp.columns;
  const dtypes = rp.dtypes;
  const nullCounts = rp.null_counts;
  const totalCols = cols.length;
  const totalRows = rp.shape[0];

  // ---- Count column types ----
  let numericCount = 0;
  let datetimeCount = 0;
  let categoricalCount = 0;
  let textLikelyCols: string[] = [];
  let datetimeCols: string[] = [];
  let geoCols: string[] = [];
  let idCols: string[] = [];
  let amountCols: string[] = [];

  for (const col of cols) {
    const dtype = dtypes[col] || "object";

    // dtype-based classification
    if (NUMERIC_DTYPES.has(dtype)) numericCount++;
    else if (DATETIME_DTYPES.has(dtype)) {
      datetimeCount++;
      datetimeCols.push(col);
    } else if (CATEGORICAL_DTYPES.has(dtype)) categoricalCount++;

    // name-based heuristic enrichment
    if (DATETIME_PATTERNS.test(col) && !datetimeCols.includes(col)) {
      datetimeCols.push(col);
    }
    if (GEO_PATTERNS.test(col)) geoCols.push(col);
    if (TEXT_PATTERNS.test(col)) textLikelyCols.push(col);
    if (ID_PATTERNS.test(col)) idCols.push(col);
    if (AMOUNT_PATTERNS.test(col)) amountCols.push(col);
  }

  const numericRatio = totalCols > 0 ? numericCount / totalCols : 0;
  const categoricalRatio = totalCols > 0 ? categoricalCount / totalCols : 0;
  const hasDatetime = datetimeCols.length > 0;
  const hasText = textLikelyCols.length > 0;

  // Missing-data heuristic
  const totalNulls = Object.values(nullCounts).reduce(
    (s, v) => s + v,
    0
  );
  const hasMissingData = totalNulls > 0 && totalNulls / (totalRows * totalCols) > 0.01;

  // ---- Determine primary category via scoring ----
  // Each category gets a score; highest wins
  const scores: Partial<Record<DatasetCategory, number>> = {};
  const tags: string[] = [];

  // Time series: needs datetime + predominantly numeric (measurements over time)
  if (hasDatetime && numericRatio > 0.5) {
    scores.time_series = 3 + numericRatio * 2; // max ~5
  } else if (hasDatetime && numericCount >= 2) {
    scores.time_series = 2; // weaker signal
  }

  // Text heavy: prominent text columns
  if (textLikelyCols.length >= 3) {
    scores.text_heavy = 5;
  } else if (textLikelyCols.length >= 2) {
    scores.text_heavy = 3 + categoricalRatio;
  } else if (textLikelyCols.length === 1 && categoricalRatio > 0.5) {
    scores.text_heavy = 2;
  }

  // Geospatial: needs at least 2 geo columns (lat + lng)
  if (geoCols.length >= 2) {
    scores.geospatial = 4;
  }

  // Transactional: needs ID + datetime + amount-like columns
  if (amountCols.length > 0 && idCols.length > 0 && hasDatetime) {
    scores.transactional = 4 + (amountCols.length > 1 ? 1 : 0);
  }

  // High dimensional: many numeric columns
  if (totalCols > 30 && numericRatio > 0.7) {
    scores.high_dimensional = 5;
  } else if (totalCols > 15 && numericRatio > 0.8) {
    scores.high_dimensional = 3;
  }

  // Cross-sectional: default for mixed data that doesn't fit others
  if (numericRatio > 0.3) {
    scores.cross_sectional = 1; // base score, lowest priority
  }

  // Pick category with highest score
  let category: DatasetCategory = "general";
  let maxScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      category = cat as DatasetCategory;
    }
  }

  // Build tags from all relevant signals (independent of primary category)
  if (hasDatetime) tags.push("temporal");
  if (geoCols.length >= 2) tags.push("geospatial");
  if (textLikelyCols.length >= 1) tags.push("text");
  if (amountCols.length > 0 && idCols.length > 0 && hasDatetime)
    tags.push("transactional");
  if (totalCols > 15 && numericRatio > 0.7) tags.push("high_dimensional");
  if (hasMissingData) tags.push("missing_data");
  if (numericRatio > 0.6) tags.push("numeric_heavy");
  if (categoricalRatio > 0.6) tags.push("categorical_heavy");

  // ---- Build summary ----
  const summary = buildSummary(
    category,
    totalRows,
    totalCols,
    numericCount,
    categoricalCount,
    datetimeCols,
    geoCols,
    textLikelyCols
  );

  const profile: DatasetProfile = {
    category,
    tags,
    summary,
    numericRatio,
    categoricalRatio,
    hasDatetime,
    hasText,
    hasMissingData,
    rowCount: totalRows,
    colCount: totalCols,
  };

  // ---- Select strategies ----
  const strategies = selectStrategies(profile, {
    datetimeCols,
    geoCols,
    textLikelyCols,
    idCols,
    amountCols,
    numericCount,
    categoricalCount,
    cols,
  });

  return { profile, strategies };
}

// ============================================================
// Strategy Selection
// ============================================================

interface ColContext {
  datetimeCols: string[];
  geoCols: string[];
  textLikelyCols: string[];
  idCols: string[];
  amountCols: string[];
  numericCount: number;
  categoricalCount: number;
  cols: string[];
}

function selectStrategies(
  profile: DatasetProfile,
  ctx: ColContext
): AnalysisStrategy[] {
  const strategies: AnalysisStrategy[] = [];

  // ---- Always: Basic EDA ----
  strategies.push({
    name: "探索性数据分析 (EDA)",
    reason: "任何数据集的分析第一步",
    steps: [
      "查看数据形状、类型、缺失值概况",
      "数值列分布直方图 / 箱线图",
      "分类列频率统计（value_counts）",
      "关键统计量（均值、中位数、标准差、偏度、峰度）",
    ],
    tools: ["pandas.describe()", "matplotlib/seaborn distplot", "df.info()"],
    priority: 10,
  });

  // ---- Missing data handling ----
  if (profile.hasMissingData) {
    strategies.push({
      name: "缺失值分析与处理",
      reason: "数据集存在显著缺失值",
      steps: [
        "可视化缺失模式（missingno 矩阵热力图）",
        "判断缺失机制（MCAR/MAR/MNAR）",
        "选择处理策略：删除 / 均值填充 / 中位数填充 / 插值 / 模型预测填充",
        "处理前后分布对比验证",
      ],
      tools: ["missingno", "sklearn.impute.SimpleImputer", "df.interpolate()"],
      priority: 9,
    });
  }

  // ---- Time Series ----
  if (profile.category === "time_series" || profile.hasDatetime) {
    strategies.push({
      name: "时间序列分析",
      reason: `检测到时间列: ${ctx.datetimeCols.join(", ")}`,
      steps: [
        `将 ${ctx.datetimeCols[0]} 转为 datetime 并设为索引`,
        "绘制时间趋势线（line plot）",
        "按时间粒度（日/周/月）聚合分析",
        "使用滑动平均（rolling mean）平滑趋势",
        "季节性分解（seasonal_decompose）：趋势 + 季节性 + 残差",
        "如需预测：考虑 ARIMA / Prophet / 指数平滑",
      ],
      tools: [
        "pd.to_datetime()",
        "df.resample()",
        "statsmodels.tsa.seasonal_decompose",
        "matplotlib 时间趋势图",
      ],
      priority: 9,
    });
  }

  // ---- Correlation & Regression (multiple numeric cols) ----
  if (ctx.numericCount >= 3) {
    strategies.push({
      name: "相关性与回归分析",
      reason: `有 ${ctx.numericCount} 个数值列，适合研究变量间关系`,
      steps: [
        "计算相关系数矩阵（pearson / spearman）",
        "绘制热力图可视化相关性",
        "识别强相关变量对",
        "散点图矩阵（pairplot）探索分布与关系",
        "如果有明确的因变量，建立回归模型（线性回归 / 多项式回归）",
      ],
      tools: [
        "df.corr()",
        "seaborn.heatmap",
        "seaborn.pairplot",
        "sklearn.linear_model.LinearRegression",
      ],
      priority: 8,
    });
  }

  // ---- Categorical / Grouping Analysis ----
  if (ctx.categoricalCount >= 1 && ctx.numericCount >= 1) {
    strategies.push({
      name: "分组对比分析",
      reason: "同时存在分类变量和数值变量，可按类别比较",
      steps: [
        "按分类列 groupby 聚合数值列（mean, median, sum）",
        "绘制分组柱状图 / 箱线图",
        "如有多个分类维度，使用交叉分析（pivot_table）",
        "统计检验：t-test / ANOVA 检验组间差异显著性",
      ],
      tools: [
        "df.groupby().agg()",
        "pd.pivot_table()",
        "seaborn.boxplot / barplot",
        "scipy.stats.ttest_ind / f_oneway",
      ],
      priority: 7,
    });
  }

  // ---- High Dimensional / Dimensionality Reduction ----
  if (profile.tags.includes("high_dimensional") || ctx.numericCount > 10) {
    strategies.push({
      name: "降维与特征分析",
      reason: `数值列较多（${ctx.numericCount}个），适合降维探索`,
      steps: [
        "标准化数据（StandardScaler）",
        "PCA 主成分分析，查看方差解释比",
        "可视化前2-3个主成分的散点图",
        "特征重要性排序（如有目标变量）",
        "如需非线性降维：考虑 t-SNE / UMAP",
      ],
      tools: [
        "sklearn.preprocessing.StandardScaler",
        "sklearn.decomposition.PCA",
        "sklearn.manifold.TSNE",
      ],
      priority: 7,
    });
  }

  // ---- Clustering (numeric heavy, no clear label) ----
  if (ctx.numericCount >= 3 && ctx.categoricalCount <= ctx.numericCount) {
    strategies.push({
      name: "聚类分析",
      reason: "多个数值特征，适合发现自然分组模式",
      steps: [
        "数据标准化（StandardScaler）",
        "肘部法则（Elbow Method）确定最佳聚类数",
        "轮廓系数评估聚类质量",
        "K-Means 或 DBSCAN 聚类",
        "可视化聚类结果（降维到2D后标色）",
        "分析各聚类的特征差异",
      ],
      tools: [
        "sklearn.cluster.KMeans / DBSCAN",
        "sklearn.metrics.silhouette_score",
        "matplotlib scatter",
      ],
      priority: 6,
    });
  }

  // ---- Text Analysis ----
  if (profile.hasText || profile.category === "text_heavy") {
    strategies.push({
      name: "文本分析",
      reason: `检测到文本列: ${ctx.textLikelyCols.join(", ")}`,
      steps: [
        "文本长度分布统计",
        "词频统计 / 词云可视化",
        "文本清洗（去停用词、标点、大小写统一）",
        "如中文文本：使用 jieba 分词",
        "TF-IDF 特征提取",
        "如需分类：使用 Naive Bayes / SVM 等文本分类模型",
        "情感分析（如适用）",
      ],
      tools: [
        "jieba（中文分词）",
        "wordcloud",
        "sklearn.feature_extraction.text.TfidfVectorizer",
        "collections.Counter",
      ],
      priority: 7,
    });
  }

  // ---- Geospatial ----
  if (profile.tags.includes("geospatial")) {
    strategies.push({
      name: "地理空间分析",
      reason: `检测到地理列: ${ctx.geoCols.join(", ")}`,
      steps: [
        "地图散点图可视化数据分布",
        "按地区聚合统计",
        "热力图展示密度分布",
        "如需聚类：基于坐标的 DBSCAN 空间聚类",
      ],
      tools: ["folium", "matplotlib scatter（经纬度）", "geopandas"],
      priority: 7,
    });
  }

  // ---- Transactional / Business ----
  if (profile.tags.includes("transactional")) {
    strategies.push({
      name: "业务/交易分析",
      reason: "检测到交易类数据特征（ID + 时间 + 金额）",
      steps: [
        "交易量趋势分析（按日/周/月）",
        "客户/产品维度的分析（Top-N、帕累托分析）",
        "RFM 分析（最近一次消费、消费频率、消费金额）",
        "同比/环比增长率计算",
        "异常交易检测",
      ],
      tools: [
        "df.groupby().agg()",
        "df.resample()",
        "matplotlib 趋势图 + 柱状图",
      ],
      priority: 8,
    });
  }

  // ---- Distribution & Outlier Analysis ----
  if (ctx.numericCount >= 2) {
    strategies.push({
      name: "分布与异常值分析",
      reason: "数值列需要检测分布特征和异常值",
      steps: [
        "各数值列直方图 + KDE 密度曲线",
        "QQ 图检验正态性",
        "IQR 法 / Z-score 法检测异常值",
        "异常值可视化（箱线图标注）",
        "判断是否需要对数变换或标准化",
      ],
      tools: [
        "seaborn.histplot(kde=True)",
        "scipy.stats.probplot（QQ图）",
        "numpy percentile（IQR）",
      ],
      priority: 5,
    });
  }

  // Sort by priority descending
  strategies.sort((a, b) => b.priority - a.priority);

  return strategies;
}

// ============================================================
// Prompt Formatting
// ============================================================

/**
 * Format the classification result into a prompt block
 * that gets injected alongside the file context.
 */
export function formatStrategyPrompt(
  fileName: string,
  profile: DatasetProfile,
  strategies: AnalysisStrategy[]
): string {
  const lines: string[] = [];

  lines.push(`\n🔍 【${fileName} 数据画像】`);
  lines.push(`类型: ${CATEGORY_LABELS[profile.category]}  |  ${profile.summary}`);
  if (profile.tags.length > 0) {
    lines.push(`特征标签: ${profile.tags.join(", ")}`);
  }

  lines.push(`\n📐 【推荐分析策略】（按适配度排序）`);
  for (const s of strategies) {
    lines.push(`\n▸ ${s.name}（适配理由: ${s.reason}）`);
    lines.push(`  步骤:`);
    s.steps.forEach((step, i) => lines.push(`    ${i + 1}. ${step}`));
    lines.push(`  推荐工具: ${s.tools.join(", ")}`);
  }

  lines.push(
    `\n💡 请根据用户的具体问题，从上述策略中选择最合适的方案执行。如果用户没有明确指定分析方向，优先执行 EDA 并基于发现推荐下一步分析。`
  );

  return lines.join("\n");
}

const CATEGORY_LABELS: Record<DatasetCategory, string> = {
  time_series: "📈 时间序列数据",
  cross_sectional: "📊 截面/表格数据",
  text_heavy: "📝 文本密集型数据",
  geospatial: "🗺️ 地理空间数据",
  transactional: "💰 交易/业务数据",
  high_dimensional: "🔬 高维数据",
  general: "📋 通用数据集",
};

// ============================================================
// Helpers
// ============================================================

function buildSummary(
  category: DatasetCategory,
  rows: number,
  cols: number,
  numericCount: number,
  categoricalCount: number,
  datetimeCols: string[],
  geoCols: string[],
  textCols: string[]
): string {
  const parts: string[] = [`${rows}行 × ${cols}列`];
  parts.push(`${numericCount}个数值列, ${categoricalCount}个分类列`);
  if (datetimeCols.length > 0)
    parts.push(`时间列: ${datetimeCols.join(", ")}`);
  if (geoCols.length > 0) parts.push(`地理列: ${geoCols.join(", ")}`);
  if (textCols.length > 0) parts.push(`文本列: ${textCols.join(", ")}`);
  return parts.join(" | ");
}
