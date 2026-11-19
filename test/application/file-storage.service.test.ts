import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoggerFactory } from "@/handlers/logger-factory";
import { AppConstants } from "@/server.constants";
import { FileStorageService } from "@/services/file-storage.service";
import type { TypeormService } from "@/services/typeorm/typeorm.service";

vi.mock(import("node:fs/promises"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe(FileStorageService.name, () => {
  const content = "G28\nG1 X10 Y10\n";
  let sandbox: string;
  let upload: Express.Multer.File;
  let storage: FileStorageService;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "fdm-storage-test-"));
    vi.stubEnv(AppConstants.MEDIA_PATH, join(sandbox, "media"));
    const typeorm = { getDataSource: () => ({ getRepository: vi.fn() }) } as TypeormService;
    storage = new FileStorageService(LoggerFactory(), typeorm);
    await storage.ensureStorageDirectories();
    upload = { path: join(sandbox, "upload"), originalname: "part.gcode" } as Express.Multer.File;
    await writeFile(upload.path, content);
  });

  afterEach(async () => {
    vi.mocked(rename).mockReset();
    vi.unstubAllEnvs();
    await rm(sandbox, { recursive: true, force: true });
  });

  it("stores the complete file across filesystems and removes the temporary source", async () => {
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("cross-device link"), { code: "EXDEV" }));
    const id = await storage.saveFile(upload);
    const stored = storage.getFilePath(id);
    expect(await readFile(stored, "utf8")).toBe(content);
    await expect(readFile(upload.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(dirname(stored))).toEqual([`${id}.gcode`]);
  });

  it("preserves the source and an existing destination if publishing the staged file fails", async () => {
    const id = await storage.saveFile(upload, "hash");
    const stored = storage.getFilePath(id);
    await writeFile(upload.path, "replacement");
    vi.mocked(rename)
      .mockRejectedValueOnce(Object.assign(new Error("cross-device link"), { code: "EXDEV" }))
      .mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));

    await expect(storage.saveFile(upload, "hash")).rejects.toMatchObject({ code: "EACCES" });
    expect(await readFile(upload.path, "utf8")).toBe("replacement");
    expect(await readFile(stored, "utf8")).toBe(content);
    expect(await readdir(dirname(stored))).toEqual([`${id}.gcode`]);
  });
});
