import { Plugin, WorkspaceLeaf, Notice, MarkdownView, TFile, Modal } from "obsidian";
import { EventEmitter } from "src/utils/EventEmitter";
import type { SelectionLocationInfo } from "src/ui/selectionHighlight";
import { SelectionManager } from "src/plugin/selectionManager";
import { EncryptionManager } from "src/plugin/encryptionManager";
import { WorkspaceStateManager } from "src/core/workspaceStateManager";
import { ChatView, VIEW_TYPE_GEMINI_CHAT } from "src/ui/ChatView";
import { CryptView, CRYPT_VIEW_TYPE } from "src/ui/CryptView";
import { SettingsTab } from "src/ui/SettingsTab";
import {
  type GeminiHelperSettings,
  type WorkspaceState,
  type RagSetting,
  type RagState,
  type ModelType,
  type SlashCommand,
  DEFAULT_SETTINGS,
  DEFAULT_RAG_STATE,
} from "src/types";
import { initCliProviderManager } from "src/core/cliProvider";
import {
  initEditHistoryManager,
  resetEditHistoryManager,
  getEditHistoryManager,
} from "src/core/editHistory";
import { EditHistoryModal } from "src/ui/components/EditHistoryModal";
import { formatError } from "src/utils/error";
import { DEFAULT_CLI_CONFIG, DEFAULT_EDIT_HISTORY_SETTINGS, DEFAULT_LANGFUSE_SETTINGS, DEFAULT_DRIVE_SYNC_SETTINGS, hasVerifiedCli } from "src/types";
import { initLocale, t } from "src/i18n";


export class GeminiHelperPlugin extends Plugin {
  settings: GeminiHelperSettings = { ...DEFAULT_SETTINGS };
  settingsEmitter = new EventEmitter();
  private wsManager!: WorkspaceStateManager;
  private selectionManager!: SelectionManager;
  private encryptionManager!: EncryptionManager;
  private lastActiveMarkdownView: MarkdownView | null = null;
  driveSyncManager = null;

  // Delegate workspaceState to the manager
  get workspaceState(): WorkspaceState {
    return this.wsManager.workspaceState;
  }
  set workspaceState(value: WorkspaceState) {
    this.wsManager.workspaceState = value;
  }

