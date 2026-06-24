// 构建期脚本：把 data/ 下体积较大的原始 CCF/JCR/中科院数据
// 预处理成精简的「归一化刊名 -> 分区」查找表，生成 src/generated/rankingData.ts，
// 从而把内置数据 inline 进 main.js（避免运行时再读磁盘、也避免把几 MB 原文塞进 bundle）。
//
// 注意：normalizeLookupKey 必须与 src/rankings.ts 里保持完全一致，否则查不到。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

const DATA_DIR = "data";
const OUT_DIR = "src/generated";
const OUT_FILE = `${OUT_DIR}/rankingData.ts`;

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.warn(`[generate-data] 缺少数据文件：${path}`);
    return "";
  }
}

function stripBom(value) {
  return value.replace(/^\uFEFF/, "");
}

function normalizeLookupKey(value) {
  return (value || "").toLowerCase().replace(/[^0-9a-z一-鿿]+/g, "");
}

function cleanCell(value) {
  return (value ?? "").trim();
}

function normalizeCasQuartile(value) {
  const match = (value || "").match(/([1-4])/);
  return match ? `${match[1]}区` : "";
}

function parseCsvMatrix(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function parseCsv(text) {
  const rows = parseCsvMatrix(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => stripBom(h).trim());
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] ?? "";
    });
    return item;
  });
}

function buildCcfRanks(text) {
  const out = {};
  if (!text) return out;
  let parsed;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    console.warn("[generate-data] CCF JSON 解析失败", error);
    return out;
  }
  const by = parsed.by_normalized_key ?? {};
  for (const [key, entries] of Object.entries(by)) {
    const rank = Array.isArray(entries) && entries[0] ? entries[0].rank : "";
    if (rank) out[key] = rank;
  }
  return out;
}

function buildCsvRanks(text, valueColumn, transform) {
  const out = {};
  if (!text) return out;
  for (const row of parseCsv(stripBom(text))) {
    const journal = cleanCell(row.Journal);
    const key = normalizeLookupKey(journal);
    if (!key) continue;
    const value = transform(cleanCell(row[valueColumn]));
    if (value) out[key] = value;
  }
  return out;
}

const ccfText = readOrEmpty(`${DATA_DIR}/ccf/ccf_2026_lookup.json`);
const jcrText = readOrEmpty(`${DATA_DIR}/JCR2024-UTF8.csv`);
const casText = readOrEmpty(`${DATA_DIR}/FQBJCR2025-UTF8.csv`);

// CI / 干净克隆里没有原始 data/，此时保留已提交的 rankingData.ts，不覆盖。
if (!ccfText && !jcrText && !casText) {
  if (existsSync(OUT_FILE)) {
    console.log(`[generate-data] 未找到原始数据，沿用已存在的 ${OUT_FILE}`);
    process.exit(0);
  }
  console.error(`[generate-data] 既无原始数据也无 ${OUT_FILE}，无法构建`);
  process.exit(1);
}

const ccf = buildCcfRanks(ccfText);
const jcr = buildCsvRanks(jcrText, "IF Quartile(2024)", (v) => v);
const cas = buildCsvRanks(casText, "大类分区", normalizeCasQuartile);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const banner =
  "// 本文件由 generate-data.mjs 自动生成，请勿手动编辑。\n" +
  "// 内容为内置 CCF/JCR/中科院分区的精简查找表（归一化刊名 -> 分区）。\n\n";

const body =
  `export const CCF_RANKS: Record<string, string> = ${JSON.stringify(ccf)};\n\n` +
  `export const JCR_QUARTILES: Record<string, string> = ${JSON.stringify(jcr)};\n\n` +
  `export const CAS_QUARTILES: Record<string, string> = ${JSON.stringify(cas)};\n`;

writeFileSync(OUT_FILE, banner + body);

console.log(
  `[generate-data] 已生成 ${OUT_FILE}: CCF ${Object.keys(ccf).length} 条, ` +
    `JCR ${Object.keys(jcr).length} 条, 中科院 ${Object.keys(cas).length} 条`
);
