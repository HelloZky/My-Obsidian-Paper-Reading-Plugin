import { PaperRecord } from "./indexer";
import { SortDirection } from "./settings";

export interface FilterState {
  query: string;
  areaPrimary: string;
  areaSecondary: string;
  ccf: string;
  jcr: string;
  cas: string;
  starMin: number;
  yearFrom: string;
  yearTo: string;
  paperKind: string;
  paperType: string;
}

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface SortRuntime {
  getOpenCount?: (record: PaperRecord) => number;
  getLastOpenedAt?: (record: PaperRecord) => number;
}

export const EMPTY_FILTERS: FilterState = {
  query: "",
  areaPrimary: "",
  areaSecondary: "",
  ccf: "",
  jcr: "",
  cas: "",
  starMin: 0,
  yearFrom: "",
  yearTo: "",
  paperKind: "",
  paperType: ""
};

export function filterRecords(records: PaperRecord[], filters: FilterState): PaperRecord[] {
  const query = filters.query.trim().toLowerCase();
  const from = parseBound(filters.yearFrom);
  const to = parseBound(filters.yearTo);

  return records.filter((record) => {
    if (query && !matchesQuery(record, query)) return false;
    if (filters.areaPrimary && record.areaPrimary !== filters.areaPrimary) return false;
    if (filters.areaSecondary && record.areaSecondary !== filters.areaSecondary) return false;
    if (filters.ccf && record.rankings.ccf !== filters.ccf) return false;
    if (filters.jcr && record.rankings.jcr !== filters.jcr) return false;
    if (filters.cas && record.rankings.cas !== filters.cas) return false;
    if (filters.starMin && record.star < filters.starMin) return false;
    if (from !== null && (record.year === null || record.year < from)) return false;
    if (to !== null && (record.year === null || record.year > to)) return false;
    if (filters.paperKind && record.paperKind !== filters.paperKind) return false;
    if (filters.paperType && record.paperType !== filters.paperType) return false;
    return true;
  });
}

export function sortRecords(records: PaperRecord[], sort: SortState, runtime: SortRuntime = {}): PaperRecord[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...records].sort((a, b) => compareValue(getSortValue(a, sort.key, runtime), getSortValue(b, sort.key, runtime)) * direction);
}

export function getFilterOptions(records: PaperRecord[], filters: FilterState): Record<string, string[]> {
  const areaFiltered = filters.areaPrimary ? records.filter((record) => record.areaPrimary === filters.areaPrimary) : records;
  return {
    areaPrimary: unique(records.map((record) => record.areaPrimary)),
    areaSecondary: unique(areaFiltered.map((record) => record.areaSecondary)),
    ccf: sortRanks(unique(records.map((record) => record.rankings.ccf))),
    jcr: sortQuartiles(unique(records.map((record) => record.rankings.jcr))),
    cas: sortCas(unique(records.map((record) => record.rankings.cas))),
    paperKind: unique(records.map((record) => record.paperKind ?? "")),
    paperType: unique(records.map((record) => record.paperType ?? ""))
  };
}

function matchesQuery(record: PaperRecord, query: string): boolean {
  return [
    record.title,
    record.desc,
    record.citekey,
    record.authors.join(" "),
    record.techniques.join(" ")
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function getSortValue(record: PaperRecord, key: string, runtime: SortRuntime): string | number {
  switch (key) {
    case "year":
      return record.year ?? 0;
    case "venueAbbrev":
      return record.venueAbbrev || record.venue;
    case "ccf":
      return rankWeight(record.rankings.ccf);
    case "jcr":
      return quartileWeight(record.rankings.jcr);
    case "cas":
      return casWeight(record.rankings.cas);
    case "star":
      return record.star;
    case "uid":
      return record.uid;
    case "openCount":
      return runtime.getOpenCount?.(record) ?? 0;
    case "lastOpenedAt":
      return runtime.getLastOpenedAt?.(record) ?? 0;
    case "areaPrimary":
      return record.areaPrimary;
    case "areaSecondary":
      return record.areaSecondary;
    case "paperKind":
      return record.paperKind ?? "";
    case "paperType":
      return record.paperType ?? "";
    case "title":
    default:
      return record.title;
  }
}

function compareValue(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function parseBound(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
  );
}

function sortRanks(values: string[]): string[] {
  const order = new Map([
    ["A", 1],
    ["B", 2],
    ["C", 3]
  ]);
  return [...values].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

function sortQuartiles(values: string[]): string[] {
  return [...values].sort((a, b) => quartileWeight(a) - quartileWeight(b));
}

function sortCas(values: string[]): string[] {
  return [...values].sort((a, b) => casWeight(a) - casWeight(b));
}

function rankWeight(value: string): number {
  return { A: 1, B: 2, C: 3 }[value] ?? 99;
}

function quartileWeight(value: string): number {
  const match = value.match(/Q([1-4])/i);
  return match ? Number(match[1]) : 99;
}

function casWeight(value: string): number {
  const match = value.match(/([1-4])区/);
  return match ? Number(match[1]) : 99;
}
