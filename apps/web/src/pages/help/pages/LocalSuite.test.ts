import { describe, expect, it } from "vitest";
import { assetMatchesPlatform, findDownloadAsset } from "./localSuiteDownloads";

describe("Local Suite release assets", () => {
  it("maps native package extensions to the right operating system", () => {
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_x64-setup.exe", "windows-x64"),
    ).toBe(true);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_x64.msi", "windows-x64"),
    ).toBe(true);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_aarch64.dmg", "darwin-arm64"),
    ).toBe(true);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_x64.dmg", "darwin-x64"),
    ).toBe(true);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_amd64.AppImage", "linux-x64"),
    ).toBe(true);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_amd64.deb", "linux-x64"),
    ).toBe(true);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_amd64.rpm", "linux-x64"),
    ).toBe(true);
  });

  it("does not offer an artifact under the wrong operating system", () => {
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_aarch64.dmg", "windows-x64"),
    ).toBe(false);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_x64-setup.exe", "linux-x64"),
    ).toBe(false);
    expect(assetMatchesPlatform("checksums.txt", "darwin-arm64")).toBe(false);
    expect(
      assetMatchesPlatform("Local.Runtime_0.1.5_aarch64.dmg", "darwin-x64"),
    ).toBe(false);
  });

  it("chooses a deterministic package when a platform has several formats", () => {
    const assets = [
      { name: "Local.Runtime_0.1.5_amd64.rpm", browser_download_url: "rpm" },
      { name: "Local.Runtime_0.1.5_amd64.deb", browser_download_url: "deb" },
      {
        name: "Local.Runtime_0.1.5_amd64.AppImage",
        browser_download_url: "appimage",
      },
    ];

    expect(findDownloadAsset(assets, "linux-x64")?.browser_download_url).toBe(
      "appimage",
    );
  });
});
