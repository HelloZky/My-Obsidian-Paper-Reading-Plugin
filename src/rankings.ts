import { App, normalizePath } from "obsidian";
import { CAS_QUARTILES, CCF_RANKS, JCR_QUARTILES } from "./generated/rankingData";
import { PaperVaultSettings } from "./settings";

export interface VenueRankings {
  ccf: string;
  jcr: string;
  cas: string;
}

type RankMap = Record<string, string>;

export function normalizeLookupKey(value: string): string {
  return (value || "").toLowerCase().replace(/[^0-9a-z一-鿿]+/g, "");
}

export class RankingService {
  private app: App;
  private pluginDir: string;
  private settings: PaperVaultSettings;
  private ccf: RankMap = {};
  private jcr: RankMap = {};
  private cas: RankMap = {};
  loaded = false;

  constructor(app: App, pluginDir: string, settings: PaperVaultSettings) {
    this.app = app;
    this.pluginDir = pluginDir;
    this.settings = settings;
  }

  async reload(settings: PaperVaultSettings): Promise<void> {
    this.settings = settings;
    this.loaded = false;
    await this.load();
  }

  async load(): Promise<void> {
    if (this.settings.dataSource === "vault" && this.settings.dataDirectory) {
      await this.loadFromVault();
    } else {
      // 内置数据：来自构建期 inline 进 bundle 的精简查找表
      this.ccf = CCF_RANKS;
      this.jcr = JCR_QUARTILES;
      this.cas = CAS_QUARTILES;
    }
    this.loaded = true;
  }

  resolve(venue: string, venueAbbrev: string): VenueRankings {
    return {
      ccf: queryRank(this.ccf, venue, venueAbbrev),
      jcr: queryRank(this.jcr, venue, venueAbbrev),
      cas: queryRank(this.cas, venue, venueAbbrev)
    };
  }

  private async loadFromVault(): Promise<void> {
    const [ccfText, jcrText, casText] = await Promise.all([
      this.readDataFile("ccf/ccf_2026_lookup.json"),
      this.readDataFile("JCR2024-UTF8.csv"),
      this.readDataFile("FQBJCR2025-UTF8.csv")
    ]);
    // vault 指定目录缺某个文件时，回退到内置数据
    this.ccf = ccfText ? buildCcfRanks(ccfText) : CCF_RANKS;
    this.jcr = jcrText ? buildCsvRanks(jcrText, "IF Quartile(2024)", (v) => v) : JCR_QUARTILES;
    this.cas = casText ? buildCsvRanks(casText, "大类分区", normalizeCasQuartile) : CAS_QUARTILES;
  }

  private async readDataFile(relativePath: string): Promise<string> {
    const base = this.settings.dataDirectory || `${this.pluginDir}/data`;
    const path = normalizePath(`${base}/${relativePath}`);
    try {
      return await this.app.vault.adapter.read(path);
    } catch (_error) {
      return "";
    }
  }
}

function queryRank(map: RankMap, venue: string, venueAbbrev: string): string {
  for (const candidate of [venue, venueAbbrev]) {
    const normalized = normalizeLookupKey(candidate);
    if (normalized && map[normalized]) return map[normalized];
  }
  return "";
}

function buildCcfRanks(text: string): RankMap {
  const out: RankMap = {};
  try {
    const parsed = JSON.parse(stripBom(text));
    const by = (parsed.by_normalized_key ?? {}) as Record<string, Array<{ rank?: string }>>;
    for (const [key, entries] of Object.entries(by)) {
      const rank = Array.isArray(entries) && entries[0] ? entries[0].rank : "";
      if (rank) out[key] = rank;
    }
  } catch (error) {
    console.error("Paper Vault: failed to parse CCF lookup", error);
  }
  return out;
}

function buildCsvRanks(text: string, valueColumn: string, transform: (value: string) => string): RankMap {
  const out: RankMap = {};
  for (const row of parseCsv(stripBom(text))) {
    const key = normalizeLookupKey(cleanCell(row.Journal));
    if (!key) continue;
    const value = transform(cleanCell(row[valueColumn]));
    if (value) out[key] = value;
  }
  return out;
}

function normalizeCasQuartile(value: string): string {
  const match = (value || "").match(/([1-4])/);
  return match ? `${match[1]}区` : "";
}

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
  const rows = parseCsvMatrix(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => stripBom(header).trim());
  return rows.slice(1).map((row) => {
    const item: CsvRow = {};
    headers.forEach((header, index) => {
      item[header] = row[index] ?? "";
    });
    return item;
  });
}

function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
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

function cleanCell(value: string | undefined): string {
  return (value ?? "").trim();
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}
