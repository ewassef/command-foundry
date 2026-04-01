import type { VersionManifest } from "./types";

export const versionManifest: VersionManifest = {
  ghVersion: "2.88.1",
  copilotCompatibility: "gh copilot preview as shipped with GitHub CLI 2.88.1",
  supportedPlatforms: [
    {
      platform: "win32",
      arch: "x64",
      archiveExtension: "zip",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.88.1/gh_2.88.1_windows_amd64.zip",
      binaryRelativePath: "gh_2.88.1_windows_amd64/bin/gh.exe"
    },
    {
      platform: "darwin",
      arch: "arm64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.88.1/gh_2.88.1_macOS_arm64.tar.gz",
      binaryRelativePath: "gh_2.88.1_macOS_arm64/bin/gh"
    },
    {
      platform: "darwin",
      arch: "x64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.88.1/gh_2.88.1_macOS_amd64.tar.gz",
      binaryRelativePath: "gh_2.88.1_macOS_amd64/bin/gh"
    },
    {
      platform: "linux",
      arch: "x64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.88.1/gh_2.88.1_linux_amd64.tar.gz",
      binaryRelativePath: "gh_2.88.1_linux_amd64/bin/gh"
    },
    {
      platform: "linux",
      arch: "arm64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.88.1/gh_2.88.1_linux_arm64.tar.gz",
      binaryRelativePath: "gh_2.88.1_linux_arm64/bin/gh"
    }
  ]
};
