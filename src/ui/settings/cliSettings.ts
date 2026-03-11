import { Setting, Notice, Platform } from "obsidian";
import { verifyCodexCli } from "src/core/cliProvider";
import { DEFAULT_CLI_CONFIG } from "src/types";
import { CliPathModal } from "./CliPathModal";
import type { SettingsContext } from "./settingsContext";

export function displayCliSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  if (Platform.isMobile) return;

  const { plugin, display } = ctx;
  const app = plugin.app;
  const cliConfig = plugin.settings.cliConfig || DEFAULT_CLI_CONFIG;

  new Setting(containerEl).setName("Codex CLI").setHeading();

  const introEl = containerEl.createDiv({ cls: "setting-item-description gemini-helper-cli-intro" });
  introEl.textContent = "ChatGPT Sidebar for Obsidian runs on Codex CLI only. Verify the CLI here and set an explicit path if Obsidian cannot locate it.";

  createCliVerifyRow(containerEl, {
    name: "Codex CLI",
    isVerified: !!cliConfig.codexCliVerified,
    customPath: cliConfig.codexCliPath,
    installCmd: "npm install -g @openai/codex",
    onVerify: (statusEl) => handleVerifyCodex(statusEl, plugin, display),
    onDisable: async () => {
      plugin.settings.cliConfig = { ...cliConfig, codexCliVerified: false };
      await plugin.saveSettings();
      display();
      new Notice("Codex CLI disabled");
    },
    onSettings: (customPath) => openCliPathModal(app, customPath, plugin, display),
  });

  const note = containerEl.createDiv({ cls: "gemini-helper-cli-notice gemini-helper-cli-notice--spaced" });
  note.createEl("strong", { text: "Boundaries:" });
  const list = note.createEl("ul");
  list.createEl("li").textContent = "Codex CLI is the only active backend in this fork.";
  list.createEl("li").textContent = "Gemini API, Claude, RAG, Drive Sync, MCP, and workflow settings are hidden until they have a Codex-native path.";
  list.createEl("li").textContent = "AGENTS.md in the vault root is injected into Codex prompts automatically when present.";
}

function createCliVerifyRow(
  containerEl: HTMLElement,
  options: {
    name: string;
    isVerified: boolean;
    customPath?: string;
    installCmd: string;
    onVerify: (statusEl: HTMLElement) => Promise<void>;
    onDisable: () => Promise<void>;
    onSettings: (customPath?: string) => void;
  }
): void {
  const setting = new Setting(containerEl)
    .setName(options.name)
    .setDesc(`Install: ${options.installCmd}`);

  const statusEl = setting.controlEl.createDiv({ cls: "gemini-helper-cli-row-status" });

  if (options.isVerified) {
    statusEl.addClass("gemini-helper-cli-status--success");
    statusEl.textContent = "Verified";
    setting.addButton((button) =>
      button
        .setButtonText("Disable")
        .onClick(() => void options.onDisable())
    );
  } else {
    setting.addButton((button) =>
      button
        .setButtonText("Verify")
        .setCta()
        .onClick(() => void options.onVerify(statusEl))
    );
  }

  setting.addExtraButton((button) =>
    button
      .setIcon("settings")
      .setTooltip("Set Codex CLI path")
      .onClick(() => options.onSettings(options.customPath))
  );
}

function openCliPathModal(
  app: import("obsidian").App,
  currentPath: string | undefined,
  plugin: import("src/plugin").GeminiHelperPlugin,
  display: () => void
): void {
  new CliPathModal(
    app,
    "codex",
    currentPath,
    async (path: string | undefined) => {
      const cliConfig = plugin.settings.cliConfig;
      if (path) {
        plugin.settings.cliConfig = { ...cliConfig, codexCliPath: path };
        await plugin.saveSettings();
        new Notice("Codex CLI path saved");
      } else {
        const newConfig = { ...cliConfig };
        delete newConfig.codexCliPath;
        plugin.settings.cliConfig = newConfig;
        await plugin.saveSettings();
        new Notice("Codex CLI path cleared");
      }
      display();
    }
  ).open();
}

async function handleVerifyCodex(
  statusEl: HTMLElement,
  plugin: import("src/plugin").GeminiHelperPlugin,
  display: () => void
): Promise<void> {
  statusEl.empty();
  statusEl.removeClass("gemini-helper-cli-status--success", "gemini-helper-cli-status--error");
  statusEl.setText("Verifying Codex CLI...");

  try {
    const result = await verifyCodexCli(plugin.settings.cliConfig.codexCliPath);

    if (!result.success) {
      statusEl.addClass("gemini-helper-cli-status--error");
      plugin.settings.cliConfig = { ...plugin.settings.cliConfig, codexCliVerified: false };
      await plugin.saveSettings();

      statusEl.empty();
      if (result.stage === "version") {
        statusEl.createEl("strong", { text: "Not found: " });
        statusEl.createSpan({ text: result.error || "Codex CLI not found" });
      } else {
        statusEl.createEl("strong", { text: "Login required: " });
        statusEl.createSpan({ text: result.error || "Run `codex` in a terminal and authenticate first." });
      }
      return;
    }

    plugin.settings.cliConfig = {
      ...plugin.settings.cliConfig,
      cliVerified: false,
      claudeCliVerified: false,
      codexCliVerified: true,
    };
    await plugin.saveSettings();
    display();
    new Notice("Codex CLI verified");
  } catch (error) {
    plugin.settings.cliConfig = { ...plugin.settings.cliConfig, codexCliVerified: false };
    await plugin.saveSettings();
    statusEl.addClass("gemini-helper-cli-status--error");
    statusEl.empty();
    statusEl.createEl("strong", { text: "Error: " });
    statusEl.createSpan({ text: String(error) });
  }
}
