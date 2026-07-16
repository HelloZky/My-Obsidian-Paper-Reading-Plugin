import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { ccfClass, quartileClass } from "../badges";
import { VIEW_TYPE_PAPER_LIST } from "../constants";
import { EMPTY_FILTERS, FilterState, filterRecords, getFilterOptions, SortState, sortRecords } from "../filter";
import { PaperRecord } from "../indexer";
import type PaperVaultPlugin from "../main";

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "title", label: "标题" },
  { key: "year", label: "年份" },
  { key: "uid", label: "UID" },
  { key: "venueAbbrev", label: "期刊/会议" },
  { key: "ccf", label: "CCF" },
  { key: "jcr", label: "JCR" },
  { key: "cas", label: "中科院" },
  { key: "star", label: "star" },
  { key: "openCount", label: "查看次数" },
  { key: "lastOpenedAt", label: "最近查看" },
  { key: "areaPrimary", label: "大方向" },
  { key: "areaSecondary", label: "小方向" },
  { key: "paperKind", label: "kind" }
];

export type PaperListViewMode = "table" | "cards" | "qa";

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
    this.rootEl.classList.remove("paper-vault-card-density-compact", "paper-vault-card-density-standard", "paper-vault-card-density-rich");
    this.rootEl.classList.add(`paper-vault-card-style-${this.plugin.settings.cardStyle}`);
    this.rootEl.classList.add(`paper-vault-card-density-${this.plugin.settings.cardDensity}`);
  }

  private renderResults(records = this.plugin.indexer.getRecords()): void {
    const filtered = sortRecords(filterRecords(records, this.filters), this.sort, {
      getOpenCount: (record) => this.plugin.getPaperOpenCount(record),
      getLastOpenedAt: (record) => this.plugin.getPaperLastOpenedAt(record)
    });
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
    if (this.viewMode === "qa") {
      this.renderQa(filtered);
    } else if (this.viewMode === "cards") {
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
    this.addPresetControls(primaryRow);

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
    this.addSortControls(filterRow);

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
    this.addModeButton(group, "qa", "QA");
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

  private addSortControls(parent: HTMLElement): void {
    const select = parent.createEl("select", { cls: "paper-vault-sort-select", attr: { "aria-label": "排序字段" } });
    for (const column of COLUMNS) {
      select.createEl("option", { text: column.label, value: column.key });
    }
    select.value = this.sort.key;
    select.addEventListener("change", () => {
      this.sort.key = select.value;
      this.renderResults();
    });

    const direction = parent.createEl("button", {
      cls: "paper-vault-sort-direction",
      text: this.sort.direction === "asc" ? "↑" : "↓"
    });
    direction.setAttr("title", this.sort.direction === "asc" ? "升序" : "降序");
    direction.addEventListener("click", () => {
      this.sort.direction = this.sort.direction === "asc" ? "desc" : "asc";
      direction.setText(this.sort.direction === "asc" ? "↑" : "↓");
      direction.setAttr("title", this.sort.direction === "asc" ? "升序" : "降序");
      this.renderResults();
    });
  }

  private addPresetControls(parent: HTMLElement): void {
    const presets = this.plugin.settings.filterPresets;
    const select = parent.createEl("select", { cls: "paper-vault-preset-select", attr: { "aria-label": "筛选预设" } });
    select.createEl("option", { text: "预设", value: "" });
    for (const preset of presets) {
      select.createEl("option", { text: preset.name, value: preset.name });
    }
    select.addEventListener("change", () => {
      const preset = presets.find((item) => item.name === select.value);
      if (!preset) return;
      this.filters = { ...EMPTY_FILTERS, ...(preset.filters as Partial<FilterState>) };
      this.sort = { key: preset.sortKey, direction: preset.sortDirection };
      this.render();
    });

    const nameInput = parent.createEl("input", {
      cls: "paper-vault-preset-name",
      attr: { type: "text", placeholder: "预设名称" }
    });
    const save = parent.createEl("button", { cls: "paper-vault-preset-save", text: "保存预设" });
    save.addEventListener("click", () => void this.saveCurrentPreset(nameInput.value));
  }

  private async saveCurrentPreset(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      new Notice("请先填写预设名称");
      return;
    }
    const next = this.plugin.settings.filterPresets.filter((preset) => preset.name !== trimmed);
    next.push({
      name: trimmed,
      filters: { ...this.filters },
      sortKey: this.sort.key,
      sortDirection: this.sort.direction
    });
    this.plugin.settings.filterPresets = next;
    await this.plugin.saveSettingsOnly();
    new Notice(`已保存预设：${trimmed}`);
    this.render();
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
      row.createEl("td", { text: record.uid || "—" });
      row.createEl("td", { text: record.venueAbbrev || record.venue || "—" });
      this.addBadgeCell(row, record.rankings.ccf, ccfClass(record.rankings.ccf));
      this.addBadgeCell(row, record.rankings.jcr, quartileClass(record.rankings.jcr));
      this.addBadgeCell(row, record.rankings.cas, quartileClass(record.rankings.cas));
      row.createEl("td", { text: record.star ? "⭐".repeat(record.star) : "—" });
      row.createEl("td", { text: String(this.plugin.getPaperOpenCount(record)) });
      row.createEl("td", { text: formatRelativeTime(this.plugin.getPaperLastOpenedAt(record)) });
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
      const badgeList = badges.createDiv({ cls: "paper-vault-card-badge-list" });
      this.renderCardRankingBadges(badgeList, record);
      badges.createSpan({
        cls: "paper-vault-card-rating",
        text: record.star ? "⭐".repeat(record.star) : "未评级"
      });

      const footer = body.createDiv({ cls: "paper-vault-card-footer" });
      footer.createSpan({
        cls: "paper-vault-card-direction",
        text: this.cardContextLabel(record)
      });
      const metrics = footer.createSpan({ cls: "paper-vault-card-metrics" });
      metrics.createSpan({ cls: "paper-vault-card-open-count", text: `查看 ${this.plugin.getPaperOpenCount(record)} 次` });
      metrics.createSpan({ cls: "paper-vault-card-last-opened", text: formatRelativeTime(this.plugin.getPaperLastOpenedAt(record)) });

      card.addEventListener("click", () => void this.openRecordFromCard(record));
    }
  }

  private renderQa(records: PaperRecord[]): void {
    this.resultsEl.empty();
    this.resultsEl.className = "paper-vault-results paper-vault-qa-wrap";
    const items = this.collectQaItems(records);
    if (!items.length) {
      this.resultsEl.createDiv({ cls: "paper-vault-empty", text: "当前筛选范围内没有发现 QA 问题。" });
      return;
    }

    const list = this.resultsEl.createDiv({ cls: "paper-vault-qa-list" });
    for (const itemData of items) {
      const item = list.createEl("button", { cls: "paper-vault-qa-item" });
      item.createDiv({ cls: "paper-vault-qa-title", text: itemData.record.title });
      item.createDiv({ cls: "paper-vault-qa-meta", text: [itemData.record.areaPrimary, itemData.record.areaSecondary].filter(Boolean).join(" / ") || "未分类" });
      const problems = item.createDiv({ cls: "paper-vault-qa-problems" });
      for (const message of itemData.messages) {
        problems.createSpan({ cls: "paper-vault-qa-problem", text: message });
      }
      item.addEventListener("click", () => void this.openRecord(itemData.record));
    }
  }

  private collectQaItems(records: PaperRecord[]): Array<{ record: PaperRecord; messages: string[] }> {
    const citekeyCounts = new Map<string, number>();
    for (const record of records) {
      if (record.citekey) citekeyCounts.set(record.citekey, (citekeyCounts.get(record.citekey) ?? 0) + 1);
    }

    const items: Array<{ record: PaperRecord; messages: string[] }> = [];
    for (const record of records) {
      const messages: string[] = [];
      const missingFields = [
        !record.desc ? "desc" : "",
        !record.venue && !record.venueAbbrev ? "venue" : "",
        !record.paperKind ? "paper-kind" : "",
        !record.star ? "star" : ""
      ].filter(Boolean);
      if (missingFields.length) messages.push(`缺字段：${missingFields.join("、")}`);
      if (!record.rankings.ccf && !record.rankings.jcr && !record.rankings.cas) {
        messages.push("venue 三库均未匹配");
      }
      if (!record.bannerExists) messages.push("缺 banner 图片");
      if (!record.slidesExist) messages.push("缺 slides 文件");
      const missingSubNotes = ["简报", "方法介绍", "实验结果", "审阅建议", "后续灵感"].filter((key) => !record.subNotes[key]);
      if (missingSubNotes.length) messages.push(`缺子笔记：${missingSubNotes.join("、")}`);
      if (record.citekey && (citekeyCounts.get(record.citekey) ?? 0) > 1) {
        messages.push(`citekey 重复：${record.citekey}`);
      }
      if (messages.length) items.push({ record, messages });
    }
    return items;
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
      this.addCardBadge(parent, missing.join("/"), "paper-vault-badge-struck");
    }
  }

  private cardContextLabel(record: PaperRecord): string {
    if (this.filters.areaPrimary && this.filters.areaSecondary) {
      return formatPaperType(record.paperType) || formatPaperKind(record.paperKind) || "已筛选方向";
    }
    if (this.filters.areaPrimary) {
      return record.areaSecondary || formatPaperType(record.paperType) || formatPaperKind(record.paperKind) || "未细分方向";
    }
    return [record.areaPrimary, record.areaSecondary].filter(Boolean).join(" / ") || "未分类";
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

  private async openRecordFromCard(record: PaperRecord): Promise<void> {
    await this.plugin.incrementPaperOpenCount(record);
    await this.openRecord(record);
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

function formatRelativeTime(ms: number): string {
  if (!ms) return "未查看";
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatPaperType(value: string | null): string {
  switch (value) {
    case "journalArticle":
    case "reviewArticle":
      return "期刊";
    case "conferencePaper":
      return "会议";
    case "preprint":
      return "预印本";
    default:
      return value ?? "";
  }
}

function formatPaperKind(value: string | null): string {
  switch (value) {
    case "survey":
      return "综述";
    case "regular":
      return "常规论文";
    case "ambiguous":
      return "类型待定";
    default:
      return value ?? "";
  }
}
