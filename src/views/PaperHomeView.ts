import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { ccfClass } from "../badges";
import { VIEW_TYPE_PAPER_HOME } from "../constants";
import { PaperRecord } from "../indexer";
import type PaperVaultPlugin from "../main";

const RECENT_DAYS = 30;
const RECENT_LIMIT = 8;
const STAR_LIMIT = 8;

export class PaperHomeView extends ItemView {
  plugin: PaperVaultPlugin;

  private bodyEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: PaperVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_PAPER_HOME;
  }

  getDisplayText(): string {
    return "Paper Vault 主页";
  }

  getIcon(): string {
    return "home";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.bodyEl = this.contentEl.createDiv({ cls: "paper-vault-home" });
    this.render();
  }

  refresh(): void {
    if (this.bodyEl) this.render();
  }

  private render(): void {
    this.bodyEl.empty();
    const records = this.plugin.indexer.getRecords();

    this.renderHeader(records);
    if (!records.length) {
      this.bodyEl.createDiv({
        cls: "paper-vault-home-empty",
        text: "论文库还没有可索引的笔记。检查设置里的「论文库根目录」是否正确。"
      });
      return;
    }
    this.renderStats(records);
    this.renderAreas(records);
    this.renderRecent(records);
    this.renderTopStars(records);
  }

  private renderHeader(records: PaperRecord[]): void {
    const header = this.bodyEl.createDiv({ cls: "paper-vault-home-header" });
    header.createEl("h1", { cls: "paper-vault-home-title", text: "📚 Paper Vault" });

    const bar = header.createDiv({ cls: "paper-vault-home-actionbar" });
    const search = bar.createEl("input", {
      cls: "paper-vault-home-search",
      attr: { type: "search", placeholder: "搜索论文后回车，在论文库中查看…" }
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.plugin.openListWithFilter({ query: search.value.trim() });
      }
    });

    const openList = bar.createEl("button", { cls: "mod-cta", text: "打开论文库" });
    openList.addEventListener("click", () => void this.plugin.activateView());

    const random = bar.createEl("button", { text: "🎲 随机一篇" });
    random.addEventListener("click", () => {
      if (!records.length) return;
      const pick = records[Math.floor(Math.random() * records.length)];
      void this.openRecord(pick);
    });
  }

  private renderStats(records: PaperRecord[]): void {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const recentCount = records.filter((r) => r.mtime >= cutoff).length;
    const ccfA = records.filter((r) => r.rankings.ccf === "A").length;
    const topTier = records.filter((r) => r.rankings.jcr === "Q1" || r.rankings.cas === "1区").length;
    const highStar = records.filter((r) => r.star >= 4).length;

    const grid = this.bodyEl.createDiv({ cls: "paper-vault-home-stats" });
    this.addStat(grid, "论文总数", records.length);
    this.addStat(grid, `近 ${RECENT_DAYS} 天新增`, recentCount);
    this.addStat(grid, "CCF-A", ccfA);
    this.addStat(grid, "顶刊/顶区", topTier);
    this.addStat(grid, "高星 (≥4⭐)", highStar);
  }

  private addStat(grid: HTMLElement, label: string, value: number): void {
    const card = grid.createDiv({ cls: "paper-vault-home-stat" });
    card.createDiv({ cls: "paper-vault-home-stat-value", text: String(value) });
    card.createDiv({ cls: "paper-vault-home-stat-label", text: label });
  }

  private renderAreas(records: PaperRecord[]): void {
    const counts = new Map<string, number>();
    for (const record of records) {
      const area = record.areaPrimary || "未分类";
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    const areas = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (!areas.length) return;

    const section = this.createSection("研究方向");
    const grid = section.createDiv({ cls: "paper-vault-home-areas" });
    for (const [area, count] of areas) {
      const card = grid.createEl("button", { cls: "paper-vault-home-area" });
      card.createDiv({ cls: "paper-vault-home-area-name", text: area });
      card.createDiv({ cls: "paper-vault-home-area-count", text: `${count} 篇` });
      card.addEventListener("click", () => {
        const filter = area === "未分类" ? {} : { areaPrimary: area };
        void this.plugin.openListWithFilter(filter);
      });
    }
  }

  private renderRecent(records: PaperRecord[]): void {
    const recent = [...records].sort((a, b) => b.mtime - a.mtime).slice(0, RECENT_LIMIT);
    const section = this.createSection("最近修改");
    const cards = section.createDiv({ cls: "paper-vault-home-cards" });
    for (const record of recent) {
      const card = cards.createEl("button", { cls: "paper-vault-home-card" });
      const thumb = card.createDiv({ cls: "paper-vault-home-card-thumb" });
      const src = this.bannerSrc(record);
      if (src) {
        thumb.createEl("img", { cls: "paper-vault-home-card-img", attr: { src } });
      } else {
        thumb.addClass("paper-vault-home-card-thumb-empty");
        thumb.createSpan({ text: "📄" });
      }
      card.createDiv({ cls: "paper-vault-home-card-title", text: record.title });
      const venue = record.venueAbbrev || record.venue;
      if (venue || record.rankings.ccf) {
        const line = card.createDiv({ cls: "paper-vault-home-card-venue" });
        if (venue) {
          line.createSpan({ cls: "paper-vault-home-card-venue-text", text: venue });
        }
        if (record.rankings.ccf) {
          line.createSpan({
            cls: `paper-vault-badge ${ccfClass(record.rankings.ccf)}`,
            text: `CCF-${record.rankings.ccf}`
          });
        }
      }
      card.createDiv({ cls: "paper-vault-home-card-meta", text: formatDate(record.mtime) });
      card.addEventListener("click", () => void this.openRecord(record));
    }
  }

  private bannerSrc(record: PaperRecord): string | null {
    if (!record.bannerExists || !record.bannerPath) return null;
    const file = this.app.vault.getAbstractFileByPath(record.bannerPath);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }

  private renderTopStars(records: PaperRecord[]): void {
    const starred = records
      .filter((r) => r.star > 0)
      .sort((a, b) => b.star - a.star || b.mtime - a.mtime)
      .slice(0, STAR_LIMIT);
    const section = this.createSection("高星论文");
    if (!starred.length) {
      section.createDiv({ cls: "paper-vault-home-empty", text: "还没有标星的论文。" });
      return;
    }
    const list = section.createDiv({ cls: "paper-vault-home-list" });
    for (const record of starred) {
      const item = this.addListItem(list, record);
      item.createSpan({ cls: "paper-vault-home-item-meta", text: "⭐".repeat(record.star) });
    }
  }

  private addListItem(list: HTMLElement, record: PaperRecord): HTMLElement {
    const item = list.createDiv({ cls: "paper-vault-home-item" });
    item.createSpan({ cls: "paper-vault-home-item-title", text: record.title });
    item.addEventListener("click", () => void this.openRecord(record));
    return item;
  }

  private createSection(title: string): HTMLElement {
    const section = this.bodyEl.createDiv({ cls: "paper-vault-home-section" });
    section.createDiv({ cls: "paper-vault-home-section-title", text: title });
    return section;
  }

  private async openRecord(record: PaperRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
  }
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
