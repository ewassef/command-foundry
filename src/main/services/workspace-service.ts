import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FileTreeNode, WorkspaceSnapshot } from "@shared/types";

const IGNORED_NAMES = new Set([".git", "node_modules", "dist", "release", ".next", ".turbo"]);
const MAX_DEPTH = 3;
const MAX_CHILDREN = 40;

export class WorkspaceService {
  async loadWorkspace(rootPath: string): Promise<WorkspaceSnapshot> {
    return {
      rootPath,
      tree: await this.readDirectory(rootPath, 0)
    };
  }

  private async readDirectory(directoryPath: string, depth: number): Promise<FileTreeNode[]> {
    if (depth >= MAX_DEPTH) {
      return [];
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    const sorted = entries
      .filter((entry) => !IGNORED_NAMES.has(entry.name))
      .sort((left, right) => {
        if (left.isDirectory() && !right.isDirectory()) {
          return -1;
        }
        if (!left.isDirectory() && right.isDirectory()) {
          return 1;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, MAX_CHILDREN);

    return Promise.all(
      sorted.map(async (entry) => {
        const fullPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          return {
            id: fullPath,
            name: entry.name,
            path: fullPath,
            type: "directory" as const,
            children: await this.readDirectory(fullPath, depth + 1)
          };
        }

        return {
          id: fullPath,
          name: entry.name,
          path: fullPath,
          type: "file" as const
        };
      })
    );
  }

  summarize(rootPath?: string): string {
    return rootPath ? basename(rootPath) : "No workspace selected";
  }
}
