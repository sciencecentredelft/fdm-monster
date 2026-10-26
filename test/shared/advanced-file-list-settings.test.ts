import { getDefaultSettings } from "@/constants/server-settings.constants";
import { migrateSettingsRuntime } from "@/shared/runtime-settings.migration";

describe("advanced file list settings migration", () => {
  it("defaults an existing installation to the normal file list", () => {
    const settings = getDefaultSettings();
    delete settings.server.advancedFileListEnabled;
    delete settings.server.advancedFileListColumns;
    delete settings.server.printAssignmentEnabled;
    delete settings.server.showPrintAssigneeOnGrid;
    delete settings.server.checkPrinterStatusBeforePrint;
    delete settings.server.gridStatusColorsEnabled;
    delete settings.server.gridStatusColors;
    delete settings.server.floorGridLockEnabled;
    expect(migrateSettingsRuntime(settings).server.advancedFileListEnabled).toBe(false);
    expect(settings.server.advancedFileListColumns).toEqual({ size: true, startedAt: true });
    expect(settings.server.printAssignmentEnabled).toBe(false);
    expect(settings.server.showPrintAssigneeOnGrid).toBe(false);
    expect(settings.server.checkPrinterStatusBeforePrint).toBe(false);
    expect(settings.server.gridStatusColorsEnabled).toBe(false);
    expect(settings.server.floorGridLockEnabled).toBe(false);
    expect(settings.server.gridStatusColors?.ready).toBe("#2E7D32");
  });

  it("preserves an enabled status check independently of assignment", () => {
    const settings = getDefaultSettings();
    settings.server.checkPrinterStatusBeforePrint = true;
    expect(migrateSettingsRuntime(settings).server.checkPrinterStatusBeforePrint).toBe(true);
    expect(settings.server.printAssignmentEnabled).toBe(false);
  });

  it("preserves custom grid colours and the disabled toggle", () => {
    const settings = getDefaultSettings();
    settings.server.gridStatusColors!.printing = "#123456";
    expect(migrateSettingsRuntime(settings).server.gridStatusColors?.printing).toBe("#123456");
    expect(settings.server.gridStatusColorsEnabled).toBe(false);
  });

  it("preserves an explicitly enabled advanced file list", () => {
    const settings = getDefaultSettings();
    settings.server.advancedFileListEnabled = true;
    settings.server.advancedFileListColumns = { size: false, startedAt: false };
    expect(migrateSettingsRuntime(settings).server.advancedFileListEnabled).toBe(true);
    expect(settings.server.advancedFileListColumns).toEqual({ size: false, startedAt: false });
  });
});
