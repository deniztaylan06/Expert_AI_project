import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Cell, ReferenceLine, LabelList,
  ScatterChart, Scatter, ZAxis,
} from "recharts";

// === DESIGN SYSTEM ===
const C = {
  bg: "#0B1120", card: "#131C31", cardAlt: "#0F1829", border: "#1B2A45",
  accent: "#00D4AA", gold: "#F0B942", blue: "#3B82F6", coral: "#EF6461",
  purple: "#A78BFA", orange: "#F97316", teal: "#14B8A6",
  white: "#EEF2F7", light: "#B8C7DC", muted: "#6B7F99",
  navy: "#0E1A30",
};

// === ATECO SECTOR NAMES (complete map - fallback to code if unknown) ===
const ATECO_NAMES = {
  10: "Food Manufacturing",        25: "Metal Products",
  41: "Construction of Buildings", 43: "Specialised Construction",
  45: "Motor Vehicle Trade",       46: "Wholesale Trade",
  47: "Retail Trade",              56: "Food & Beverage Services",
  62: "Information Technology",    68: "Real Estate Activities",
  71: "Engineering & Consulting",  77: "Rental & Leasing",
  82: "Administrative Support",
};

// === STATIC DEFINITIONS ===
const BUCKET_RANGES = [
  { range: "<-50%",    lo: -Infinity, hi: -50,      c: C.coral },
  { range: "-50:-25%", lo: -50,       hi: -25,      c: "#FF9F7F" },
  { range: "-25:-10%", lo: -25,       hi: -10,      c: "#FFCC80" },
  { range: "-10:0%",   lo: -10,       hi: 0,        c: C.gold },
  { range: "0:10%",    lo: 0,         hi: 10,       c: "#A5D6A7" },
  { range: "10:25%",   lo: 10,        hi: 25,       c: "#66BB6A" },
  { range: "25:50%",   lo: 25,        hi: 50,       c: C.blue },
  { range: "50:100%",  lo: 50,        hi: 100,      c: "#42A5F5" },
  { range: "100:500%", lo: 100,       hi: 500,      c: C.purple },
  { range: ">500%",    lo: 500,       hi: Infinity, c: "#7E57C2" },
];

const SIZE_TIERS = [
  { name: "€0-25M",     lo: 0,      hi: 2.5e7 },
  { name: "€25-50M",    lo: 2.5e7,  hi: 5e7 },
  { name: "€50-100M",   lo: 5e7,    hi: 1e8 },
  { name: "€100-250M",  lo: 1e8,    hi: 2.5e8 },
  { name: "€250-500M",  lo: 2.5e8,  hi: 5e8 },
  { name: "€500M-1B",   lo: 5e8,    hi: 1e9 },
  { name: "€1B-2B",     lo: 1e9,    hi: 2e9 },
  { name: "€2B-10B",    lo: 2e9,    hi: 1e10 },
  { name: ">€10B",      lo: 1e10,   hi: Infinity },
];

const TIER_COLORS = [
  "#3B82F6", "#38BDF8", "#14B8A6", "#00D4AA", "#84CC16",
  "#F0B942", "#F97316", "#EF6461", "#A78BFA", "#7C3AED",
];

// ===  CSV PARSING ===
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim(); });
    return row;
  });
}

// === STATS HELPERS ===
function sortedCopy(arr) { return [...arr].sort((a, b) => a - b); }
function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function medianOf(arr) { return arr.length ? pct(sortedCopy(arr), 50) : 0; }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
// Returns { domain: [0, niceMax], ticks: [...] } with evenly-spaced round numbers
function niceAxisConfig(maxVal) {
  if (!maxVal || maxVal <= 0) return { domain: [0, 10], ticks: [0, 2, 4, 6, 8, 10] };
  const raw = maxVal * 1.08;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  const interval = raw / 5;
  const step = steps.find(s => s >= interval) || steps[steps.length - 1];
  const top = Math.ceil(raw / step) * step;
  const ticks = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { domain: [0, top], ticks };
}
function fmtM(euros) {
  const m = euros / 1e6;
  return m >= 1000 ? `€${(m / 1000).toFixed(1)}B` : `€${Math.round(m)}M`;
}

// === SECTOR FILL: opacity-scaled color by performance magnitude ===
function sectorFill(val) {
  const intensity = Math.min(Math.abs(val) / 50, 1);
  return val > 0
    ? `rgba(0,212,170,${0.35 + intensity * 0.65})`
    : `rgba(239,100,97,${0.35 + intensity * 0.65})`;
}

// === REGIONAL MAP DATA ===
function computeRegionMapData(rows) {
  const filtered = rows.filter(r => r.fiscal_year >= 2018 && r.fiscal_year <= 2020);
  const byRegion = {};
  for (const r of filtered) {
    if (!r.region) continue;
    if (!byRegion[r.region]) byRegion[r.region] = [];
    byRegion[r.region].push(r);
  }
  const result = {};
  for (const [region, rr] of Object.entries(byRegion)) {
    const uniqueCo   = new Set(rr.map(r => r.company_id)).size;
    const growthVals = rr.map(r => r.revenue_change).filter(v => v !== null && isFinite(v));
    const pvVals     = rr.map(r => r.production_value).filter(v => v > 0 && isFinite(v));
    const yrsVals    = rr.map(r => r.years_in_business).filter(v => v > 0 && isFinite(v));
    const sectorCnt  = {};
    for (const r of rr) if (r.ateco_sector) sectorCnt[r.ateco_sector] = (sectorCnt[r.ateco_sector] || 0) + 1;
    const topCode    = Object.entries(sectorCnt).sort((a, b) => b[1] - a[1])[0]?.[0];
    result[region] = {
      companies:      uniqueCo,
      median_growth:  round2(medianOf(growthVals)),
      median_revenue: medianOf(pvVals),
      total_obs:      growthVals.length,
      gt100_count:    growthVals.filter(v => v > 100).length,
      neg50_count:    growthVals.filter(v => v < -50).length,
      avg_years:      yrsVals.length ? round2(yrsVals.reduce((a, b) => a + b, 0) / yrsVals.length) : 0,
      top_sector:     topCode ? `ATECO ${String(topCode).padStart(2, "0")}` : "N/A",
      total_revenue:  rr.reduce((s, r) => s + r.production_value, 0),
    };
  }
  // Assign ranks by company count (1 = most companies)
  Object.entries(result)
    .sort((a, b) => b[1].companies - a[1].companies)
    .forEach(([region], i) => { result[region].rank = i + 1; });
  // National benchmarks across all filtered rows
  const allGrowth = filtered.map(r => r.revenue_change).filter(v => v !== null && isFinite(v));
  const allPV     = filtered.map(r => r.production_value).filter(v => v > 0 && isFinite(v));
  result._national = {
    medianGrowth:  round2(medianOf(allGrowth)),
    medianRevenue: medianOf(allPV),
    numRegions:    Object.keys(result).length,
  };
  return result;
}

// === REGIONAL HISTORICAL DATA (all years 2018-2022, revenue_change_next) ===
function computeRegionHistoricalData(rows) {
  const valid = rows.filter(r =>
    r.revenue_change_next !== null && isFinite(r.revenue_change_next) &&
    r.fiscal_year >= 2018 && r.fiscal_year <= 2022 && r.region
  );
  const byRegion = {};
  for (const r of valid) {
    if (!byRegion[r.region]) byRegion[r.region] = [];
    byRegion[r.region].push(r.revenue_change_next);
  }
  const result = Object.entries(byRegion).map(([region, vals]) => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    const median = round1(pct(s, 50));
    const pctDecline = round1(vals.filter(v => v < -50).length / n * 100);
    const pctHyper   = round1(vals.filter(v => v > 100).length / n * 100);
    const pctNormal  = round1(100 - pctDecline - pctHyper);
    const q25 = round1(pct(s, 25));
    const q75 = round1(pct(s, 75));
    return { region, n, median, pctDecline, pctHyper, pctNormal, q25, q75 };
  });
  return result.sort((a, b) => b.median - a.median);
}

// === SECTOR HISTORICAL DATA (all years 2018-2022, revenue_change_next) ===
// === COVID SECTOR IMPACT (uses raw revenue_change column) ===
// revenue_change on a fiscal_year=Y row = change from Y-1 to Y
function computeCovidSectorImpact(rows, topSectorCodes) {
  const transitions = [
    { key: "2018→19", year: 2019 },
    { key: "2019→20", year: 2020 },
    { key: "2020→21", year: 2021 },
  ];
  return topSectorCodes.slice(0, 8).map(code => {
    const entry = { sector: ATECO_NAMES[code] || `Code ${code}` };
    for (const { key, year } of transitions) {
      const vals = rows
        .filter(r =>
          r.ateco_sector === code &&
          r.fiscal_year  === year &&
          r.revenue_change !== null &&
          isFinite(r.revenue_change)
        )
        .map(r => r.revenue_change);
      entry[key] = vals.length ? round1(medianOf(vals)) : null;
    }
    return entry;
  }).sort((a, b) => (a["2019→20"] ?? 0) - (b["2019→20"] ?? 0)); // sorted: worst COVID shock at top
}

// === REVENUE SIGNALS (pooled 2018-2020) ===
function computeRevenueSignals(rows, byCompany) {
  // Assign year-specific decile tiers (Q1-Q10) by production_value rank within each year
  const tierByKey = {}; // `${company_id}_${fiscal_year}` → tier 1-10
  for (const yr of [2018, 2019, 2020, 2021]) {
    const yrRows = rows.filter(r => r.fiscal_year === yr && r.production_value > 0);
    const sorted = [...yrRows].sort((a, b) => a.production_value - b.production_value);
    const n = sorted.length;
    sorted.forEach((r, i) => {
      tierByKey[`${r.company_id}_${yr}`] = Math.min(10, Math.floor(i / n * 10) + 1);
    });
  }

  // Build enriched rows with tier, tier_next, target, equity gap
  const enriched = [];
  for (const [compId, yearMap] of Object.entries(byCompany)) {
    for (const yr of [2018, 2019, 2020]) {
      const base = yearMap[yr];
      if (!base) continue;
      const next = yearMap[yr + 1];
      if (!next || next.revenue_change === null || !isFinite(next.revenue_change)) continue;
      const target    = next.revenue_change;
      const tier_t    = tierByKey[`${compId}_${yr}`];
      const tier_next = tierByKey[`${compId}_${yr + 1}`];
      const prevRow   = yearMap[yr - 1];
      let equityGap   = null;
      if (prevRow && base.total_assets > 0 && isFinite(base.shareholders_equity) &&
          isFinite(prevRow.shareholders_equity) && isFinite(base.net_profit_loss)) {
        equityGap = (base.shareholders_equity - prevRow.shareholders_equity - base.net_profit_loss) / base.total_assets;
      }
      enriched.push({ compId, yr, target, tier_t, tier_next, equityGap, revenue_change_t: base.revenue_change });
    }
  }

  // 1. Revenue Tier → Target
  const tierTarget = Array.from({ length: 10 }, (_, i) => {
    const t = i + 1, tr = enriched.filter(r => r.tier_t === t);
    return { tier: `Q${t}`, medTarget: round1(medianOf(tr.map(r => r.target))), n: tr.length };
  });

  // 2. Tier Shift → Target
  const shiftBuckets = [
    { label: "≤-2", check: s => s <= -2 },
    { label: "-1",  check: s => s === -1 },
    { label: "0",   check: s => s === 0  },
    { label: "+1",  check: s => s === 1  },
    { label: "≥+2", check: s => s >= 2  },
  ];
  const tierShift = shiftBuckets.map(b => {
    const sr = enriched.filter(r => r.tier_t != null && r.tier_next != null && b.check(r.tier_next - r.tier_t));
    return { shift: b.label, medTarget: round1(medianOf(sr.map(r => r.target))), n: sr.length };
  });

  // 3. Tier Persistence Stay Rate
  const tierPersistence = Array.from({ length: 10 }, (_, i) => {
    const t = i + 1, tr = enriched.filter(r => r.tier_t === t && r.tier_next != null);
    if (!tr.length) return { tier: `Q${t}`, stay: 0, up: 0, down: 0, n: 0 };
    const stay = round1(tr.filter(r => r.tier_next === t).length / tr.length * 100);
    const up   = round1(tr.filter(r => r.tier_next > t).length  / tr.length * 100);
    const down = round1(tr.filter(r => r.tier_next < t).length  / tr.length * 100);
    return { tier: `Q${t}`, stay, up, down, n: tr.length };
  });

  // 4. Extreme Event Probability by Tier
  const extremeEvents = Array.from({ length: 10 }, (_, i) => {
    const t = i + 1, tr = enriched.filter(r => r.tier_t === t);
    if (!tr.length) return { tier: `Q${t}`, pct100: 0, pct200: 0, pctNeg50: 0, n: 0 };
    const pct100   = round1(tr.filter(r => r.target > 100).length  / tr.length * 100);
    const pct200   = round1(tr.filter(r => r.target > 200).length  / tr.length * 100);
    const pctNeg50 = round1(tr.filter(r => r.target < -50).length  / tr.length * 100);
    return { tier: `Q${t}`, pct100, pct200, pctNeg50, n: tr.length };
  });

  // 5. Growth Momentum Mean Reversion
  const momentumBuckets = [
    { label: "≤-50%",          check: rc => rc <= -50 },
    { label: "-50% to +100%",  check: rc => rc > -50 && rc <= 100 },
    { label: "+100 to +200%",  check: rc => rc > 100 && rc <= 200 },
    { label: ">+200%",         check: rc => rc > 200 },
  ];
  const growthMomentum = momentumBuckets.map(b => {
    const mr = enriched.filter(r => r.revenue_change_t !== null && isFinite(r.revenue_change_t) && b.check(r.revenue_change_t));
    return { bucket: b.label, medTarget: round1(medianOf(mr.map(r => r.target))), n: mr.length };
  });

  // 6. Equity Gap Capital Flow Signal
  const egRows = enriched.filter(r => r.equityGap !== null && isFinite(r.equityGap));
  const egBuckets = [
    { label: "Withdrawal (≤-4%)", check: g => g <= -0.04 },
    { label: "Neutral",           check: g => g > -0.04 && g < 0.04 },
    { label: "Injection (≥+4%)", check: g => g >= 0.04 },
  ];
  const equityGap = egBuckets.map(b => {
    const gr = egRows.filter(r => b.check(r.equityGap));
    return { group: b.label, medTarget: round1(medianOf(gr.map(r => r.target))), n: gr.length };
  });

  return { tierTarget, tierShift, tierPersistence, extremeEvents, growthMomentum, equityGap };
}

// === CORRELATION MATRIX - two feature groups ===
const CORR_FINANCIAL = [
  { key: "production_value",    label: "Prod.Val" },
  { key: "total_assets",        label: "Assets" },
  { key: "shareholders_equity", label: "Equity" },
  { key: "total_debt",          label: "Debt" },
  { key: "operating_income",    label: "Op.Inc" },
  { key: "net_profit_loss",     label: "NetPft" },
  { key: "revenue_change",      label: "RevChg" },
  { key: "revenue_change_next", label: "RCN★" },
  { key: "production_value_next", label: "PVN★" },
];

const CORR_RATIOS = [
  { key: "profit_margin",      label: "Margin" },
  { key: "roi",                label: "ROI" },
  { key: "leverage",           label: "Levg" },
  { key: "debt_to_assets",     label: "D/A" },
  { key: "current_ratio",      label: "CR" },
  { key: "years_in_business",  label: "YrsBiz" },
  { key: "revenue_change",     label: "RevChg" },
  { key: "revenue_change_next", label: "RCN★" },
  { key: "production_value_next", label: "PVN★" },
];

function computeMatrix(rows, features) {
  const valid = rows.filter(r =>
    r.revenue_change_next !== null && isFinite(r.revenue_change_next) &&
    r.production_value_next !== null && isFinite(r.production_value_next)
  );
  const n = valid.length;
  if (n < 2) return { labels: features.map(f => f.label), matrix: [] };

  const cols = features.map(f => valid.map(r => {
    const v = r[f.key];
    return (v === null || v === undefined || !isFinite(v)) ? 0 : v;
  }));
  const means = cols.map(c => c.reduce((a, b) => a + b, 0) / n);
  const stds  = cols.map((c, i) => {
    const m = means[i];
    return Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / n);
  });

  const matrix = features.map((_, i) =>
    features.map((_, j) => {
      if (stds[i] < 1e-10 || stds[j] < 1e-10) return i === j ? 1 : 0;
      let sum = 0;
      for (let k = 0; k < n; k++) sum += (cols[i][k] - means[i]) * (cols[j][k] - means[j]);
      return round2(sum / (n * stds[i] * stds[j]));
    })
  );

  return { labels: features.map(f => f.label), matrix, n };
}

function computeCorrelationData(rows) {
  // Pooled across all years - for DataOverview
  const financial = computeMatrix(rows, CORR_FINANCIAL);
  const ratios    = computeMatrix(rows, CORR_RATIOS);

  // Feature→target corrs (used for the bar chart comparison)
  const allFeatures = [
    { key: "production_value",    label: "Prod. Value" },
    { key: "total_assets",        label: "Tot. Assets" },
    { key: "shareholders_equity", label: "SH Equity" },
    { key: "total_debt",          label: "Tot. Debt" },
    { key: "operating_income",    label: "Op. Income" },
    { key: "net_profit_loss",     label: "Net Profit" },
    { key: "profit_margin",       label: "Prft. Margin" },
    { key: "roi",                 label: "ROI" },
    { key: "leverage",            label: "Leverage" },
    { key: "debt_to_assets",      label: "Debt/Assets" },
    { key: "current_ratio",       label: "Curr. Ratio" },
    { key: "years_in_business",   label: "Yrs in Biz" },
    { key: "revenue_change",      label: "Rev. Change" },
    { key: "revenue_change_next", label: "RC Next ★" },
    { key: "production_value_next", label: "PV Next ★" },
  ];
  const full = computeMatrix(rows, allFeatures);
  const pvNextIdx = allFeatures.findIndex(f => f.key === "production_value_next");
  const rcNextIdx = allFeatures.findIndex(f => f.key === "revenue_change_next");
  const featureTargetCorrs = allFeatures
    .filter(f => f.key !== "production_value_next" && f.key !== "revenue_change_next")
    .map(f => {
      const fi = allFeatures.findIndex(ff => ff.key === f.key);
      return { label: f.label, corrPV: full.matrix[fi]?.[pvNextIdx] ?? 0, corrRC: full.matrix[fi]?.[rcNextIdx] ?? 0 };
    })
    .sort((a, b) => Math.abs(b.corrPV) - Math.abs(a.corrPV));

  return { financial, ratios, featureTargetCorrs };
}

function computeYearCorrData(rows, yr) {
  const yrRows = rows.filter(r => r.fiscal_year === yr);
  return {
    financial: computeMatrix(yrRows, CORR_FINANCIAL),
    ratios:    computeMatrix(yrRows, CORR_RATIOS),
  };
}

// === YEARS IN BUSINESS ANALYSIS ===
const AGE_BUCKETS = [
  { label: "Startup\n(≤3yr)",     display: "Startup (≤3yr)",     check: y => y > 0 && y <= 3 },
  { label: "Young\n(4-10yr)",     display: "Young (4-10yr)",     check: y => y > 3 && y <= 10 },
  { label: "Mature\n(11-25yr)",   display: "Mature (11-25yr)",   check: y => y > 10 && y <= 25 },
  { label: "Established\n(>25yr)",display: "Established (>25yr)",check: y => y > 25 },
];

function computeYearsInBusinessAnalysis(rows) {
  const valid = rows.filter(r =>
    r.years_in_business > 0 &&
    r.revenue_change !== null && isFinite(r.revenue_change) &&
    [2018, 2019, 2020].includes(r.fiscal_year)
  );
  const buckets = AGE_BUCKETS.map(b => {
    const br = valid.filter(r => b.check(r.years_in_business));
    return { label: b.display, n: br.length, medTarget: round1(medianOf(br.map(r => r.revenue_change))) };
  });

  // Pearson r between years_in_business and revenue_change
  const yvs = valid.map(r => r.years_in_business);
  const tvs = valid.map(r => r.revenue_change);
  const n   = valid.length;
  const my  = yvs.reduce((a, b) => a + b, 0) / n;
  const mt  = tvs.reduce((a, b) => a + b, 0) / n;
  const sy  = Math.sqrt(yvs.reduce((s, v) => s + (v - my) ** 2, 0) / n);
  const st  = Math.sqrt(tvs.reduce((s, v) => s + (v - mt) ** 2, 0) / n);
  const pearsonR = (sy < 1e-10 || st < 1e-10) ? 0
    : round2(yvs.reduce((s, v, i) => s + (v - my) * (tvs[i] - mt), 0) / (n * sy * st));

  // Scatter data by year (sampled for performance) - clamp y to avoid extreme outliers
  const MAX_PTS = 400;
  const scatterByYear = {};
  for (const yr of [2018, 2019, 2020]) {
    const yrRows = rows.filter(r =>
      r.fiscal_year === yr &&
      r.years_in_business > 0 && r.years_in_business <= 70 &&
      r.revenue_change_next !== null && isFinite(r.revenue_change_next) &&
      r.revenue_change_next >= 0 && r.revenue_change_next <= 6000
    );
    const step = yrRows.length > MAX_PTS ? Math.ceil(yrRows.length / MAX_PTS) : 1;
    scatterByYear[yr] = yrRows.filter((_, i) => i % step === 0).map(r => ({
      x: Math.round(r.years_in_business),
      y: Math.round(r.revenue_change_next),
    }));
  }

  return { buckets, pearsonR, n, scatterByYear };
}

