import { App, PluginSettingTab, Setting } from "obsidian";
import type PaperVaultPlugin from "./main";

export type SortDirection = "asc" | "desc";

export interface PaperVaultSettings {
  paperRoot: string;
  dataSource: "builtin" | "vault";
  dataDirectory: string;
  defaultSortKey: string;
  defaultSortDirection: SortDirection;
  showStatusBarCount: boolean;
  openHomeOnStartup: boolean;
  debugLogging: boolean;
}

export const DEFAULT_SETTINGS: PaperVaultSettings = {
  paperRoot: "论文笔记",
  dataSource: "builtin",
  dataDirectory: "",
  defaultSortKey: "year",
  defaultSortDirection: "desc",
  showStatusBarCount: true,
  openHomeOnStartup: true,
  debugLogging: false
};

export class PaperVaultSettingTab extends PluginSettingTab {
  plugin: PaperVaultPlugin;

  constructor(app: App, plugin: PaperVaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("论文库").setHeading();

    new Setting(containerEl)
      .setName("论文库根目录")
      .setDesc("相对 vault 根目录，例如：论文笔记")
      .addText((text) =>
        text
          .setPlaceholder("论文笔记")
          .setValue(this.plugin.settings.paperRoot)
          .onChange(async (value) => {
            this.plugin.settings.paperRoot = value.trim() || DEFAULT_SETTINGS.paperRoot;
            await this.plugin.saveSettingsAndRefresh();
          })
      );

    new Setting(containerEl).setName("分区数据").setHeading();

    new Setting(containerEl)
      .setName("分区数据来源")
      .setDesc("内置数据位于插件 data/；vault 目录适合后续手动更新 CCF/JCR/中科院数据。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("builtin", "插件内置")
          .addOption("vault", "vault 指定目录")
          .setValue(this.plugin.settings.dataSource)
          .onChange(async (value: "builtin" | "vault") => {
            this.plugin.settings.dataSource = value;
            await this.plugin.saveSettingsAndRefresh();
          })
      );

    new Setting(containerEl)
      .setName("vault 分区数据目录")
      .setDesc("使用 vault 指定目录时填写，例如：paper-ranking-data")
      .addText((text) =>
        text
          .setPlaceholder("paper-ranking-data")
          .setValue(this.plugin.settings.dataDirectory)
          .onChange(async (value) => {
            this.plugin.settings.dataDirectory = value.trim();
            await this.plugin.saveSettingsAndRefresh();
          })
      );

    new Setting(containerEl).setName("显示与排序").setHeading();

    new Setting(containerEl)
      .setName("默认排序字段")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("year", "年份")
          .addOption("title", "标题")
          .addOption("venueAbbrev", "期刊/会议")
          .addOption("ccf", "CCF")
          .addOption("jcr", "JCR")
          .addOption("cas", "中科院")
          .addOption("star", "星级")
          .addOption("areaPrimary", "大方向")
          .addOption("areaSecondary", "小方向")
          .addOption("paperKind", "kind")
          .setValue(this.plugin.settings.defaultSortKey)
          .onChange(async (value) => {
            this.plugin.settings.defaultSortKey = value;
            await this.plugin.saveSettingsOnly();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("默认排序方向")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("asc", "升序")
          .addOption("desc", "降序")
          .setValue(this.plugin.settings.defaultSortDirection)
          .onChange(async (value: SortDirection) => {
            this.plugin.settings.defaultSortDirection = value;
            await this.plugin.saveSettingsOnly();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("状态栏显示论文总数")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showStatusBarCount).onChange(async (value) => {
          this.plugin.settings.showStatusBarCount = value;
          await this.plugin.saveSettingsOnly();
          this.plugin.updateStatusBar();
        })
      );

    new Setting(containerEl)
      .setName("启动时打开主页")
      .setDesc("Obsidian 启动后自动在主区域打开 Paper Vault 主页作为入口。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openHomeOnStartup).onChange(async (value) => {
          this.plugin.settings.openHomeOnStartup = value;
          await this.plugin.saveSettingsOnly();
        })
      );

    new Setting(containerEl).setName("调试").setHeading();

    new Setting(containerEl)
      .setName("输出调试日志")
      .setDesc("打开后会在开发者工具 Console 输出索引和筛选过程，前缀为 [Paper Vault]。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
          this.plugin.settings.debugLogging = value;
          await this.plugin.saveSettingsOnly();
        })
      );

    containerEl.createDiv({
      cls: "paper-vault-setting-note",
      text: "文件名约定：ccf/ccf_2026_lookup.json、JCR2024-UTF8.csv、FQBJCR2025-UTF8.csv。"
    });
  }
}
