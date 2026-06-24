import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_PAPER_DETAIL, VIEW_TYPE_PAPER_HOME, VIEW_TYPE_PAPER_LIST } from "./constants";
import { FilterState } from "./filter";
import { PaperIndexer } from "./indexer";
import { RankingService } from "./rankings";
import { DEFAULT_SETTINGS, PaperVaultSettings, PaperVaultSettingTab } from "./settings";
import { PaperDetailView } from "./views/PaperDetailView";
import { PaperHomeView } from "./views/PaperHomeView";
import { PaperListView } from "./views/PaperListView";

export default class PaperVaultPlugin extends Plugin {
  settings: PaperVaultSettings;
  rankings: RankingService;
  indexer: PaperIndexer;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.debugLog("bundle loaded", {
      version: this.manifest.version,
      dir: this.manifest.dir
    });

    this.rankings = new RankingService(this.app, this.manifest.dir ?? ".obsidian/plugins/obsidian-paper-reading", this.settings);
    await this.rankings.load();

    this.debugLog("plugin loaded with settings", this.settings);

    this.indexer = new PaperIndexer(
      this.app,
      this.settings,
      this.rankings,
      () => {
        this.refreshViews();
        this.updateStatusBar();
      },
      (...args) => this.debugLog(...args)
    );

    this.registerView(VIEW_TYPE_PAPER_LIST, (leaf: WorkspaceLeaf) => new PaperListView(leaf, this));
    this.registerView(VIEW_TYPE_PAPER_DETAIL, (leaf: WorkspaceLeaf) => new PaperDetailView(leaf, this));
    this.registerView(VIEW_TYPE_PAPER_HOME, (leaf: WorkspaceLeaf) => new PaperHomeView(leaf, this));
    this.indexer.register(this);

    this.addRibbonIcon("home", "打开 Paper Vault 主页", () => {
      void this.activateHomeView();
    });

    this.addRibbonIcon("library-big", "打开 Paper Vault", () => {
      void this.activateView();
    });

    this.addRibbonIcon("file-text", "打开论文详情面板", () => {
      void this.activateDetailView();
    });

    this.addCommand({
      id: "open-paper-home",
      name: "打开 Paper Vault 主页",
      callback: () => void this.activateHomeView()
    });

    this.addCommand({
      id: "open-paper-vault",
      name: "打开 Paper Vault",
      callback: () => void this.activateView()
    });

    this.addCommand({
      id: "open-paper-detail",
      name: "打开论文详情面板",
      callback: () => void this.activateDetailView()
    });

    this.addCommand({
      id: "rebuild-paper-index",
      name: "重建论文索引",
      callback: async () => {
        await this.indexer.rebuild();
        new Notice(`Paper Vault 已索引 ${this.indexer.getRecords().length} 篇论文`);
      }
    });

    this.addCommand({
      id: "dump-paper-debug-info",
      name: "输出 Paper Vault 调试信息到控制台",
      callback: () => {
        this.dumpDebugInfo();
        new Notice("Paper Vault 调试信息已输出到控制台");
      }
    });

    this.addSettingTab(new PaperVaultSettingTab(this.app, this));
    this.statusBarEl = this.addStatusBarItem();

    this.app.workspace.onLayoutReady(() => {
      void this.indexer.rebuild();
      void this.ensureDetailView();
      if (this.settings.openHomeOnStartup) void this.openHomeOnStartup();
    });
    this.updateStatusBar();
  }

  onunload(): void {
    this.debugLog("plugin unloaded");
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PAPER_LIST);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PAPER_DETAIL);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PAPER_HOME);
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_LIST)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_PAPER_LIST,
        active: true
      });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async activateDetailView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_DETAIL)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_PAPER_DETAIL,
        active: true
      });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async activateHomeView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_HOME)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_PAPER_HOME, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 打开论文库并套用给定筛选条件（供主页卡片跳转使用）。 */
  async openListWithFilter(partial: Partial<FilterState>): Promise<void> {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_LIST)[0];
    if (leaf?.view instanceof PaperListView) {
      leaf.view.applyFilter(partial);
    }
  }

  /** 启动时在主区域打开主页：优先复用空白标签页，否则新开标签。 */
  private async openHomeOnStartup(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_HOME).length) return;
    const leaf = this.app.workspace.getLeavesOfType("empty")[0] ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_PAPER_HOME, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 启动时把详情面板停靠到右侧栏（不抢占焦点，已存在则跳过）。 */
  private async ensureDetailView(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_DETAIL).length) return;
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({
      type: VIEW_TYPE_PAPER_DETAIL,
      active: false
    });
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_LIST)) {
      const view = leaf.view;
      if (view instanceof PaperListView) view.refresh();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_DETAIL)) {
      const view = leaf.view;
      if (view instanceof PaperDetailView) view.refresh();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PAPER_HOME)) {
      const view = leaf.view;
      if (view instanceof PaperHomeView) view.refresh();
    }
  }

  updateStatusBar(): void {
    if (!this.statusBarEl) return;
    if (!this.settings.showStatusBarCount) {
      this.statusBarEl.empty();
      return;
    }
    this.statusBarEl.setText(`论文 ${this.indexer?.getRecords().length ?? 0}`);
  }

  debugLog(...args: unknown[]): void {
    if (this.settings?.debugLogging) {
      console.log("[Paper Vault]", ...args);
    }
  }

  dumpDebugInfo(): void {
    const snapshot = this.indexer?.getDebugSnapshot();
    const records = this.indexer?.getRecords() ?? [];
    console.warn("[Paper Vault] debug dump", {
      settings: this.settings,
      rankingLoaded: this.rankings?.loaded,
      indexSnapshot: snapshot,
      recordCount: records.length,
      firstRecords: records.slice(0, 10).map((record) => ({
        title: record.title,
        path: record.path,
        year: record.year,
        areaPrimary: record.areaPrimary,
        areaSecondary: record.areaSecondary,
        rankings: record.rankings
      }))
    });
  }

  async saveSettingsOnly(): Promise<void> {
    await this.saveData(this.settings);
  }

  async saveSettingsAndRefresh(): Promise<void> {
    await this.saveSettingsOnly();
    this.indexer?.updateSettings(this.settings);
    await this.rankings?.reload(this.settings);
    await this.indexer?.rebuild();
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
}
