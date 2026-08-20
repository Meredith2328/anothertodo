import { mkdir, open, rename, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { basename, dirname, join } from "node:path";

import lockfile from "proper-lockfile";

export const atomicWriteText = async (path: string, text: string): Promise<void> => {
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(tempPath, path); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== "EPERM" && code !== "EBUSY") || attempt >= 8) throw error;
        await delay(10 * (attempt + 1));
      }
    }
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
  }
};

export const withDataLock = async <T>(dir: string, fn: () => Promise<T>): Promise<T> => {
  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(dir, { lockfilePath: join(dir, ".lock"), retries: { retries: 5, minTimeout: 20, maxTimeout: 200 } });
  try { return await fn(); }
  finally { await release(); }
};
