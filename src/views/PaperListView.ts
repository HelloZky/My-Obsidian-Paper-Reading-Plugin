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

export class PaperListView extends ItemView {
  plugin: PaperVaultPlugin;
  filters: FilterState = { ...EMPTY_FILTERS };
  sort: SortState;

  private rootEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private countEl!: HTMLElement;
  private tableWrapEl!: HTMLElement;

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
    this.tableWrapEl = this.rootEl.createDiv({ cls: "paper-vault-table-wrap" });
    this.render();
  }

  refresh(): void {
    if (!this.rootEl) return;
    this.render();
  }

  /** 从主页等入口跳转过来时，用给定筛选条件覆盖当前筛选并刷新。 */
  applyFilter(partial: Partial<FilterState>): void {
    this.filters = { ...EMPTY_FILTERS, ...partial };
    if (this.rootEl) this.render();
  }

  private render(): void {
    const records = this.plugin.indexer.getRecords();
    this.renderToolbar(records);
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
    this.renderTable(filtered);
  }

  private renderToolbar(records: PaperRecord[]): void {
    this.toolbarEl.empty();

    const search = this.toolbarEl.createEl("input", {
      cls: "paper-vault-search",
      attr: { type: "search", placeholder: "搜索标题、摘要、citekey、作者、技术..." }
    });
    search.value = this.filters.query;
    search.addEventListener("input", () => {
      this.filters.query = search.value;
      this.render();
    });

    const options = getFilterOptions(records, this.filters);
    this.addSelect("大方向", "areaPrimary", options.areaPrimary);
    this.addSelect("小方向", "areaSecondary", options.areaSecondary);
    this.addSelect("CCF", "ccf", options.ccf);
    this.addSelect("JCR", "jcr", options.jcr);
    this.addSelect("中科院", "cas", options.cas);
    this.addStarSelect();
    this.addYearInput("yearFrom", "年份从");
    this.addYearInput("yearTo", "到");
    this.addSelect("kind", "paperKind", options.paperKind);
    this.addSelect("类型", "paperType", options.paperType);

    const reset = this.toolbarEl.createEl("button", { text: "清空" });
    reset.addEventListener("click", () => {
      this.filters = { ...EMPTY_FILTERS };
      this.render();
    });

    this.countEl = this.toolbarEl.createSpan({ cls: "paper-vault-count" });
  }

  private addSelect(label: string, key: keyof FilterState, values: string[]): void {
    const select = this.toolbarEl.createEl("select", { attr: { "aria-label": label } });
    select.createEl("option", { text: label, value: "" });
    for (const value of values) {
      select.createEl("option", { text: value, value });
    }
    select.value = String(this.filters[key] ?? "");
    select.addEventListener("change", () => {
      (this.filters[key] as string) = select.value;
      if (key === "areaPrimary") this.filters.areaSecondary = "";
      this.render();
    });
  }

  private addStarSelect(): void {
    const select = this.toolbarEl.createEl("select", { attr: { "aria-label": "star" } });
    select.createEl("option", { text: "star ≥", value: "0" });
    for (let i = 1; i <= 5; i++) {
      select.createEl("option", { text: `≥ ${"⭐".repeat(i)}`, value: String(i) });
    }
    select.value = String(this.filters.starMin);
    select.addEventListener("change", () => {
      this.filters.starMin = Number(select.value);
      this.render();
    });
  }

  private addYearInput(key: "yearFrom" | "yearTo", placeholder: string): void {
    const input = this.toolbarEl.createEl("input", {
      attr: { type: "number", placeholder, min: "1900", max: "2100" }
    });
    input.value = this.filters[key];
    input.addEventListener("input", () => {
      this.filters[key] = input.value;
      this.render();
    });
  }

  private renderTable(records: PaperRecord[]): void {
    this.tableWrapEl.empty();
    if (!records.length) {
      const empty = this.tableWrapEl.createDiv({ cls: "paper-vault-empty" });
      empty.createDiv({ text: "没有匹配的论文" });
      this.renderDebugInfo(empty);
      return;
    }

    const table = this.tableWrapEl.createEl("table", { cls: "paper-vault-table" });
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

  private addBadgeCell(row: HTMLTableRowElement, value: string, cls: string): void {
    const cell = row.createEl("td");
    cell.createSpan({
      cls: `paper-vault-badge ${cls || "paper-vault-badge-missing"}`,
      text: value || "未收录"
    });
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
    this.render();
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