  onload(): void {
    // Initialize i18n locale
    initLocale();

    // Initialize selection manager
    this.selectionManager = new SelectionManager(this);

    // Initialize encryption manager
    this.encryptionManager = new EncryptionManager(this);

    // Initialize workspace state manager
    this.wsManager = new WorkspaceStateManager(
      this.app,
      () => this.settings,
      () => this.saveSettings(),
      this.settingsEmitter,
      () => this.loadData()
    );

    // Handle migration data modified event
    this.settingsEmitter.on("migration-data-modified", (data: unknown) => {
      void (async () => {
        await this.saveData(data);
      })();
    });

    // Load settings and workspace state
    void this.loadSettings().then(async () => {
      // Apply workspace folder visibility (body class toggle)
      this.updateWorkspaceFolderVisibility();

      // Migrate from old settings format first (one-time)
      try {
        await this.wsManager.migrateFromOldSettings();
      } catch (e) {
        console.error("Gemini Helper: Failed to migrate old settings:", formatError(e));
      }
      try {
        await this.wsManager.loadWorkspaceState();
      } catch (e) {
        console.error("Gemini Helper: Failed to load workspace state:", formatError(e));
      }
      // Migrate slash commands (add default commands if missing)
      try {
        await this.migrateSlashCommands();
      } catch (e) {
        console.error("Gemini Helper: Failed to migrate slash commands:", formatError(e));
      }
      // Initialize clients if a verified CLI is available
      try {
        const cliConfig = this.settings.cliConfig || DEFAULT_CLI_CONFIG;
        if (hasVerifiedCli(cliConfig)) {
          this.initializeClients();
        }
      } catch (e) {
        console.error("ChatGPT Sidebar for Obsidian: Failed to initialize clients:", formatError(e));
      }
      // Emit event to refresh UI after workspace state is loaded
      this.settingsEmitter.emit("workspace-state-loaded", this.workspaceState);
      // Notify UI components that settings are ready (fixes race condition where
      // ChatView renders before loadSettings() completes, e.g. after BRAT hot-reload)
      this.settingsEmitter.emit("settings-updated", this.settings);
    }).catch((e) => {
      console.error("Gemini Helper: Failed to load settings:", formatError(e));
    });

    // Add settings tab
    this.addSettingTab(new SettingsTab(this.app, this));

    // Register chat view
    this.registerView(
      VIEW_TYPE_GEMINI_CHAT,
      (leaf) => new ChatView(leaf, this)
    );

    // Register crypt view (for encrypted files)
    this.registerView(
      CRYPT_VIEW_TYPE,
      (leaf) => new CryptView(leaf, this)
    );

    // Register .encrypted extension so Obsidian opens these files in CryptView
    this.registerExtensions(["encrypted"], CRYPT_VIEW_TYPE);

    // Register file menu (right-click) for encryption and edit history
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle(t("crypt.encryptFile"))
              .setIcon("lock")
              .onClick(async () => {
                await this.encryptFile(file);
              });
          });
          menu.addItem((item) => {
            item
              .setTitle(t("statusBar.snapshot"))
              .setIcon("camera")
              .onClick(async () => {
                await this.saveSnapshotForFile(file);
              });
          });
          menu.addItem((item) => {
            item
              .setTitle(t("statusBar.history"))
              .setIcon("history")
              .onClick(() => {
                new EditHistoryModal(this.app, file.path, this.driveSyncManager).open();
              });
          });
        }
      })
    );

    // Ensure chat view exists on layout ready
    this.app.workspace.onLayoutReady(() => {
      void this.ensureChatViewExists();
    });

    // Track active markdown view and capture selection when switching to chat
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view?.getViewType() === VIEW_TYPE_GEMINI_CHAT) {
          // Capture selection from the last active markdown view
          this.captureSelectionFromView(this.lastActiveMarkdownView);
          // Notify Chat component that it's now active
          this.settingsEmitter.emit("chat-activated");
        } else {
          // Leaving chat view - clear the highlight
          this.clearSelectionHighlight();
          if (leaf?.view instanceof MarkdownView) {
            // Track the last active markdown view
            this.lastActiveMarkdownView = leaf.view;
          }
        }
      })
    );

    // Add ribbon icon
    this.addRibbonIcon("message-square", "Open chat", () => {
      void this.activateChatView();
    });

    // Add command to open chat
    this.addCommand({
      id: "open-chat",
      name: "Open chat",
      callback: () => {
        void this.activateChatView();
      },
    });

    // Add command to toggle between chat and markdown view
    this.addCommand({
      id: "toggle-chat",
      name: "Toggle chat / editor",
      callback: () => {
        this.toggleChatView();
      },
    });

    // Add command to show edit history
    this.addCommand({
      id: "show-edit-history",
      name: t("command.showEditHistory"),
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            new EditHistoryModal(this.app, activeFile.path, this.driveSyncManager).open();
          }
          return true;
        }
        return false;
      },
    });

    // Add command to restore previous version
    this.addCommand({
      id: "restore-previous-version",
      name: t("command.restorePreviousVersion"),
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            void this.restorePreviousVersion(activeFile.path);
          }
          return true;
        }
        return false;
      },
    });

    // Add command to encrypt current file
    this.addCommand({
      id: "encrypt-file",
      name: t("command.encryptFile"),
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "md") {
          if (!checking) {
            void this.encryptFile(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // Add command to decrypt current file
    this.addCommand({
      id: "decrypt-file",
      name: t("command.decryptFile"),
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && (activeFile.extension === "md" || activeFile.extension === "encrypted")) {
          if (!checking) {
            void this.decryptCurrentFile(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // Register file events for edit history
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          const historyManager = getEditHistoryManager();
          if (historyManager) {
            historyManager.handleFileRename(oldPath, file.path);
          }
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          const historyManager = getEditHistoryManager();
          if (historyManager) {
            historyManager.handleFileDelete(file.path);
          }
        }
      })
    );

    // Initialize snapshot when a file is opened (for edit history)
    // Also check if .md file is encrypted and redirect to CryptView
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile) {
          if (file.extension === "md") {
            const historyManager = getEditHistoryManager();
            if (historyManager) {
              void historyManager.initSnapshot(file.path);
            }

            // Check if file is encrypted and redirect to CryptView
            void this.checkAndOpenEncryptedFile(file);
          }
        }
      })
    );

  }

  /**
   * Save a snapshot for a specific file
   */
  private async saveSnapshotForFile(file: TFile): Promise<void> {
    const historyManager = getEditHistoryManager();
    if (!historyManager) {
      new Notice(t("editHistory.notInitialized"));
      return;
    }

    await historyManager.ensureSnapshot(file.path);
    const entry = historyManager.saveEdit({
      path: file.path,
      modifiedContent: await this.app.vault.read(file),
      source: "manual",
    });

    if (entry) {
      new Notice(t("statusBar.snapshotSaved"));
    } else {
      new Notice(t("editHistory.noChanges"));
    }
  }

  /**
   * Save a snapshot for the active file
   */
  private async saveSnapshotForActiveFile(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice(t("editHistory.noActiveFile"));
      return;
    }
    await this.saveSnapshotForFile(activeFile);
  }

  private async restorePreviousVersion(filePath: string): Promise<void> {
    const historyManager = getEditHistoryManager();
    if (!historyManager) {
      new Notice("Edit history manager not initialized");
      return;
    }

    const history = historyManager.getHistory(filePath);
    if (history.length === 0) {
      new Notice(t("editHistoryModal.noHistory"));
      return;
    }

    // Get the most recent entry and restore to before that change
    const lastEntry = history[history.length - 1];

    // Show confirmation modal
    const confirmed = await new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      modal.contentEl.createEl("p", { text: t("editHistoryModal.confirmRestore") });
      const buttonContainer = modal.contentEl.createDiv({ cls: "modal-button-container" });
      buttonContainer.createEl("button", { text: t("common.cancel") }).addEventListener("click", () => {
        modal.close();
        resolve(false);
      });
      buttonContainer.createEl("button", { text: t("common.confirm"), cls: "mod-warning" }).addEventListener("click", () => {
        modal.close();
        resolve(true);
      });
      modal.open();
    });

    if (confirmed) {
      await historyManager.restoreTo(filePath, lastEntry.id);
      const date = new Date(lastEntry.timestamp);
      const timeStr = date.toLocaleString();
      new Notice(t("editHistoryModal.restored", { timestamp: timeStr }));
    }
  }

  onunload(): void {
    this.clearSelectionHighlight();
    resetEditHistoryManager();

    // Clean up hide workspace folder style element
    document.getElementById("gemini-helper-hide-workspace-folder-style")?.remove();
  }

  async loadSettings() {
    const loaded = await this.loadData() ?? {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      // Deep copy arrays to avoid mutating DEFAULT_SETTINGS
      // Use loaded commands if present, otherwise use default commands
      slashCommands: loaded.slashCommands
        ? [...loaded.slashCommands]
        : [...DEFAULT_SETTINGS.slashCommands],
      // Deep copy MCP servers
      mcpServers: loaded.mcpServers
        ? [...loaded.mcpServers]
        : [],
      // Deep copy workflow arrays
      enabledWorkflowHotkeys: loaded.enabledWorkflowHotkeys
        ? [...loaded.enabledWorkflowHotkeys]
        : [],
      enabledWorkflowEventTriggers: loaded.enabledWorkflowEventTriggers
        ? [...loaded.enabledWorkflowEventTriggers]
        : [],
      // Deep merge editHistory settings
      editHistory: {
        ...DEFAULT_EDIT_HISTORY_SETTINGS,
        ...(loaded.editHistory ?? {}),
        diff: {
          ...DEFAULT_EDIT_HISTORY_SETTINGS.diff,
          ...(loaded.editHistory?.diff ?? {}),
        },
      },
      // Deep merge langfuse settings
      langfuse: {
        ...DEFAULT_LANGFUSE_SETTINGS,
        ...(loaded.langfuse ?? {}),
      },
      // Deep merge driveSync settings
      driveSync: {
        ...DEFAULT_DRIVE_SYNC_SETTINGS,
        ...(loaded.driveSync ?? {}),
        excludePatterns: loaded.driveSync?.excludePatterns
          ? [...loaded.driveSync.excludePatterns]
          : [...DEFAULT_DRIVE_SYNC_SETTINGS.excludePatterns],
      },
    };
  }

  async saveSettings() {
    // Only save values that differ from defaults
    const dataToSave: Partial<GeminiHelperSettings> = {};
    for (const key of Object.keys(this.settings) as (keyof GeminiHelperSettings)[]) {
      const currentValue = this.settings[key];
      const defaultValue = DEFAULT_SETTINGS[key];
      // Use JSON.stringify for arrays/objects comparison
      const isDifferent = Array.isArray(currentValue) || (typeof currentValue === 'object' && currentValue !== null)
        ? JSON.stringify(currentValue) !== JSON.stringify(defaultValue)
        : currentValue !== defaultValue;
      if (isDifferent) {
        (dataToSave as Record<string, unknown>)[key] = currentValue;
      }
    }
    await this.saveData(dataToSave);
    this.settingsEmitter.emit("settings-updated", this.settings);

    // Always reinitialize clients to pick up any config changes
    this.initializeClients();
  }

  // ========================================
  // Workspace State Methods (delegated to WorkspaceStateManager)
  // ========================================

  getWorkspaceStateFilePath(): string {
    return this.wsManager.getWorkspaceStateFilePath();
  }

  async loadWorkspaceState(): Promise<void> {
    return this.wsManager.loadWorkspaceState();
  }

  async loadOrCreateWorkspaceState(): Promise<void> {
    return this.wsManager.loadOrCreateWorkspaceState();
  }

  async saveWorkspaceState(): Promise<void> {
    return this.wsManager.saveWorkspaceState();
  }

  /** Show or hide the workspace folder in the file explorer. */
  updateWorkspaceFolderVisibility(): void {
    document.body.toggleClass("gemini-helper-hide-workspace-folder", this.settings.hideWorkspaceFolder);
  }

  getSelectedRagSetting(): RagSetting | null {
    return this.wsManager.getSelectedRagSetting();
  }

  getRagSetting(name: string): RagSetting | null {
    return this.wsManager.getRagSetting(name);
  }

  getRagSettingNames(): string[] {
    return this.wsManager.getRagSettingNames();
  }

  async selectRagSetting(name: string | null): Promise<void> {
    return this.wsManager.selectRagSetting(name);
  }

  async selectModel(model: ModelType): Promise<void> {
    return this.wsManager.selectModel(model);
  }

  getSelectedModel(): ModelType {
    return this.wsManager.getSelectedModel();
  }

  async createRagSetting(name: string, setting?: Partial<RagSetting>): Promise<void> {
    return this.wsManager.createRagSetting(name, setting);
  }

  async updateRagSetting(name: string, updates: Partial<RagSetting>): Promise<void> {
    return this.wsManager.updateRagSetting(name, updates);
  }

  async deleteRagSetting(name: string): Promise<void> {
    return this.wsManager.deleteRagSetting(name);
  }

  async renameRagSetting(oldName: string, newName: string): Promise<void> {
    return this.wsManager.renameRagSetting(oldName, newName);
  }

  async resetRagSettingSyncState(name: string): Promise<void> {
    return this.wsManager.resetRagSettingSyncState(name);
  }

  getVaultStoreName(): string {
    return this.wsManager.getVaultStoreName();
  }

  private syncFileSearchManagerWithSelectedRag(): void {
    return;
  }

  // Migrate from old settings format (plugin-specific parts)
  private async migrateSlashCommands(): Promise<void> {
    const hasRefineCommand = this.settings.slashCommands.some(
      (cmd) => cmd.name === "refine-note"
    );
    if (!hasRefineCommand) {
      this.settings.slashCommands.push({
        id: "cmd_refine_note_default",
        name: "refine-note",
        promptTemplate: "Refine the following Obsidian note content for clarity and concision. Keep markdown structure and vault conventions intact.\n\n{selection}",
        model: "codex-cli",
        description: "Refine the current selection or active note using Codex",
        searchSetting: null,
      });
      await this.saveSettings();
    }
  }

  private initializeClients() {
    // Initialize CLI provider manager
    initCliProviderManager();

    // Initialize edit history manager
    const editHistorySettings = this.settings.editHistory || DEFAULT_EDIT_HISTORY_SETTINGS;
    initEditHistoryManager(this.app, editHistorySettings);
  }

  async promptDriveSyncUnlock(): Promise<void> {
    return Promise.resolve();
  }

  private teardownDriveSyncUI(): void {
    return;
  }

  public setupDriveSyncUI(): void {
    return;
  }

  private updateDriveSyncRibbonBadges(): void {
    return;
  }

  private updateDriveSyncStatusBar(): void {
    return;
  }

  private async ensureChatViewExists() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GEMINI_CHAT);
    if (leaves.length === 0) {
      let leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        leaf = this.app.workspace.getRightLeaf(true);
      }
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_GEMINI_CHAT,
          active: false,
        });
      }
    }
  }

  async activateChatView(): Promise<void> {
    // Capture selection before switching focus
    this.captureSelection();

    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;

    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_GEMINI_CHAT);
    if (existingLeaves.length > 0) {
      leaf = existingLeaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_GEMINI_CHAT,
          active: true,
        });
      }
    }

    if (leaf) {
      void workspace.revealLeaf(leaf);
    }
  }

  // Toggle between chat view and last active markdown view
  private toggleChatView(): void {
    const chatLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GEMINI_CHAT);
    const activeChatView = this.app.workspace.getActiveViewOfType(ChatView);

    if (activeChatView) {
      // Currently in chat, go back to last markdown view
      if (this.lastActiveMarkdownView?.leaf) {
        this.clearSelectionHighlight();
        this.app.workspace.setActiveLeaf(this.lastActiveMarkdownView.leaf, { focus: true });
      }
    } else {
      // Not in chat, capture selection and open/activate chat
      this.captureSelectionFromView(this.lastActiveMarkdownView);
      if (chatLeaves.length > 0) {
        this.app.workspace.setActiveLeaf(chatLeaves[0], { focus: true });
        // Notify Chat component that it's now active
        this.settingsEmitter.emit("chat-activated");
      } else {
        void this.activateChatView();
      }
    }
  }

  // Capture selection from a specific markdown view
  private captureSelectionFromView(view: MarkdownView | null): void {
    this.selectionManager.captureSelectionFromView(view);
  }

  captureSelection(): void {
    this.selectionManager.captureSelection();
  }

  clearSelectionHighlight(): void {
    this.selectionManager.clearSelectionHighlight();
  }

  getLastSelection(): string {
    return this.selectionManager.getLastSelection();
  }

  getSelectionLocation(): SelectionLocationInfo | null {
    return this.selectionManager.getSelectionLocation();
  }

  clearLastSelection(): void {
    this.selectionManager.clearLastSelection();
  }

  async syncVaultForRAG(
    ragSettingName?: string,
    onProgress?: (
      current: number,
      total: number,
      fileName: string,
      action: "upload" | "skip" | "delete"
    ) => void
  ): Promise<null> {
    void ragSettingName;
    void onProgress;
    new Notice("Semantic search is disabled in ChatGPT Sidebar for Obsidian.");
    return null;
  }

  // Delete RAG store from server
  async deleteRagStore(ragSettingName: string): Promise<void> {
    throw new Error(`Semantic search is disabled in ChatGPT Sidebar for Obsidian (${ragSettingName})`);
  }

  // Legacy compatibility: ragState getter
  get ragState(): RagState {
    const selected = this.getSelectedRagSetting();
    if (!selected) {
      return { ...DEFAULT_RAG_STATE };
    }
    // For external stores, use first storeId from storeIds array
    const storeId = selected.isExternal
      ? (selected.storeIds[0] || null)
      : selected.storeId;
    return {
      storeId,
      storeName: selected.storeName,
      files: selected.files,
      lastFullSync: selected.lastFullSync,
      includeFolders: selected.targetFolders,
      excludePatterns: selected.excludePatterns,
    };
  }

  // Get all store IDs for the selected RAG setting (for external stores with multiple IDs)
  getSelectedStoreIds(): string[] {
    const selected = this.getSelectedRagSetting();
    if (!selected) return [];
    if (selected.isExternal) {
      return selected.storeIds;
    }
    return selected.storeId ? [selected.storeId] : [];
  }

  // Get slash commands for workflow
  getSlashCommands(): SlashCommand[] {
    return this.settings.slashCommands;
  }

  // Execute a slash command for workflow
  async executeSlashCommand(
    commandIdOrName: string,
    options?: {
      value?: string;
      contentPath?: string;
      selection?: { path: string; start: unknown; end: unknown };
      chatId?: string;
    }
  ): Promise<{ response: string; chatId: string }> {
    // Find the command
    const command = this.settings.slashCommands.find(
      (cmd) => cmd.id === commandIdOrName || cmd.name === commandIdOrName
    );

    if (!command) {
      throw new Error(`Slash command not found: ${commandIdOrName}`);
    }

    // Get the content to use
    let content = "";
    if (options?.value) {
      content = options.value;
    } else if (options?.contentPath) {
      // Read content from file
      const file = this.app.vault.getAbstractFileByPath(options.contentPath);
      if (file instanceof TFile) {
        content = await this.app.vault.read(file);
      }
    } else if (options?.selection) {
      // Read content from selection
      const selectionPath = options.selection.path;
      const file = this.app.vault.getAbstractFileByPath(selectionPath);
      if (file instanceof TFile) {
        const fileContent = await this.app.vault.read(file);
        // For now, just use the whole file content
        // TODO: Extract selection range
        content = fileContent;
      }
    }

    const prompt = command.promptTemplate.replace(/\{selection\}/g, content);
    const chatId = options?.chatId || `workflow-${Date.now()}`;
    return { response: prompt, chatId };
  }

  // ========================================
  // Temp Upload / Download
  // ========================================

  private async handleTempUpload(file: TFile): Promise<void> {
    void file;
    new Notice("Drive Sync is disabled in ChatGPT Sidebar for Obsidian.");
  }

  private async handleTempDownload(file: TFile): Promise<void> {
    void file;
    new Notice("Drive Sync is disabled in ChatGPT Sidebar for Obsidian.");
  }

  // ========================================
  // Encryption Methods
  // ========================================

  /**
   * Encrypt a file
   */
  async encryptFile(file: TFile): Promise<void> {
    return this.encryptionManager.encryptFile(file);
  }

  private async checkAndOpenEncryptedFile(file: TFile): Promise<void> {
    return this.encryptionManager.checkAndOpenEncryptedFile(file);
  }

  async decryptCurrentFile(file: TFile): Promise<void> {
    return this.encryptionManager.decryptCurrentFile(file);
  }
}
