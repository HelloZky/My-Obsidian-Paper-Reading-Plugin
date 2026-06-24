import { App, Component, normalizePath, parseYaml, TAbstractFile, TFile, TFolder } from "obsidian";
import { RankingService, VenueRankings } from "./rankings";
import { PaperVaultSettings } from "./settings";

export type PaperKind = "regular" | "survey" | "ambiguous";

export interface PaperRecord {
  fileStem: string;
  path: string;
  folder: string;
  mtime: number;
  title: string;
  desc: string;
  year: number | null;
  venue: string;
  venueAbbrev: string;
  star: number;
  paperKind: PaperKind | null;
  paperType: string | null;
  areaPrimary: string;
  areaSecondary: string;
  categoryPath: string;
  methodCategory: string;
  techniques: string[];
  authors: string[];
  citekey: string;
  zoteroUrl: string | null;
  uid: string;
  banner: string;
  bannerPath: string | null;
  bannerExists: boolean;
  slidesExist: boolean;
  subNotes: Record<string, string>;
  rankings: VenueRankings;
}

type FrontMatter = Record<string, unknown>;

export interface IndexDebugSnapshot {
  root: string;
  totalMarkdownFiles: number;
  markdownFilesUnderRoot: number;
  indexedPaperCount: number;
  elapsedMs: number;
  indexedSamples: string[];
  skippedNoFrontmatter: string[];
  skippedWrongType: Array<{ path: string; type: unknown }>;
}

const SUB_NOTE_SUFFIXES = [
  "简报",
  "方法介绍",
  "实验结果",
  "审阅建议",
  "后续灵感",
  "NotebookLM简报",
  "NotebookLM博文"
];

const MISSING_VALUES = new Set([
  "",
  "论文未报告",
  "无法从文中确认",
  "未提供公开链接",
  "未执行外部检索，无法确认"
]);

export class PaperIndexer {
  private app: App;
  private settings: PaperVaultSettings;
  private rankings: RankingService;
  private onChanged: () => void;
  private debugLog: (...args: unknown[]) => void;
  private recordsByPath = new Map<string, PaperRecord>();
  private debugSnapshot: IndexDebugSnapshot | null = null;
  private rebuildTimer: number | null = null;

  constructor(
    app: App,
    settings: PaperVaultSettings,
    rankings: RankingService,
    onChanged: () => void,
    debugLog: (...args: unknown[]) => void
  ) {
    this.app = app;
    this.settings = settings;
    this.rankings = rankings;
    this.onChanged = onChanged;
    this.debugLog = debugLog;
  }