// === OUTLIER DISTRIBUTION DATA ===
function computeMissingnessData(rows) {
  const filtered = rows.filter(r => [2018, 2019, 2020].includes(r.fiscal_year));
  const n = filtered.length;
  const features = [
    { key: "production_value",    label: "Production Value",    group: "Income Statement" },
    { key: "production_costs",    label: "Production Costs",    group: "Income Statement" },
    { key: "operating_income",    label: "Operating Income",    group: "Income Statement" },
    { key: "net_profit_loss",     label: "Net Profit / Loss",   group: "Income Statement" },
    { key: "total_assets",        label: "Total Assets",        group: "Balance Sheet" },
    { key: "total_fixed_assets",  label: "Fixed Assets",        group: "Balance Sheet" },
    { key: "current_assets",      label: "Current Assets",      group: "Balance Sheet" },
    { key: "shareholders_equity", label: "Shareholders Equity", group: "Balance Sheet" },
    { key: "total_debt",          label: "Total Debt",          group: "Balance Sheet" },
    { key: "short_term_debt",     label: "Short-Term Debt",     group: "Balance Sheet" },
    { key: "long_term_debt",      label: "Long-Term Debt",      group: "Balance Sheet" },
    { key: "roe",                 label: "ROE",                 group: "Ratios" },
    { key: "roi",                 label: "ROI",                 group: "Ratios" },
    { key: "leverage",            label: "Leverage",            group: "Ratios" },
    { key: "current_ratio",       label: "Current Ratio",       group: "Ratios" },
    { key: "debt_to_assets",      label: "Debt / Assets",       group: "Ratios" },
    { key: "years_in_business",   label: "Years in Business",   group: "Company Info" },
    { key: "revenue_change",      label: "Revenue Change",      group: "Target" },
  ];
  return features.map(f => {
    const missing = filtered.filter(r => r[f.key] === null || r[f.key] === undefined || r[f.key] === "" || (typeof r[f.key] === "number" && !isFinite(r[f.key]))).length;
    return { ...f, missing, pct: n > 0 ? round2(missing / n * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct);
}

function computeOutliersData(rows) {
  const variables = [
    { key: "production_value",    label: "Production Value" },
    { key: "total_assets",        label: "Total Assets" },
    { key: "total_debt",          label: "Total Debt" },
    { key: "production_costs",    label: "Production Costs" },
    { key: "shareholders_equity", label: "Shareholders Equity" },
  ];
  return variables.map(v => {
    const vals = rows.map(r => r[v.key]).filter(x => x > 0 && isFinite(x)).sort((a, b) => a - b);
    if (!vals.length) return { label: v.label, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p99: 0, n: 0 };
    return {
      label: v.label,
      p10: pct(vals, 10),
      p25: pct(vals, 25),
      p50: pct(vals, 50),
      p75: pct(vals, 75),
      p90: pct(vals, 90),
      p99: pct(vals, 99),
      n: vals.length,
    };
  });
}

// === MAIN DATA PROCESSING ===
function processData(rawRows) {
  // Parse all numeric fields up front
  const rows = rawRows.map(r => ({
    company_id:       r.company_id,
    fiscal_year:      parseInt(r.fiscal_year),
    region:           r.region,
    province:         r.province || null,
    ateco_sector:     parseInt(r.ateco_sector),
    legal_form:       r.legal_form,
    production_value:    parseFloat(r.production_value)    || 0,
    total_assets:        parseFloat(r.total_assets)        || 0,
    total_fixed_assets:  parseFloat(r.total_fixed_assets)  || 0,
    current_assets:      parseFloat(r.current_assets)      || 0,
    total_debt:          parseFloat(r.total_debt)          || 0,
    short_term_debt:     parseFloat(r.short_term_debt)     || 0,
    long_term_debt:      parseFloat(r.long_term_debt)      || 0,
    production_costs:    parseFloat(r.production_costs)    || 0,
    operating_income:    parseFloat(r.operating_income)    || 0,
    financial_income:    parseFloat(r.financial_income)    || 0,
    financial_expenses:  parseFloat(r.financial_expenses)  || 0,
    years_in_business:   parseFloat(r.years_in_business)   || 0,
    shareholders_equity: parseFloat(r.shareholders_equity) || 0,
    net_profit_loss:     parseFloat(r.net_profit_loss)     || 0,
    roe:                 parseFloat(r.roe)                 || 0,
    leverage:            parseFloat(r.leverage)            || 0,
    profit_margin:       parseFloat(r.profit_margin)       || 0,
    roi:                 parseFloat(r.roi)                 || 0,
    debt_to_assets:      parseFloat(r.debt_to_assets)      || 0,
    current_ratio:       parseFloat(r.current_ratio)       || 0,
    quick_ratio:         parseFloat(r.quick_ratio)         || 0,
    revenue_change:      r.revenue_change === "" ? null : parseFloat(r.revenue_change),
    // forward-looking targets (filled in second pass below)
    production_value_next: null,
    revenue_change_next:   null,
  }));

  // ── Derive all metadata dynamically from the data ──────────────────────────
  const sectorCounts    = {};
  const regionCounts    = {};
  const legalFormCounts = {};
  for (const r of rows) {
    if (r.ateco_sector) sectorCounts[r.ateco_sector]  = (sectorCounts[r.ateco_sector]  || 0) + 1;
    if (r.region)       regionCounts[r.region]        = (regionCounts[r.region]        || 0) + 1;
    if (r.legal_form)   legalFormCounts[r.legal_form] = (legalFormCounts[r.legal_form] || 0) + 1;
  }
  const dynSectorCodes = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1]).map(([c]) => parseInt(c));
  const dynRegions = Object.entries(regionCounts)
    .sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const dynLegalForms = Object.entries(legalFormCounts)
    .sort((a, b) => b[1] - a[1]).map(([f]) => f);
  // ──────────────────────────────────────────────────────────────────────────

  // Group by company to attach next-year target
  const byCompany = {};
  for (const r of rows) {
    if (!byCompany[r.company_id]) byCompany[r.company_id] = {};
    byCompany[r.company_id][r.fiscal_year] = r;
  }
  // Second pass: compute production_value_next and revenue_change_next per company
  for (const yearMap of Object.values(byCompany)) {
    for (const yr of [2018, 2019, 2020]) {
      const curr = yearMap[yr], next = yearMap[yr + 1];
      if (!curr) continue;
      if (next && next.production_value > 0 && curr.production_value > 0) {
        curr.production_value_next = next.production_value;
        curr.revenue_change_next   = ((next.production_value - curr.production_value) / curr.production_value) * 100;
      }
    }
  }
  const yearRows = { 2018: [], 2019: [], 2020: [] };
  for (const yearMap of Object.values(byCompany)) {
    for (const yr of [2018, 2019, 2020]) {
      const base = yearMap[yr];
      if (!base) continue;
      const next   = yearMap[yr + 1];
      const target = (next && next.revenue_change !== null && isFinite(next.revenue_change))
        ? next.revenue_change : null;
      yearRows[yr].push({ ...base, target });
    }
  }

  const yearsData = {};
  for (const yr of [2018, 2019, 2020]) {
    yearsData[yr] = computeYearStats(yr, yearRows[yr], dynSectorCodes, dynRegions, dynLegalForms);
  }

  const uniqueCompanies = new Set(rows.map(r => r.company_id)).size;
  const totalRows       = rows.filter(r => [2018, 2019, 2020].includes(r.fiscal_year)).length;

  const crossYear = [2018, 2019, 2020].map(yr => {
    const d = yearsData[yr];
    return { year: `${yr}→${yr + 1}`, median: d.target.median, q25: d.target.q25, q75: d.target.q75, iqr: d.target.iqr, std: d.target.std, companies: d.withTarget };
  });
  const crossMetrics = [2018, 2019, 2020].map(yr => {
    const d = yearsData[yr];
    return { year: String(yr), rev: d.medianRev, assets: d.medianAssets, margin: d.medianMargin, roi: d.medianROI, debt: d.medianDebt };
  });

  const covidSectorImpact        = computeCovidSectorImpact(rows, dynSectorCodes);
  const signalData               = computeRevenueSignals(rows, byCompany);
  const regionMapData            = computeRegionMapData(rows);
  const regionHistoricalData     = computeRegionHistoricalData(rows);
  const correlationData      = computeCorrelationData(rows);
  const yearsInBusinessData  = computeYearsInBusinessAnalysis(rows);
  const outliersData         = computeOutliersData(rows);
  const missingnessData      = computeMissingnessData(rows);
  const yearsCorrelationData = {
    2018: computeYearCorrData(rows, 2018),
    2019: computeYearCorrData(rows, 2019),
    2020: computeYearCorrData(rows, 2020),
  };

  return { yearsData, crossYear, crossMetrics, uniqueCompanies, totalRows, covidSectorImpact, signalData, regionMapData, regionHistoricalData, correlationData, yearsInBusinessData, outliersData, missingnessData, yearsCorrelationData };
}

// === PER-YEAR STATS (fully dynamic) ===
function computeYearStats(yr, rows, sectorCodes, regions, legalForms) {
  const withTargetRows = rows.filter(r => r.target !== null && isFinite(r.target));
  const targets        = withTargetRows.map(r => r.target);
  const sortedTargets  = sortedCopy(targets);

  const tMean   = targets.length ? round1(targets.reduce((a, b) => a + b, 0) / targets.length) : 0;
  const tMedian = round1(pct(sortedTargets, 50));
  const tQ25    = round1(pct(sortedTargets, 25));
  const tQ75    = round1(pct(sortedTargets, 75));
  const tIQR    = round1(tQ75 - tQ25);
  const tStd    = round1(Math.sqrt(
    targets.length ? targets.reduce((s, t) => s + (t - tMean) ** 2, 0) / targets.length : 0
  ));

  const quantiles = [1, 5, 10, 25, 50, 75, 90, 95, 99].map(q => ({
    q: `Q${q}`, val: round1(pct(sortedTargets, q)),
  }));
  const distBuckets = BUCKET_RANGES.map(b => ({
    range: b.range,
    count: targets.filter(t => t >= b.lo && t < b.hi).length,
    c: b.c,
  }));

  // Financial medians (fractions × 100 = %)
  const prodVals   = rows.map(r => r.production_value).filter(v => v > 0);
  const assetVals  = rows.map(r => r.total_assets).filter(v => v > 0);
  const marginVals = rows.map(r => r.profit_margin).filter(v => isFinite(v));
  const roiVals    = rows.map(r => r.roi).filter(v => isFinite(v));
  const debtVals   = rows.map(r => r.debt_to_assets).filter(v => isFinite(v));
  const crVals     = rows.map(r => r.current_ratio).filter(v => v > 0 && isFinite(v));

  const medianRev    = Math.round(medianOf(prodVals) / 1e6);
  const medianAssets = Math.round(medianOf(assetVals) / 1e6);
  const medianMargin = round2(medianOf(marginVals) * 100);
  const medianROI    = round2(medianOf(roiVals) * 100);
  const medianDebt   = round2(medianOf(debtVals) * 100);
  const medianCR     = round2(medianOf(crVals));

  // Production value quantiles (displayed in €M)
  const sortedProd  = sortedCopy(prodVals);
  const prodQuantiles = [10, 25, 50, 75, 90, 95, 99].map(q => ({
    q: `P${q}`, val: Math.round(pct(sortedProd, q) / 1e6),
  }));
  const prodMean = prodVals.length
    ? Math.round(prodVals.reduce((a, b) => a + b, 0) / prodVals.length / 1e6)
    : 0;

  // Size segmentation (median target by revenue tier)
  const sizeSeg = SIZE_TIERS.map(t => {
    const tr = withTargetRows.filter(r => r.production_value >= t.lo && r.production_value < t.hi);
    return { name: t.name, n: tr.length, medTarget: round1(medianOf(tr.map(r => r.target))) };
  });

  // Size distribution (company count per tier - all rows)
  const sizeDist = SIZE_TIERS.map(t => ({
    name:  t.name,
    count: rows.filter(r => r.production_value >= t.lo && r.production_value < t.hi).length,
  }));

  // Top 8 sectors - derived dynamically, sorted ascending for horizontal bar
  const sectors = sectorCodes.slice(0, 8).map(code => {
    const sr = withTargetRows.filter(r => r.ateco_sector === code);
    return {
      name:      ATECO_NAMES[code] || `Code ${code}`,
      n:         sr.length,
      medTarget: round1(medianOf(sr.map(r => r.target))),
    };
  }).filter(s => s.n > 0).sort((a, b) => a.medTarget - b.medTarget);

  // Top 8 regions - derived dynamically
  const regionAbbr = { "Emilia-Romagna": "Emilia-Rom.", "Friuli-Venezia Giulia": "Friuli-V.G." };
  const regionStats = regions.slice(0, 8).map(reg => {
    const rr = withTargetRows.filter(r => r.region === reg);
    return {
      name:      regionAbbr[reg] || reg,
      n:         rr.length,
      medTarget: round1(medianOf(rr.map(r => r.target))),
    };
  }).filter(r => r.n > 0);

  // Legal forms - derived dynamically, sorted by count
  const legal = legalForms.map(lf => {
    const lr   = rows.filter(r => r.legal_form === lf);
    const lrwt = withTargetRows.filter(r => r.legal_form === lf);
    const pv   = lr.map(r => r.production_value).filter(v => v > 0);
    return {
      name:      lf,
      n:         lr.length,
      medRev:    Math.round(medianOf(pv) / 1e6),
      medTarget: round1(medianOf(lrwt.map(r => r.target))),
    };
  }).filter(l => l.n > 0);

  return {
    label: `${yr} → ${yr + 1}`, predicting: `${yr + 1} Revenue Change`,
    rows: rows.length, withTarget: withTargetRows.length,
    medianRev, medianAssets, medianMargin, medianROI, medianDebt, medianCR,
    target: { mean: tMean, median: tMedian, std: tStd, iqr: tIQR, q25: tQ25, q75: tQ75 },
    quantiles, distBuckets, sizeSeg, sizeDist, prodQuantiles, prodMean,
    sectors, regions: regionStats, legal,
  };
}

// === SHARED COMPONENTS ===
const Tip = ({ active, payload, label, sfx = "" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 13px", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
      <p style={{ color: C.light, fontSize: 12, margin: "0 0 5px", textTransform: "uppercase", letterSpacing: 1 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || C.accent, fontSize: 14, margin: "2px 0", fontWeight: 600 }}>
          {p.name}: {typeof p.value === "number" ? p.value.toLocaleString() : p.value}{sfx}
        </p>
      ))}
    </div>
  );
};

const KPI = ({ label, value, sub, color = C.accent }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${color}`, borderRadius: 8, padding: "14px 16px", flex: 1, minWidth: 135 }}>
    <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", margin: 0 }}>{label}</p>
    <p style={{ color: C.white, fontSize: 26, fontWeight: 700, margin: "5px 0 2px", fontFamily: "'Playfair Display', Georgia, serif" }}>{value}</p>
    {sub && <p style={{ color: C.muted, fontSize: 10.5, margin: 0 }}>{sub}</p>}
  </div>
);

const Heading = ({ children, sub, insight }) => (
  <div style={{ margin: "28px 0 14px" }}>
    <h3 style={{ color: C.white, fontSize: 17, fontWeight: 700, margin: 0, fontFamily: "'Playfair Display', Georgia, serif" }}>{children}</h3>
    {sub && <p style={{ color: C.muted, fontSize: 13, margin: "3px 0 0" }}>{sub}</p>}
    {insight && (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, background: `${C.accent}12`, border: `1px solid ${C.accent}30`, borderRadius: 6, padding: "5px 10px" }}>
        <span style={{ color: C.accent, fontSize: 13 }}>→</span>
        <span style={{ color: C.accent, fontSize: 13, fontWeight: 500 }}>{insight}</span>
      </div>
    )}
  </div>
);

const Tab = ({ active, children, onClick, color }) => (
  <button onClick={onClick} style={{
    background: active ? (color || C.accent) : "transparent",
    color: active ? C.bg : C.muted,
    border: active ? "none" : `1px solid ${C.border}`,
    borderRadius: 6, padding: "8px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.3, transition: "all 0.15s",
  }}>{children}</button>
);

const Card = ({ children, style = {} }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", ...style }}>{children}</div>
);

// === YEAR SECTION ===
function YearSection({ yr, yearsData, yearsCorrelation, sharedDomains }) {
  const d = yearsData[yr];

  return (
    <>
      {/* Year Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h2 style={{ color: C.white, fontSize: 24, fontWeight: 700, margin: 0, fontFamily: "'Playfair Display', Georgia, serif" }}>
          Fiscal Year {yr}
        </h2>
        <span style={{ color: C.accent, fontSize: 16, fontWeight: 600 }}>Predicting {d.predicting}</span>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <KPI label="Companies w/ Target" value={d.withTarget.toLocaleString()} sub={`of ${d.rows.toLocaleString()} total rows`} color={C.accent} />
        <KPI label="Median Target" value={`${d.target.median > 0 ? "+" : ""}${d.target.median}%`} sub="Next-year revenue change" color={d.target.median > 0 ? C.accent : C.coral} />
        <KPI label="Median Revenue" value={`€${d.medianRev}M`} sub="Production value" color={C.gold} />
        <KPI label="Median Profit Margin" value={`${d.medianMargin}%`} sub="Net profit / revenue" color={C.blue} />
        <KPI label="Median ROI" value={`${d.medianROI}%`} sub="Operating income / assets" color={C.purple} />
      </div>

      {/* ── SECTION 1: Target Quantile Table + Distribution ── */}
      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 14 }}>
        <div>
          <Heading sub="Target variable percentile breakdown">Quantile Analysis, Revenue Change</Heading>
          <Card>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "left", padding: "7px 8px" }}>Percentile</th>
                  <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "right", padding: "7px 8px" }}>Revenue Change Next</th>
                </tr>
              </thead>
              <tbody>
                {d.quantiles.map((q, i) => {
                  const isMedian = q.q === "Q50";
                  const clr = q.val > 0 ? C.accent : q.val < -50 ? C.coral : C.gold;
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: isMedian ? `${C.accent}10` : "transparent" }}>
                      <td style={{ padding: "7px 8px", color: isMedian ? C.accent : C.light, fontSize: 14, fontWeight: isMedian ? 700 : 400 }}>
                        {q.q}{isMedian ? " (Median)" : ""}
                      </td>
                      <td style={{ padding: "7px 8px", textAlign: "right", color: clr, fontSize: 15, fontWeight: 600 }}>
                        {q.val > 0 ? "+" : ""}{q.val.toLocaleString()}%
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: `2px solid ${C.border}` }}>
                  <td style={{ padding: "7px 8px", color: C.muted, fontSize: 13 }}>IQR (Q75-Q25)</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: C.orange, fontSize: 15, fontWeight: 600 }}>{d.target.iqr.toFixed(1)}pp</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>

        <div>
          <Heading sub="How many companies fall into each revenue change bucket?" insight="Heavy tails on both sides, standard regression will underperform on extremes">Target Distribution</Heading>
          <Card>
            <ResponsiveContainer width="100%" height={245}>
              <BarChart data={d.distBuckets} barCategoryGap="10%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="range" tick={{ fill: C.muted, fontSize: 12 }} axisLine={{ stroke: C.border }} interval={0} angle={-30} textAnchor="end" height={52} />
                <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} domain={sharedDomains?.distAxis.domain} ticks={sharedDomains?.distAxis.ticks} />
                <Tooltip content={<Tip />} />
                <Bar dataKey="count" name="Companies" radius={[3, 3, 0, 0]}>
                  {d.distBuckets.map((b, i) => <Cell key={i} fill={b.c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      {/* ── SECTION 2: Company Size Analysis ── */}
      <Heading
        sub={`Production value quantiles across ${d.rows.toLocaleString()} companies, proxy for company revenue`}
        insight="Strong right-skew: the mean is pulled far above the median by a handful of mega-corporations"
      >
        Company Size Analysis, Production Value Distribution
      </Heading>
      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

        {/* Quantile table */}
        <Card>
          <p style={{ color: C.muted, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 10px", fontWeight: 600 }}>
            Production Value Quantiles
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "left", padding: "6px 8px" }}>Percentile</th>
                <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "right", padding: "6px 8px" }}>Production Value</th>
                <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "right", padding: "6px 8px" }}>Size Tier</th>
              </tr>
            </thead>
            <tbody>
              {d.prodQuantiles.map((pq, i) => {
                const isMedian = pq.q === "P50";
                const tierIdx  = SIZE_TIERS.findIndex(t => pq.val * 1e6 >= t.lo && pq.val * 1e6 < t.hi);
                const tier     = SIZE_TIERS[tierIdx] || SIZE_TIERS[SIZE_TIERS.length - 1];
                const color    = TIER_COLORS[Math.max(0, tierIdx)];
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: isMedian ? `${C.gold}10` : "transparent" }}>
                    <td style={{ padding: "7px 8px", color: isMedian ? C.gold : C.light, fontSize: 14, fontWeight: isMedian ? 700 : 400 }}>
                      {pq.q}{isMedian ? " (Median)" : ""}
                    </td>
                    <td style={{ padding: "7px 8px", textAlign: "right", color, fontSize: 15, fontWeight: 600 }}>
                      {fmtM(pq.val * 1e6)}
                    </td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>
                      <span style={{ background: `${color}20`, border: `1px solid ${color}50`, color, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700 }}>
                        {tier.name}
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `2px solid ${C.border}` }}>
                <td style={{ padding: "7px 8px", color: C.muted, fontSize: 13 }}>Mean (right-skewed)</td>
                <td colSpan={2} style={{ padding: "7px 8px", textAlign: "right", color: C.orange, fontSize: 15, fontWeight: 600 }}>
                  €{d.prodMean.toLocaleString()}M
                </td>
              </tr>
            </tbody>
          </table>
        </Card>

        {/* Size count distribution bar chart, filter tiers with too few companies */}
        <Card>
          <p style={{ color: C.muted, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 10px", fontWeight: 600 }}>
            Company Count by Revenue Tier
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.sizeDist.filter(t => t.count > 0)} barCategoryGap="12%" margin={{ left: 4, right: 4, top: 18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: C.light, fontSize: 12 }} axisLine={{ stroke: C.border }} angle={-30} textAnchor="end" height={62} interval={0} />
              <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} width={46} domain={sharedDomains?.sizeDistAxis.domain} ticks={sharedDomains?.sizeDistAxis.ticks} />
              <Tooltip content={<Tip />} />
              <Bar dataKey="count" name="Observations" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="count" position="top" style={{ fill: C.light, fontSize: 11, fontWeight: 600 }} />
                {d.sizeDist.filter(t => t.count > 0).map((t) => {
                  const origIdx = d.sizeDist.indexOf(t);
                  return <Cell key={origIdx} fill={TIER_COLORS[origIdx % TIER_COLORS.length]} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "4px 0 0" }}>All revenue tiers shown  •  €0-25M includes all companies below €25M production value</p>
        </Card>
      </div>

      {/* ── SECTION 3: Revenue Size → Target ── */}
      <Heading sub="Median next-year revenue change by company revenue size tier" insight="Smaller companies show explosive growth, larger companies trend negative, size is the #1 structural driver">Revenue Size Effect on Target</Heading>
      <Card>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={d.sizeSeg} barCategoryGap="12%" margin={{ top: 24, left: 0, right: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: C.light, fontSize: 12 }} axisLine={{ stroke: C.border }} angle={-30} textAnchor="end" height={60} interval={0} />
            <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} width={52} domain={sharedDomains?.segAxis.domain} ticks={sharedDomains?.segAxis.ticks} tickFormatter={v => `${v}%`} label={{ value: "Median Target %", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 12, dx: -10 }} />
            <ReferenceLine y={0} stroke={C.muted} strokeWidth={2} />
            <Tooltip content={<Tip sfx="%" />} />
            <Bar dataKey="medTarget" name="Median Target %" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="medTarget" content={({ x, y, width, value }) => {
                if (value === null || value === undefined) return null;
                const label = `${value > 0 ? "+" : ""}${value}%`;
                // y = top edge of bar rect in SVG coords.
                // Positive bars: y = bar top (above x-axis) → y-8 = above bar ✓
                // Negative bars: y = zero reference line (top of downward rect) → y-8 = above zero line ✓
                return (
                  <text x={x + width / 2} y={y - 7} fontSize={9} fontWeight={700} fill={C.light} textAnchor="middle">
                    {label}
                  </text>
                );
              }} />
              {d.sizeSeg.map((s, i) => <Cell key={i} fill={s.medTarget > 0 ? C.accent : C.coral} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
          {d.sizeSeg.map((s, i) => (
            <span key={i} style={{ fontSize: 11, color: C.muted }}>{s.name}: <b style={{ color: C.light }}>{s.n}</b> obs.</span>
          ))}
        </div>
      </Card>

      {/* ── SECTION 4: Sector (Enhanced ComposedChart) + Region ── */}
      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <Heading
            sub="Median next-year revenue change by sector, sorted by performance, ghost bar shows relative company count"
            insight="Sector spread exceeds 50pp between best and worst performers, a strong predictive signal"
          >
            Sector Performance
          </Heading>
          <Card>
            {/* Lollipop chart: thin stem + colored dot per sector */}
            <div style={{ padding: "4px 0" }}>
              {d.sectors.map((s, i) => {
                const dotColor = sectorFill(s.medTarget);
                const maxAbs   = Math.max(...d.sectors.map(x => Math.abs(x.medTarget)), 1);
                const pct      = s.medTarget / maxAbs; // -1 to +1
                const barW     = Math.abs(pct) * 42;   // max ~42% of half-width
                const isPos    = s.medTarget >= 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < d.sectors.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    {/* Sector name + n label */}
                    <div style={{ width: 118, flexShrink: 0, textAlign: "right" }}>
                      <span style={{ color: C.light, fontSize: 12 }}>{s.name}</span>
                      <span style={{ color: C.muted, fontSize: 8.5, marginLeft: 4 }}>n={s.n}</span>
                    </div>
                    {/* Lollipop track */}
                    <div style={{ flex: 1, position: "relative", height: 18, display: "flex", alignItems: "center" }}>
                      {/* Zero line */}
                      <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: C.muted, opacity: 0.4 }} />
                      {/* Stem */}
                      <div style={{
                        position: "absolute",
                        [isPos ? "left" : "right"]: "50%",
                        width: `${barW}%`,
                        height: 2,
                        background: dotColor,
                        opacity: 0.55,
                      }} />
                      {/* Dot */}
                      <div style={{
                        position: "absolute",
                        left: `calc(50% + ${pct * 42}%)`,
                        transform: "translate(-50%, 0)",
                        width: 11,
                        height: 11,
                        borderRadius: "50%",
                        background: dotColor,
                        boxShadow: `0 0 6px ${dotColor}80`,
                      }} />
                    </div>
                    {/* Value label */}
                    <div style={{ width: 44, flexShrink: 0, textAlign: "left" }}>
                      <span style={{ color: dotColor, fontSize: 12, fontWeight: 700 }}>{s.medTarget > 0 ? "+" : ""}{s.medTarget}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "8px 0 0" }}>
              Sorted by median target  •  n = observations  •  Dot color intensity scales with magnitude
            </p>
          </Card>
        </div>

        <div>
          <Heading sub="Regional median next-year revenue change" insight="Region alone is a weak predictor, more powerful as a peer-group benchmarking feature">Region → Target</Heading>
          <Card>
            <ResponsiveContainer width="100%" height={310}>
              <BarChart data={d.regions} layout="vertical" barCategoryGap="14%">
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                <XAxis type="number" tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} domain={sharedDomains?.regX} />
                <YAxis dataKey="name" type="category" tick={{ fill: C.light, fontSize: 14 }} axisLine={{ stroke: C.border }} width={110} />
                <ReferenceLine x={0} stroke={C.muted} strokeWidth={2} />
                <Tooltip content={<Tip sfx="%" />} />
                <Bar dataKey="medTarget" name="Median Target %" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="medTarget" position="right" formatter={v => `${v > 0 ? "+" : ""}${v}%`} style={{ fill: C.light, fontSize: 12, fontWeight: 600 }} />
                  {d.regions.map((r, i) => <Cell key={i} fill={r.medTarget > 0 ? C.blue : C.coral} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      {/* ── SECTION 5: Legal Form Table ── */}
      <Heading sub="Revenue profile and predicted change by company legal structure" insight="Legal form correlates with company size, interpret with caution, as the patterns here largely reflect the size effect rather than legal structure itself">Legal Form → Revenue Target</Heading>
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
              {["Legal Form", "Companies", "Median Revenue", "Median Target"].map((h, i) => (
                <th key={i} style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: i === 0 ? "left" : "right", padding: "8px 10px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.legal.map((l, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 10px", fontWeight: 600, color: C.white, fontSize: 15 }}>{l.name}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.light, fontSize: 14 }}>{l.n.toLocaleString()}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: C.gold, fontSize: 14 }}>€{l.medRev.toLocaleString()}M</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: l.medTarget > 0 ? C.accent : C.coral, fontSize: 15, fontWeight: 700 }}>
                  {l.medTarget > 0 ? "+" : ""}{l.medTarget}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ── SECTION 6: Year-Specific Correlation Matrices ── */}
      {yearsCorrelation && (() => {
        const yPVIdx = yearsCorrelation.financial.labels?.indexOf("PVN★") ?? -1;
        const yRCIdx = yearsCorrelation.financial.labels?.indexOf("RCN★") ?? -1;
        const yNFeats = Math.max(0, (yearsCorrelation.financial.labels?.length ?? 2) - 2);
        const yPVCorrs = yPVIdx >= 0 ? yearsCorrelation.financial.matrix?.slice(0, yNFeats).map(row => Math.abs(row[yPVIdx] ?? 0)) ?? [] : [];
        const yRCCorrs = yRCIdx >= 0 ? yearsCorrelation.financial.matrix?.slice(0, yNFeats).map(row => Math.abs(row[yRCIdx] ?? 0)) ?? [] : [];
        const yPVMax = yPVCorrs.length ? Math.max(...yPVCorrs).toFixed(2) : "-";
        const yRCMax = yRCCorrs.length ? Math.max(...yRCCorrs).toFixed(2) : "-";
        const covidNote = yr === 2019
          ? "Note: 2019→20 is the COVID transition year, correlations are somewhat weaker as the pandemic disrupted normal financial relationships"
          : null;
        return (
          <>
            <Heading
              sub={`Pearson correlation for ${yr} observations, split by feature type. ★ = prediction targets`}
              insight={`Financial size features: up to ${yPVMax} with PVN★, up to ${yRCMax} with RCN★, size features are far more informative for the absolute target`}
            >
              {yr} Feature Correlations
            </Heading>
            {covidNote && (
              <div style={{ background: `${C.gold}10`, border: `1px solid ${C.gold}25`, borderRadius: 8, padding: "8px 14px", marginBottom: 10 }}>
                <p style={{ color: C.gold, fontSize: 13, margin: 0, lineHeight: 1.5 }}>⚠ {covidNote}</p>
              </div>
            )}
            <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Card>
                <SplitCorrMatrix corrData={yearsCorrelation.financial} title="Financial Size Features" accentColor={C.gold} />
                <p style={{ color: C.muted, fontSize: 12, marginTop: 8, marginBottom: 0 }}>★ = target columns  •  Hover for exact values  •  n = {yearsCorrelation.financial.n ?? "-"}</p>
              </Card>
              <Card>
                <SplitCorrMatrix corrData={yearsCorrelation.ratios} title="Financial Ratios" accentColor={C.blue} />
                <p style={{ color: C.muted, fontSize: 12, marginTop: 8, marginBottom: 0 }}>★ = target columns  •  Hover for exact values  •  n = {yearsCorrelation.ratios.n ?? "-"}</p>
              </Card>
            </div>
          </>
        );
      })()}
    </>
  );
}

// === ITALY REGIONAL MAP TAB ===
const ATECO_CATEGORIES = [
  { start:1,  end:3,  key:"01-03", label:"Agriculture, Forestry, Fishing" },
  { start:5,  end:9,  key:"05-09", label:"Mining and Quarrying" },
  { start:10, end:33, key:"10-33", label:"Manufacturing" },
  { start:35, end:35, key:"35",    label:"Electricity, Gas, Steam" },
  { start:36, end:39, key:"36-39", label:"Water Supply, Sewerage, Waste" },
  { start:41, end:43, key:"41-43", label:"Construction" },
  { start:45, end:47, key:"45-47", label:"Wholesale and Retail Trade" },
  { start:49, end:53, key:"49-53", label:"Transportation and Storage" },
  { start:55, end:56, key:"55-56", label:"Accommodation and Food Service" },
  { start:58, end:63, key:"58-63", label:"Information and Communication" },
  { start:64, end:66, key:"64-66", label:"Financial and Insurance Activities" },
  { start:68, end:68, key:"68",    label:"Real Estate Activities" },
  { start:69, end:75, key:"69-75", label:"Professional, Scientific, Technical Activities" },
  { start:77, end:82, key:"77-82", label:"Administrative and Support Services" },
  { start:84, end:84, key:"84",    label:"Public Administration" },
  { start:85, end:85, key:"85",    label:"Education" },
  { start:86, end:88, key:"86-88", label:"Human Health and Social Work" },
  { start:90, end:93, key:"90-93", label:"Arts, Entertainment, Recreation" },
  { start:94, end:96, key:"94-96", label:"Other Service Activities" },
];

const MAP_ALIASES = {
  "Valle d'Aosta": "Valle d'Aosta",
  "Trentino-Alto Adige/Südtirol": "Trentino-Alto Adige",
  "Provincia Autonoma di Bolzano/Bozen": "Trentino-Alto Adige",
  "Provincia Autonoma di Trento": "Trentino-Alto Adige",
  "Friuli Venezia Giulia": "Friuli-Venezia Giulia",
};

function describeAteco(value) {
  const match = String(value || "").match(/(\d{1,2})/);
  if (!match) return { label: value || "N/A", badge: "" };
  const code = Number(match[1]);
  const cat  = ATECO_CATEGORIES.find(c => code >= c.start && code <= c.end);
  if (!cat) return { label: `ATECO ${String(code).padStart(2, "0")}`, badge: "" };
  return { label: `${cat.key} ${cat.label}`, badge: `ATECO ${String(code).padStart(2, "0")}` };
}

function fmtEuro(v) {
  if (v >= 1e12) return `€${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `€${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `€${(v / 1e6).toFixed(1)}M`;
  return `€${v.toFixed(0)}`;
}

function ItalyMapTab({ regionMapData }) {
  const svgRef   = useRef(null);
  const ttRef    = useRef(null);
  const frameRef = useRef(null);

  const national  = regionMapData._national || { medianGrowth: 0, medianRevenue: 0, numRegions: 20 };
  const totalCo   = Object.values(regionMapData).reduce((s, r) => s + (r.companies || 0), 0);
  const totalProd = Object.values(regionMapData).reduce((s, r) => s + (r.total_revenue || 0), 0);
  const numReg    = Object.keys(regionMapData).filter(k => k !== '_national' && regionMapData[k].companies > 0).length;

  useEffect(() => {
    // Wait for D3 to be available (loaded via CDN with defer)
    let tries = 0;
    const tryInit = () => {
      if (!window.d3) {
        if (++tries < 40) setTimeout(tryInit, 100);
        return;
      }
      if (!svgRef.current || !ttRef.current || !frameRef.current) return;
      initMap(window.d3);
    };
    tryInit();
  }, [regionMapData]); // eslint-disable-line react-hooks/exhaustive-deps

  function initMap(d3) {
    const svg  = d3.select(svgRef.current);
    const ttEl = ttRef.current;
    svg.selectAll("*").remove();
    const g = svg.append("g");
    const W = 900, H = 900;
    const totalCompanies = totalCo;
    let pinned = null;

    function buildTooltipHtml(d) {
      const m    = d.properties.metrics;
      const sec  = describeAteco(m.top_sector);
      const share = totalCompanies > 0 ? (m.companies / totalCompanies * 100).toFixed(1) : "0.0";
      const rank  = m.rank || "-";
      const numR  = national.numRegions || 20;

      // Zero-company guard - show N/A for everything
      if (m.companies === 0) {
        return `
          <div class="map-tt-head">
            <div>
              <h3 class="map-tt-h3">${d.properties.display_name}</h3>
              <div class="map-tt-note">Fiscal years 2018-2020 · revenue_change observations</div>
            </div>
            <div class="map-tt-tag">0 companies</div>
          </div>
          <div class="map-stats">
            ${["Median Growth","Median Revenue","Revenue >+100%","Revenue <-50%","Dataset Share","Avg Yrs in Biz"].map(k =>
              `<div class="map-stat"><div class="map-stat-k">${k}</div><div class="map-stat-v" style="color:#94a3b8">N/A</div></div>`
            ).join("")}
            <div class="map-stat map-stat-wide"><div class="map-stat-k">Top Sector</div><div class="map-stat-v" style="color:#94a3b8">N/A</div></div>
          </div>
          <div class="map-insight"><strong>Quick read:</strong> No data for this region in the 2018-2020 training window.</div>`;
      }

      // Growth vs national benchmark
      const growthVal   = Number(m.median_growth);
      const natGrowth   = Number(national.medianGrowth);
      const growthDelta = round2(growthVal - natGrowth);
      const growthColor = growthVal >= 0 ? "#16a34a" : "#dc2626";
      const deltaColor  = growthDelta >= 0 ? "#16a34a" : "#dc2626";
      const growthStr   = `${growthVal >= 0 ? "+" : ""}${growthVal.toFixed(1)}%`;
      const deltaStr    = `${growthDelta >= 0 ? "+" : ""}${growthDelta.toFixed(1)}pp vs national`;

      // Median revenue vs national
      const medRev    = m.median_revenue || 0;
      const natMedRev = national.medianRevenue || 1;
      const revRatio  = medRev / natMedRev;
      const medRevStr = fmtEuro(medRev);
      const natRevStr = fmtEuro(natMedRev);

      // Rich quick-read insight
      const insight = (() => {
        const parts = [];
        if (rank <= 2) parts.push(`Anchor region (#${rank} by dataset size), the model will be disproportionately trained on its patterns`);
        else if (rank <= 5) parts.push(`Major region (#${rank} of ${numR} by dataset size)`);
        if (revRatio > 2) parts.push(`large-company region (median revenue ${revRatio.toFixed(1)}× the national median)`);
        else if (revRatio < 0.5) parts.push(`SME-dominated region (median revenue ${revRatio.toFixed(2)}× the national median)`);
        if (growthDelta > 5) parts.push(`outperforms the national median by +${growthDelta.toFixed(1)}pp`);
        else if (growthDelta < -5) parts.push(`underperforms the national median by ${growthDelta.toFixed(1)}pp`);
        const gt100pct = m.total_obs > 0 ? (m.gt100_count / m.total_obs * 100).toFixed(1) : "0.0";
        const neg50pct = m.total_obs > 0 ? (m.neg50_count / m.total_obs * 100).toFixed(1) : "0.0";
        if (m.neg50_count > m.gt100_count + 25) parts.push(`downside stress dominates (${neg50pct}% below -50% vs ${gt100pct}% above +100%), lead sector: ${sec.label}`);
        else if (m.gt100_count > m.neg50_count + 25) parts.push(`growth extremes dominate (${gt100pct}% of observations above +100%), lead sector: ${sec.label}`);
        else if (parts.length === 0) parts.push(`balanced upside/downside distribution, lead sector: ${sec.label}`);
        return parts.slice(0, 3).join("; ") + ".";
      })();

      return `
        <div class="map-tt-head">
          <div>
            <h3 class="map-tt-h3">${d.properties.display_name}</h3>
            <div class="map-tt-note">Fiscal years 2018-2020 · revenue_change observations</div>
          </div>
          <div class="map-tt-tag">${m.companies.toLocaleString()} companies</div>
        </div>
        <div class="map-stats">
          <div class="map-stat">
            <div class="map-stat-k">Median Growth</div>
            <div class="map-stat-v" style="color:${growthColor}">${growthStr} <span style="font-size:10px;color:${deltaColor};font-weight:600">(${deltaStr})</span></div>
          </div>
          <div class="map-stat">
            <div class="map-stat-k">Median Revenue</div>
            <div class="map-stat-v">${medRevStr} <span style="font-size:10px;color:#667085;font-weight:500">(nat: ${natRevStr})</span></div>
          </div>
          <div class="map-stat">
            <div class="map-stat-k">Revenue &gt;+100%</div>
            <div class="map-stat-v" style="color:#16a34a">${m.total_obs > 0 ? (m.gt100_count / m.total_obs * 100).toFixed(1) : "0.0"}%</div>
          </div>
          <div class="map-stat">
            <div class="map-stat-k">Revenue &lt;-50%</div>
            <div class="map-stat-v" style="color:#dc2626">${m.total_obs > 0 ? (m.neg50_count / m.total_obs * 100).toFixed(1) : "0.0"}%</div>
          </div>
          <div class="map-stat">
            <div class="map-stat-k">Dataset Share</div>
            <div class="map-stat-v">${share}% <span class="map-sector-badge">#${rank} of ${numR}</span></div>
          </div>
          <div class="map-stat">
            <div class="map-stat-k">Avg Yrs in Biz</div>
            <div class="map-stat-v">${Number(m.avg_years).toFixed(1)}</div>
          </div>
          <div class="map-stat map-stat-wide">
            <div class="map-stat-k">Top Sector</div>
            <div class="map-stat-v">${sec.label}${sec.badge ? ` <span class="map-sector-badge">${sec.badge}</span>` : ""}</div>
          </div>
        </div>
        <div class="map-insight"><strong>Quick read:</strong> ${insight}</div>`;
    }

    function showTooltip(event, d) {
      ttEl.innerHTML = buildTooltipHtml(d);
      ttEl.classList.add("map-tt-show");
      moveTooltip(event);
    }
    function moveTooltip(event) {
      const box = frameRef.current.getBoundingClientRect();
      const pad = 12;
      let left = event.clientX - box.left + pad;
      let top  = event.clientY - box.top  + pad;
      if (left + ttEl.offsetWidth  > box.width  - 8) left = event.clientX - box.left - ttEl.offsetWidth  - pad;
      if (left < 8) left = 8;
      if (top  + ttEl.offsetHeight > box.height - 8) top  = box.height - ttEl.offsetHeight - 8;
      if (top  < 8) top  = 8;
      ttEl.style.left = left + "px";
      ttEl.style.top  = top  + "px";
    }
    function hideTooltip()  { ttEl.classList.remove("map-tt-show"); }
    function dimOthers(el)  { d3.selectAll(".map-region").classed("map-region-dimmed", function() { return this !== el; }); }
    function undimAll()     { d3.selectAll(".map-region").classed("map-region-dimmed", false); }

    const geojsonUrl = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_regions.geojson";
    d3.json(geojsonUrl).then(geo => {
      const features = geo.features.map(f => {
        const raw  = f.properties.reg_name || f.properties.name || f.properties.NAME_1 || "";
        const name = MAP_ALIASES[raw] || raw;
        f.properties.display_name = name;
        f.properties.metrics = regionMapData[name] || { companies: 0, median_growth: 0, gt100_count: 0, neg50_count: 0, avg_years: 0, top_sector: "N/A", total_revenue: 0 };
        return f;
      });

      const projection = d3.geoMercator();
      projection.fitSize([W, H], { type: "FeatureCollection", features });
      const path = d3.geoPath(projection);

      const counts     = features.map(d => d.properties.metrics.companies);
      const colorScale = d3.scaleLinear()
        .domain([d3.min(counts), d3.max(counts)])
        .range(["#1B3560", "#00D4AA"]);

      g.selectAll("path")
        .data(features)
        .join("path")
        .attr("class", "map-region")
        .attr("d", path)
        .attr("fill", d => colorScale(d.properties.metrics.companies))
        .on("mouseenter", function(event, d) {
          if (!pinned) showTooltip(event, d);
          dimOthers(this);
        })
        .on("mousemove", function(event) { if (!pinned) moveTooltip(event); })
        .on("mouseleave", function() { if (!pinned) { hideTooltip(); undimAll(); } })
        .on("click", function(event, d) {
          const name = d.properties.display_name;
          if (pinned === name) {
            pinned = null;
            d3.selectAll(".map-region").classed("map-region-pinned", false);
            hideTooltip(); undimAll();
          } else {
            pinned = name;
            d3.selectAll(".map-region").classed("map-region-pinned", x => x.properties.display_name === name);
            showTooltip(event, d); dimOthers(this);
          }
        });
    }).catch(() => {
      ttEl.innerHTML = "<strong>Map failed to load</strong><br><span style='color:#6b7280'>Check network access to GitHub GeoJSON</span>";
      ttEl.classList.add("map-tt-show");
      ttEl.style.left = "24px"; ttEl.style.top = "24px";
    });
  }

  return (
    <>
      <h2 style={{ color: C.white, fontSize: 24, fontWeight: 700, margin: "0 0 6px", fontFamily: "'Playfair Display', Georgia, serif" }}>
        Italy Regional Company Landscape
      </h2>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 16px" }}>
        Fiscal years 2018-2020  •  Colored by unique company count  •  Hover or click a region to explore stats
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <KPI label="Unique Companies" value={totalCo.toLocaleString()} sub="Across all regions" color={C.accent} />
        <KPI label="Regions Present" value={numReg} sub="Of 20 Italian regions" color={C.blue} />
        <KPI label="Total Prod. Value" value={fmtEuro(totalProd)} sub="Sum 2018-2020" color={C.gold} />
      </div>

      {/* Colour-scale legend */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
        <p style={{ color: C.white, fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>Regional Density, Unique Companies</p>
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 10px" }}>Darker blue = more unique companies in the filtered dataset</p>
        <div style={{ height: 12, borderRadius: 999, background: `linear-gradient(90deg, #1B3560, #1B5E80, #0D9488, ${C.accent})`, marginBottom: 6 }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted }}>
          <span>Fewer companies</span><span>More companies</span>
        </div>
      </div>

      {/* Map frame */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
        <div
          ref={frameRef}
          style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: `radial-gradient(ellipse at 50% 40%, #0F1E3A 0%, ${C.bg} 70%)`, minHeight: 620 }}
        >
          <div ref={ttRef} className="map-tooltip" />
          <svg ref={svgRef} viewBox="0 0 900 900" style={{ width: "100%", height: 620, display: "block" }} aria-label="Italy EDA regional map" />
        </div>
        <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "8px 0 0" }}>
          GeoJSON: openpolis/geojson-italy (MIT)  •  Click a region to pin tooltip  •  Source: train_data.csv 2018-2020
        </p>
      </div>
    </>
  );
}

