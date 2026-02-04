/**
 * Filesystem Tools - List, read, write, and check files
 */

import { readFile, writeFile, readdir, stat, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";

// Tool Definitions
const listDef: ToolDefinition = {
  name: "fs_list",
  description: "List files and directories in a path",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path (default: current directory)",
      },
      pattern: {
        type: "string",
        description: "Filter pattern (e.g., *.mp4, *.json)",
      },
    },
    required: [],
  },
};

const readDef: ToolDefinition = {
  name: "fs_read",
  description: "Read contents of a text file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path to read",
      },
    },
    required: ["path"],
  },
};

const writeDef: ToolDefinition = {
  name: "fs_write",
  description: "Write content to a file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path to write",
      },
      content: {
        type: "string",
        description: "Content to write",
      },
    },
    required: ["path", "content"],
  },
};

const existsDef: ToolDefinition = {
  name: "fs_exists",
  description: "Check if a file or directory exists",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to check",
      },
    },
    required: ["path"],
  },
};

// Helper to match glob pattern
function matchPattern(filename: string, pattern: string): boolean {
  // Simple glob matching (* = any characters)
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
    "i"
  );
  return regex.test(filename);
}

// Format file size
function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(1)}${units[unit]}`;
}

// Tool Handlers
const list: ToolHandler = async (args, context): Promise<ToolResult> => {
  const dirPath = (args.path as string) || ".";
  const pattern = args.pattern as string | undefined;

  try {
    const absPath = resolve(context.workingDirectory, dirPath);
    const entries = await readdir(absPath, { withFileTypes: true });

    const results: string[] = [];
    for (const entry of entries) {
      // Filter by pattern if provided
      if (pattern && !matchPattern(entry.name, pattern)) {
        continue;
      }

      const fullPath = join(absPath, entry.name);
      const stats = await stat(fullPath);

      if (entry.isDirectory()) {
        results.push(`[DIR]  ${entry.name}/`);
      } else {
        results.push(`[FILE] ${entry.name} (${formatSize(stats.size)})`);
      }
    }

    if (results.length === 0) {
      return {
        toolCallId: "",
        success: true,
        output: pattern ? `No files matching "${pattern}" in ${dirPath}` : `Directory is empty: ${dirPath}`,
      };
    }

    return {
      toolCallId: "",
      success: true,
      output: `Contents of ${dirPath}:\n${results.join("\n")}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const read: ToolHandler = async (args, context): Promise<ToolResult> => {
  const filePath = args.path as string;

  try {
    const absPath = resolve(context.workingDirectory, filePath);
    const content = await readFile(absPath, "utf-8");

    // Truncate if too long
    const maxLength = 4000;
    const truncated = content.length > maxLength;
    const output = truncated
      ? content.substring(0, maxLength) + "\n... (truncated)"
      : content;

    return {
      toolCallId: "",
      success: true,
      output: `Contents of ${filePath}:\n${output}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const write: ToolHandler = async (args, context): Promise<ToolResult> => {
  const filePath = args.path as string;
  const content = args.content as string;

  try {
    const absPath = resolve(context.workingDirectory, filePath);
    await writeFile(absPath, content, "utf-8");

    return {
      toolCallId: "",
      success: true,
      output: `File written: ${filePath} (${formatSize(content.length)})`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const exists: ToolHandler = async (args, context): Promise<ToolResult> => {
  const filePath = args.path as string;

  try {
    const absPath = resolve(context.workingDirectory, filePath);
    await access(absPath);

    const stats = await stat(absPath);
    const type = stats.isDirectory() ? "directory" : "file";

    return {
      toolCallId: "",
      success: true,
      output: `${type} exists: ${filePath}`,
    };
  } catch {
    return {
      toolCallId: "",
      success: true,
      output: `Does not exist: ${filePath}`,
    };
  }
};

// Registration function
export function registerFilesystemTools(registry: ToolRegistry): void {
  registry.register(listDef, list);
  registry.register(readDef, read);
  registry.register(writeDef, write);
  registry.register(existsDef, exists);
}