  register(component: Component): void {
    component.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (this.isRelevantMarkdown(file)) this.scheduleRebuild();
      })
    );
    component.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.scheduleRebuild();
      })
    );
    component.registerEvent(
      this.app.vault.on("create", (file) => {
        if (this.isRelevantFile(file)) this.scheduleRebuild();
      })
    );
    component.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.isRelevantFile(file) || this.isPathUnderRoot(oldPath)) this.scheduleRebuild();
      })
    );
    component.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.isRelevantFile(file)) this.scheduleRebuild();
      })
    );
  }

  updateSettings(settings: PaperVaultSettings): void {
    this.settings = settings;
  }

  getRecords(): PaperRecord[] {
    return Array.from(this.recordsByPath.values());
  }

  /**
   * 给定任意文件路径，找到它所属的论文记录。
   * 优先匹配主笔记本身，其次匹配登记的子笔记，最后回退到同文件夹的笔记。
   */
  findRecordForPath(path: string): PaperRecord | null {
    const direct = this.recordsByPath.get(path);
    if (direct) return direct;

    for (const record of this.recordsByPath.values()) {
      if (Object.values(record.subNotes).includes(path)) return record;
    }

    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder) {
      for (const record of this.recordsByPath.values()) {
        if (record.folder === folder) return record;
      }
    }
    return null;
  }

  getDebugSnapshot(): IndexDebugSnapshot | null {
    return this.debugSnapshot;
  }

  async rebuild(): Promise<void> {
    const startedAt = performance.now();
    const next = new Map<string, PaperRecord>();
    const root = normalizeVaultPath(this.settings.paperRoot);
    const allMarkdownFiles = this.app.vault.getMarkdownFiles();
    const files = allMarkdownFiles.filter((file) => file.path.startsWith(`${root}/`) || file.path === root);
    const skippedNoFrontmatter: string[] = [];
    const skippedWrongType: Array<{ path: string; type: unknown }> = [];
    const indexedSamples: string[] = [];

    for (const file of files) {
      const fm = await this.getFrontmatter(file);
      if (!fm) {
        if (skippedNoFrontmatter.length < 5) skippedNoFrontmatter.push(file.path);
        continue;
      }
      if (readString(fm.type) !== "FolderNote") {
        if (skippedWrongType.length < 5) skippedWrongType.push({ path: file.path, type: fm.type });
        continue;
      }
      try {
        const record = this.buildRecord(file, fm, root);
        next.set(file.path, record);
        if (indexedSamples.length < 5) indexedSamples.push(file.path);
      } catch (error) {
        console.error(`Paper Vault: failed to index ${file.path}`, error);
      }
    }

    this.recordsByPath = next;
    this.debugSnapshot = {
      root,
      totalMarkdownFiles: allMarkdownFiles.length,
      markdownFilesUnderRoot: files.length,
      indexedPaperCount: next.size,
      elapsedMs: Math.round(performance.now() - startedAt),
      indexedSamples,
      skippedNoFrontmatter,
      skippedWrongType
    };
    this.debugLog("index rebuild finished", this.debugSnapshot);
    this.onChanged();
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.debugLog("scheduled rebuild fired");
      void this.rebuild();
    }, 300);
  }

  private buildRecord(file: TFile, fm: FrontMatter, root: string): PaperRecord {
    const folder = file.parent?.path ?? "";
    const fileStem = readString(fm["file-stem"]) || file.basename;
    const title = readString(fm.title) || file.basename;
    const venue = readString(fm.venue);
    const venueAbbrev = readString(fm["venue-abbrev"]);
    const banner = readString(fm.banner);
    const bannerPath = banner ? normalizePath(`${folder}/${banner}`) : null;
    const subNotes = collectSubNotes(file, fileStem);
    const areas = deriveAreas(root, folder);

    return {
      fileStem,
      path: file.path,
      folder,
      mtime: file.stat.mtime,
      title,
      desc: readString(fm.desc),
      year: parseYear(readString(fm["publication-year"])),
      venue,
      venueAbbrev,
      star: parseStar(readString(fm.star)),
      paperKind: parsePaperKind(readString(fm["paper-kind"])),
      paperType: readString(fm.paperType) || null,
      areaPrimary: areas.primary,
      areaSecondary: areas.secondary,
      categoryPath: readString(fm["category-path"]),
      methodCategory: readString(fm["method-category"]),
      techniques: readStringArray(fm.technique),
      authors: readStringArray(fm.author).map(stripWikiLink),
      citekey: readString(fm.citekey),
      zoteroUrl: readString(fm["zotero-url"]) || null,
      uid: readString(fm.uid),
      banner,
      bannerPath,
      bannerExists: bannerPath ? this.app.vault.getAbstractFileByPath(bannerPath) instanceof TFile : false,
      slidesExist: hasAnyFile(file.parent, [`${fileStem}_slides_zh.pdf`, `${fileStem}_slides_zh.pptx`]),
      subNotes,
      rankings: this.rankings.resolve(venue, venueAbbrev)
    };
  }

  private async getFrontmatter(file: TFile): Promise<FrontMatter | null> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter as FrontMatter | undefined;
    if (cached) {
      return cached;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      const yaml = extractFrontmatterYaml(content);
      return yaml ? (parseYaml(yaml) as FrontMatter) : null;
    } catch (error) {
      console.error(`Paper Vault: failed to read frontmatter from ${file.path}`, error);
      return null;
    }
  }

  private isRelevantMarkdown(file: TFile): boolean {
    return file.extension === "md" && this.isPathUnderRoot(file.path);
  }

  private isRelevantFile(file: TAbstractFile): boolean {
    return this.isPathUnderRoot(file.path);
  }

  private isPathUnderRoot(path: string): boolean {
    const root = normalizeVaultPath(this.settings.paperRoot);
    return path === root || path.startsWith(`${root}/`);
  }
}

function collectSubNotes(file: TFile, fileStem: string): Record<string, string> {
  const result: Record<string, string> = {};
  const folder = file.parent;
  if (!(folder instanceof TFolder)) return result;

  for (const child of folder.children) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    if (child.basename === file.basename || child.name === "plan.md") continue;
    for (const suffix of SUB_NOTE_SUFFIXES) {
      if (child.basename === `${fileStem}-${suffix}`) {
        result[suffix] = child.path;
        break;
      }
    }
  }
  return result;
}

function hasAnyFile(folder: TFolder | null, names: string[]): boolean {
  if (!folder) return false;
  return names.some((name) => folder.children.some((child) => child instanceof TFile && child.name === name));
}

function deriveAreas(root: string, folder: string): { primary: string; secondary: string } {
  const relative = folder.startsWith(`${root}/`) ? folder.slice(root.length + 1) : "";
  const segments = relative.split("/").filter(Boolean);
  const categorySegments = segments.slice(0, Math.max(segments.length - 1, 0));
  return {
    primary: categorySegments[0] ?? "",
    secondary: categorySegments.length > 1 ? categorySegments.slice(1).join("/") : ""
  };
}

function readString(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return MISSING_VALUES.has(trimmed) ? "" : trimmed;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(readString).filter(Boolean);
  }
  const single = readString(value);
  return single ? [single] : [];
}

function parseYear(value: string): number | null {
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function parseStar(value: string): number {
  return value.match(/⭐/g)?.length ?? 0;
}

function parsePaperKind(value: string): PaperKind | null {
  return value === "regular" || value === "survey" || value === "ambiguous" ? value : null;
}

function stripWikiLink(value: string): string {
  return value.replace(/^\[\[/, "").replace(/\]\]$/, "");
}

function normalizeVaultPath(path: string): string {
  return normalizePath(path.trim()).replace(/\/$/, "");
}

function extractFrontmatterYaml(content: string): string {
  if (!content.startsWith("---")) return "";
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1] ?? "";
}