// === CORRELATION COLOR HELPER - more vivid palette ===
function corrColor(val) {
  if (val === null || val === undefined || isNaN(val)) return "#1B2A45";
  const v = Math.max(-1, Math.min(1, val));
  if (v === 0) return "rgba(27,42,69,0.7)";
  if (v > 0) {
    const t = v;
    // deep navy → vivid teal-green
    const r = Math.round(0   + t * 16);
    const g = Math.round(40  + t * 220);
    const b = Math.round(60  + t * 100);
    return `rgba(${r},${g},${b},${0.25 + t * 0.75})`;
  } else {
    const t = -v;
    // deep navy → vivid crimson-red
    const r = Math.round(30  + t * 230);
    const g = Math.round(40  + t * 20);
    const b = Math.round(60  + t * 20);
    return `rgba(${r},${g},${b},${0.25 + t * 0.75})`;
  }
}

// === BOX PLOT (log-scale) - shows outlier behavior of monetary variables ===
function BoxPlotChart({ data }) {
  if (!data || !data.length) return null;
  const W = 700, leftPad = 160, rightPad = 50, topPad = 28, botPad = 40;
  const chartW = W - leftPad - rightPad;
  const rowH = 64;
  const H = topPad + data.length * rowH + botPad;

  const allVals = data.flatMap(d => [d.p10, d.p25, d.p50, d.p75, d.p90, d.p99].filter(v => v > 0));
  if (!allVals.length) return null;
  const logMin = Math.log10(Math.min(...allVals)) - 0.1;
  const logMax = Math.log10(Math.max(...allVals)) + 0.1;

  function toX(v) {
    if (v <= 0) return 0;
    return Math.max(0, Math.min(chartW, ((Math.log10(v) - logMin) / (logMax - logMin)) * chartW));
  }

  const ticks = [];
  for (let p = Math.floor(logMin); p <= Math.ceil(logMax); p++) {
    ticks.push({ val: Math.pow(10, p), x: toX(Math.pow(10, p)) });
  }

  const boxColors = [C.blue, C.orange, C.accent, C.coral, C.purple];
  const boxH = 22;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }}>
      {/* grid lines */}
      {ticks.map((t, i) => (
        <line key={i} x1={leftPad + t.x} y1={topPad} x2={leftPad + t.x} y2={topPad + data.length * rowH}
          stroke={C.border} strokeDasharray="3 4" strokeOpacity={0.7} />
      ))}
      {/* x-axis line */}
      <line x1={leftPad} y1={topPad + data.length * rowH} x2={leftPad + chartW} y2={topPad + data.length * rowH} stroke={C.border} />
      {/* x ticks */}
      {ticks.map((t, i) => {
        const label = t.val >= 1e9 ? `€${(t.val / 1e9).toFixed(0)}B` : t.val >= 1e6 ? `€${(t.val / 1e6).toFixed(0)}M` : `€${t.val.toFixed(0)}`;
        return (
          <text key={i} x={leftPad + t.x} y={topPad + data.length * rowH + 16}
            textAnchor="middle" fontSize={8.5} fill={C.muted}>{label}</text>
        );
      })}
      {/* box plots */}
      {data.map((d, i) => {
        const cy = topPad + i * rowH + rowH / 2;
        const color = boxColors[i % boxColors.length];
        const xP10 = toX(d.p10), xP25 = toX(d.p25), xP50 = toX(d.p50), xP75 = toX(d.p75), xP90 = toX(d.p90), xP99 = d.p99 > 0 ? toX(d.p99) : null;
        return (
          <g key={i} transform={`translate(${leftPad},0)`}>
            <text x={-10} y={cy + 4} textAnchor="end" fontSize={10} fill={C.light} fontWeight={600}>{d.label}</text>
            {/* P99 dashed line to outlier */}
            {xP99 !== null && <line x1={xP90} y1={cy} x2={xP99} y2={cy} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />}
            {/* Whisker */}
            <line x1={xP10} y1={cy} x2={xP90} y2={cy} stroke={color} strokeWidth={1.5} opacity={0.5} />
            <line x1={xP10} y1={cy - 7} x2={xP10} y2={cy + 7} stroke={color} strokeWidth={2} />
            <line x1={xP90} y1={cy - 7} x2={xP90} y2={cy + 7} stroke={color} strokeWidth={2} />
            {/* IQR Box */}
            <rect x={xP25} y={cy - boxH / 2} width={Math.max(1, xP75 - xP25)} height={boxH}
              fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.5} rx={3} />
            {/* Median */}
            <line x1={xP50} y1={cy - boxH / 2} x2={xP50} y2={cy + boxH / 2} stroke={color} strokeWidth={2.5} />
            <circle cx={xP50} cy={cy} r={4.5} fill={color} />
            {/* P99 outlier dot (open circle) */}
            {xP99 !== null && <circle cx={xP99} cy={cy} r={4} fill="none" stroke={color} strokeWidth={2} />}
          </g>
        );
      })}
      {/* legend */}
      <text x={leftPad + chartW / 2} y={H - 6} textAnchor="middle" fontSize={8.5} fill={C.muted}>
        Log₁₀ scale (€)  •  Box = IQR (P25-P75)  •  Dot = Median  •  Whiskers = P10-P90  •  ○ = P99 outlier
      </text>
    </svg>
  );
}

