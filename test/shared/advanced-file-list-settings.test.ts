import { getDefaultSettings } from "@/constants/server-settings.constants";
import { migrateSettingsRuntime } from "@/shared/runtime-settings.migration";

describe("advanced file list settings migration", () => {
  it("defaults an existing installation to the normal file list", () => {
    const settings = getDefaultSettings();
    delete settings.server.advancedFileListEnabled;
    delete settings.server.advancedFileListColumns;
    expect(migrateSettingsRuntime(settings).server.advancedFileListEnabled).toBe(false);
    expect(settings.server.advancedFileListColumns).toEqual({ size: true, startedAt: true });
  });

  it("preserves an explicitly enabled advanced file list", () => {
    const settings = getDefaultSettings();
    settings.server.advancedFileListEnabled = true;
    settings.server.advancedFileListColumns = { size: false, startedAt: false };
    expect(migrateSettingsRuntime(settings).server.advancedFileListEnabled).toBe(true);
    expect(settings.server.advancedFileListColumns).toEqual({ size: false, startedAt: false });
  });
});
