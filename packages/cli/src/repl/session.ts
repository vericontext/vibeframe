/**
 * REPL Session Manager
 * Manages the current project state within an interactive session
 */

import { resolve, basename } from "node:path";
import { readFile, writeFile, access } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { Project, type ProjectFile } from "../engine/index.js";
import { loadConfig, type VibeConfig } from "../config/index.js";

/** State change for undo support */
interface StateSnapshot {
  state: ProjectFile;
  description: string;
}

/**
 * Session class - manages project state in REPL
 */
export class Session {
  private config: VibeConfig | null = null;
  private project: Project | null = null;
  private projectPath: string | null = null;
  private history: StateSnapshot[] = [];
  private maxHistorySize = 50;

  /**
   * Initialize session, loading config
   */
  async initialize(): Promise<void> {
    this.config = await loadConfig();
  }

  /**
   * Get current configuration
   */
  getConfig(): VibeConfig | null {
    return this.config;
  }

  /**
   * Check if a project is currently loaded
   */
  hasProject(): boolean {
    return this.project !== null;
  }

  /**
   * Get current project (throws if none)
   */
  getProject(): Project {
    if (!this.project) {
      throw new Error("No project loaded. Use 'new' or 'open' first.");
    }
    return this.project;
  }

  /**
   * Get current project or null
   */
  getProjectOrNull(): Project | null {
    return this.project;
  }

  /**
   * Get project name
   */
  getProjectName(): string | undefined {
    return this.project?.getMeta().name;
  }

  /**
   * Get project file path
   */
  getProjectPath(): string | null {
    return this.projectPath;
  }

  /**
   * Create a new project
   */
  createProject(name: string): Project {
    // Save state for undo if we had a project
    if (this.project) {
      this.pushHistory("switch project");
    }

    this.project = new Project(name);
    this.projectPath = null;
    this.history = [];

    // Apply default settings from config
    if (this.config?.defaults.aspectRatio) {
      this.project.setAspectRatio(this.config.defaults.aspectRatio);
    }

    return this.project;
  }

  /**
   * Load a project from file
   */
  async loadProject(filePath: string): Promise<Project> {
    const absPath = resolve(process.cwd(), filePath);

    // Check file exists
    try {
      await access(absPath);
    } catch {
      throw new Error(`File not found: ${absPath}`);
    }

    // Read and parse
    const content = await readFile(absPath, "utf-8");
    const data: ProjectFile = JSON.parse(content);

    // Save state for undo if we had a project
    if (this.project) {
      this.pushHistory("switch project");
    }

    this.project = Project.fromJSON(data);
    this.project.setFilePath(absPath);
    this.projectPath = absPath;
    this.history = [];

    return this.project;
  }

  /**
   * Save current project to file
   */
  async saveProject(filePath?: string): Promise<string> {
    if (!this.project) {
      throw new Error("No project to save");
    }

    // Determine save path
    let savePath = filePath ? resolve(process.cwd(), filePath) : this.projectPath;

    if (!savePath) {
      // Generate default path from project name
      const name = this.project.getMeta().name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      savePath = resolve(process.cwd(), `${name}.vibe.json`);
    }

    // Ensure .vibe.json extension
    if (!savePath.endsWith(".vibe.json")) {
      savePath += ".vibe.json";
    }

    // Write file
    const data = this.project.toJSON();
    await writeFile(savePath, JSON.stringify(data, null, 2), "utf-8");

    // Update stored path
    this.projectPath = savePath;
    this.project.setFilePath(savePath);

    return savePath;
  }

  /**
   * Push current state to history (for undo)
   */
  pushHistory(description: string): void {
    if (!this.project) return;

    this.history.push({
      state: this.project.toJSON(),
      description,
    });

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Undo last action
   */
  undo(): string | null {
    if (this.history.length === 0) {
      return null;
    }

    const snapshot = this.history.pop()!;
    this.project = Project.fromJSON(snapshot.state);

    if (this.projectPath) {
      this.project.setFilePath(this.projectPath);
    }

    return snapshot.description;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Get summary info for display
   */
  getProjectSummary(): {
    name: string;
    duration: number;
    aspectRatio: string;
    frameRate: number;
    trackCount: number;
    clipCount: number;
    sourceCount: number;
    filePath?: string;
  } | null {
    if (!this.project) return null;

    const summary = this.project.getSummary();
    return {
      ...summary,
      filePath: this.projectPath || undefined,
    };
  }

  /**
   * Check if media file exists
   */
  checkMediaExists(mediaPath: string): { exists: boolean; absPath: string } {
    const absPath = resolve(process.cwd(), mediaPath);
    const exists = existsSync(absPath);
    return { exists, absPath };
  }

  /**
   * Get media file info
   */
  getMediaInfo(mediaPath: string): { name: string; size: number; ext: string } | null {
    const absPath = resolve(process.cwd(), mediaPath);
    if (!existsSync(absPath)) return null;

    try {
      const stat = statSync(absPath);
      return {
        name: basename(absPath),
        size: stat.size,
        ext: absPath.split(".").pop()?.toLowerCase() || "",
      };
    } catch {
      return null;
    }
  }
}
