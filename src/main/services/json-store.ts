import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonStore<T> {
  constructor(private readonly filePath: string, private readonly seed: () => T) {}

  async read(): Promise<T> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as T;
    } catch {
      const initial = this.seed();
      await this.write(initial);
      return initial;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(value, null, 2), "utf8");
  }
}
