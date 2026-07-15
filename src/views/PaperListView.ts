import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { ccfClass, quartileClass } from "../badges";
import { VIEW_TYPE_PAPER_LIST } from "../constants";
import { EMPTY_FILTERS, FilterState, filterRecords, getFilterOptions, SortState, sortRecords } from "../filter";
import { PaperRecord } from "../indexer";
import type PaperVaultPlugin from "../main";

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "title", label: "标题" },
  { key: "year", label: "年份" },
  { key: "venueAbbrev", label: "期刊/会议" },
  { key: "ccf", label: "CCF" },
  { key: "jcr", label: "JCR" },
  { key: "cas", label: "中科院" },
  { key: "star", label: "star" },
  { key: "areaPrimary", label: "大方向" },
  { key: "areaSecondary", label: "小方向" },
  { key: "paperKind", label: "kind" }
];

export type PaperListViewMode = "table" | "cards";

export class PaperListView extends ItemView {
  plugin: PaperVaultPlugin;
  filters: FilterState = { ...EMPTY_FILTERS };
  sort: SortState;
  viewMode: PaperListViewMode = "table";

  private rootEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private countEl!: HTMLElement;
  private resultsEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: PaperVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.sort = {
      key: plugin.settings.defaultSortKey,
      direction: plugin.settings.defaultSortDirection
    };
  }

  getViewType(): string {
    return VIEW_TYPE_PAPER_LIST;
  }

  getDisplayText(): string {
    return "Paper Vault";
  }

  getIcon(): string {
    return "library-big";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.rootEl = this.contentEl.createDiv({ cls: "paper-vault-view" });
    this.toolbarEl = this.rootEl.createDiv({ cls: "paper-vault-toolbar" });
    this.countEl = this.toolbarEl.createSpan({ cls: "paper-vault-count" });
    this.resultsEl = this.rootEl.createDiv({ cls: "paper-vault-results" });
    this.render();
  }

  refresh(): void {
    if (!this.rootEl) return;
    this.render();
  }

  /** 从主页等入口跳转过来时，用给定筛选条件覆盖当前筛选并刷新。 */
  applyFilter(partial: Partial<FilterState>, viewMode?: PaperListViewMode): void {
    this.filters = { ...EMPTY_FILTERS, ...partial };
    if (viewMode) this.viewMode = viewMode;
    if (this.rootEl) this.render();
  }

  private render(): void {
    const records = this.plugin.indexer.getRecords();
    this.updateCardStyleClass();
    this.renderToolbar(records);
    this.renderResults(records);
  }

  private updateCardStyleClass(): void {
    this.rootEl.classList.remove("paper-vault-card-style-classic", "paper-vault-card-style-glass");
    this.rootEl.classList.add(`paper-vault-card-style-${this.plugin.settings.cardStyle}`);
  }

  private renderResults(records = this.plugin.indexer.getRecords()): void {
    const filtered = sortRecords(filterRecords(records, this.filters), this.sort);
    this.plugin.debugLog("view render", {
      totalRecords: records.length,
      filteredRecords: filtered.length,
      filters: { ...this.filters },
      sort: { ...this.sort },
      firstRecords: records.slice(0, 5).map((record) => ({
        title: record.title,
        path: record.path,
        year: record.year,
        areaPrimary: record.areaPrimary,
        areaSecondary: record.areaSecondary,
        ccf: record.rankings.ccf,
        jcr: record.rankings.jcr,
        cas: record.rankings.cas
      }))
    });
    this.countEl.setText(`命中 ${filtered.length} / ${records.length}`);
    if (this.viewMode === "cards") {
      this.renderCards(filtered);
    } else {
      this.renderTable(filtered);
    }
  }

  private renderToolbar(records: PaperRecord[]): void {
    this.toolbarEl.empty();

    const primaryRow = this.toolbarEl.createDiv({ cls: "paper-vault-toolbar-primary" });
    const filterRow = this.toolbarEl.createDiv({ cls: "paper-vault-filter-row" });

    const search = primaryRow.createEl("input", {
      cls: "paper-vault-search",
      attr: { type: "search", placeholder: "搜索标题、摘要、citekey、作者、技术..." }
    });
    search.value = this.filters.query;
    search.addEventListener("input", () => {
      this.filters.query = search.value;
      this.renderResults();
    });

    this.countEl = primaryRow.createSpan({ cls: "paper-vault-count" });
    this.addViewModeToggle(primaryRow);

    const options = getFilterOptions(records, this.filters);
    this.addSelect(filterRow, "大方向", "areaPrimary", options.areaPrimary);
    this.addSelect(filterRow, "小方向", "areaSecondary", options.areaSecondary);
    this.addSelect(filterRow, "CCF", "ccf", options.ccf);
    this.addSelect(filterRow, "JCR", "jcr", options.jcr);
    this.addSelect(filterRow, "中科院", "cas", options.cas);
    this.addStarSelect(filterRow);
    this.addYearInput(filterRow, "yearFrom", "年份从");
    this.addYearInput(filterRow, "yearTo", "到");
    this.addSelect(filterRow, "kind", "paperKind", options.paperKind);
    this.addSelect(filterRow, "类型", "paperType", options.paperType);

    const reset = filterRow.createEl("button", { cls: "paper-vault-clear-button", text: "清空" });
    reset.addEventListener("click", () => {
      this.filters = { ...EMPTY_FILTERS };
      this.render();
    });
  }

  private addViewModeToggle(parent: HTMLElement): void {
    const group = parent.createDiv({ cls: "paper-vault-view-toggle" });
    this.addModeButton(group, "table", "表格");
    this.addModeButton(group, "cards", "卡片");
  }

  private addModeButton(group: HTMLElement, mode: PaperListViewMode, label: string): void {
    const button = group.createEl("button", {
      cls: `paper-vault-view-toggle-button ${this.viewMode === mode ? "is-active" : ""}`,
      text: label
    });
    button.addEventListener("click", () => {
      if (this.viewMode === mode) return;
      this.viewMode = mode;
      this.render();
    });
  }

  private addSelect(parent: HTMLElement, label: string, key: keyof FilterState, values: string[]): void {
    const select = parent.createEl("select", { attr: { "aria-label": label } });
    select.createEl("option", { text: label, value: "" });
    for (const value of values) {
      select.createEl("option", { text: value, value });
    }
    select.value = String(this.filters[key] ?? "");
    select.addEventListener("change", () => {
      (this.filters[key] as string) = select.value;
      if (key === "areaPrimary") {
        this.filters.areaSecondary = "";
        this.render();
        return;
      }
      this.renderResults();
    });
  }

  private addStarSelect(parent: HTMLElement): void {
    const select = parent.createEl("select", { attr: { "aria-label": "star" } });
    select.createEl("option", { text: "star ≥", value: "0" });
    for (let i = 1; i <= 5; i++) {
      select.createEl("option", { text: `≥ ${"⭐".repeat(i)}`, value: String(i) });
    }
    select.value = String(this.filters.starMin);
    select.addEventListener("change", () => {
      this.filters.starMin = Number(select.value);
      this.renderResults();
    });
  }

  private addYearInput(parent: HTMLElement, key: "yearFrom" | "yearTo", placeholder: string): void {
    const input = parent.createEl("input", {
      attr: { type: "number", placeholder, min: "1900", max: "2100" }
    });
    input.value = this.filters[key];
    input.addEventListener("input", () => {
      this.filters[key] = input.value;
      this.renderResults();
    });
  }

  private renderTable(records: PaperRecord[]): void {
    this.resultsEl.empty();
    this.resultsEl.className = "paper-vault-results paper-vault-table-wrap";
    if (!records.length) {
      const empty = this.resultsEl.createDiv({ cls: "paper-vault-empty" });
      empty.createDiv({ text: "没有匹配的论文" });
      this.renderDebugInfo(empty);
      return;
    }

    const table = this.resultsEl.createEl("table", { cls: "paper-vault-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    for (const column of COLUMNS) {
      const th = headerRow.createEl("th", { text: this.headerLabel(column.key, column.label) });
      th.addEventListener("click", () => this.toggleSort(column.key));
    }

    const tbody = table.createEl("tbody");
    for (const record of records) {
      const row = tbody.createEl("tr");
      row.addEventListener("click", () => void this.openRecord(record));
      row.createEl("td", { cls: "paper-vault-title-cell", text: record.title });
      row.createEl("td", { text: record.year ? String(record.year) : "—" });
      row.createEl("td", { text: record.venueAbbrev || record.venue || "—" });
      this.addBadgeCell(row, record.rankings.ccf, ccfClass(record.rankings.ccf));
      this.addBadgeCell(row, record.rankings.jcr, quartileClass(record.rankings.jcr));
      this.addBadgeCell(row, record.rankings.cas, quartileClass(record.rankings.cas));
      row.createEl("td", { text: record.star ? "⭐".repeat(record.star) : "—" });
      row.createEl("td", { text: record.areaPrimary || "—" });
      row.createEl("td", { text: record.areaSecondary || "—" });
      row.createEl("td", { text: record.paperKind ?? "—" });
    }
  }

  private renderCards(records: PaperRecord[]): void {
    this.resultsEl.empty();
    this.resultsEl.className = "paper-vault-results paper-vault-card-wrap";
    if (!records.length) {
      const empty = this.resultsEl.createDiv({ cls: "paper-vault-empty" });
      empty.createDiv({ text: "没有匹配的论文" });
      this.renderDebugInfo(empty);
      return;
    }

    const grid = this.resultsEl.createDiv({ cls: "paper-vault-card-grid" });
    for (const record of records) {
      const card = grid.createEl("button", { cls: "paper-vault-card" });
      const thumb = card.createDiv({ cls: "paper-vault-card-thumb" });
      const src = this.bannerSrc(record);
      if (src) {
        thumb.createEl("img", { cls: "paper-vault-card-img", attr: { src } });
      } else {
        thumb.addClass("paper-vault-card-thumb-empty");
        thumb.createSpan({ text: "论文" });
      }

      const body = card.createDiv({ cls: "paper-vault-card-body" });
      body.createDiv({ cls: "paper-vault-card-title", text: record.title });
      body.createDiv({ cls: "paper-vault-card-desc", text: record.desc || "" });

      const venue = record.venueAbbrev || record.venue;
      if (venue || record.year) {
        const meta = body.createDiv({ cls: "paper-vault-card-meta" });
        if (venue) meta.createSpan({ cls: "paper-vault-card-venue", text: venue });
        if (record.year) meta.createSpan({ text: String(record.year) });
      }

      const badges = body.createDiv({ cls: "paper-vault-card-badges" });
      this.renderCardRankingBadges(badges, record);

      const footer = body.createDiv({ cls: "paper-vault-card-footer" });
      footer.createSpan({
        cls: "paper-vault-card-direction",
        text: [record.areaPrimary, record.areaSecondary].filter(Boolean).join(" / ") || "未分类"
      });
      footer.createSpan({ cls: "paper-vault-card-star", text: record.star ? "⭐".repeat(record.star) : "未评级" });

      card.addEventListener("click", () => void this.openRecord(record));
    }
  }

  private addBadgeCell(row: HTMLTableRowElement, value: string, cls: string): void {
    const cell = row.createEl("td");
    cell.createSpan({
      cls: `paper-vault-badge ${cls || "paper-vault-badge-missing"}`,
      text: value || "未收录"
    });
  }

  private addCardBadge(parent: HTMLElement, text: string, cls: string): void {
    parent.createSpan({
      cls: `paper-vault-badge ${cls || "paper-vault-badge-missing"}`,
      text
    });
  }

  private renderCardRankingBadges(parent: HTMLElement, record: PaperRecord): void {
    const missing: string[] = [];
    if (record.rankings.ccf) {
      this.addCardBadge(parent, `CCF-${record.rankings.ccf}`, ccfClass(record.rankings.ccf));
    } else {
      missing.push("CCF");
    }

    if (record.rankings.jcr) {
      this.addCardBadge(parent, record.rankings.jcr, quartileClass(record.rankings.jcr));
    } else {
      missing.push("JCR");
    }

    if (record.rankings.cas) {
      this.addCardBadge(parent, record.rankings.cas, quartileClass(record.rankings.cas));
    } else {
      missing.push("中科院");
    }

    if (missing.length) {
      this.addCardBadge(parent, `${missing.join("/")}未收录`, "");
    }
  }

  private bannerSrc(record: PaperRecord): string | null {
    if (!record.bannerExists || !record.bannerPath) return null;
    const file = this.app.vault.getAbstractFileByPath(record.bannerPath);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }

  private headerLabel(key: string, label: string): string {
    if (this.sort.key !== key) return label;
    return `${label} ${this.sort.direction === "asc" ? "▲" : "▼"}`;
  }

  private toggleSort(key: string): void {
    if (this.sort.key === key) {
      this.sort.direction = this.sort.direction === "asc" ? "desc" : "asc";
    } else {
      this.sort.key = key;
      this.sort.direction = "asc";
    }
    this.renderResults();
  }

  private async openRecord(record: PaperRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  private renderDebugInfo(parent: HTMLElement): void {
    if (!this.plugin.settings.debugLogging) return;

    const snapshot = this.plugin.indexer.getDebugSnapshot();
    const details = parent.createEl("details", { cls: "paper-vault-debug" });
    details.createEl("summary", { text: "调试信息" });

    const pre = details.createEl("pre");
    pre.setText(
      JSON.stringify(
        {
          indexSnapshot: snapshot,
          filters: this.filters,
          sort: this.sort
        },
        null,
        2
      )
    );

    const button = details.createEl("button", { text: "输出到 Console" });
    button.addEventListener("click", () => this.plugin.dumpDebugInfo());
  }
}
