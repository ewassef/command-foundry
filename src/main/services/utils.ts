import { randomUUID } from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(): string {
  return randomUUID();
}

export function summarizeText(text: string, maxLength = 140): string {
  const condensed = text.replace(/\s+/g, " ").trim();
  if (condensed.length <= maxLength) {
    return condensed;
  }

  return `${condensed.slice(0, maxLength - 1)}…`;
}
