import { describe, it, expect, beforeEach } from "vitest";
import { Session } from "./session.js";
import { executeReplCommand } from "./executor.js";
import {
  getWelcomeMessage,
  getHelpText,
  getPrompt,
  formatProjectInfo,
  formatDuration,
  success,
  error,
  warn,
  info,
} from "./prompts.js";

describe("REPL Prompts", () => {
  describe("getWelcomeMessage", () => {
    it("shows welcome message when configured", () => {
      const msg = getWelcomeMessage(true);
      // ASCII logo contains stylized VIBE letters
      expect(msg).toContain("AI-First Video Editor");
      expect(msg).not.toContain("No configuration found");
    });

    it("shows setup prompt when not configured", () => {
      const msg = getWelcomeMessage(false);
      expect(msg).toContain("No configuration found");
      expect(msg).toContain("setup");
    });
  });

  describe("getHelpText", () => {
    it("lists built-in commands", () => {
      const help = getHelpText();
      expect(help).toContain("new <name>");
      expect(help).toContain("open <path>");
      expect(help).toContain("save");
      expect(help).toContain("info");
      expect(help).toContain("list");
      expect(help).toContain("export");
      expect(help).toContain("undo");
      expect(help).toContain("help");
      expect(help).toContain("exit");
    });

    it("shows natural language examples", () => {
      const help = getHelpText();
      expect(help).toContain("Natural Language");
      expect(help).toContain("Trim");
      expect(help).toContain("fade");
    });
  });

  describe("getPrompt", () => {
    it("shows basic prompt without project", () => {
      const prompt = getPrompt();
      expect(prompt).toContain("vibe");
      expect(prompt).toContain(">");
    });

    it("shows project name in prompt", () => {
      const prompt = getPrompt("My Project");
      expect(prompt).toContain("vibe");
      expect(prompt).toContain("My Project");
      expect(prompt).toContain(">");
    });
  });

  describe("formatDuration", () => {
    it("formats seconds only", () => {
      expect(formatDuration(5.5)).toBe("5.50s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(65.25)).toBe("1:05.25");
    });

    it("formats hours", () => {
      expect(formatDuration(3661)).toBe("1:01:01");
    });
  });

  describe("formatProjectInfo", () => {
    it("formats project summary", () => {
      const summary = {
        name: "Test Project",
        duration: 120,
        aspectRatio: "16:9",
        frameRate: 30,
        trackCount: 2,
        clipCount: 5,
        sourceCount: 3,
      };

      const formatted = formatProjectInfo(summary);
      expect(formatted).toContain("Test Project");
      expect(formatted).toContain("16:9");
      expect(formatted).toContain("30 fps");
      expect(formatted).toContain("2");
      expect(formatted).toContain("5");
      expect(formatted).toContain("3");
    });

    it("shows unsaved status", () => {
      const summary = {
        name: "Test",
        duration: 0,
        aspectRatio: "16:9",
        frameRate: 30,
        trackCount: 2,
        clipCount: 0,
        sourceCount: 0,
      };

      const formatted = formatProjectInfo(summary);
      expect(formatted).toContain("unsaved");
    });

    it("shows file path when saved", () => {
      const summary = {
        name: "Test",
        duration: 0,
        aspectRatio: "16:9",
        frameRate: 30,
        trackCount: 2,
        clipCount: 0,
        sourceCount: 0,
        filePath: "/path/to/project.vibe.json",
      };

      const formatted = formatProjectInfo(summary);
      expect(formatted).toContain("/path/to/project.vibe.json");
    });
  });

  describe("message helpers", () => {
    it("formats success message", () => {
      expect(success("Done")).toContain("Done");
    });

    it("formats error message", () => {
      expect(error("Failed")).toContain("Failed");
    });

    it("formats warning message", () => {
      expect(warn("Careful")).toContain("Careful");
    });

    it("formats info message", () => {
      expect(info("Note")).toContain("Note");
    });
  });
});

describe("REPL Session", () => {
  let session: Session;

  beforeEach(async () => {
    session = new Session();
    await session.initialize();
  });

  describe("hasProject", () => {
    it("returns false initially", () => {
      expect(session.hasProject()).toBe(false);
    });

    it("returns true after creating project", () => {
      session.createProject("Test");
      expect(session.hasProject()).toBe(true);
    });
  });

  describe("createProject", () => {
    it("creates a new project", () => {
      const project = session.createProject("My Project");
      expect(project).toBeDefined();
      expect(session.getProjectName()).toBe("My Project");
    });

    it("replaces existing project", () => {
      session.createProject("First");
      session.createProject("Second");
      expect(session.getProjectName()).toBe("Second");
    });
  });

  describe("getProject", () => {
    it("throws when no project loaded", () => {
      expect(() => session.getProject()).toThrow();
    });

    it("returns project when loaded", () => {
      session.createProject("Test");
      expect(session.getProject()).toBeDefined();
    });
  });

  describe("getProjectOrNull", () => {
    it("returns null when no project", () => {
      expect(session.getProjectOrNull()).toBeNull();
    });

    it("returns project when loaded", () => {
      session.createProject("Test");
      expect(session.getProjectOrNull()).not.toBeNull();
    });
  });

  describe("undo", () => {
    it("returns null when nothing to undo", () => {
      session.createProject("Test");
      expect(session.undo()).toBeNull();
    });

    it("can undo changes", () => {
      session.createProject("Test");
      const project = session.getProject();

      // Make a change
      session.pushHistory("add source");
      project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/test.mp4",
        duration: 10,
      });

      expect(project.getSources().length).toBe(1);

      // Undo - note: this only reverts session state, not project modifications
      // In real usage, the state snapshot would restore the project
      const undone = session.undo();
      expect(undone).toBe("add source");
    });
  });

  describe("canUndo", () => {
    it("returns false when nothing to undo", () => {
      session.createProject("Test");
      expect(session.canUndo()).toBe(false);
    });

    it("returns true after pushing history", () => {
      session.createProject("Test");
      session.pushHistory("test action");
      expect(session.canUndo()).toBe(true);
    });
  });

  describe("getProjectSummary", () => {
    it("returns null when no project", () => {
      expect(session.getProjectSummary()).toBeNull();
    });

    it("returns summary when project exists", () => {
      session.createProject("Test Project");
      const summary = session.getProjectSummary();

      expect(summary).not.toBeNull();
      expect(summary?.name).toBe("Test Project");
      expect(summary?.trackCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("checkMediaExists", () => {
    it("returns exists: false for non-existent file", () => {
      const result = session.checkMediaExists("/nonexistent/file.mp4");
      expect(result.exists).toBe(false);
    });
  });
});

describe("REPL Executor", () => {
  let session: Session;

  beforeEach(async () => {
    session = new Session();
    await session.initialize();
  });

  describe("empty input", () => {
    it("handles empty input", async () => {
      const result = await executeReplCommand("", session);
      expect(result.success).toBe(true);
      expect(result.message).toBe("");
    });
  });

  describe("exit command", () => {
    it("handles exit", async () => {
      const result = await executeReplCommand("exit", session);
      expect(result.success).toBe(true);
      expect(result.shouldExit).toBe(true);
    });

    it("handles quit", async () => {
      const result = await executeReplCommand("quit", session);
      expect(result.shouldExit).toBe(true);
    });

    it("handles q", async () => {
      const result = await executeReplCommand("q", session);
      expect(result.shouldExit).toBe(true);
    });
  });

  describe("help command", () => {
    it("shows help", async () => {
      const result = await executeReplCommand("help", session);
      expect(result.success).toBe(true);
      expect(result.message).toContain("new <name>");
      expect(result.message).toContain("exit");
    });
  });

  describe("new command", () => {
    it("creates new project", async () => {
      const result = await executeReplCommand("new My Project", session);
      expect(result.success).toBe(true);
      expect(result.message).toContain("My Project");
      expect(session.hasProject()).toBe(true);
    });

    it("uses default name if none provided", async () => {
      const result = await executeReplCommand("new", session);
      expect(result.success).toBe(true);
      expect(session.getProjectName()).toBe("Untitled Project");
    });
  });

  describe("info command", () => {
    it("fails without project", async () => {
      const result = await executeReplCommand("info", session);
      expect(result.success).toBe(false);
    });

    it("shows project info", async () => {
      session.createProject("Test");
      const result = await executeReplCommand("info", session);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Test");
    });
  });

  describe("list command", () => {
    it("fails without project", async () => {
      const result = await executeReplCommand("list", session);
      expect(result.success).toBe(false);
    });

    it("shows timeline", async () => {
      session.createProject("Test");
      const result = await executeReplCommand("list", session);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Timeline");
    });
  });

  describe("undo command", () => {
    it("warns when nothing to undo", async () => {
      session.createProject("Test");
      const result = await executeReplCommand("undo", session);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Nothing to undo");
    });
  });

  describe("setup command", () => {
    it("triggers setup wizard", async () => {
      const result = await executeReplCommand("setup", session);
      expect(result.showSetup).toBe(true);
    });
  });

  describe("add command", () => {
    it("fails without project", async () => {
      const result = await executeReplCommand("add test.mp4", session);
      expect(result.success).toBe(false);
    });

    it("fails without arguments", async () => {
      session.createProject("Test");
      const result = await executeReplCommand("add", session);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Usage");
    });

    it("fails for non-existent file", async () => {
      session.createProject("Test");
      const result = await executeReplCommand("add /nonexistent/file.mp4", session);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  describe("save command", () => {
    it("fails without project", async () => {
      const result = await executeReplCommand("save", session);
      expect(result.success).toBe(false);
    });
  });

  describe("export command", () => {
    it("fails without project", async () => {
      const result = await executeReplCommand("export", session);
      expect(result.success).toBe(false);
    });

    it("shows export command info", async () => {
      session.createProject("Test");
      const result = await executeReplCommand("export", session);
      expect(result.success).toBe(true);
      expect(result.message).toContain("vibe export");
    });
  });

  describe("unknown command", () => {
    it("returns error for unknown builtin", async () => {
      // This tests a command that looks like a builtin but isn't
      // Since most inputs go to AI, we need to check edge cases
    });
  });
});
