import { ItemView, MarkdownRenderer, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { ccfClass, quartileClass } from "../badges";
import { VIEW_TYPE_PAPER_DETAIL } from "../constants";
import { PaperRecord } from "../indexer";
import type PaperVaultPlugin from "../main";

const SUB_NOTE_ORDER = [
  "简报",
  "方法介绍",
  "实验结果",
  "审阅建议",
  "后续灵感",
  "NotebookLM简报",
  "NotebookLM博文"
];

interface NoteTabEntry {
  label: string;
  path: string;
}

export class PaperDetailView extends ItemView {
  plugin: PaperVaultPlugin;

  private bodyEl!: HTMLElement;
  private selectedNotePath: string | null = null;
  private noteContentRenderId = 0;

  constructor(leaf: WorkspaceLeaf, plugin: PaperVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_PAPER_DETAIL;
  }

  getDisplayText(): string {
    return "论文详情";
  }

  getIcon(): string {
    return "file-text";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.bodyEl = this.contentEl.createDiv({ cls: "paper-vault-detail" });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.update()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.update()));

    this.update();
  }

  /** 索引重建后由插件调用，保持详情与最新数据一致。 */
  refresh(): void {
    if (this.bodyEl) this.update();
  }

  private update(): void {
    const file = this.resolveActiveFile();
    void this.render(file);
  }

  private resolveActiveFile(): TFile | null {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView?.file) return mdView.file;
    const active = this.app.workspace.getActiveFile();
    return active && active.extension === "md" ? active : null;
  }

  private async render(file: TFile | null): Promise<void> {
    this.bodyEl.empty();

    if (!file) {
      this.renderPlaceholder("打开一篇论文笔记后，这里会显示它的详细信息。");
      return;
    }

    const record = this.plugin.indexer.findRecordForPath(file.path);
    if (!record) {
      this.renderPlaceholder("当前笔记不在论文库中，或尚未被索引。");
      return;
    }

    this.renderHeader(record, file);
    this.renderMeta(record);
    this.renderRankings(record);
    this.renderAuthors(record);
    this.renderLinks(record);
    this.renderNoteTabs(record, file);
  }

  private renderPlaceholder(text: string): void {
    this.bodyEl.createDiv({ cls: "paper-vault-detail-empty", text });
  }

  private renderHeader(record: PaperRecord, file: TFile): void {
    const header = this.bodyEl.createDiv({ cls: "paper-vault-detail-header" });

    const title = header.createEl("div", { cls: "paper-vault-detail-title", text: record.title });
    title.addEventListener("click", () => void this.openMainNote(record));

    if (record.star) {
      header.createDiv({ cls: "paper-vault-detail-star", text: "⭐".repeat(record.star) });
    }
    if (record.desc) {
      header.createDiv({ cls: "paper-vault-detail-desc", text: record.desc });
    }
    if (file.path !== record.path) {
      const suffix = file.basename.startsWith(`${record.fileStem}-`)
        ? file.basename.slice(record.fileStem.length + 1)
        : file.basename;
      header.createDiv({
        cls: "paper-vault-detail-current",
        text: `当前查看：${suffix}`
      });
    }
  }

  private renderMeta(record: PaperRecord): void {
    const section = this.createSection("基本信息");
    const grid = section.createDiv({ cls: "paper-vault-detail-grid" });

    const direction = [record.areaPrimary, record.areaSecondary].filter(Boolean).join(" / ") || "—";
    this.addMetaRow(grid, [
      ["年份", record.year ? String(record.year) : "—"],
      ["类型", record.paperType || "—"]
    ]);
    this.addVenueRow(grid, record);
    this.addMetaRow(grid, [["方向", direction]]);
    this.addMetaRow(grid, [["kind", record.paperKind ?? "—"]]);
    if (record.techniques.length) {
      this.addMetaRow(grid, [["技术", record.techniques.join("、")]]);
    }
  }

  private addVenueRow(grid: HTMLElement, record: PaperRecord): void {
    const full = record.venue;
    const abbrev = record.venueAbbrev;
    const row = grid.createDiv({ cls: "paper-vault-detail-row" });
    const cell = row.createDiv({ cls: "paper-vault-detail-cell" });
    cell.createDiv({ cls: "paper-vault-detail-label", text: "发表" });
    const value = cell.createDiv({
      cls: "paper-vault-detail-value",
      text: abbrev || full || "—"
    });

    if (full && abbrev && full !== abbrev) {
      value.addClass("paper-vault-detail-toggle");
      value.setAttr("title", "点击切换全称 / 简称");
      let showAbbrev = true;
      value.addEventListener("click", () => {
        showAbbrev = !showAbbrev;
        value.setText(showAbbrev ? abbrev : full);
      });
    }
  }

  private addMetaRow(grid: HTMLElement, pairs: Array<[string, string]>): void {
    const row = grid.createDiv({ cls: "paper-vault-detail-row" });
    for (const [label, value] of pairs) {
      const cell = row.createDiv({ cls: "paper-vault-detail-cell" });
      cell.createDiv({ cls: "paper-vault-detail-label", text: label });
      cell.createDiv({ cls: "paper-vault-detail-value", text: value });
    }
  }

  private renderRankings(record: PaperRecord): void {
    const section = this.createSection("论文分区");
    const wrap = section.createDiv({ cls: "paper-vault-detail-badges" });
    this.addBadge(wrap, "CCF", record.rankings.ccf, ccfClass(record.rankings.ccf));
    this.addBadge(wrap, "JCR", record.rankings.jcr, quartileClass(record.rankings.jcr));
    this.addBadge(wrap, "中科院", record.rankings.cas, quartileClass(record.rankings.cas));
  }

  private addBadge(parent: HTMLElement, label: string, value: string, cls: string): void {
    const item = parent.createDiv({ cls: "paper-vault-detail-badge-item" });
    item.createSpan({ cls: "paper-vault-detail-badge-label", text: label });
    item.createSpan({
      cls: `paper-vault-badge ${value ? cls || "" : "paper-vault-badge-missing"}`,
      text: value || "未收录"
    });
  }

  private renderAuthors(record: PaperRecord): void {
    if (!record.authors.length) return;
    const section = this.createSection("作者");
    const list = section.createDiv({ cls: "paper-vault-detail-authors" });
    for (const author of record.authors) {
      list.createSpan({ cls: "paper-vault-detail-author", text: author });
    }
  }

  private renderLinks(record: PaperRecord): void {
    if (!record.zoteroUrl) return;
    const section = this.createSection("链接");
    const link = section.createEl("a", {
      cls: "paper-vault-detail-zotero",
      text: "在 Zotero 中打开",
      href: record.zoteroUrl
    });
    link.setAttr("target", "_blank");
  }

  private renderNoteTabs(record: PaperRecord, currentFile: TFile): void {
    const entries = this.getNoteTabEntries(record);
    const activePath = this.resolveActiveNotePath(entries, currentFile);

    const section = this.createSection("笔记内容");
    const tabs = section.createDiv({ cls: "paper-vault-detail-tabs" });
    const content = section.createDiv({ cls: "paper-vault-detail-markdown markdown-rendered" });
    const buttons: Array<{ entry: NoteTabEntry; button: HTMLButtonElement }> = [];

    const selectEntry = (entry: NoteTabEntry) => {
      this.selectedNotePath = entry.path;
      for (const item of buttons) {
        item.button.classList.toggle("is-active", item.entry.path === entry.path);
      }
      void this.renderNoteContent(entry.path, content);
    };

    for (const entry of entries) {
      const button = tabs.createEl("button", {
        cls: "paper-vault-detail-tab",
        text: entry.label
      });
      buttons.push({ entry, button });
      button.addEventListener("click", () => selectEntry(entry));
    }

    if (record.slidesExist) {
      tabs.createSpan({ cls: "paper-vault-detail-tag", text: "含 slides" });
    }

    selectEntry(entries.find((entry) => entry.path === activePath) ?? entries[0]);
  }

  private getNoteTabEntries(record: PaperRecord): NoteTabEntry[] {
    return [
      { label: "主笔记", path: record.path },
      ...SUB_NOTE_ORDER.filter((key) => record.subNotes[key]).map((key) => ({
        label: key,
        path: record.subNotes[key]
      }))
    ];
  }

  private resolveActiveNotePath(entries: NoteTabEntry[], currentFile: TFile): string {
    if (entries.some((entry) => entry.path === currentFile.path)) return currentFile.path;
    if (this.selectedNotePath && entries.some((entry) => entry.path === this.selectedNotePath)) {
      return this.selectedNotePath;
    }
    return entries[0].path;
  }

  private async renderNoteContent(path: string, parent: HTMLElement): Promise<void> {
    const renderId = ++this.noteContentRenderId;
    parent.empty();

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      parent.createDiv({ cls: "paper-vault-detail-empty", text: "这份笔记不存在或已经移动。" });
      return;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      if (renderId !== this.noteContentRenderId) return;
      await MarkdownRenderer.render(this.app, stripFrontmatter(content), parent, file.path, this);
    } catch (error) {
      console.error(`Paper Vault: failed to render ${path}`, error);
      if (renderId === this.noteContentRenderId) {
        parent.createDiv({ cls: "paper-vault-detail-empty", text: "渲染这份笔记时出错。" });
      }
    }
  }

  private createSection(title: string): HTMLElement {
    const section = this.bodyEl.createDiv({ cls: "paper-vault-detail-section" });
    section.createDiv({ cls: "paper-vault-detail-section-title", text: title });
    return section;
  }

  private async openMainNote(record: PaperRecord): Promise<void> {
    await this.openPath(record.path);
  }

  private async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const leaf = this.findLeafForFile(file) ?? this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }
  }

  private findLeafForFile(file: TFile): WorkspaceLeaf | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if ((leaf.view as MarkdownView).file === file) return leaf;
    }
    return null;
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}