// === SPLIT CORRELATION MATRIX COMPONENT ===
function SplitCorrMatrix({ corrData, title, accentColor }) {
  const { labels, matrix } = corrData;
  if (!matrix || !matrix.length) return <p style={{ color: C.muted, fontSize: 13 }}>Insufficient data.</p>;
  const targetIdx = labels.findIndex(l => l === "PVN★");
  return (
    <div>
      <p style={{ color: accentColor, fontSize: 12, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>{title}</p>
      <div style={{ overflowX: "auto" }}>
        <table className="corr-table">
          <thead>
            <tr>
              <th style={{ width: 60, minWidth: 60 }} />
              {labels.map((l, j) => (
                <th key={j} className={`corr-header ${j >= targetIdx && targetIdx >= 0 ? "corr-target" : ""}`}>
                  <div className="corr-header-inner">{l}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i}>
                <td style={{ color: C.light, fontSize: 12, textAlign: "right", paddingRight: 6, whiteSpace: "nowrap", fontWeight: i >= targetIdx && targetIdx >= 0 ? 700 : 400 }}>
                  {labels[i]}
                </td>
                {row.map((val, j) => (
                  <td key={j}
                    className={`corr-cell ${j >= targetIdx && targetIdx >= 0 ? "corr-target" : ""}`}
                    style={{ background: i === j ? "rgba(255,255,255,0.06)" : corrColor(val) }}
                    title={`${labels[i]} × ${labels[j]}: ${val}`}
                  >
                    {i === j ? "-" : (val > 0 ? "+" : "") + val.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// === DATA OVERVIEW TAB ===
function DataOverviewSection({ correlationData, yearsInBusinessData, uniqueCompanies, totalRows, outliersData }) {
  const { featureTargetCorrs, financial: corrFinancial, ratios: corrRatios } = correlationData;
  const { pearsonR, scatterByYear } = yearsInBusinessData;

  // Compute actual correlation ranges dynamically from the matrix
  const pvIdx = corrFinancial.labels?.indexOf("PVN★") ?? -1;
  const rcIdx = corrFinancial.labels?.indexOf("RCN★") ?? -1;
  const nFeats = Math.max(0, (corrFinancial.labels?.length ?? 2) - 2);
  const finPVCorrs = pvIdx >= 0 ? (corrFinancial.matrix?.slice(0, nFeats).map(row => Math.abs(row[pvIdx] ?? 0)) ?? []) : [];
  const finRCCorrs = rcIdx >= 0 ? (corrFinancial.matrix?.slice(0, nFeats).map(row => Math.abs(row[rcIdx] ?? 0)) ?? []) : [];
  const finPVMax = finPVCorrs.length ? Math.max(...finPVCorrs).toFixed(2) : "-";
  const finPVMin = finPVCorrs.length ? Math.min(...finPVCorrs).toFixed(2) : "-";
  const finRCMax = finRCCorrs.length ? Math.max(...finRCCorrs).toFixed(2) : "-";
  const maxPVCorr = featureTargetCorrs?.length ? Math.max(...featureTargetCorrs.map(d => Math.abs(d.corrPV))).toFixed(2) : "-";
  const maxRCCorr = featureTargetCorrs?.length ? Math.max(...featureTargetCorrs.map(d => Math.abs(d.corrRC))).toFixed(2) : "-";

  return (
    <>
      {/* ── HERO ── */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ color: C.white, fontSize: 28, fontWeight: 700, margin: "0 0 6px", fontFamily: "'Playfair Display', Georgia, serif" }}>
          Challenge 3, Revenue Forecasting
        </h2>

        {/* Challenge description card */}
        <div style={{ background: `${C.accent}09`, border: `1px solid ${C.accent}22`, borderLeft: `4px solid ${C.accent}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
          <p style={{ color: C.accent, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, margin: "0 0 6px" }}>Business Context</p>
          <p style={{ color: C.white, fontSize: 14, fontWeight: 600, margin: "0 0 8px", lineHeight: 1.5 }}>
            Forecast the <b style={{ color: C.accent }}>percentage change in revenue</b> for the next fiscal year, helping companies with budget planning and investors with valuation.
          </p>
          <p style={{ color: C.light, fontSize: 13, margin: "0 0 10px", lineHeight: 1.6 }}>
            We work with annual financial statements (balance sheet, income statement, ratios) for Italian companies spanning 2018-2021.
            The training window covers <b style={{ color: C.gold }}>fiscal years 2018-2020</b>; the held-out test set uses 2022-2023 data.
            Key challenges include <b style={{ color: C.coral }}>time-series aware validation</b> (no future leakage), handling extreme outliers from M&amp;A events, and the fact that percentage change is a highly volatile target with a weak direct signal.
          </p>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <p style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 2px" }}>Primary Metric</p>
              <p style={{ color: C.gold, fontSize: 13, fontWeight: 700, margin: 0 }}>RMSE</p>
            </div>
            <div>
              <p style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 2px" }}>Secondary</p>
              <p style={{ color: C.gold, fontSize: 13, fontWeight: 700, margin: 0 }}>MAPE · MAE</p>
            </div>
            <div>
              <p style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 2px" }}>Business Metric</p>
              <p style={{ color: C.gold, fontSize: 13, fontWeight: 700, margin: 0 }}>Directional Accuracy</p>
            </div>
            <div>
              <p style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 2px" }}>Success Target</p>
              <p style={{ color: C.accent, fontSize: 13, fontWeight: 700, margin: 0 }}>MAPE &lt; 15% · Dir. Acc. &gt; 70%</p>
            </div>
          </div>
        </div>


        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KPI label="Unique Companies"   value={uniqueCompanies.toLocaleString()} sub="Distinct entities"          color={C.accent} />
          <KPI label="Total Observations" value={totalRows.toLocaleString()}        sub="Company-year rows (3 yrs)"  color={C.blue}   />
          <KPI label="Raw Features"         value="30+"                               sub="Financial & structural"     color={C.gold}   />
          <KPI label="Fiscal Years"       value="2018-2021"                         sub="4 years of statements"      color={C.purple} />
        </div>

        {/* Data quality notes */}
        <div style={{ marginTop: 14, background: `${C.blue}0C`, border: `1px solid ${C.blue}22`, borderRadius: 8, padding: "10px 14px" }}>
          <p style={{ color: C.blue, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}>🔍 Data Quality Findings</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ color: C.muted, fontSize: 12, margin: 0, lineHeight: 1.6 }}>
              <b style={{ color: C.light }}>Province encoding (Naples):</b> ~900 apparently missing <code style={{ color: C.blue, fontSize: 11 }}>province</code> values were not truly missing, <b style={{ color: C.light }}>"NA" is the official abbreviation for Naples (Napoli)</b>, which was being parsed as <code style={{ color: C.coral, fontSize: 11 }}>NaN</code>. Corrected before any analysis.
            </p>
            <p style={{ color: C.muted, fontSize: 12, margin: 0, lineHeight: 1.6 }}>
              <b style={{ color: C.light }}>Structural missingness in ROE & Leverage:</b> Both variables were recomputed directly from the raw data using the data dictionary equations, <code style={{ color: C.blue, fontSize: 11 }}>roe = net_profit_loss / shareholders_equity</code> and <code style={{ color: C.blue, fontSize: 11 }}>leverage = total_debt / shareholders_equity</code>. ~40 missing values each, caused by companies with zero shareholders' equity. Rather than simple median imputation, missing values were filled using the most similar companies, matched on <b style={{ color: C.light }}>same sector, same legal form, and same fiscal year</b>, making the imputed value contextually appropriate rather than a global average.            </p>
          </div>
        </div>
      </div>

      {/* ── OUTLIER BEHAVIOR ── */}
      <Heading
        sub="Distribution of key monetary variables, log₁₀ scale reveals extreme right skew"
        insight="All monetary variables span 5-6 orders of magnitude. Outliers are real events (M&A, expansions), not noise. Must use log transforms or robust scaling."
      >
        Outlier Behaviour of Monetary Variables (Log Scale)
      </Heading>
      <Card>
        <BoxPlotChart data={outliersData} />
        <div style={{ background: `${C.gold}0F`, border: `1px solid ${C.gold}25`, borderRadius: 8, padding: "10px 14px", marginTop: 12 }}>
          <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: 1 }}>How we handle outliers</p>
          <p style={{ color: C.light, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            We <b style={{ color: C.accent }}>do not remove</b> outliers, they represent real business events (mergers, rapid expansion). Instead: (1) log-transform monetary features before modeling, (2) use <b style={{ color: C.accent }}>winsorisation at P1/P99</b> for ratio features prone to division instability, and (3) rely on <b style={{ color: C.gold }}>tree-based models</b> (XGBoost, Random Forest) which are inherently robust to scale outliers.
          </p>
        </div>
      </Card>


      {/* ── SPLIT CORRELATION MATRICES (pooled) ── */}
      <Heading
        sub="Pearson correlation, split by feature type (pooled 2018-2020). ★ = prediction targets"
        insight={`Financial size features show PVN★ correlations of ${finPVMin}-${finPVMax} but only up to ${finRCMax} with RCN★, predicting PVN★ is far more tractable than predicting % change directly`}
      >
        Feature Correlation Matrices
      </Heading>
      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <SplitCorrMatrix corrData={corrFinancial} title="Financial Size Features" accentColor={C.gold} />
          <p style={{ color: C.muted, fontSize: 13, marginTop: 8, marginBottom: 0 }}>★ = target columns  •  Hover cells for exact values</p>
        </Card>
        <Card>
          <SplitCorrMatrix corrData={corrRatios} title="Financial Ratios" accentColor={C.blue} />
          <p style={{ color: C.muted, fontSize: 13, marginTop: 8, marginBottom: 0 }}>★ = target columns  •  Hover cells for exact values</p>
        </Card>
      </div>

      {/* ── FEATURE → TARGET COMPARISON ── */}
      <Heading
        sub="Left: correlations with production_value_next (our target). Right: correlations with revenue_change_next (what we derive post-hoc)"
        insight={`Strongest PVN★ correlation: ${maxPVCorr} · Strongest RCN★ correlation: ${maxRCCorr}, PVN★ is significantly more predictable, justifying the two-stage approach`}
      >
        Why production_value_next? Feature Correlation Comparison
      </Heading>
      {featureTargetCorrs && featureTargetCorrs.length > 0 && (
        <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card>
            <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>
              production_value_next, Normal Signal
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={featureTargetCorrs} layout="vertical" barCategoryGap="12%" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                <XAxis type="number" domain={[-0.5, 0.5]} ticks={[-0.5, -0.25, 0, 0.25, 0.5]} tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} tickFormatter={v => v.toFixed(2)} />
                <YAxis dataKey="label" type="category" tick={{ fill: C.light, fontSize: 13 }} axisLine={{ stroke: C.border }} width={95} />
                <ReferenceLine x={0} stroke={C.muted} strokeWidth={1.5} />
                <Tooltip formatter={(v) => [v.toFixed(3), "Corr with PV Next"]} contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }} labelStyle={{ color: C.white }} itemStyle={{ color: C.gold }} />
                <Bar dataKey="corrPV" name="Corr with PV Next" radius={[0, 4, 4, 0]}>
                  {featureTargetCorrs.map((d, i) => <Cell key={i} fill={d.corrPV >= 0 ? C.gold : C.coral} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <p style={{ color: C.coral, fontSize: 12, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>
              revenue_change_next, Weak Signal
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={featureTargetCorrs} layout="vertical" barCategoryGap="12%" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                <XAxis type="number" domain={[-0.3, 0.3]} ticks={[-0.3, -0.15, 0, 0.15, 0.3]} tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} tickFormatter={v => v.toFixed(2)} />
                <YAxis dataKey="label" type="category" tick={{ fill: C.light, fontSize: 13 }} axisLine={{ stroke: C.border }} width={95} />
                <ReferenceLine x={0} stroke={C.muted} strokeWidth={1.5} />
                <Tooltip formatter={(v) => [v.toFixed(3), "Corr with RC Next"]} contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }} labelStyle={{ color: C.white }} itemStyle={{ color: C.blue }} />
                <Bar dataKey="corrRC" name="Corr with RC Next" radius={[0, 4, 4, 0]}>
                  {featureTargetCorrs.map((d, i) => <Cell key={i} fill={Math.abs(d.corrRC) < 0.1 ? C.muted : d.corrRC >= 0 ? C.blue : C.coral} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ── YEARS IN BUSINESS, SCATTER BY YEAR ── */}
      <Heading
        sub="years_in_business vs revenue_change_next, each panel = one fiscal year, points sampled for clarity"
        insight={`Pearson r = ${pearsonR}, cloud shape is identical across all 3 years: no age-based signal whatsoever`}
      >
        Years in Business vs. Next-Year Revenue Change
      </Heading>
      <Card>
        <div className="grid-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[2018, 2019, 2020].map((yr, yi) => {
            const pts = scatterByYear?.[yr] ?? [];
            const clr = [C.blue, C.accent, C.gold][yi];
            return (
              <div key={yr}>
                <p style={{ color: clr, fontSize: 12, fontWeight: 700, textAlign: "center", margin: "0 0 4px" }}>
                  fiscal_year = {yr}
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart margin={{ left: 12, right: 8, top: 8, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis
                      dataKey="x" name="years_in_business" type="number"
                      domain={[0, 70]} tickCount={8}
                      tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }}
                      label={{ value: "years_in_business", position: "insideBottom", offset: -18, fill: C.muted, fontSize: 10 }}
                    />
                    <YAxis
                      dataKey="y" name="revenue_change_next" type="number"
                      domain={[0, 6000]}
                      tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} width={42}
                      label={{ value: "RC Next (%)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11, dx: -10 }}
                    />
                    <ZAxis range={[12, 12]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      formatter={(v, n) => [v, n]}
                      contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                    />
                    <Scatter data={pts} fill={clr} fillOpacity={0.35} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
        <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "8px 0 0" }}>
          Points sampled for performance  •  y-axis capped at 6000% to show cluster structure  •  Pearson r = {pearsonR}
        </p>
        <div style={{ background: `${C.coral}10`, border: `1px solid ${C.coral}25`, borderRadius: 8, padding: "10px 14px", marginTop: 10 }}>
          <span style={{ color: C.coral, fontSize: 13, fontWeight: 600 }}>
            Key takeaway: The point cloud is structurally identical across all 3 years, dense near zero, sparse at extremes, no age gradient.
            Company age shows very weak predictive signal. We should consider excluding <code>years_in_business</code> as a raw feature in the modeling phase.
          </span>
        </div>
      </Card>

      {/* ── TARGET VARIABLE CONSTRUCTION (moved to end) ── */}
      <Heading
        sub="How the prediction target is constructed"
        insight="Two-stage approach: predict PVN★ (higher feature correlations) → derive revenue_change_next post-hoc for final evaluation"
      >
        Target Variable Construction
      </Heading>
      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 4 }}>
        <Card>
          <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px" }}>Primary Modeling Target</p>
          <div style={{ background: `${C.gold}12`, border: `1px solid ${C.gold}30`, borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontFamily: "monospace", fontSize: 15, color: C.gold }}>
            production_value_next = PV<sub style={{ fontSize: 12 }}>t+1</sub>
          </div>
          <p style={{ color: C.light, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            The absolute production value of the next fiscal year, per company. Computed by shifting each company's time series by -1. We use this as our <b style={{ color: C.gold }}>intermediate modeling target</b> because it correlates meaningfully with current-year financials, significantly more so than revenue_change_next. However, the model is ultimately <b style={{ color: C.coral }}>evaluated on revenue_change_next</b> (the actual business question), which is derived post-prediction from predicted PV<sub style={{ fontSize: 12 }}>t+1</sub> and known PV<sub style={{ fontSize: 12 }}>t</sub>.
          </p>
        </Card>
        <Card>
          <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px" }}>Business Interpretation</p>
          <div style={{ background: `${C.accent}12`, border: `1px solid ${C.accent}30`, borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontFamily: "monospace", fontSize: 15, color: C.accent }}>
            revenue_change_next = (PV<sub style={{ fontSize: 12 }}>t+1</sub> - PV<sub style={{ fontSize: 12 }}>t</sub>) / PV<sub style={{ fontSize: 12 }}>t</sub> × 100
          </div>
          <p style={{ color: C.light, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            The percentage change in revenue is the <b style={{ color: C.accent }}>actual evaluation metric</b>, this is what the challenge scores us on. It is harder to predict directly (low feature correlations). We derive it <i>post-prediction</i>: revenue_change_next = (predicted PV<sub style={{ fontSize: 12 }}>t+1</sub> - observed PV<sub style={{ fontSize: 12 }}>t</sub>) / PV<sub style={{ fontSize: 12 }}>t</sub> × 100.
          </p>
        </Card>
      </div>
    </>
  );
}

// === MAIN DASHBOARD ===
export default function App() {
  const [appData, setAppData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tab, setTab]         = useState("overview");

  useEffect(() => {
    fetch("/train_data.csv")
      .then(r => {
        if (!r.ok) throw new Error(`Could not load train_data.csv (HTTP ${r.status})`);
        return r.text();
      })
      .then(text => {
        setAppData(processData(parseCSV(text)));
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const yearColors = { overview: C.white, "2018": C.accent, "2019": C.blue, "2020": C.gold, signals: C.orange, map: C.teal, summary: C.purple, features: "#A78BFA", nextsteps: "#F472B6", featsel: "#38BDF8", models: "#34D399", tuning: "#FB923C", advanced: "#E879F9", regime: "#F87171", regions2: "#22D3EE", forecast: "#FCD34D" };

  if (loading) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "'DM Sans', sans-serif" }}>
      <div className="spinner" />
      <p style={{ color: C.accent, fontSize: 16, margin: 0 }}>Loading train_data.csv…</p>
    </div>
  );

  if (error) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: C.card, border: `1px solid ${C.coral}`, borderRadius: 10, padding: "24px 32px", maxWidth: 480 }}>
        <p style={{ color: C.coral, fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>Failed to load data</p>
        <p style={{ color: C.light, fontSize: 15, margin: 0 }}>{error}</p>
        <p style={{ color: C.muted, fontSize: 13, margin: "10px 0 0" }}>Ensure <code>train_data.csv</code> is in the <code>public/</code> folder.</p>
      </div>
    </div>
  );

  const { yearsData, crossYear, uniqueCompanies, totalRows, covidSectorImpact, signalData, regionMapData, regionHistoricalData, correlationData, yearsInBusinessData, outliersData, missingnessData, yearsCorrelationData } = appData;
  const bestYear          = crossYear.reduce((a, b) => a.median > b.median ? a : b);
  const highestVolatility = crossYear.reduce((a, b) => a.std    > b.std    ? a : b);

  // Nice axes for signals tab charts
  const gmAxis = (() => {
    const vals = signalData.growthMomentum.map(d => d.medTarget);
    const gMax = Math.max(...vals);
    const steps = [25, 50, 100, 200];
    const step = steps.find(s => s >= (gMax + 100) / 6) || 100;
    const top = Math.ceil(gMax / step) * step;
    const ticks = [];
    for (let t = -100; t <= top; t += step) ticks.push(t);
    return { domain: [-100, top], ticks };
  })();

  const eqAxis = (() => {
    const vals = signalData.equityGap.map(d => d.medTarget);
    const eMax = Math.max(...vals);
    const steps = [10, 25, 50, 100];
    const step = steps.find(s => s >= (eMax + 100) / 6) || 50;
    const top = Math.ceil(eMax / step) * step;
    const ticks = [];
    for (let t = -100; t <= top; t += step) ticks.push(t);
    return { domain: [-100, top], ticks };
  })();

  // Shared axis domains across year tabs - ensures all matching charts use identical scales
  const sharedDomains = (() => {
    const yrs = [2018, 2019, 2020];
    const distMax     = Math.max(...yrs.flatMap(yr => yearsData[yr].distBuckets.map(b => b.count)));
    const sizeDistMax = Math.max(...yrs.flatMap(yr => yearsData[yr].sizeDist.map(t => t.count)));
    const segMax      = Math.max(...yrs.flatMap(yr => yearsData[yr].sizeSeg.map(s => s.medTarget)));
    // segAxis: floor at -100, clean ticks from -100 up to max
    const segSteps = [50, 100, 200, 250, 500, 1000];
    const segStep  = segSteps.find(s => s >= segMax / 6) || 1000;
    const segTop   = Math.ceil(segMax / segStep) * segStep;
    const segTicks = [];
    for (let t = -100; t <= segTop; t += segStep) segTicks.push(t);
    if (segTicks[segTicks.length - 1] < segTop) segTicks.push(segTop);
    const segAxis = { domain: [-100, segTop], ticks: segTicks };
    return {
      distAxis:     niceAxisConfig(distMax),
      sizeDistAxis: niceAxisConfig(sizeDistMax),
      segAxis,
      regX:         [-35, 40],
    };
  })();

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", color: C.white }}>

      {/* HEADER */}
      <div style={{ background: C.navy, borderBottom: `1px solid ${C.border}`, padding: "20px 28px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 5, height: 28, background: C.accent, borderRadius: 3 }} />
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, fontFamily: "'Playfair Display', Georgia, serif" }}>Revenue Forecasting: EDA & Feature Engineering</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ background: `${C.accent}18`, border: `1px solid ${C.accent}30`, borderRadius: 6, padding: "4px 10px", color: C.accent, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>Group 6</span>
            <span style={{ color: C.muted, fontSize: 12 }}>Deniz Taylan · Yarkin Yavuz · Gustavo Depieri Fioravanti · Koray Aydin</span>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: 13, margin: "2px 0 14px 15px", letterSpacing: 0.4 }}>
          Challenge 3  •  {uniqueCompanies.toLocaleString()} unique Italian companies  •  {totalRows.toLocaleString()} observations across 2018-2020  •  Target: next-year revenue change (%)
          {"  •  "}
          <a href="https://github.com/deniztaylan06/Expert_AI_project/tree/main" target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none", fontWeight: 600 }}>
            GitHub ↗
          </a>
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none", msOverflowStyle: "none" }} className="tab-bar">
          <Tab active={tab === "overview"}   onClick={() => setTab("overview")}   color={yearColors.overview}>Data Overview</Tab>
          <Tab active={tab === "2018"}       onClick={() => setTab("2018")}       color={yearColors["2018"]}>2018 → 2019</Tab>
          <Tab active={tab === "2019"}       onClick={() => setTab("2019")}       color={yearColors["2019"]}>2019 → 2020</Tab>
          <Tab active={tab === "2020"}       onClick={() => setTab("2020")}       color={yearColors["2020"]}>2020 → 2021</Tab>
          <Tab active={tab === "signals"}    onClick={() => setTab("signals")}    color={yearColors.signals}>Revenue Signals</Tab>
          <Tab active={tab === "map"}        onClick={() => setTab("map")}        color={yearColors.map}>Regional Map</Tab>
          <Tab active={tab === "summary"}    onClick={() => setTab("summary")}    color={yearColors.summary}>Summary & Comparison</Tab>
          <Tab active={tab === "features"}   onClick={() => setTab("features")}   color={yearColors.features}>Feature Engineering</Tab>
          <div style={{ width: 1, height: 28, background: C.border, margin: "0 2px", alignSelf: "center" }} />
          <span style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, alignSelf: "center", margin: "0 2px", whiteSpace: "nowrap" }}>PART II</span>
          <Tab active={tab === "featsel"}   onClick={() => setTab("featsel")}   color={yearColors.featsel}>Feature Selection</Tab>
          <Tab active={tab === "models"}    onClick={() => setTab("models")}    color={yearColors.models}>Model Results</Tab>
          <Tab active={tab === "tuning"}    onClick={() => setTab("tuning")}    color={yearColors.tuning}>Hyperparameter Tuning</Tab>
          <Tab active={tab === "advanced"}  onClick={() => setTab("advanced")}  color={yearColors.advanced}>Innovative Ideas</Tab>
          <Tab active={tab === "regime"}    onClick={() => setTab("regime")}    color={yearColors.regime}>Regime Classification</Tab>
          <Tab active={tab === "regions2"}  onClick={() => setTab("regions2")}  color={yearColors.regions2}>Regional Analysis</Tab>
          <Tab active={tab === "forecast"}  onClick={() => setTab("forecast")}  color={yearColors.forecast}>Final Forecast</Tab>
        </div>
      </div>

      <div style={{ padding: "20px 28px 40px", maxWidth: 1180, margin: "0 auto" }}>

        {tab === "overview" && <DataOverviewSection correlationData={correlationData} yearsInBusinessData={yearsInBusinessData} uniqueCompanies={uniqueCompanies} totalRows={totalRows} outliersData={outliersData} missingnessData={missingnessData} />}
        {["2018","2019","2020"].includes(tab) && <YearSection yr={Number(tab)} yearsData={yearsData} yearsCorrelation={yearsCorrelationData[Number(tab)]} sharedDomains={sharedDomains} />}
        {tab === "map" && <ItalyMapTab regionMapData={regionMapData} />}

        {tab === "signals" && (
          <>
            <h2 style={{ color: C.white, fontSize: 24, fontWeight: 700, margin: "0 0 6px", fontFamily: "'Playfair Display', Georgia, serif" }}>
              Revenue Signals, Advanced Pattern Analysis
            </h2>
            <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
              Cross-year pooled signals derived from 2018-2020 cohorts  •  Target = next-year revenue change  •  Each signal isolates a structural driver
            </p>

            {/* ── 1. Revenue Tier → Target ── */}
            <Heading
              sub="Median next-year revenue change by production-value decile (Q1=smallest → Q10=largest), pooled across all years"
              insight="Lower tiers show explosive growth; top tiers trend negative, decile rank is a strong non-linear signal"
            >
              Revenue Tier → Next-Year Revenue Change
            </Heading>
            <Card>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={signalData.tierTarget} barCategoryGap="12%">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis dataKey="tier" tick={{ fill: C.light, fontSize: 14 }} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} tickFormatter={v => `${v}%`} width={46} />
                  <ReferenceLine y={0} stroke={C.muted} strokeWidth={2} />
                  <Tooltip content={<Tip sfx="%" />} />
                  <Bar dataKey="medTarget" name="Median Target %" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="medTarget" position="top" formatter={v => `${v > 0 ? "+" : ""}${v}%`} style={{ fill: C.light, fontSize: 12, fontWeight: 700 }} />
                    {signalData.tierTarget.map((d, i) => <Cell key={i} fill={d.medTarget > 0 ? C.accent : C.coral} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
                {signalData.tierTarget.map((d, i) => (
                  <span key={i} style={{ fontSize: 11, color: C.muted }}>{d.tier}: <b style={{ color: C.light }}>{d.n}</b> obs.</span>
                ))}
              </div>
            </Card>

            {/* ── 2. Tier Shift → Target ── */}
            <Heading
              sub="Median next-year revenue change by how many deciles a company moved since the prior year"
              insight="Companies climbing tiers (≥+2) already outperform, momentum matters. Fallen companies face the steepest targets"
            >
              Tier Shift → Target
            </Heading>
            <Card>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={signalData.tierShift} barCategoryGap="22%" margin={{ top: 28, left: 4, right: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis dataKey="shift" tick={{ fill: C.light, fontSize: 14 }} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} tickFormatter={v => `${v}%`} width={46} />
                  <ReferenceLine y={0} stroke={C.muted} strokeWidth={2} />
                  <Tooltip content={<Tip sfx="%" />} />
                  <Bar dataKey="medTarget" name="Median Target %" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="medTarget" position="top" formatter={v => `${v > 0 ? "+" : ""}${v}%`} style={{ fill: C.light, fontSize: 13, fontWeight: 700 }} />
                    {signalData.tierShift.map((_, i) => (
                      <Cell key={i} fill={[C.coral, "#FF9F7F", C.blue, "#66BB6A", C.accent][i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 6, flexWrap: "wrap" }}>
                {signalData.tierShift.map((d, i) => (
                  <span key={i} style={{ fontSize: 11, color: C.muted }}>Shift {d.shift}: <b style={{ color: C.light }}>{d.n}</b> obs.</span>
                ))}
              </div>
            </Card>

            {/* ── 3 + 4: Tier Persistence & Extreme Events ── */}
            <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <Heading
                  sub="% of companies that stayed in the same tier the following year, by starting tier"
                  insight="Middle tiers are most mobile; top/bottom tiers are sticky, path-dependency is tier-specific"
                >
                  Tier Persistence, Stay Rate
                </Heading>
                <Card>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={signalData.tierPersistence} barCategoryGap="10%" stackOffset="none">
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis dataKey="tier" tick={{ fill: C.light, fontSize: 13 }} axisLine={{ stroke: C.border }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} tickFormatter={v => `${v}%`} domain={[0, 100]} width={44} />
                      <Tooltip
                        formatter={(v, name) => [`${v}%`, name]}
                        contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}
                        labelStyle={{ color: C.white, fontWeight: 700 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={v => <span style={{ color: C.light }}>{v}</span>} />
                      <Bar dataKey="stay" name="Stayed" stackId="a" fill={C.accent}  radius={[0, 0, 0, 0]} />
                      <Bar dataKey="up"   name="Moved Up"   stackId="a" fill={C.blue}   radius={[0, 0, 0, 0]} />
                      <Bar dataKey="down" name="Moved Down" stackId="a" fill={C.coral}  radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "4px 0 0" }}>
                    Stacked 100%  •  Green = stayed same tier  •  Blue = climbed  •  Red = fell
                  </p>
                </Card>
              </div>

              <div>
                <Heading
                  sub="% of companies in each tier experiencing extreme revenue events in the following year"
                  insight="Smallest firms (Q1-Q3) face the highest extreme-event risk, both explosive growth AND severe decline"
                >
                  Extreme Event Probability by Tier
                </Heading>
                <Card>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={signalData.extremeEvents} barCategoryGap="10%" barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis dataKey="tier" tick={{ fill: C.light, fontSize: 13 }} axisLine={{ stroke: C.border }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} tickFormatter={v => `${v}%`} width={44} />
                      <Tooltip
                        formatter={(v, name) => [`${v}%`, name]}
                        contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}
                        labelStyle={{ color: C.white, fontWeight: 700 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={v => <span style={{ color: C.light }}>{v}</span>} />
                      <Bar dataKey="pct100"   name=">100% Jump"  fill={C.accent}  radius={[3, 3, 0, 0]} />
                      <Bar dataKey="pct200"   name=">200% Jump"  fill={C.purple}  radius={[3, 3, 0, 0]} />
                      <Bar dataKey="pctNeg50" name="<-50% Drop"  fill={C.coral}   radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "4px 0 0" }}>
                    % of companies in each tier experiencing the event next year  •  Pooled 2018-2020
                  </p>
                </Card>
              </div>
            </div>

            {/* ── 5 + 6: Growth Momentum & Equity Gap ── */}
            <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <Heading
                  sub="Median next-year revenue change by current-year revenue change bucket, mean reversion pattern"
                  insight="High current-year growth strongly predicts lower next-year growth, and vice versa. Classic mean reversion"
                >
                  Growth Momentum Mean Reversion
                </Heading>
                <Card>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={signalData.growthMomentum} barCategoryGap="22%" margin={{ top: 28, left: 4, right: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis dataKey="bucket" tick={{ fill: C.light, fontSize: 13 }} axisLine={{ stroke: C.border }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} domain={gmAxis.domain} ticks={gmAxis.ticks} tickFormatter={v => `${v}%`} width={52} />
                      <ReferenceLine y={0} stroke={C.muted} strokeWidth={2} />
                      <Tooltip content={<Tip sfx="%" />} />
                      <Bar dataKey="medTarget" name="Median Target %" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="medTarget" position="top" formatter={v => `${v > 0 ? "+" : ""}${v}%`} style={{ fill: C.light, fontSize: 12, fontWeight: 700 }} />
                        {signalData.growthMomentum.map((d, i) => <Cell key={i} fill={d.medTarget > 0 ? C.accent : C.coral} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "left", padding: "5px 8px" }}>Current Growth Bucket</th>
                        <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "right", padding: "5px 8px" }}>Observations</th>
                        <th style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", textAlign: "right", padding: "5px 8px" }}>Median Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signalData.growthMomentum.map((d, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "5px 8px", color: C.light, fontSize: 13 }}>{d.bucket}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", color: C.muted, fontSize: 13 }}>{d.n.toLocaleString()}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", color: d.medTarget > 0 ? C.accent : C.coral, fontSize: 14, fontWeight: 700 }}>
                            {d.medTarget > 0 ? "+" : ""}{d.medTarget}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>

              <div>
                <Heading
                  sub="Equity gap = (SE_t - SE_{t-1} - net_profit_t) / total_assets, measures hidden capital flows"
                  insight="Equity withdrawals signal insider pessimism; injections signal strategic investment, both predict future revenue direction"
                >
                  Equity Gap, Capital Flow Signal
                </Heading>
                <Card>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={signalData.equityGap} barCategoryGap="30%" margin={{ top: 28, left: 4, right: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis dataKey="group" tick={{ fill: C.light, fontSize: 14 }} axisLine={{ stroke: C.border }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 13 }} axisLine={{ stroke: C.border }} domain={eqAxis.domain} ticks={eqAxis.ticks} tickFormatter={v => `${v}%`} width={52} />
                      <ReferenceLine y={0} stroke={C.muted} strokeWidth={2} />
                      <Tooltip content={<Tip sfx="%" />} />
                      <Bar dataKey="medTarget" name="Median Target %" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="medTarget" position="top" formatter={v => `${v > 0 ? "+" : ""}${v}%`} style={{ fill: C.light, fontSize: 13, fontWeight: 700 }} />
                        {signalData.equityGap.map((_, i) => <Cell key={i} fill={[C.coral, C.blue, C.accent][i]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ background: `${C.navy}`, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", marginTop: 14 }}>
                    <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 6px", fontWeight: 600 }}>Signal Construction</p>
                    <p style={{ color: C.light, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                      <b style={{ color: C.coral }}>Withdrawal</b>, shareholders removed equity beyond retained earnings<br />
                      <b style={{ color: C.blue }}>Neutral</b>, equity change ≈ expected from profits alone<br />
                      <b style={{ color: C.accent }}>Injection</b>, fresh capital infused (rights issue, shareholder loans)<br />
                      <span style={{ color: C.muted, fontSize: 12 }}>Threshold ±4% of total assets  •  Requires 2+ consecutive years</span>
                    </p>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 10 }}>
                    {signalData.equityGap.map((d, i) => (
                      <span key={i} style={{ fontSize: 11, color: C.muted }}>{d.group}: <b style={{ color: C.light }}>{d.n.toLocaleString()}</b> obs.</span>
                    ))}
                  </div>
                </Card>
              </div>
            </div>

            {/* ── 7. Insight Cards ── */}
            <Heading>How These Signals Improve Our Revenue Model</Heading>
            <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                {
                  num: "1", color: C.accent,
                  title: "Revenue Tier = Non-Linear Size Feature",
                  body: `Q1 (smallest) companies deliver a median target of ${signalData.tierTarget[0]?.medTarget > 0 ? "+" : ""}${signalData.tierTarget[0]?.medTarget}% while Q10 (largest) sits at ${signalData.tierTarget[9]?.medTarget > 0 ? "+" : ""}${signalData.tierTarget[9]?.medTarget}%. A simple production-value decile rank outperforms the raw €-value as a model feature because the relationship is monotone but non-linear.`,
                },
                {
                  num: "2", color: C.orange,
                  title: "Tier Momentum Compounds the Signal",
                  body: `Companies rising ≥2 tiers (${signalData.tierShift[4]?.n.toLocaleString()} obs.) show a median target of ${signalData.tierShift[4]?.medTarget > 0 ? "+" : ""}${signalData.tierShift[4]?.medTarget}% vs. ${signalData.tierShift[0]?.medTarget > 0 ? "+" : ""}${signalData.tierShift[0]?.medTarget}% for those falling ≥2 tiers. Tier change (lag-1 shift) adds orthogonal information on top of absolute tier rank.`,
                },
                {
                  num: "3", color: C.purple,
                  title: "Mean Reversion Is Actionable",
                  body: `Companies with current growth >+200% (${signalData.growthMomentum[3]?.n.toLocaleString()} obs.) show a next-year median of ${signalData.growthMomentum[3]?.medTarget > 0 ? "+" : ""}${signalData.growthMomentum[3]?.medTarget}%. Companies already declining (≤-50%) show ${signalData.growthMomentum[0]?.medTarget > 0 ? "+" : ""}${signalData.growthMomentum[0]?.medTarget}% next. Encoding current-year growth bucket creates a powerful mean-reversion feature.`,
                },
                {
                  num: "4", color: C.blue,
                  title: "Equity Gap Reveals Hidden Owner Signals",
                  body: `Equity injections (${signalData.equityGap[2]?.n.toLocaleString()} co.) precede a median target of ${signalData.equityGap[2]?.medTarget > 0 ? "+" : ""}${signalData.equityGap[2]?.medTarget}%; withdrawals (${signalData.equityGap[0]?.n.toLocaleString()} co.) precede ${signalData.equityGap[0]?.medTarget > 0 ? "+" : ""}${signalData.equityGap[0]?.medTarget}%. This accounting identity captures owner sentiment not visible in the P&L, a premium signal for Italian private companies.`,
                },
              ].map((t, i) => (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${t.color}`, borderRadius: 8, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: t.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: C.bg }}>{t.num}</div>
                    <span style={{ color: C.white, fontSize: 16, fontWeight: 700 }}>{t.title}</span>
                  </div>
                  <p style={{ color: C.light, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{t.body}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "summary" && (
          <>
            <h2 style={{ color: C.white, fontSize: 24, fontWeight: 700, margin: "0 0 6px", fontFamily: "'Playfair Display', Georgia, serif" }}>
              3-Year Comparison & Strategic Insights
            </h2>
            <p style={{ color: C.muted, fontSize: 14, margin: "0 0 16px" }}>
              How the revenue forecasting landscape evolved across 2018→2019, 2019→2020, and 2020→2021
            </p>

            {/* Summary KPIs */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <KPI label="Total Companies" value={uniqueCompanies.toLocaleString()} sub="Unique across all years" color={C.accent} />
              <KPI label="Total Observations" value={totalRows.toLocaleString()} sub="Company-year rows, 2018-2020 (2021 = test year)" color={C.blue} />
              <KPI label="Best Median Target" value={`${bestYear.median > 0 ? "+" : ""}${bestYear.median}%`} sub={`${bestYear.year}, post-COVID rebound`} color={C.accent} />
              <KPI label="Highest Volatility" value={highestVolatility.std.toLocaleString()} sub={`${highestVolatility.year} std dev (COVID effect)`} color={C.coral} />
            </div>

            {/* Median Target Trend */}
            <Heading sub="How the median next-year revenue change shifted across years" insight="2020→2021 shows post-COVID recovery, a structural upward shift in the target">Median Target Trend</Heading>
            <Card>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={crossYear} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: C.light, fontSize: 14 }} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 12 }} axisLine={{ stroke: C.border }} />
                  <ReferenceLine y={0} stroke={C.border} strokeWidth={2} />
                  <Tooltip content={<Tip sfx="%" />} />
                  <Bar dataKey="median" name="Median Target %" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="median" position="top" formatter={v => `${v > 0 ? "+" : ""}${v}%`} style={{ fill: C.light, fontSize: 14, fontWeight: 700 }} />
                    {crossYear.map((_, i) => <Cell key={i} fill={[C.accent, C.blue, C.gold][i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* ── COVID SECTOR IMPACT ── */}
            <Heading
              sub="Median revenue change per sector × year-transition, reveals which industries were hit by COVID and who recovered strongest"
              insight="Sectors sorted by COVID shock (2019→20). Specialised Construction & Information Technology absorbed the blow; Food & Beverage Services took the deepest hit"
            >
              COVID Sector Impact: Revenue Change 2018-2021
            </Heading>
            <Card>
              <ResponsiveContainer width="100%" height={460}>
                <BarChart
                  data={covidSectorImpact}
                  layout="vertical"
                  barCategoryGap="22%"
                  barGap={3}
                  margin={{ left: 8, right: 68, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: C.muted, fontSize: 14 }}
                    axisLine={{ stroke: C.border }}
                    tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`}
                  />
                  <YAxis
                    dataKey="sector"
                    type="category"
                    tick={{ fill: C.light, fontSize: 14 }}
                    axisLine={{ stroke: C.border }}
                    width={200}
                  />
                  <Tooltip
                    formatter={(v, name) => v != null ? [`${v > 0 ? "+" : ""}${v}%`, name] : ["-", name]}
                    contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}
                    labelStyle={{ color: C.white, fontWeight: 700, marginBottom: 4 }}
                  />
                  <ReferenceLine x={0} stroke={C.muted} strokeWidth={2} />
                  <Legend
                    wrapperStyle={{ fontSize: 13, paddingTop: 10 }}
                    formatter={value => <span style={{ color: C.light }}>{value}</span>}
                  />
                  <Bar dataKey="2018→19" name="2018→19  Pre-COVID" fill={C.accent} radius={[0, 3, 3, 0]}>
                    <LabelList dataKey="2018→19" position="right" formatter={v => v != null ? `${v > 0 ? "+" : ""}${v}%` : ""} style={{ fill: C.muted, fontSize: 11 }} />
                  </Bar>
                  <Bar dataKey="2019→20" name="2019→20  COVID Shock" fill={C.coral} radius={[0, 3, 3, 0]}>
                    <LabelList dataKey="2019→20" position="right" formatter={v => v != null ? `${v > 0 ? "+" : ""}${v}%` : ""} style={{ fill: C.muted, fontSize: 11 }} />
                  </Bar>
                  <Bar dataKey="2020→21" name="2020→21  Recovery" fill={C.gold} radius={[0, 3, 3, 0]}>
                    <LabelList dataKey="2020→21" position="right" formatter={v => v != null ? `${v > 0 ? "+" : ""}${v}%` : ""} style={{ fill: C.muted, fontSize: 11 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p style={{ color: C.muted, fontSize: 11, textAlign: "center", margin: "4px 0 0" }}>
                Sorted by 2019→20 COVID shock (worst at top)  •  Median revenue_change per sector-year cohort  •  Source: train_data.csv
              </p>
            </Card>

            {/* Quantile Comparison Across Years */}
            <Heading sub="Side-by-side percentile comparison across years" insight="Q25 stays near -68% every year, Q75 near +240%, the spread is structurally stable, only the center shifts">Quantile Comparison Across Years</Heading>
            <Card>
              <div className="grid-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[2018, 2019, 2020].map((yr, yi) => {
                  const d = yearsData[yr];
                  const clr = [C.accent, C.blue, C.gold][yi];
                  return (
                    <div key={yr} style={{ border: `1px solid ${C.border}`, borderTop: `3px solid ${clr}`, borderRadius: 8, padding: "12px" }}>
                      <p style={{ color: clr, fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>{d.label}</p>
                      {d.quantiles.map((q, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: q.q === "Q50" ? `1px solid ${clr}40` : "none" }}>
                          <span style={{ color: q.q === "Q50" ? clr : C.muted, fontSize: 13, fontWeight: q.q === "Q50" ? 700 : 400 }}>{q.q}</span>
                          <span style={{ color: q.val > 0 ? C.accent : C.coral, fontSize: 13, fontWeight: 600 }}>{q.val > 0 ? "+" : ""}{q.val.toLocaleString()}%</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 0", marginTop: 4, borderTop: `1px solid ${C.border}` }}>
                        <span style={{ color: C.muted, fontSize: 12 }}>IQR</span>
                        <span style={{ color: C.orange, fontSize: 13, fontWeight: 700 }}>{d.target.iqr.toFixed(1)}pp</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Volatility */}
            <Heading sub="Standard deviation and IQR of the target, measuring prediction difficulty year over year" insight="Growing std dev confirms increasing volatility, models must account for temporal instability">Target Volatility Trend</Heading>
            <Card>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={crossYear} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: C.light, fontSize: 14 }} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 12 }} axisLine={{ stroke: C.border }} />
                  <Tooltip content={<Tip />} />
                  <Bar dataKey="std" name="Std Deviation" fill={C.coral} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="iqr" name="IQR"           fill={C.blue}  radius={[4, 4, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 13, color: C.muted }} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Size Effect Across Years */}
            <Heading sub="The 'funnel pattern', consistent across all three years" insight="Most actionable finding: company revenue size should be a primary feature in any predictive model">Size Effect: Consistent Across Years</Heading>
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
                  √ scale, equal bar height = equal proportional change · hover for exact %
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["2018→19", C.accent], ["2019→20", C.blue], ["2020→21", C.gold]].map(([lbl, col]) => (
                    <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: col }} />
                      <span style={{ color: C.muted, fontSize: 12 }}>{lbl}</span>
                    </div>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={(() => {
                  const sq = v => v == null ? null : Math.sign(v) * Math.sqrt(Math.abs(v));
                  return yearsData[2018].sizeSeg.map((s, i) => ({
                    name: s.name,
                    v18: sq(yearsData[2018].sizeSeg[i]?.medTarget),
                    v19: sq(yearsData[2019].sizeSeg[i]?.medTarget),
                    v20: sq(yearsData[2020].sizeSeg[i]?.medTarget),
                    r18: yearsData[2018].sizeSeg[i]?.medTarget,
                    r19: yearsData[2019].sizeSeg[i]?.medTarget,
                    r20: yearsData[2020].sizeSeg[i]?.medTarget,
                  }));
                })()} barCategoryGap="14%">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: C.light, fontSize: 12 }} axisLine={{ stroke: C.border }} angle={-30} textAnchor="end" height={60} interval={0} />
                  <YAxis
                    tick={{ fill: C.muted, fontSize: 13 }}
                    axisLine={{ stroke: C.border }}
                    width={68}
                    ticks={[-10, 0, 10, 20, 30, 40, 50]}
                    domain={[-10, 52]}
                    tickFormatter={v => { const r = Math.sign(v) * Math.round(v * v); return (r > 0 ? '+' : '') + r + '%'; }}
                    label={{ value: "Median Target % (√ scale)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11, dx: -16 }}
                  />
                  <ReferenceLine y={0} stroke={C.border} strokeWidth={2} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    return (
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ color: C.white, fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>{d?.name}</p>
                        {[["2018→19", C.accent, d?.r18], ["2019→20", C.blue, d?.r19], ["2020→21", C.gold, d?.r20]].map(([lbl, col, val]) => (
                          <p key={lbl} style={{ color: col, fontSize: 13, margin: "2px 0", fontWeight: 600 }}>
                            {lbl}: {val != null ? (val > 0 ? '+' : '') + Math.round(val) + '%' : 'N/A'}
                          </p>
                        ))}
                      </div>
                    );
                  }} />
                  <Bar dataKey="v18" fill={C.accent} name="2018→19" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="v19" fill={C.blue}   name="2019→20" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="v20" fill={C.gold}   name="2020→21" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p style={{ color: C.muted, fontSize: 11, margin: "6px 0 0", textAlign: "center" }}>
                Tick labels show real % values · +100% → tick 10 · +400% → tick 20 · +900% → tick 30 · +2500% → tick 50
              </p>
            </Card>

            {/* Strategic Takeaways */}
            <Heading>Key Strategic Takeaways for Revenue Forecasting</Heading>
            <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { num: "1", title: "Size Drives Everything", body: "Small companies (<€100M) show explosive median growth; large companies (>€10B) trend deeply negative. This funnel pattern is consistent across all 3 years. Company revenue tier must be a primary model feature.", color: C.accent },
                { num: "2", title: "Extreme Tails Are Structural", body: "~35% of companies have >100% revenue change. These are real events, expansions, closures, or potentially structural reorganisations. The IQR stays ~300pp every year. Standard RMSE will be dominated by these tails without explicit handling.", color: C.coral },
                { num: "3", title: "COVID Created a Shift, Not a Break", body: "The 2020→2021 median target reached its highest level in the dataset. The recovery effect is real but the distributional shape is unchanged. Year-fixed effects or temporal features should capture this.", color: C.gold },
                { num: "4", title: "Sector Divergence Amplified by COVID", body: "The COVID shock (2019→20) hit sectors asymmetrically. Food & Beverage Services, Motor Vehicle Trade saw the deepest declines; Construction and Information Technology held. The 2020→21 recovery was equally uneven, creating strong sector-level signals for modeling.", color: C.blue },
              ].map((t, i) => (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${t.color}`, borderRadius: 8, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: t.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: C.bg }}>{t.num}</div>
                    <span style={{ color: C.white, fontSize: 16, fontWeight: 700 }}>{t.title}</span>
                  </div>
                  <p style={{ color: C.light, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{t.body}</p>
                </div>
              ))}
            </div>

            {/* M&A Hypothesis */}
            <Heading sub="A working hypothesis to explain unexplained extremes, not a confirmed fact">Unexplained Extremes: A Structural Reorganisation Hypothesis</Heading>
            <div style={{ background: `${C.orange}0C`, border: `1.5px solid ${C.orange}35`, borderRadius: 12, padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ background: `${C.orange}25`, color: C.orange, fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 4, letterSpacing: 1, textTransform: "uppercase" }}>Working Hypothesis</span>
                <span style={{ color: C.white, fontSize: 15, fontWeight: 700 }}>Some extreme revenue changes may reflect M&A or major capital restructurings</span>
              </div>
              <p style={{ color: C.light, fontSize: 14, lineHeight: 1.75, margin: "0 0 16px" }}>
                After accounting for size effects, COVID shocks, and sector dynamics, a small subset of companies still shows simultaneous extreme revenue changes (&gt;500%) alongside unusual equity and asset movements. We cannot confirm these are M&A events, the dataset contains no such label. However, the co-occurrence of four indirect financial signals is too consistent to dismiss as noise.
              </p>
              <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {[
                  { signal: "Equity Shock", desc: "Shareholders' equity changes by more than what net profit alone explains, suggesting external capital injection or withdrawal", icon: "⚡" },
                  { signal: "Asset Jump", desc: "Total fixed assets increase sharply year-over-year without proportional capex, consistent with asset acquisition from a merger", icon: "📈" },
                  { signal: "Debt Structure Shift", desc: "Short-term vs. long-term debt mix changes abruptly, reflects refinancing typical of acquisition financing", icon: "🏦" },
                  { signal: "Revenue Discontinuity", desc: "Revenue change exceeds ±200% in a single year, beyond what organic growth or sector trends can explain", icon: "📊" },
                ].map((s, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                      <span style={{ fontSize: 15 }}>{s.icon}</span>
                      <span style={{ color: C.orange, fontSize: 13, fontWeight: 700 }}>{s.signal}</span>
                    </div>
                    <p style={{ color: C.muted, fontSize: 10.5, lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                  <p style={{ color: C.white, fontSize: 13, fontWeight: 700, margin: "0 0 5px" }}>Confidence Scoring Logic</p>
                  <p style={{ color: C.muted, fontSize: 10.5, lineHeight: 1.55, margin: 0 }}>
                    Each company-year receives 1 point per signal present. A score ≥ 4 out of 4 triggers <code style={{ color: C.orange }}>ma_event_proxy_flag = 1</code>. This conservative threshold minimises false positives, only observations where all four signals align simultaneously are flagged.
                  </p>
                </div>
                <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                  <p style={{ color: C.white, fontSize: 13, fontWeight: 700, margin: "0 0 5px" }}>How We Use It</p>
                  <p style={{ color: C.muted, fontSize: 10.5, lineHeight: 1.55, margin: 0 }}>
                    The flag is used as a feature, not as ground truth. We do not claim to have identified M&A events, we claim these observations behave differently and the model should know that. If the hypothesis is wrong, the flag still captures "structurally unusual years" which carry predictive value regardless of the true cause.
                  </p>
                </div>
              </div>
              <p style={{ color: C.orange, fontSize: 12, fontWeight: 600, margin: "14px 0 0", fontStyle: "italic" }}>
                → This hypothesis motivates the <code style={{ color: C.orange }}>ma_event_proxy_flag</code> and <code style={{ color: C.orange }}>ma_confidence_score</code> features built in the Feature Engineering section.
              </p>
            </div>
          </>
        )}

        {/* ── FEATURE ENGINEERING TAB ── */}
        {tab === "features" && (
          <>
            <h2 style={{ color: C.white, fontSize: 24, fontWeight: 700, margin: "0 0 6px", fontFamily: "'Playfair Display', Georgia, serif" }}>
              Feature Engineering
            </h2>
            <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
              The feature pipeline starts from raw financial statements and constructs 301 candidate features. After correlation and VIF review, 63 remain. The final model uses 49 selected by a composite Spearman-first rule.
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
              {[
                { label: "Base Candidates", value: "301", color: C.muted, sub: "engineered from raw statements" },
                { label: "After VIF / Corr Review", value: "63", color: C.gold, sub: "correlation and multicollinearity filter" },
                { label: "Final Model Features", value: "49", color: C.accent, sub: "selected by Spearman-first composite rule" },
                { label: "Feature Domains", value: "7", color: C.blue, sub: "economic groupings in the winning set" },
              ].map((s, i) => (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 8, padding: "12px 20px", textAlign: "center", flex: "1 1 140px" }}>
                  <div style={{ color: s.color, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ color: C.white, fontSize: 12, fontWeight: 700, marginTop: 4 }}>{s.label}</div>
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            <Heading sub="Seven economic domains in the 49-feature winning set (Experiment A), with key feature names from each">Feature Domains in the Final Model</Heading>
            <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { name: "Revenue & Growth History", count: "6", type: "Momentum", color: C.accent, desc: "prior_revchg_tier_shift_median, prior_revchg_tier_median, prior_revchg_sector_tier_shift_count, age_bucket_established, age_bucket_mature, large_tier_jump_flag", body: "Prior-year tier shift signals capture whether a company\'s revenue rank moved relative to peers. These momentum features encode mean-reversion risk: companies that jumped tiers sharply tend to revert." },
                { name: "Profitability Cluster", count: "4", type: "Profitability", color: C.gold, desc: "profitability_cluster, profit_margin_calc, margin_squeeze_flag, debt_buildup_margin_deterioration_flag", body: "A composite profitability cluster score groups companies by margin stability, growth consistency, and financial health. Margin squeeze and deterioration flags capture firms where profitability is under structural pressure." },
                { name: "Balance Sheet & Leverage", count: "8", type: "Solvency", color: C.blue, desc: "capital_intensity, debt_maturity_ratio, net_debt, leverage, debt_to_assets, equity_gap_direction, debt_buildup_margin_deterioration_flag, debt_funded_expansion_flag", body: "Debt structure and capital intensity features identify whether a company is leveraging up for growth or under financial stress. Equity gap direction detects hidden capital flows not visible in the P&L." },
                { name: "Sector / ATECO Encoding", count: "13", type: "Sector", color: C.teal, desc: "ateco_sector_68, 46, 10, 56, 45, 47, 71, 25, 41, 62, 77, 82, 43 (one-hot dummies)", body: "ATECO sector dummies for the 13 sectors that survived the VIF filter. Sectors carry structural baseline growth rates, COVID exposure differences, and legal form composition that ratios alone cannot capture." },
                { name: "Legal Form & Company Age", count: "10", type: "Company", color: C.purple, desc: "legal_form_SPA, SRL, SAS, SNC, SAPA, is_young_company, lifecycle_stage_veteran, age_bucket_established, age_bucket_mature, leverage", body: "Legal form is the single strongest predictor by SHAP value. SPA companies have different ownership structure, governance, and growth behavior than SRL companies. Age buckets encode lifecycle stage effects." },
                { name: "Region Indicators", count: "4", type: "Geography", color: C.orange, desc: "region_Liguria, region_Toscana, region_Lazio, prior_revchg_sector_tier_shift_count (cross-signal)", body: "Three regional dummies that showed consistent holdout signal. Regional differences in credit access, labor markets, and industrial mix affect revenue dynamics beyond what sector alone captures." },
                { name: "Cost & Efficiency Flags", count: "2", type: "Efficiency", color: "#F472B6", desc: "margin_squeeze_flag, capex_intensity_flag", body: "Binary flags for companies with deteriorating cost efficiency or unusually high capital expenditure intensity. These identify operational stress or investment cycles before they appear in revenue." },
                { name: "Temporal & COVID Interactions", count: "5", type: "Temporal", color: C.coral, desc: "debt_buildup_margin_deterioration_flag, debt_funded_expansion_flag, margin_squeeze_flag, capex_intensity_flag, large_tier_jump_flag", body: "Flags that combine time-period signals with company characteristics. COVID interaction terms capture which companies were structurally vulnerable when the shock hit, not just which sector they were in." },
              ].map((f, i) => (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${f.color}`, borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <code style={{ color: f.color, fontSize: 14, fontWeight: 700 }}>{f.name}</code>
                    <span style={{ background: `${f.color}20`, color: f.color, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 0.5 }}>{f.type}</span>
                    <span style={{ marginLeft: "auto", color: C.muted, fontSize: 11, fontWeight: 600 }}>{f.count} features</span>
                  </div>
                  <p style={{ color: C.muted, fontSize: 12, fontFamily: "monospace", margin: "0 0 6px", lineHeight: 1.4 }}>{f.desc}</p>
                  <p style={{ color: C.light, fontSize: 13, lineHeight: 1.5, margin: 0 }}>{f.body}</p>
                </div>
              ))}
            </div>

            {/* Missingness */}
            {/* Missingness */}
            <Heading sub="How missing values are identified and treated">Handling Missingness</Heading>
            <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Card>
                <p style={{ color: C.accent, fontSize: 12, fontWeight: 700, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 1 }}>Numeric Features</p>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  {[
                    { feature: "Monetary columns", strategy: "Median per fiscal year", reason: "Right-skewed; median robust to outliers" },
                    { feature: "Ratio columns (ROI, margin…)", strategy: "Winsorise P1/P99 → median", reason: "Division instability near zero" },
                    { feature: "ROE & Leverage (structural zeros)", strategy: "Similarity-based imputation", reason: "Matched on sector, legal form & fiscal year" },
                    { feature: "Temporal lag features", strategy: "Forward-fill within company", reason: "Preserves time-series continuity" },
                    { feature: "Target (revenue_change_next)", strategy: "Row excluded from training", reason: "No future info available, not imputable" },
                  ].map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px", color: C.light, fontSize: 12 }}>{r.feature}</td>
                      <td style={{ padding: "6px 8px", color: C.accent, fontSize: 12, fontWeight: 600 }}>{r.strategy}</td>
                    </tr>
                  ))}
                </table>
                <p style={{ color: C.muted, fontSize: 11, margin: "8px 0 0" }}>All imputers fitted on training data only, applied to validation/test to avoid leakage</p>
              </Card>
              <Card>
                <p style={{ color: C.blue, fontSize: 12, fontWeight: 700, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 1 }}>Categorical Features</p>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  {[
                    { feature: "legal_form", strategy: "One-Hot Encoding", reason: "Low cardinality (6 classes), no ordinal order" },
                    { feature: "ateco_sector", strategy: "Target encoding (mean PV Next)", reason: "High cardinality, smoothed to avoid overfitting" },
                    { feature: "region", strategy: "Target encoding (mean PV Next)", reason: "20 regions, OHE would add too many sparse dims" },
                    { feature: "fiscal_year", strategy: "Integer feature + year dummies", reason: "Captures temporal trend and COVID fixed effect" },
                  ].map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px", color: C.light, fontSize: 12 }}>{r.feature}</td>
                      <td style={{ padding: "6px 8px", color: C.blue, fontSize: 12, fontWeight: 600 }}>{r.strategy}</td>
                    </tr>
                  ))}
                </table>
                <p style={{ color: C.muted, fontSize: 11, margin: "8px 0 0" }}>Target encoding computed on training fold only to prevent leakage into validation</p>
              </Card>
            </div>

            {/* Feature Selection */}
            <div style={{ background: `${C.gold}09`, border: `1px solid ${C.gold}22`, borderLeft: `4px solid ${C.gold}`, borderRadius: 10, padding: "14px 18px", marginTop: 8 }}>
              <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 5px" }}>Next Step: Feature Selection</p>
              <p style={{ color: C.light, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                The final model uses <b style={{ color: C.gold }}>49 features</b> selected from 301 base candidates via a Spearman-first composite rule. See the <b style={{ color: C.white }}>Feature Selection</b> tab in Part II for the full methodology.
              </p>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════════
            PART II - FEATURE SELECTION
        ═══════════════════════════════════════════════════════ */}
        {tab === "featsel" && (() => {
          const experiments = [
            { id: "A", variant: "Profitability Cluster", n: 49, dacc: 74.2838, spear: 0.6749, tmape: 172.2, color: C.accent, tag: "WINNER", tagColor: C.accent },
            { id: "B", variant: "Broad Ranked Pool",     n: 99, dacc: 74.0109, spear: 0.6735, tmape: 169.1, color: C.blue,   tag: "Runner-up", tagColor: C.blue },
            { id: "C", variant: "Top-39 SHAP",           n: 39, dacc: 74.5566, spear: 0.6727, tmape: 173.2, color: C.gold,   tag: "Best Dir.", tagColor: C.gold },
            { id: "D", variant: "Top-30 SHAP",           n: 30, dacc: 72.1010, spear: 0.5994, tmape: 200.6, color: C.coral,  tag: "REJECTED", tagColor: C.coral },
          ];
          const shap15 = [
            { feature: "legal_form_SPA",                shap: 0.4615, domain: "Company" },
            { feature: "legal_form_SRL",                shap: 0.1940, domain: "Company" },
            { feature: "revchg_tier_shift_median",      shap: 0.1441, domain: "Revenue" },
            { feature: "capital_intensity",             shap: 0.1042, domain: "Balance" },
            { feature: "ateco_sector_68",               shap: 0.0593, domain: "Sector" },
            { feature: "retained_earnings_proxy",       shap: 0.0483, domain: "Profit" },
            { feature: "financial_drag",                shap: 0.0474, domain: "Balance" },
            { feature: "ateco_sector_46",               shap: 0.0463, domain: "Sector" },
            { feature: "retained_earnings_to_assets",   shap: 0.0417, domain: "Profit" },
            { feature: "ateco_sector_10",               shap: 0.0393, domain: "Sector" },
            { feature: "financial_income",              shap: 0.0393, domain: "Balance" },
            { feature: "debt_maturity_ratio",           shap: 0.0366, domain: "Balance" },
            { feature: "accounting_gap",                shap: 0.0337, domain: "Balance" },
            { feature: "net_debt",                      shap: 0.0335, domain: "Balance" },
            { feature: "profitability_cluster",         shap: 0.0335, domain: "Profit" },
          ];
          const domainColors = { Company: C.purple, Revenue: C.accent, Balance: C.blue, Profit: C.gold, Sector: C.teal, Cost: C.orange };
          const domains = [
            { name: "Sector / Region", count: 17, color: C.teal },
            { name: "Company (Legal Form)", count: 10, color: C.purple },
            { name: "Leverage / Balance", count: 8, color: C.blue },
            { name: "Revenue / Growth", count: 6, color: C.accent },
            { name: "Profitability", count: 4, color: C.gold },
            { name: "Cost / Efficiency", count: 2, color: C.orange },
            { name: "Temporal Flags", count: 5, color: C.teal },
          ];
          const maxShap = shap15[0].shap;
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ color: "#38BDF8", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, whiteSpace: "nowrap" }}>Part II · Feature Selection</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <Heading sub="Four candidate pools tested on the 2020 validation fold, ranked by Spearman ρ, WAPE, and TMAPE₉₅. Experiment D is immediately rejected." insight="Experiment A wins: best Spearman and WAPE despite lower raw directional accuracy than Exp C">Feature Selection Experiments A / B / C / D</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 6 }}>
                {experiments.map(ex => (
                  <div key={ex.id} style={{ background: C.card, border: `2px solid ${ex.color}50`, borderTop: `4px solid ${ex.color}`, borderRadius: 10, padding: "18px 20px", position: "relative" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <span style={{ color: ex.color, fontSize: 22, fontWeight: 800, fontFamily: "'Playfair Display',serif" }}>Exp {ex.id}</span>
                        <p style={{ color: C.light, fontSize: 12, margin: "2px 0 0" }}>{ex.variant}</p>
                      </div>
                      <span style={{ background: `${ex.tagColor}20`, color: ex.tagColor, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4 }}>{ex.tag}</span>
                    </div>
                    {[
                      { label: "Features", val: ex.n, suffix: "", hi: false },
                      { label: "Directional Acc", val: ex.dacc + "%", suffix: "", hi: true },
                      { label: "Spearman ρ", val: ex.spear, suffix: "", hi: true },
                      { label: "TMAPE₉₅", val: ex.tmape + "%", suffix: "", hi: false },
                    ].map((m, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < 3 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.muted, fontSize: 12 }}>{m.label}</span>
                        <span style={{ color: m.hi ? ex.color : C.light, fontSize: 13, fontWeight: 700 }}>{m.val}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 0 2px", lineHeight: 1.5 }}>
                All experiments use the same <strong style={{ color: C.white }}>time-valid split</strong>: trained on 2018-2019, validated on 2020. The selection rule ranks by <strong style={{ color: C.white }}>Spearman ρ</strong> first, then WAPE, then TMAPE₉₅, because ranking quality and robust percentage error matter more than a single directional-accuracy decimal on one validation year.
              </p>

              <Heading sub="Mean absolute SHAP value on 2020 validation, higher = more predictive signal" insight="Legal form dominates: SPA companies behave structurally differently to SRL">SHAP Feature Importance, Top 15</Heading>
              <Card>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {shap15.map((f, i) => {
                    const pct = (f.shap / maxShap) * 100;
                    const col = domainColors[f.domain] || C.blue;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: C.muted, fontSize: 11, width: 20, textAlign: "right", flexShrink: 0 }}>#{i+1}</span>
                        <span style={{ color: C.light, fontSize: 12, width: 220, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.feature}</span>
                        <div style={{ flex: 1, background: C.bg, borderRadius: 4, height: 18, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 4, transition: "width 0.3s" }} />
                        </div>
                        <span style={{ color: col, fontSize: 12, fontWeight: 700, width: 46, textAlign: "right", flexShrink: 0 }}>{f.shap.toFixed(3)}</span>
                        <span style={{ background: `${col}20`, color: col, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, width: 56, textAlign: "center", flexShrink: 0 }}>{f.domain}</span>
                      </div>
                    );
                  })}
                </div>
                <p style={{ color: C.muted, fontSize: 12, margin: "14px 0 0", lineHeight: 1.5 }}>
                  <strong style={{ color: C.white }}>Why SHAP over Pearson r?</strong> Pearson r only captures linear associations, the financial features here often interact non-linearly (e.g. high leverage × thin margin). SHAP measures actual model-level contribution on the held-out set, including non-linear and interaction effects. Features like <code style={{ color: C.gold }}>accounting_gap</code> and <code style={{ color: C.gold }}>capital_intensity</code> have near-zero Pearson r with the target but carry real tree-level signal.
                </p>
              </Card>

              <Heading sub="49 selected features grouped by economic domain" insight="Sector dummies (17) dominate the count, structural industry membership is the strongest stable signal across all validation years">Feature Domain Breakdown</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Domain Composition</p>
                  {domains.map((d, i) => {
                    const pct = (d.count / 52) * 100;
                    return (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ color: C.light, fontSize: 13 }}>{d.name}</span>
                          <span style={{ color: d.color, fontSize: 13, fontWeight: 700 }}>{d.count} features</span>
                        </div>
                        <div style={{ background: C.bg, borderRadius: 4, height: 8 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: d.color, borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })}
                </Card>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Experiment A: Why It Wins</p>
                  <p style={{ color: C.muted, fontSize: 12, margin: "0 0 12px" }}>WAPE across all 4 experiments on the 2020 validation fold (lower is better)</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={[
                      { exp: "Exp A", wape: 89.26, color: C.accent },
                      { exp: "Exp B", wape: 89.37, color: `${C.blue}88` },
                      { exp: "Exp C", wape: 89.43, color: `${C.gold}88` },
                      { exp: "Exp D", wape: 93.90, color: `${C.coral}88` },
                    ]} margin={{ top: 20, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                      <XAxis dataKey="exp" tick={{ fill: C.muted, fontSize: 11 }} />
                      <YAxis domain={[88, 95]} tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => v.toFixed(0) + "%"} />
                      <Tooltip contentStyle={{ background: "#1A2540", border: `1px solid ${C.accent}40`, borderRadius: 8, padding: "8px 12px" }} labelStyle={{ color: C.accent, fontWeight: 700, fontSize: 12 }} itemStyle={{ color: C.white, fontSize: 12 }} formatter={v => [`${v.toFixed(2)}%`, "WAPE"]} />
                      <Bar dataKey="wape" radius={[4,4,0,0]}>
                        {[C.accent, `${C.blue}88`, `${C.gold}88`, `${C.coral}88`].map((col, i) => <Cell key={i} fill={col} />)}
                        <LabelList dataKey="wape" position="top" formatter={v => `${v.toFixed(2)}%`} style={{ fill: C.light, fontSize: 11 }} />
                      </Bar>
                      <ReferenceLine y={89.26} stroke={C.accent} strokeDasharray="3 2" />
                    </BarChart>
                  </ResponsiveContainer>
                  <p style={{ color: C.muted, fontSize: 11, margin: "8px 0 0" }}>Exp A uses a profitability cluster approach, not a SHAP top-k sweep. It selects 49 features and achieves the lowest WAPE of all four experiments. Exp D is rejected immediately.</p>
                </Card>
              </div>
            </>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════
            PART II - MODEL RESULTS
        ═══════════════════════════════════════════════════════ */}
        {tab === "models" && (() => {
          const models = [
            { name: "Lasso",            group: "linear",   features: 49, dacc: 74.5225, spear: 0.6841, color: C.accent, tag: "BEST OVERALL" },
            { name: "ElasticNet",       group: "linear",   features: 49, dacc: 74.5225, spear: 0.6838, color: C.gold,   tag: "" },
            { name: "LinearRegression", group: "linear",   features: 49, dacc: 74.6248, spear: 0.6829, color: C.muted,  tag: "Best Dir." },
            { name: "Ridge",            group: "linear",   features: 49, dacc: 74.4884, spear: 0.6836, color: C.muted,  tag: "" },
            { name: "RandomForest",     group: "advanced", features: 49, dacc: 74.4543, spear: 0.6736, color: C.teal,   tag: "" },
            { name: "CatBoost",         group: "advanced", features: 49, dacc: 74.2838, spear: 0.6749, color: C.blue,   tag: "Best Tree" },
            { name: "LightGBM",         group: "advanced", features: 49, dacc: 73.8745, spear: 0.6634, color: C.purple, tag: "" },
            { name: "XGBoost",          group: "advanced", features: 49, dacc: 73.8745, spear: 0.6595, color: C.orange, tag: "" },
            { name: "BaselineMedian",   group: "baseline", features: 49, dacc: 70.5662, spear: 0.5689, color: C.coral,  tag: "Baseline" },
          ];
          const stability = [
            { fold: "Pre-COVID\n2018→2019", shortFold: "2018→19",   dacc: 72.9364, spear: 0.6359, wape: 92.82, tmape: 156.9, n: 41, color: C.blue },
            { fold: "COVID\n2018-19→2020",  shortFold: "2018-19→20", dacc: 74.5225, spear: 0.6841, wape: 88.71, tmape: 166.7, n: 49, color: C.gold },
            { fold: "Post-COVID\n2018-20→2021", shortFold: "18-20→21", dacc: 75.6173, spear: 0.7031, wape: 86.45, tmape: 164.5, n: 49, color: C.accent },
          ];
          const groupColors = { advanced: C.accent, linear: C.gold, baseline: C.coral };
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ color: "#34D399", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, whiteSpace: "nowrap" }}>Part II · Model Results</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <Heading sub="9 models benchmarked on the 2020 temporal validation fold, 49 features, same leakage-safe split" insight="Lasso is the clean base model; CatBoost is kept as the advanced sensitivity check">Full Model Benchmark, 2020 Validation</Heading>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.cardAlt }}>
                      {["Model", "Group", "Features", "Dir. Acc ↑", "Spearman ρ ↑"].map((h, i) => (
                        <th key={i} style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, padding: "10px 12px", textAlign: i < 2 ? "left" : "right", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m, i) => (
                      <tr key={i} style={{ background: i === 0 ? `${C.accent}08` : "transparent", borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "9px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: C.white, fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                            {m.tag && <span style={{ background: `${m.color}25`, color: m.color, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3 }}>{m.tag}</span>}
                          </div>
                        </td>
                        <td style={{ padding: "9px 12px" }}><span style={{ background: `${groupColors[m.group]}15`, color: groupColors[m.group], fontSize: 11, padding: "2px 7px", borderRadius: 3, fontWeight: 600 }}>{m.group}</span></td>
                        <td style={{ padding: "9px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{m.features}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right", color: i === 0 ? C.accent : C.light, fontWeight: i === 0 ? 700 : 400, fontSize: 13 }}>{m.dacc.toFixed(2)}%</td>
                        <td style={{ padding: "9px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{m.spear.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <p style={{ color: C.muted, fontSize: 12, margin: "8px 0 0 2px", lineHeight: 1.5 }}>
                <strong style={{ color: C.white }}>Why Lasso over tree-based models?</strong> The feature selection rule ranks by <strong style={{ color: C.white }}>Spearman ρ</strong>, then WAPE, then TMAPE₉₅, metrics that are more meaningful than raw directional accuracy on a single noisy fold. Under these criteria <strong style={{ color: C.accent }}>Lasso</strong> wins: it achieves <strong style={{ color: C.accent }}>75.62% directional accuracy</strong>, <strong style={{ color: C.blue }}>0.703 Spearman</strong>, and <strong style={{ color: C.purple }}>164.5 TMAPE₉₅</strong> on the locked 2021 holdout, while being fully interpretable and less likely to overfit the extreme tails.
              </p>

              <Heading sub="Lasso log-target workflow retrained on three expanding time windows: pre-COVID, COVID, and post-COVID recovery" insight="Directional accuracy and Spearman ρ both improve as the training window broadens, the model gets better, not worse, over time">Historical Stability Audit, 3 Rolling Folds</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Card>
                  {stability.map((s, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8, padding: "12px 0", borderBottom: i < 2 ? `1px solid ${C.border}` : "none" }}>
                      <div>
                        <p style={{ color: s.color, fontSize: 12, fontWeight: 700, margin: "0 0 2px" }}>{s.shortFold}</p>
                        <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>{s.n} features</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ color: C.muted, fontSize: 10, margin: "0 0 2px", textTransform: "uppercase" }}>Dir. Acc</p>
                        <p style={{ color: s.color, fontSize: 14, fontWeight: 700, margin: 0 }}>{s.dacc.toFixed(2)}%</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ color: C.muted, fontSize: 10, margin: "0 0 2px", textTransform: "uppercase" }}>Spearman</p>
                        <p style={{ color: C.light, fontSize: 14, fontWeight: 700, margin: 0 }}>{s.spear.toFixed(3)}</p>
                      </div>
                    </div>
                  ))}
                  <p style={{ color: C.muted, fontSize: 12, margin: "12px 0 0", lineHeight: 1.5 }}>
                    Directional accuracy rises from <strong style={{ color: C.white }}>72.94%</strong> on the 2019 audit to <strong style={{ color: C.white }}>75.62%</strong> on the locked 2021 holdout, while Spearman improves from <strong style={{ color: C.white }}>0.636</strong> to <strong style={{ color: C.white }}>0.703</strong>. That is the pattern we want: the selected workflow gets stronger as the time window broadens instead of degrading after COVID.
                  </p>
                </Card>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>WAPE Across Folds <span style={{ color: C.accent, fontSize: 10, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(lower = better)</span></p>
                  <p style={{ color: C.muted, fontSize: 11, margin: "0 0 10px", lineHeight: 1.4 }}>WAPE = sum of all errors ÷ sum of all actual revenue changes. Scale-invariant and never blows up near zero, unlike raw MAPE.</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={stability} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                      <XAxis dataKey="shortFold" tick={{ fill: C.muted, fontSize: 10 }} />
                      <YAxis domain={[84, 95]} tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => v + "%"} />
                      <Tooltip contentStyle={{ background: "#1A2540", border: `1px solid ${C.accent}40`, borderRadius: 8, padding: "8px 12px" }} labelStyle={{ color: C.accent, fontWeight: 700, fontSize: 12 }} itemStyle={{ color: C.white, fontSize: 12 }} formatter={v => [`${v.toFixed(2)}%`, "WAPE"]} />
                      <Bar dataKey="wape" radius={[4,4,0,0]}>
                        {stability.map((s, i) => <Cell key={i} fill={s.color} />)}
                        <LabelList dataKey="wape" position="top" formatter={v => `${v.toFixed(1)}%`} style={{ fill: C.light, fontSize: 11 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p style={{ color: C.muted, fontSize: 11, margin: "6px 0 0", textAlign: "center" }}>WAPE drops 6.4pp from pre-COVID to post-COVID fold, the model improves as the training window grows.</p>
                </Card>
              </div>

              <Heading sub="Leakage is the most common mistake in financial ML, we audit 6 risk categories" insight="All 6 checks pass: the workflow is clean and defensible">Leakage Control Audit, 6 Checks</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {[
                  { risk: "Target Leakage", control: "Drop next-year target/value columns from every feature list", status: true },
                  { risk: "Future Peer Statistics", control: "Use T-1 joins or fold-safe computation for all sector/region aggregates", status: true },
                  { risk: "2020-Specific Overfit", control: "Feature selection on 2018-19→2020 only, locked holdout on 2020-21→2021", status: true },
                  { risk: "Panel Leakage", control: "Company groups never split across train/val within the same fold", status: true },
                  { risk: "Near-Zero MAPE Blow-up", control: "Use TMAPE₉₅ (floor denominator at P5), raw MAPE excluded from optimisation", status: true },
                  { risk: "Overclaiming Capital Events", control: "equity_gap treated as proxy signal; model uncertainty flagged in business notes", status: true },
                ].map((c, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.accent}30`, borderLeft: `4px solid ${C.accent}`, borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 16 }}>✓</span>
                      <span style={{ color: C.accent, fontSize: 13, fontWeight: 700 }}>{c.risk}</span>
                    </div>
                    <p style={{ color: C.light, fontSize: 12, margin: 0, lineHeight: 1.5 }}>{c.control}</p>
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════
            PART II - HYPERPARAMETER TUNING
        ═══════════════════════════════════════════════════════ */}
        {tab === "tuning" && (() => {
          const tuningRows = [
            { depth: 6, iterations: 300, learningRate: 0.03, wape: 88.69, spear: 0.6801, tmape: 161.7, rank: 1 },
            { depth: 6, iterations: 300, learningRate: 0.05, wape: 88.89, spear: 0.6805, tmape: 163.4, rank: 2 },
            { depth: 4, iterations: 300, learningRate: 0.05, wape: 88.89, spear: 0.6802, tmape: 165.8, rank: 3 },
            { depth: 4, iterations: 500, learningRate: 0.05, wape: 89.01, spear: 0.6794, tmape: 167.4, rank: 4 },
            { depth: 4, iterations: 700, learningRate: 0.03, wape: 88.77, spear: 0.6793, tmape: 166.2, rank: 5 },
            { depth: 6, iterations: 500, learningRate: 0.03, wape: 88.81, spear: 0.6772, tmape: 168.4, rank: 6 },
            { depth: 4, iterations: 300, learningRate: 0.03, wape: 88.82, spear: 0.6805, tmape: 163.4, rank: 7 },
            { depth: 6, iterations: 700, learningRate: 0.03, wape: 89.33, spear: 0.6762, tmape: 170.1, rank: 8 },
            { depth: 6, iterations: 500, learningRate: 0.05, wape: 89.01, spear: 0.6772, tmape: 168.4, rank: 9 },
          ];
          const clippingData = [
            { label: "No Clip",       clip: "None",         wape: 88.82, tmape: 173.0, note: "Extreme events dominate loss" },
            { label: "P2-P98",        clip: "(0.02, 0.98)", wape: 88.73, tmape: 169.9, note: "Mild trim, small improvement" },
            { label: "P5-P95 ✓",     clip: "(0.05, 0.95)", wape: 88.71, tmape: 166.7, note: "Optimal, selected" },
            { label: "+ Pred. Winsor",clip: "P5-P95 + P2-P98",wape: 89.27, tmape: 166.6, note: "Hurts WAPE, rejected" },
          ];
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ color: "#FB923C", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, whiteSpace: "nowrap" }}>Part II · Hyperparameter Tuning</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              {/* ── LASSO: CLEAN BASE MODEL ── */}
              <Heading sub="Lasso is our selected clean base model, L1 regularisation, log-target transformation, P5/P95 clipping" insight="WAPE 88.71% on 2020 validation, 86.45% on the locked 2021 holdout, improving as the training window grows">Lasso, The Clean Base Model</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
                <Card>
                  <p style={{ color: C.accent, fontSize: 13, fontWeight: 700, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 0.8 }}>Why Lasso works for revenue forecasting</p>
                  {[
                    { icon: "λ", color: C.accent,  title: "L1 Regularisation",   body: "Lasso shrinks irrelevant coefficients to exactly zero. With 49 input features and weak individual signals, this automatic sparsity prevents noise from accumulating into bias." },
                    { icon: "↗", color: C.gold,    title: "Log-Target Transform",  body: "We fit log(next_production_value), then back-transform to revenue change. Revenue follows a log-normal distribution, this single transformation removes 90% of the extreme-tail instability from the training loss." },
                    { icon: "✂", color: C.blue,    title: "P5/P95 Target Clipping",body: "Clip the training target at the 5th and 95th percentile so a handful of M&A-driven outliers can't dominate the regression. Evaluation is always on the unclipped full distribution." },
                    { icon: "⇉", color: C.purple,  title: "No Additional Grid Needed", body: "The default Lasso alpha=1.0 combined with the log-transform and clipping already produces a well-regularised model. Extensive alpha sweeps on a single noisy validation year create overfitting risk, not better models." },
                  ].map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: i < 3 ? `1px solid ${C.border}` : "none" }}>
                      <span style={{ color: p.color, fontSize: 18, fontWeight: 800, width: 22, flexShrink: 0, lineHeight: 1.4 }}>{p.icon}</span>
                      <div>
                        <p style={{ color: p.color, fontSize: 12, fontWeight: 700, margin: "0 0 3px" }}>{p.title}</p>
                        <p style={{ color: C.light, fontSize: 12, margin: 0, lineHeight: 1.5 }}>{p.body}</p>
                      </div>
                    </div>
                  ))}
                </Card>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: `${C.accent}10`, border: `1px solid ${C.accent}30`, borderRadius: 10, padding: "16px 18px" }}>
                    <p style={{ color: C.accent, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>Lasso Key Metrics</p>
                    {[
                      { label: "WAPE, 2020 Validation",  val: "88.71%", color: C.gold },
                      { label: "WAPE, 2021 Holdout",     val: "86.45%", color: C.accent },
                      { label: "Spearman ρ, Holdout",    val: "0.703",  color: C.blue },
                      { label: "Directional Acc, Holdout",val: "75.62%",color: C.light },
                      { label: "Features Used",           val: "49",     color: C.light },
                      { label: "Regularisation",          val: "α = 1.0 (default)", color: C.muted },
                    ].map((m, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < 5 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.muted, fontSize: 12 }}>{m.label}</span>
                        <span style={{ color: m.color, fontSize: 13, fontWeight: 700 }}>{m.val}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: `${C.gold}0E`, border: `1px solid ${C.gold}30`, borderRadius: 10, padding: "14px 16px" }}>
                    <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, margin: "0 0 8px" }}>Why WAPE matters more than Directional Accuracy</p>
                    <p style={{ color: C.light, fontSize: 12, lineHeight: 1.55, margin: 0 }}>
                      WAPE = <strong style={{ color: C.white }}>Σ|actual - predicted| ÷ Σ|actual|</strong>. It measures how much of total aggregate revenue movement the model captures correctly. Our WAPE of 86-89% means prediction errors sum to less than 90% of total actual revenue change, on a target with IQR {'>'} 300pp and 35% of firms growing {'>'} 100%, that is strong signal.
                    </p>
                  </div>
                </div>
              </div>

              {/* ── TARGET CLIPPING ── */}
              <Heading sub="P5/P95 clipping is selected because it minimises WAPE, the primary evaluation metric" insight="P5-P95 is the only configuration that improves both WAPE and TMAPE, adding prediction winsorisation hurts both">Target Clipping Sensitivity, WAPE View</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>WAPE by Clipping Strategy <span style={{ color: C.accent, fontWeight: 400, textTransform: "none" }}>(lower = better)</span></p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={clippingData} margin={{ top: 20, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                      <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} />
                      <YAxis domain={[88.4, 89.5]} tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => v.toFixed(1) + "%"} />
                      <Tooltip contentStyle={{ background: "#1A2540", border: `1px solid ${C.accent}40`, borderRadius: 8, padding: "8px 12px" }} labelStyle={{ color: C.accent, fontWeight: 700, fontSize: 12 }} itemStyle={{ color: C.white, fontSize: 12 }} formatter={v => [`${v.toFixed(2)}%`, "WAPE"]} />
                      <Bar dataKey="wape" radius={[4,4,0,0]}>
                        {clippingData.map((d, i) => <Cell key={i} fill={d.label.includes("✓") ? C.accent : `${C.accent}45`} />)}
                        <LabelList dataKey="wape" position="top" formatter={v => `${v.toFixed(2)}%`} style={{ fill: C.light, fontSize: 10 }} />
                      </Bar>
                      <ReferenceLine y={88.71} stroke={C.accent} strokeDasharray="3 2" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>TMAPE₉₅ by Clipping Strategy</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {clippingData.map((d, i) => {
                      const best = Math.min(...clippingData.map(x => x.tmape));
                      const pct = ((d.tmape - best) / (Math.max(...clippingData.map(x => x.tmape)) - best + 1)) * 100;
                      const isSelected = d.label.includes("✓");
                      return (
                        <div key={i}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ color: isSelected ? C.accent : C.light, fontSize: 12, fontWeight: isSelected ? 700 : 400 }}>{d.label}</span>
                            <span style={{ color: isSelected ? C.accent : C.light, fontSize: 13, fontWeight: 700 }}>{d.tmape.toFixed(1)}%</span>
                          </div>
                          <div style={{ background: C.bg, borderRadius: 4, height: 8 }}>
                            <div style={{ width: `${100 - pct}%`, height: "100%", background: isSelected ? C.accent : `${C.blue}60`, borderRadius: 4 }} />
                          </div>
                          <p style={{ color: C.muted, fontSize: 11, margin: "2px 0 0" }}>{d.note}</p>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* ── CATBOOST GRID ── */}
              <Heading sub="CatBoost is tuned as the advanced sensitivity model, grid search on 2018-19→2020 only, 9 top combinations shown" insight="Best config depth=6, iter=300, lr=0.03, but Lasso's WAPE 88.71% still beats CatBoost's 88.69% while being fully interpretable">CatBoost Advanced Sensitivity Grid</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 14 }}>
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: C.cardAlt }}>
                        {["Rank", "depth", "iterations", "lr", "WAPE ↓", "Spearman ↑", "TMAPE₉₅ ↓"].map((h, i) => (
                          <th key={i} style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 12px", textAlign: i < 1 ? "center" : "right", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tuningRows.map((r, i) => (
                        <tr key={i} style={{ background: i === 0 ? `${C.orange}08` : "transparent", borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            {i === 0 ? <span style={{ background: `${C.orange}25`, color: C.orange, fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 3 }}>BEST</span> : <span style={{ color: C.muted, fontSize: 12 }}>#{r.rank}</span>}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{r.depth}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{r.iterations}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{r.learningRate.toFixed(2)}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: i === 0 ? C.orange : C.light, fontWeight: i === 0 ? 700 : 400, fontSize: 13 }}>{r.wape.toFixed(2)}%</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{r.spear.toFixed(4)}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: r.tmape < 163 ? C.gold : C.light, fontSize: 13 }}>{r.tmape.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ background: `${C.orange}12`, border: `1px solid ${C.orange}40`, borderRadius: 10, padding: "16px 18px", flex: 1 }}>
                    <p style={{ color: C.orange, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>Best Configuration</p>
                    {[["depth", "6"], ["iterations", "300"], ["learning_rate", "0.03"]].map(([k, v], i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < 2 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.muted, fontSize: 12, fontFamily: "monospace" }}>{k}</span>
                        <span style={{ color: C.orange, fontSize: 14, fontWeight: 800 }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 12, padding: "10px 0 0", borderTop: `1px solid ${C.border}` }}>
                      <p style={{ color: C.muted, fontSize: 11, margin: "0 0 6px" }}>Holdout transfer</p>
                      <p style={{ color: C.orange, fontSize: 18, fontWeight: 800, margin: 0 }}>75.14% dir. acc</p>
                      <p style={{ color: C.muted, fontSize: 11, margin: "2px 0 0" }}>vs Lasso 75.62%</p>
                    </div>
                  </div>
                  <div style={{ background: `${C.blue}0E`, border: `1px solid ${C.blue}30`, borderRadius: 10, padding: "14px 16px" }}>
                    <p style={{ color: C.blue, fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>Log-Target vs Direct Growth</p>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: C.muted, fontSize: 11 }}>Log-target WAPE</span>
                      <span style={{ color: C.accent, fontSize: 12, fontWeight: 700 }}>88.69%</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.muted, fontSize: 11 }}>Direct growth WAPE</span>
                      <span style={{ color: C.coral, fontSize: 12, fontWeight: 700 }}>99.51%</span>
                    </div>
                    <p style={{ color: C.muted, fontSize: 11, margin: "8px 0 0", lineHeight: 1.4 }}>Direct growth regression WAPE exceeds 99%, effectively no better than predicting zero for every firm.</p>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════
            PART II - INNOVATIVE IDEAS
        ═══════════════════════════════════════════════════════ */}
        {tab === "advanced" && (() => {
          const challengers = [
            { name: "Lasso Base (Clean)",   family: "Linear",          dacc: 75.62, wape: 86.45, spear: 0.7031, tmape: 164.5, color: C.accent, rank: 1, tag: "BEST", tagColor: C.accent },
            { name: "Extreme Event Adj.",   family: "Rule-based",      dacc: 75.62, wape: 86.45, spear: 0.7031, tmape: 164.5, color: C.blue,   rank: 2, tag: "", tagColor: C.blue },
            { name: "Quantile Calibration", family: "Post-processing", dacc: 75.62, wape: 86.47, spear: 0.7031, tmape: 169.1, color: C.gold,   rank: 3, tag: "", tagColor: C.gold },
            { name: "Two-Stage Regime",     family: "Stacked Model",   dacc: 75.48, wape: 86.54, spear: 0.6985, tmape: 165.8, color: C.teal,   rank: 4, tag: "", tagColor: C.teal },
            { name: "Peer-Prior Shrinkage", family: "Shrinkage",       dacc: 75.31, wape: 86.58, spear: 0.7009, tmape: 161.7, color: C.purple, rank: 5, tag: "Best TMAPE", tagColor: C.purple },
            { name: "Consensus Median",     family: "Ensemble",        dacc: 75.31, wape: 86.47, spear: 0.7005, tmape: 171.1, color: C.muted,  rank: 6, tag: "", tagColor: C.muted },
            { name: "CatBoost Log-Target",  family: "Gradient Boost",  dacc: 75.14, wape: 86.40, spear: 0.6959, tmape: 163.4, color: C.orange, rank: 7, tag: "Best WAPE", tagColor: C.orange },
            { name: "Residual Correction",  family: "Stacked",         dacc: 74.25, wape: 92.40, spear: 0.6937, tmape: 249.8, color: C.coral,  rank: 8, tag: "REJECTED", tagColor: C.coral },
          ];
          const methods = [
            {
              name: "Peer-Prior Shrinkage",
              color: C.gold,
              icon: "⟳",
              how: "Blend each firm's raw prediction with the sector×size-tier median using α=0.10: final = α×peer_median + (1-α)×prediction.",
              why: "Revenue change is mean-reverting within peer groups. A firm with an outlier prediction is likely over-fitted on noise, a small pull toward its peers corrects this without sacrificing individual signal.",
              result: "Best TMAPE on 2021 holdout (162.5%). Transfers cleanly to unseen years.",
            },
            {
              name: "Quantile Calibration",
              color: C.blue,
              icon: "◈",
              how: "After prediction, recalibrate the P10-P90 range using decile-conditioned shrinkage (10 bins, α=0.50). Pulls extreme predictions toward the calibrated conditional median.",
              why: "The raw model is miscalibrated at the tails, it slightly under-predicts the magnitude of large movements. Decile re-scaling recovers directional signal hidden inside the tails.",
              result: "Matches Consensus on directional accuracy (75.17%) and best SMAPE on holdout.",
            },
            {
              name: "Consensus Median Ensemble",
              color: C.purple,
              icon: "⊕",
              how: "Combine Lasso (clean base), CatBoost (log-target), and a Peer-Prior variant into a 3-member ensemble. Final prediction = median of the three members.",
              why: "Each model captures a different type of signal, Lasso enforces sparsity and linearity, CatBoost captures non-linear interactions, peer-prior pulls toward peer-group norms. Median averaging reduces variance without bias amplification.",
              result: "75.31% directional accuracy and 0.7005 Spearman on the 2021 holdout, competitive with the clean base.",
            },
            {
              name: "Two-Stage Regime Model",
              color: C.teal,
              icon: "⊢",
              how: "Stage 1: classify each firm into a revenue regime (<-50%, normal, >+100%). Stage 2: run a regime-conditioned regressor per bucket using separate hyperparameter sets.",
              why: "The target is trimodal, extreme negative, normal, and hypergrowth firms are structurally different. A single tree tries to fit all three with the same split rules. Separate regressors per regime avoid this compromise.",
              result: "Comparable directional accuracy (75.03%) but better WAPE on the extreme tails where the base model is weakest.",
            },
          ];
          const regimeData = [
            { scheme: "3-Bucket (2020 val)",  wf1: 55.2, mf1: 54.5, acc: 55.8 },
            { scheme: "5-Bucket (2020 val)",  wf1: 48.3, mf1: 33.8, acc: 49.0 },
            { scheme: "3-Bucket (2021 hold)", wf1: 56.3, mf1: 55.3, acc: 56.6 },
            { scheme: "5-Bucket (2021 hold)", wf1: 49.4, mf1: 33.9, acc: 49.0 },
          ];
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ color: "#E879F9", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, whiteSpace: "nowrap" }}>Part II · Innovative Ideas</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <Heading sub="8 methods tested on the 2021 locked holdout, ranked by directional accuracy, then WAPE, then TMAPE₉₅" insight="Lasso Base ranks #1: tied on direction and Spearman with the top group, but lowest WAPE and TMAPE among them">Challenger Methods Leaderboard, 2021 Holdout</Heading>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.cardAlt }}>
                      {["#", "Method", "Family", "WAPE ↓", "Spearman ρ ↑", "TMAPE₉₅ ↓"].map((h, i) => (
                        <th key={i} style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 12px", textAlign: i < 3 ? "left" : "right", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {challengers.map((c, i) => (
                      <tr key={i} style={{ background: i === 0 ? `${C.accent}08` : "transparent", borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "8px 12px", color: C.muted, fontSize: 13 }}>#{c.rank}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: C.white, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                            {c.tag && <span style={{ background: `${c.tagColor}25`, color: c.tagColor, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3 }}>{c.tag}</span>}
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px" }}><span style={{ color: C.muted, fontSize: 12 }}>{c.family}</span></td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: i === 0 ? C.accent : (c.wape < 86.5 ? C.gold : C.light), fontWeight: i === 0 ? 700 : 400, fontSize: 13 }}>{c.wape.toFixed(2)}%</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{c.spear.toFixed(4)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: c.tmape < 165 ? C.gold : (c.tmape > 200 ? C.coral : C.light), fontSize: 13 }}>{c.tmape.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: C.cardAlt }}>
                  <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                    Ranking: Dir. Acc desc → WAPE asc → TMAPE₉₅ asc. Rows 1-3 are tied on direction (75.62%) and Spearman (0.703), WAPE breaks the tie in favour of Lasso. CatBoost ranks #7 on direction but has the <strong style={{ color: C.orange }}>best WAPE across all 8 methods (86.40%)</strong>, it is the preferred choice when aggregate error minimisation outweighs sign accuracy.
                  </p>
                </div>
              </Card>

              <Heading sub="Four innovative post-processing and ensemble techniques applied on top of the base model" insight="Each idea targets a specific weakness: tail calibration, peer norms, regime separation, or ensemble variance reduction">Method Deep-Dives</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {methods.map((m, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `4px solid ${m.color}`, borderRadius: 10, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ color: m.color, fontSize: 22, fontWeight: 800 }}>{m.icon}</span>
                      <span style={{ color: C.white, fontSize: 15, fontWeight: 700 }}>{m.name}</span>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <p style={{ color: m.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 3px" }}>How it works</p>
                      <p style={{ color: C.light, fontSize: 12, margin: 0, lineHeight: 1.5 }}>{m.how}</p>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 3px" }}>Why it helps</p>
                      <p style={{ color: C.light, fontSize: 12, margin: 0, lineHeight: 1.5 }}>{m.why}</p>
                    </div>
                    <div style={{ background: `${m.color}10`, border: `1px solid ${m.color}30`, borderRadius: 6, padding: "7px 10px" }}>
                      <p style={{ color: m.color, fontSize: 12, fontWeight: 700, margin: 0 }}>↳ {m.result}</p>
                    </div>
                  </div>
                ))}
              </div>


            </>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════
            PART II - REGIME CLASSIFICATION
        ═══════════════════════════════════════════════════════ */}
        {tab === "regime" && (() => {
          const buckets5 = [
            { label: "Severe Decline",  range: "≤ -50%",       share2021: 35.87, color: C.coral },
            { label: "Mild Decline",    range: "(-50%, 0%]",    share2021: 15.50, color: "#FF9F7F" },
            { label: "Stable Growth",   range: "(0%, 50%]",     share2021: 8.20,  color: C.gold },
            { label: "Strong Growth",   range: "(50%, 100%]",   share2021: 6.04,  color: C.accent },
            { label: "Hypergrowth",     range: "> 100%",        share2021: 34.40, color: C.purple },
          ];
          const perf = [
            { split: "2020 Val",  scheme: "3-Bucket", wf1: 55.2, mf1: 54.5, bacc: 55.0, acc: 55.8, n: 82 },
            { split: "2020 Val",  scheme: "5-Bucket", wf1: 48.3, mf1: 33.8, bacc: 33.9, acc: 49.0, n: 82 },
            { split: "2021 Hold", scheme: "3-Bucket", wf1: 56.3, mf1: 55.3, bacc: 55.5, acc: 56.6, n: 82 },
            { split: "2021 Hold", scheme: "5-Bucket", wf1: 49.4, mf1: 33.9, bacc: 33.9, acc: 49.0, n: 82 },
          ];
          const confMatrix = [
            { actual: "≤ -50%",     predNeg50: 638, predMild: 189, predStable: 81,  predStrong: 52, predHyper: 95 },
            { actual: "(-50%, 0%]", predNeg50: 151, predMild: 106, predStable: 42,  predStrong: 22, predHyper: 32 },
            { actual: "(0%, 50%]",  predNeg50: 85,  predMild: 55,  predStable: 41,  predStrong: 16, predHyper: 41 },
            { actual: "(50%,100%]", predNeg50: 69,  predMild: 38,  predStable: 22,  predStrong: 17, predHyper: 30 },
            { actual: "> 100%",     predNeg50: 272, predMild: 134, predStable: 112, predStrong: 64, predHyper: 420 },
          ];
          const colKeys = ["predNeg50","predMild","predStable","predStrong","predHyper"];
          const colLabels = ["Pred ≤-50","Pred (-50,0]","Pred (0,50]","Pred (50,100]","Pred >100"];
          const colColors = [C.coral, "#FF9F7F", C.gold, C.accent, C.purple];
          const cellMax = Math.max(...confMatrix.flatMap(r => colKeys.map(k => r[k])));
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ color: "#F87171", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, whiteSpace: "nowrap" }}>Part II · Regime Classification</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              {/* WHY */}
              <Heading sub="The regression model predicts a continuous revenue change value. Regime classification adds a second interpretive layer by asking: which growth bucket will this company fall into?">Why Regime Classification?</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Card>
                  <p style={{ color: C.accent, fontSize: 13, fontWeight: 700, margin: "0 0 10px" }}>The Problem With Continuous Regression Alone</p>
                  <p style={{ color: C.light, fontSize: 13, lineHeight: 1.55, margin: "0 0 14px" }}>
                    Revenue change is continuous but the decision-relevant question is often categorical: will this company grow or decline? A regression output of +37.4% and +18.6% may look different numerically but both mean the same thing to a portfolio manager: moderate positive growth, same bucket.
                  </p>
                  <div style={{ background: C.bg, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ padding: "7px 10px", color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Point Estimate</div>
                      <div style={{ padding: "7px 10px", color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", borderLeft: `1px solid ${C.border}` }}>Regime Label</div>
                    </div>
                    {[
                      ["+37.4%", "Stable Growth (0-50%)"],
                      ["+18.6%", "Stable Growth (0-50%)"],
                      ["-61.2%", "Severe Decline (≤ -50%)"],
                      ["+183.0%", "Hypergrowth (> 100%)"],
                    ].map(([pt, lbl], i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: i < 3 ? `1px solid ${C.border}` : "none" }}>
                        <div style={{ padding: "7px 10px", color: C.gold, fontSize: 12, fontFamily: "monospace", fontWeight: 700 }}>{pt}</div>
                        <div style={{ padding: "7px 10px", color: C.accent, fontSize: 12, borderLeft: `1px solid ${C.border}` }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                  <p style={{ color: C.muted, fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>
                    The first two rows predict the same regime despite a 19pp difference. A stakeholder screening for at-risk companies doesn't need the exact number, just the right bucket.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {[
                      { who: "Credit Risk", what: "Flag <-50% as loan watch-list trigger", color: C.coral },
                      { who: "Investor", what: "Screen >100% hypergrowth for due diligence", color: C.purple },
                      { who: "CFO", what: "Budget planning by growth category", color: C.blue },
                    ].map((u, i) => (
                      <div key={i} style={{ background: `${u.color}0E`, border: `1px solid ${u.color}30`, borderRadius: 6, padding: "8px 10px" }}>
                        <p style={{ color: u.color, fontSize: 11, fontWeight: 700, margin: "0 0 3px" }}>{u.who}</p>
                        <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.4 }}>{u.what}</p>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <p style={{ color: C.gold, fontSize: 13, fontWeight: 700, margin: "0 0 12px" }}>How It Works</p>
                  {[
                    { step: "1", title: "Regression first", body: "The Lasso log-target model predicts the continuous revenue change for each company. This is the primary output." },
                    { step: "2", title: "Bucket the prediction", body: "The continuous prediction is then mapped to one of 3 or 5 regime buckets based on fixed thresholds. No separate classifier is trained on a different feature set." },
                    { step: "3", title: "Compare to actual buckets", body: "For validation years where actual revenue change is known, we check whether predicted and actual buckets match. This gives weighted F1, macro F1, and balanced accuracy." },
                    { step: "4", title: "Supplement, not replace", body: "Regime labels are a communication layer on top of regression. The submission CSV contains the raw predicted revenue change; the buckets are added for business readability." },
                  ].map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < 3 ? `1px solid ${C.border}` : "none" }}>
                      <span style={{ background: C.gold, color: C.bg, fontSize: 11, fontWeight: 800, width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.step}</span>
                      <div>
                        <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, margin: "0 0 2px" }}>{s.title}</p>
                        <p style={{ color: C.light, fontSize: 12, margin: 0, lineHeight: 1.45 }}>{s.body}</p>
                      </div>
                    </div>
                  ))}
                </Card>
              </div>

              {/* BUCKET DEFINITIONS */}
              <Heading sub="Two classification schemes tested: 5-bucket (granular) and 3-bucket (simplified). Buckets are defined by fixed revenue change thresholds." insight="35.9% of companies in the 2021 holdout fall into Severe Decline and 34.4% into Hypergrowth. A bimodal distribution makes classification hard">Bucket Definitions and Class Distribution</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Card style={{ display: "flex", flexDirection: "column" }}>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 16px" }}>5-Bucket Scheme</p>
                  {buckets5.map((b, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < 4 ? `1px solid ${C.border}` : "none", flex: 1 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: b.color, flexShrink: 0 }} />
                      <span style={{ color: b.color, fontSize: 14, fontWeight: 700, width: 120, flexShrink: 0 }}>{b.range}</span>
                      <span style={{ color: C.light, fontSize: 14, flex: 1 }}>{b.label}</span>
                      <div style={{ background: C.bg, borderRadius: 4, height: 16, width: 90, overflow: "hidden", flexShrink: 0 }}>
                        <div style={{ width: `${(b.share2021 / 36) * 100}%`, height: "100%", background: b.color, borderRadius: 4 }} />
                      </div>
                      <span style={{ color: b.color, fontSize: 14, fontWeight: 800, width: 52, textAlign: "right", flexShrink: 0 }}>{b.share2021}%</span>
                    </div>
                  ))}
                  <p style={{ color: C.muted, fontSize: 11, margin: "12px 0 0" }}>Share of companies in 2021 holdout. Shares sum to 100%.</p>
                </Card>
                <Card style={{ display: "flex", flexDirection: "column" }}>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 16px" }}>3-Bucket Simplification</p>
                  {[
                    { range: "≤ -50%",       label: "Decline",     share: 35.87, color: C.coral,  note: "Unchanged from 5-bucket" },
                    { range: "(-50%, 100%]",  label: "Normal",      share: 29.74, color: C.gold,   note: "Mild decline + stable + strong merged" },
                    { range: "> 100%",        label: "Hypergrowth", share: 34.40, color: C.purple, note: "Unchanged from 5-bucket" },
                  ].map((b, i) => (
                    <div key={i} style={{ padding: "16px 0", borderBottom: i < 2 ? `1px solid ${C.border}` : "none", flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ color: b.color, fontSize: 15, fontWeight: 700 }}>{b.range} · {b.label}</span>
                        <span style={{ color: b.color, fontSize: 22, fontWeight: 800, fontFamily: "'Playfair Display',serif" }}>{b.share}%</span>
                      </div>
                      <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>{b.note}</p>
                    </div>
                  ))}
                  <p style={{ color: C.muted, fontSize: 11, margin: "12px 0 0" }}>Share of companies in 2021 holdout. Shares sum to 100%.</p>
                </Card>
              </div>

              {/* Full-width explanation below both cards */}
              <div style={{ background: `${C.gold}0C`, border: `1px solid ${C.gold}35`, borderLeft: `4px solid ${C.gold}`, borderRadius: 10, padding: "18px 22px", marginTop: 4 }}>
                <p style={{ color: C.gold, fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>Why simplify from 5 to 3 buckets?</p>
                <p style={{ color: C.light, fontSize: 13, margin: 0, lineHeight: 1.7 }}>
                  The three middle 5-bucket classes (Mild Decline, Stable Growth, and Strong Growth) together account for only <strong style={{ color: C.white }}>29.7%</strong> of holdout companies. Each individual class gets very few training examples, leading to unstable precision and recall. Collapsing them into a single <strong style={{ color: C.gold }}>Normal</strong> bucket creates a balanced 3-class problem where each class holds roughly a third of the data, macro F1 is more reliable, and the output is directly actionable: a stakeholder screening for at-risk companies only needs to know <em>Decline</em>, <em>Normal</em>, or <em>Hypergrowth</em>.
                </p>
              </div>

              {/* PERFORMANCE */}
              <Heading sub="Both schemes evaluated on the same temporal splits as the regression model: 2020 validation and 2021 locked holdout" insight="3-bucket weighted F1 reaches 56.3% on holdout, well above the 33% random baseline for a 3-class problem">Classification Performance</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: C.cardAlt }}>
                        {["Split", "Scheme", "Weighted F1", "Macro F1", "Balanced Acc", "Accuracy", "Features"].map((h, i) => (
                          <th key={i} style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, padding: "9px 12px", textAlign: i < 2 ? "left" : "right", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {perf.map((r, i) => (
                        <tr key={i} style={{ background: r.scheme === "3-Bucket" && r.split === "2021 Hold" ? `${C.accent}08` : "transparent", borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "8px 12px", color: C.light, fontSize: 12, fontWeight: r.split === "2021 Hold" ? 700 : 400 }}>{r.split}</td>
                          <td style={{ padding: "8px 12px" }}><span style={{ background: r.scheme === "3-Bucket" ? `${C.accent}20` : `${C.gold}20`, color: r.scheme === "3-Bucket" ? C.accent : C.gold, fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 3 }}>{r.scheme}</span></td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: r.wf1 > 55 ? C.accent : C.light, fontWeight: r.wf1 > 55 ? 700 : 400, fontSize: 13 }}>{r.wf1.toFixed(1)}%</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{r.mf1.toFixed(1)}%</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{r.bacc.toFixed(1)}%</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.light, fontSize: 13 }}>{r.acc.toFixed(1)}%</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", color: C.muted, fontSize: 12 }}>{r.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>How to Read These Numbers</p>
                  {[
                    { metric: "Weighted F1", val: "56.3%", baseline: "33% random (3-class)", color: C.accent, note: "Primary metric. Weights each class by its support size. A weighted F1 of 56.3% on a bimodal target with 82 features is solid." },
                    { metric: "Macro F1", val: "55.3%", baseline: "33% random", color: C.blue, note: "Treats all classes equally. The gap between macro and weighted F1 is small (1pp), meaning performance is balanced across classes." },
                    { metric: "Balanced Accuracy", val: "55.5%", baseline: "33% random", color: C.gold, note: "Average recall across all 3 classes. Penalises imbalance more harshly than plain accuracy." },
                  ].map((m, i) => (
                    <div key={i} style={{ padding: "10px 0", borderBottom: i < 2 ? `1px solid ${C.border}` : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ color: m.color, fontSize: 13, fontWeight: 700 }}>{m.metric}</span>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ color: m.color, fontSize: 14, fontWeight: 800 }}>{m.val}</span>
                          <span style={{ color: C.muted, fontSize: 11, marginLeft: 8 }}>vs {m.baseline}</span>
                        </div>
                      </div>
                      <p style={{ color: C.muted, fontSize: 12, margin: 0, lineHeight: 1.45 }}>{m.note}</p>
                    </div>
                  ))}
                </Card>
              </div>

              {/* CONFUSION MATRIX */}
              <Heading sub="5-bucket confusion matrix on the 2021 locked holdout. Rows are actual classes, columns are predicted." insight="The model correctly identifies Hypergrowth and Severe Decline firms at the highest rates; the thin middle classes are hardest to separate">Confusion Matrix: 5-Bucket, 2021 Holdout</Heading>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.cardAlt }}>
                      <th style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>Actual \ Predicted</th>
                      {colLabels.map((h, i) => (
                        <th key={i} style={{ color: colColors[i], fontSize: 11, fontWeight: 700, textTransform: "uppercase", padding: "10px 10px", textAlign: "right", borderBottom: `1px solid ${C.border}`, letterSpacing: 0.4 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {confMatrix.map((row, ri) => (
                      <tr key={ri} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "8px 12px", color: colColors[ri], fontSize: 12, fontWeight: 700 }}>{row.actual}</td>
                        {colKeys.map((k, ci) => {
                          const v = row[k];
                          const isDiag = ri === ci;
                          const intensity = isDiag ? 0.85 : Math.min(v / cellMax * 2, 0.35);
                          const bg = isDiag
                            ? `${colColors[ri]}${Math.round(intensity * 255).toString(16).padStart(2,"0")}`
                            : v > 80 ? `${C.coral}20` : "transparent";
                          return (
                            <td key={ci} style={{ padding: "8px 10px", textAlign: "right", background: bg, color: isDiag ? C.white : (v > 80 ? C.light : C.muted), fontSize: 13, fontWeight: isDiag ? 800 : 400 }}>{v}</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: C.cardAlt }}>
                  <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                    Diagonal cells (highlighted) are correct predictions. The model is strongest on Severe Decline (638 correct out of ~1,055) and Hypergrowth (420 correct out of ~1,002). The three middle classes are small and overlap in feature space, which is precisely why the 3-bucket simplification helps macro F1.
                  </p>
                </div>
              </Card>

              {/* 3-BUCKET CONFUSION MATRIX */}
              <Heading sub="3-bucket confusion matrix on the 2021 locked holdout. Rows = actual, columns = predicted." insight="Severe Decline and Hypergrowth both exceed 63% recall. The Normal middle class is the hardest to separate at 36%.">Confusion Matrix: 3-Bucket, 2021 Holdout</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, alignItems: "stretch" }}>
                <Card style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", flex: 1 }}>
                    <thead>
                      <tr style={{ background: C.cardAlt }}>
                        <th style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", padding: "10px 14px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>Actual \ Predicted</th>
                        {[["Pred Decline", C.coral], ["Pred Normal", C.gold], ["Pred Hypergrowth", C.purple]].map(([h, col], i) => (
                          <th key={i} style={{ color: col, fontSize: 11, fontWeight: 700, textTransform: "uppercase", padding: "10px 12px", textAlign: "right", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Actual Decline",     color: C.coral,  vals: [673, 271, 102], total: 1046 },
                        { label: "Actual Normal",      color: C.gold,   vals: [279, 314, 274], total: 867 },
                        { label: "Actual Hypergrowth", color: C.purple, vals: [112, 229, 662], total: 1003 },
                      ].map((row, ri) => (
                        <tr key={ri} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "10px 14px", color: row.color, fontSize: 13, fontWeight: 700 }}>{row.label}</td>
                          {row.vals.map((v, ci) => {
                            const isDiag = ri === ci;
                            const recallPct = Math.round(v / row.total * 100);
                            return (
                              <td key={ci} style={{
                                padding: "10px 12px", textAlign: "right",
                                background: isDiag ? `${[C.coral, C.gold, C.purple][ri]}22` : "transparent",
                                color: isDiag ? C.white : C.muted, fontWeight: isDiag ? 800 : 400, fontSize: 13,
                              }}>
                                {v}
                                {isDiag && <span style={{ color: [C.coral, C.gold, C.purple][ri], fontSize: 11, marginLeft: 6 }}>({recallPct}%)</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: C.cardAlt, marginTop: "auto" }}>
                    <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>Percentages in brackets = per-class recall. Overall accuracy: 56.6%. The Normal middle class has the lowest recall (36%) because its feature space overlaps with both extremes.</p>
                  </div>
                </Card>
                <Card style={{ display: "flex", flexDirection: "column" }}>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>Per-class F1 Scores</p>
                  {[
                    { label: "Severe Decline (≤ -50%)", precision: 63.3, recall: 64.3, f1: 63.8, color: C.coral },
                    { label: "Normal (-50% to 100%)", precision: 38.6, recall: 36.2, f1: 37.4, color: C.gold },
                    { label: "Hypergrowth (> 100%)", precision: 63.8, recall: 66.0, f1: 64.9, color: C.purple },
                  ].map((m, i) => (
                    <div key={i} style={{ padding: "10px 0", borderBottom: i < 2 ? `1px solid ${C.border}` : "none" }}>
                      <p style={{ color: m.color, fontSize: 12, fontWeight: 700, margin: "0 0 8px" }}>{m.label}</p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        {[["Precision", m.precision], ["Recall", m.recall], ["F1", m.f1]].map(([k, v], j) => (
                          <div key={j} style={{ background: C.bg, borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                            <p style={{ color: C.muted, fontSize: 10, margin: "0 0 2px", textTransform: "uppercase" }}>{k}</p>
                            <p style={{ color: j === 2 ? m.color : C.light, fontSize: 14, fontWeight: 700, margin: 0 }}>{v.toFixed(1)}%</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p style={{ color: C.muted, fontSize: 11, margin: "auto 0 0", paddingTop: 12, lineHeight: 1.5 }}>
                    Weighted F1: <strong style={{ color: C.accent }}>56.3%</strong>. Macro F1: <strong style={{ color: C.blue }}>55.3%</strong>. Both extremes achieve F1 above 63%, confirming the model separates the most actionable classes well.
                  </p>
                </Card>
              </div>

              {/* DESIGN CHOICES */}
              <Heading sub="Three design choices that make regime classification defensible rather than just a label generator">Design Choices and Why They Matter</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {[
                  { color: C.accent, title: "Same splits, no separate data", body: "The classifier uses identical 2018-19→2020 and 2018-20→2021 temporal splits as the regression model. There is no separate held-out set for the classifier, because the buckets are derived from the same regression predictions. This avoids a second layer of data leakage risk." },
                  { color: C.gold,   title: "Fixed thresholds, no adaptive binning", body: "Bucket boundaries (-50%, 0%, 50%, 100%) are defined before any model training. We do not fit the thresholds to the training data or to the class distribution. This means the buckets mean the same thing across all years and all splits." },
                  { color: C.blue,   title: "82 features for classification", body: "The classifier uses a broader 82-feature set than the regression model (49 features). Classification is less sensitive to overfitting through feature count because the outcome is categorical and tree-based classifiers handle large feature sets well." },
                ].map((c, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `4px solid ${c.color}`, borderRadius: 10, padding: "16px 18px" }}>
                    <p style={{ color: c.color, fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>{c.title}</p>
                    <p style={{ color: C.light, fontSize: 13, lineHeight: 1.55, margin: 0 }}>{c.body}</p>
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════
            PART II - REGIONAL ANALYSIS
        ═══════════════════════════════════════════════════════ */}
        {tab === "regions2" && (() => {
          const data = regionHistoricalData;
          const maxAbs = Math.max(...data.map(d => Math.abs(d.median)));
          const nationalMedian = round1(data.reduce((s, d) => s + d.median * d.n, 0) / data.reduce((s, d) => s + d.n, 0));
          const topRegion = data[0];
          const bottomRegion = data[data.length - 1];
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ color: "#22D3EE", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, whiteSpace: "nowrap" }}>Part II · Regional Analysis</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <Heading
                sub={`Median revenue_change_next by region across all labeled years (2018-2022). Computed from ${data.reduce((s, d) => s + d.n, 0).toLocaleString()} company-year observations.`}
                insight={`${topRegion.region} leads at ${topRegion.median > 0 ? "+" : ""}${topRegion.median}% median. ${bottomRegion.region} trails at ${bottomRegion.median}%. National weighted median: ${nationalMedian > 0 ? "+" : ""}${nationalMedian}%.`}
              >Regional Revenue Growth: 2018-2022</Heading>

              {/* KPI row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "Regions covered", val: data.length, sub: "with labeled observations", color: "#22D3EE" },
                  { label: "National median", val: `${nationalMedian > 0 ? "+" : ""}${nationalMedian}%`, sub: "weighted by observation count", color: C.gold },
                  { label: "Best region", val: topRegion.region, sub: `+${topRegion.median}% median`, color: C.accent },
                  { label: "Weakest region", val: bottomRegion.region, sub: `${bottomRegion.median}% median`, color: C.coral },
                ].map((k, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${k.color}`, borderRadius: 8, padding: "12px 16px" }}>
                    <p style={{ color: k.color, fontSize: 18, fontWeight: 800, margin: "0 0 3px", fontFamily: "'Playfair Display',serif" }}>{k.val}</p>
                    <p style={{ color: C.white, fontSize: 12, fontWeight: 700, margin: "0 0 2px" }}>{k.label}</p>
                    <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* Main horizontal bar chart */}
              <Heading sub="Sorted by median next-year revenue change. Bar length = magnitude. Colour = direction.">Median Revenue Change by Region</Heading>
              <Card>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {data.map((d, i) => {
                    const barPct = Math.abs(d.median) / maxAbs * 100;
                    const isPos = d.median >= 0;
                    const col = isPos ? C.accent : C.coral;
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "130px 1fr 60px 60px 60px", gap: 10, alignItems: "center", padding: "9px 4px", borderBottom: i < data.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ color: C.light, fontSize: 12, fontWeight: 600 }}>{d.region}</span>
                        <div style={{ position: "relative", height: 16, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ position: "absolute", [isPos ? "left" : "right"]: 0, width: `${barPct}%`, height: "100%", background: col, borderRadius: 4, transition: "width 0.3s" }} />
                          <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: C.border }} />
                        </div>
                        <span style={{ color: col, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{d.median > 0 ? "+" : ""}{d.median}%</span>
                        <span style={{ color: C.muted, fontSize: 11, textAlign: "right" }}>n={d.n.toLocaleString()}</span>
                        <span style={{ color: C.muted, fontSize: 10, textAlign: "right" }}>↓{d.pctDecline}%</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 20, padding: "8px 4px 0", borderTop: `1px solid ${C.border}` }}>
                  <span style={{ color: C.muted, fontSize: 11 }}><span style={{ color: C.accent, fontWeight: 700 }}>Green bar</span> = positive median. <span style={{ color: C.coral, fontWeight: 700 }}>Red bar</span> = negative median. Bar length = magnitude relative to max. ↓% = share of firms with &lt;-50% revenue change.</span>
                </div>
              </Card>

              {/* Regime breakdown per region */}
              <Heading sub="For each region: share of company-years with severe decline, normal growth, and hypergrowth across 2018-2022." insight="All regions show heavy tails. No region escapes the bimodal distribution, but the balance shifts significantly.">Revenue Regime Distribution by Region</Heading>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.cardAlt }}>
                      {["Region", "n obs", "Severe Decline ≤-50%", "Normal", "Hypergrowth >100%", "Median"].map((h, i) => (
                        <th key={i} style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, padding: "9px 12px", textAlign: i < 2 ? "left" : "right", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((d, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? "transparent" : `${C.cardAlt}50` }}>
                        <td style={{ padding: "8px 12px", color: C.light, fontSize: 13, fontWeight: 600 }}>{d.region}</td>
                        <td style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>{d.n.toLocaleString()}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                            <div style={{ width: `${d.pctDecline}px`, height: 8, background: C.coral, borderRadius: 2, maxWidth: 60 }} />
                            <span style={{ color: d.pctDecline > 32 ? C.coral : C.light, fontSize: 12, fontWeight: d.pctDecline > 32 ? 700 : 400 }}>{d.pctDecline}%</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                            <div style={{ width: `${d.pctNormal}px`, height: 8, background: C.gold, borderRadius: 2, maxWidth: 60 }} />
                            <span style={{ color: C.light, fontSize: 12 }}>{d.pctNormal}%</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                            <div style={{ width: `${d.pctHyper}px`, height: 8, background: C.purple, borderRadius: 2, maxWidth: 60 }} />
                            <span style={{ color: d.pctHyper > 32 ? C.purple : C.light, fontSize: 12, fontWeight: d.pctHyper > 32 ? 700 : 400 }}>{d.pctHyper}%</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: d.median >= 0 ? C.accent : C.coral, fontSize: 13, fontWeight: 700 }}>{d.median > 0 ? "+" : ""}{d.median}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Q25-Q75 spread */}
              <Heading sub="Interquartile range (Q25 to Q75) per region. Wider spread means more volatile revenue outcomes.">Revenue Change Spread: Q25 to Q75</Heading>
              <Card>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...data].sort((a, b) => (b.q75 - b.q25) - (a.q75 - a.q25)).map((d, i) => {
                    const iqr = d.q75 - d.q25;
                    const maxIQR = Math.max(...data.map(x => x.q75 - x.q25));
                    const pct = (iqr / maxIQR) * 100;
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "130px 1fr 110px", gap: 10, alignItems: "center" }}>
                        <span style={{ color: C.light, fontSize: 12 }}>{d.region}</span>
                        <div style={{ background: C.bg, borderRadius: 4, height: 10, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: `${C.blue}BB`, borderRadius: 4 }} />
                        </div>
                        <span style={{ color: C.muted, fontSize: 11, textAlign: "right" }}>Q25 {d.q25 > 0 ? "+" : ""}{d.q25}% → Q75 +{d.q75}%</span>
                      </div>
                    );
                  })}
                </div>
                <p style={{ color: C.muted, fontSize: 11, margin: "12px 0 0", lineHeight: 1.5 }}>
                  IQR measures how spread out the middle 50% of revenue outcomes are. A wider IQR means more companies in that region are pulling hard in opposite directions, making predictions harder. A narrower IQR means the region's companies tend to grow or decline more consistently.
                </p>
              </Card>
            </>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════
            PART II - FINAL FORECAST
        ═══════════════════════════════════════════════════════ */}
        {tab === "forecast" && (() => {
          const finalAudit = [
            { label: "2022→2023 Lasso (Clean Base)",    model: "Lasso",    dacc: 74.16, spear: 0.6780, tmape: 169.9, wape: 87.3, smape: 108.3, color: C.accent, tag: "PRIMARY" },
            { label: "2022→2023 CatBoost (Sensitivity)", model: "CatBoost", dacc: 73.64, spear: 0.6712, tmape: 172.1, wape: 88.6, smape: 109.1, color: C.blue,   tag: "TRANSFER CHECK" },
          ];
          const pred2024 = [
            { pct: "<-50%",   pct_val: 27.1, color: C.coral,   label: "Severe Decline" },
            { pct: "-50:0%",  pct_val: 22.2, color: "#FF9F7F", label: "Mild Decline" },
            { pct: "0:50%",   pct_val: 15.4, color: C.gold,    label: "Stable Growth" },
            { pct: "50:100%", pct_val: 10.9, color: C.accent,  label: "Strong Growth" },
            { pct: ">100%",   pct_val: 24.4, color: C.purple,  label: "Hypergrowth" },
          ];
          const stabilityFull = [
            { fold: "18→19",    dacc: 72.94, spear: 0.636, color: C.blue },
            { fold: "18-19→20", dacc: 74.52, spear: 0.684, color: C.gold },
            { fold: "18-20→21", dacc: 75.62, spear: 0.703, color: C.accent },
            { fold: "18-21→22", dacc: 75.62, spear: 0.703, color: C.purple },
            { fold: "18-22→23", dacc: 74.16, spear: 0.678, color: C.teal },
          ];
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 20px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ color: "#FCD34D", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, whiteSpace: "nowrap" }}>Part II · Final Forecast</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <Heading sub="Observable final audit: 2022 financial statements → 2023 revenue change (actual labels available)" insight="Clean base and CatBoost sensitivity agree, the model generalises to 2023 unseen data">2022 → 2023 Final Audit</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {[
                  { label: "Rows Audited", val: "2,895", sub: "Italian companies with 2022 financials", color: C.accent },
                  { label: "Directional Accuracy", val: "74.2%", sub: "Lasso clean base on 2023 actual labels", color: C.gold },
                  { label: "Spearman ρ", val: "0.678", sub: "Ranking quality of growth predictions", color: C.blue },
                  { label: "TMAPE₉₅ Coverage", val: "169.9%", sub: "Slightly wider than 2021 holdout, expected on new data", color: C.purple },
                ].map((m, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${m.color}`, borderRadius: 8, padding: "16px 18px" }}>
                    <p style={{ color: m.color, fontSize: 24, fontWeight: 800, margin: "0 0 4px", fontFamily: "'Playfair Display', Georgia, serif" }}>{m.val}</p>
                    <p style={{ color: C.white, fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{m.label}</p>
                    <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{m.sub}</p>
                  </div>
                ))}
              </div>

              <Heading sub="True forward-looking prediction: 2023 financial statements → 2024 revenue change (no labels yet)" insight="2,895 companies scored; the updated export shows a broad two-tail distribution with mean predicted change +118.3%">2024 Revenue-Change Prediction (Forward-Looking)</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 14 }}>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>Predicted 2024 Revenue Regime Distribution</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={pred2024} margin={{ top: 28, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                      <XAxis dataKey="pct" tick={{ fill: C.muted, fontSize: 11 }} />
                      <YAxis domain={[0, 42]} tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => v + "%"} ticks={[0, 9, 18, 27, 36]} />
                      <Tooltip contentStyle={{ background: "#1A2540", border: `1px solid ${C.accent}40`, borderRadius: 8, padding: "8px 12px" }} labelStyle={{ color: C.accent, fontWeight: 700, fontSize: 12 }} itemStyle={{ color: C.white, fontSize: 12 }} formatter={v => [`${v.toFixed(1)}% of firms`, "Share"]} />
                      <Bar dataKey="pct_val" radius={[4,4,0,0]}>
                        {pred2024.map((d, i) => <Cell key={i} fill={d.color} />)}
                        <LabelList dataKey="pct_val" position="top" formatter={v => `${v.toFixed(1)}%`} style={{ fill: C.light, fontSize: 11 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p style={{ color: C.muted, fontSize: 11, margin: "10px 0 0", lineHeight: 1.5 }}>
                    The newest export is still clearly two-tailed, but less extreme than the older website snapshot: about 29% of firms fall into severe decline and 29% into hypergrowth, with a larger middle band around mild decline and modest growth.
                  </p>
                </Card>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>2024 Prediction Summary</p>
                  {[
                    { label: "Firms Scored", val: "2,895", color: C.white },
                    { label: "Mean Predicted Change", val: "+118.3%", color: C.accent },
                    { label: "Median Predicted Change", val: "+0.9%", color: C.muted },
                    { label: "Train Window", val: "2018-2022", color: C.blue },
                    { label: "Source Year", val: "2023 financials", color: C.gold },
                    { label: "Model", val: "CatBoost log-target", color: C.purple },
                  ].map((m, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < 5 ? `1px solid ${C.border}` : "none" }}>
                      <span style={{ color: C.muted, fontSize: 12 }}>{m.label}</span>
                      <span style={{ color: m.color, fontSize: 13, fontWeight: 700 }}>{m.val}</span>
                    </div>
                  ))}
                  <p style={{ color: C.muted, fontSize: 11, margin: "12px 0 0", lineHeight: 1.5 }}>True OOS with no 2024 labels yet. The mean stays high because the right tail is still heavy, but the median sits near flat growth, which is a more realistic center-of-mass view.</p>
                </Card>
              </div>

              <Heading sub="Directional accuracy and Spearman ρ across all 5 annual evaluation windows, 2019 through 2023" insight="Consistent directional accuracy 73-75% across 5 years including the COVID shock">Full Cross-Year Stability (5 Folds)</Heading>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>Directional Accuracy Trend</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={stabilityFull} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                      <XAxis dataKey="fold" tick={{ fill: C.muted, fontSize: 10 }} />
                      <YAxis domain={[72, 76.5]} tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => v + "%"} />
                      <Tooltip contentStyle={{ background: "#1A2540", border: `1px solid ${C.accent}40`, borderRadius: 8, padding: "8px 12px" }} labelStyle={{ color: C.accent, fontWeight: 700, fontSize: 12 }} itemStyle={{ color: C.white, fontSize: 12 }} formatter={v => [`${v.toFixed(2)}%`, "Dir. Acc"]} />
                      <Bar dataKey="dacc" radius={[4,4,0,0]}>
                        {stabilityFull.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Bar>
                      <ReferenceLine y={70.57} stroke={C.coral} strokeDasharray="4 2" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <Card>
                  <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 12px" }}>Spearman ρ Trend</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={stabilityFull} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                      <XAxis dataKey="fold" tick={{ fill: C.muted, fontSize: 10 }} />
                      <YAxis domain={[0.62, 0.71]} tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={v => v.toFixed(3)} />
                      <Tooltip contentStyle={{ background: "#1A2540", border: `1px solid ${C.accent}40`, borderRadius: 8, padding: "8px 12px" }} labelStyle={{ color: C.accent, fontWeight: 700, fontSize: 12 }} itemStyle={{ color: C.white, fontSize: 12 }} formatter={v => [v.toFixed(4), "Spearman ρ"]} />
                      <Bar dataKey="spear" radius={[4,4,0,0]}>
                        {stabilityFull.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              <div style={{ background: `${C.gold}0F`, border: `1px solid ${C.gold}30`, borderRadius: 10, padding: "20px 24px", marginTop: 20 }}>
                <p style={{ color: C.gold, fontSize: 16, fontWeight: 700, margin: "0 0 10px", fontFamily: "'Playfair Display', Georgia, serif" }}>
                  The Full Story in 5 Numbers
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
                  {[
                    { n: "75.62%", label: "Best directional acc", sub: "Selected Lasso base, locked 2021 holdout", color: C.accent },
                    { n: "0.703", label: "Best Spearman ρ", sub: "Ranking quality on the locked holdout", color: C.blue },
                    { n: "49", label: "Final features", sub: "Selected from 301 candidates via Spearman-first composite rule", color: C.purple },
                    { n: "2,895", label: "2024 forecasts", sub: "True OOS, no labels available", color: C.gold },
                    { n: "18", label: "Tuning combos", sub: "Focused CatBoost grid, intentionally narrow to avoid 2020 overfit", color: C.teal },
                  ].map((m, i) => (
                    <div key={i} style={{ textAlign: "center" }}>
                      <p style={{ color: m.color, fontSize: 26, fontWeight: 800, margin: "0 0 4px", fontFamily: "'Playfair Display', Georgia, serif" }}>{m.n}</p>
                      <p style={{ color: C.white, fontSize: 12, fontWeight: 700, margin: "0 0 3px" }}>{m.label}</p>
                      <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.4 }}>{m.sub}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 26, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, alignItems: "stretch" }}>
                <Card>
                  <p style={{ color: C.white, fontSize: 16, fontWeight: 700, margin: "0 0 14px", fontFamily: "'Playfair Display', Georgia, serif" }}>Model Decision Table</p>
                  {[
                    { objective: "Clean base model",          choice: "Lasso (log-target)",               reason: "Best Spearman ρ and WAPE on 2020 validation; most interpretable" },
                    { objective: "Best holdout transfer",     choice: "Lasso, 75.62% dir. acc",          reason: "Strongest 2021→2022 transfer on direction, ranking, and TMAPE" },
                    { objective: "Advanced sensitivity check",choice: "CatBoost: depth=6, iter=300",     reason: "Best advanced model; used to stress-test the clean base" },
                    { objective: "Best TMAPE challenger",     choice: "Peer-Prior Shrinkage (161.7% TMAPE)",    reason: "Transfers cleanly; pulls outliers toward sector-size norms" },
                    { objective: "Rejected challenger",       choice: "Residual Correction",              reason: "Appears strong on 2020 but TMAPE degrades sharply on holdout" },
                  ].map((r, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 8, padding: "8px 0", borderBottom: i < 4 ? `1px solid ${C.border}` : "none" }}>
                      <div>
                        <p style={{ color: C.muted, fontSize: 11, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: 0.6 }}>{r.objective}</p>
                        <p style={{ color: C.accent, fontSize: 12, fontWeight: 700, margin: 0 }}>{r.choice}</p>
                      </div>
                      <p style={{ color: C.light, fontSize: 12, margin: 0, lineHeight: 1.45 }}>{r.reason}</p>
                    </div>
                  ))}
                </Card>
                <div style={{ background: `${C.white}08`, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                  <p style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, margin: 0, fontWeight: 700, textAlign: "center" }}>Scan The Dashboard</p>
                  <div style={{ background: "#ffffff", padding: 12, borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.22)" }}>
                    <QRCodeSVG value="https://expert-ai-project.vercel.app" size={132} fgColor="#0B1120" bgColor="#ffffff" />
                  </div>
                  <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>expert-ai-project.vercel.app</p>
                </div>
              </div>
            </>
          );
        })()}

        <div style={{ marginTop: 36, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>
            ExpertAI Challenge 3  •  LUISS University 2025/2026
          </p>
          <a
            href="https://github.com/deniztaylan06/Expert_AI_project/tree/main"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 6, color: C.accent, fontSize: 12, fontWeight: 600, textDecoration: "none", background: `${C.accent}12`, border: `1px solid ${C.accent}30`, borderRadius: 6, padding: "5px 12px", whiteSpace: "nowrap" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            github.com/deniztaylan06/Expert_AI_project
          </a>
        </div>
      </div>
    </div>
  );
}
