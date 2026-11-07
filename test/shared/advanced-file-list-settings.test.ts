import { getDefaultSettings } from "@/constants/server-settings.constants";
import { migrateSettingsRuntime } from "@/shared/runtime-settings.migration";

describe("advanced file list settings migration", () => {
  it("adds directory pagination and name defaults without changing a saved integration", () => {
    const settings = getDefaultSettings();
    const config = settings.server.userDirectoryApi!;
    config.endpoint = "https://directory.example/users";
    config.namePath = "profile.full_name";
    for (const key of [
      "paginationEnabled",
      "pageNumberParameter",
      "pageSizeParameter",
      "pageSize",
      "countPath",
      "pageNumberPath",
      "pageSizePath",
      "combineNames",
      "firstNamePath",
      "lastNamePath",
    ]) {
      Reflect.deleteProperty(config, key);
    }
    const migrated = migrateSettingsRuntime(settings).server.userDirectoryApi!;
    expect(migrated).toMatchObject({
      endpoint: "https://directory.example/users",
      namePath: "profile.full_name",
      paginationEnabled: false,
      combineNames: false,
      pageSize: 50,
      countPath: "count",
      pageNumberPath: "page_number",
      pageSizePath: "page_size",
      firstNamePath: "first_name",
      lastNamePath: "last_name",
    });
  });

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
    delete settings.server.floorGridIdleTimeoutMinutes;
    expect(migrateSettingsRuntime(settings).server.advancedFileListEnabled).toBe(false);
    expect(settings.server.advancedFileListColumns).toEqual({ size: true, startedAt: true });
    expect(settings.server.printAssignmentEnabled).toBe(false);
    expect(settings.server.showPrintAssigneeOnGrid).toBe(false);
    expect(settings.server.checkPrinterStatusBeforePrint).toBe(false);
    expect(settings.server.gridStatusColorsEnabled).toBe(false);
    expect(settings.server.floorGridLockEnabled).toBe(false);
    expect(settings.server.floorGridIdleTimeoutMinutes).toBe(0);
    expect(settings.server.gridStatusColors?.ready).toBe("#2E7D32");
  });

  it("preserves the grid inactivity timeout even with floor grid locks disabled", () => {
    const settings = getDefaultSettings();
    settings.server.floorGridIdleTimeoutMinutes = 1;
    expect(migrateSettingsRuntime(settings).server.floorGridIdleTimeoutMinutes).toBe(1);
    expect(settings.server.floorGridLockEnabled).toBe(false);
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
