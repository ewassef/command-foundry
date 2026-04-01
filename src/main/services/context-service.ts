import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { ContextAttachment, UserFacingError } from "@shared/types";

const MAX_FILE_BYTES = 256 * 1024;
const SUPPORTED_FILE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yml",
  ".yaml",
  ".cs",
  ".py",
  ".html",
  ".css"
]);

export class ContextService {
  async buildContextBlock(attachments: ContextAttachment[]): Promise<string> {
    const parts = await Promise.all(
      attachments
        .filter((attachment) => attachment.included)
        .map(async (attachment) => {
          if (attachment.type === "machine-fact") {
            return `Machine fact: ${attachment.label}: ${attachment.value}`;
          }

          if (attachment.type === "folder") {
            return `Workspace folder: ${attachment.value}`;
          }

          const fileStats = await stat(attachment.value);
          if (fileStats.size > MAX_FILE_BYTES) {
            throw this.unsupportedContext(
              `${basename(attachment.value)} is larger than the 256 KB file limit.`
            );
          }

          const extension = extname(attachment.value).toLowerCase();
          if (!SUPPORTED_FILE_EXTENSIONS.has(extension)) {
            throw this.unsupportedContext(
              `${basename(attachment.value)} is not a supported text/code file type.`
            );
          }

          const content = await readFile(attachment.value, "utf8");
          return `Attached file: ${attachment.value}\n${content}`;
        })
    );

    return parts.join("\n\n");
  }

  private unsupportedContext(message: string): UserFacingError {
    return {
      code: "UNSUPPORTED_CONTEXT",
      title: "Unsupported context",
      message,
      recoverable: true
    };
  }
}
