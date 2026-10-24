import type { VersionManifest } from "./types";

export const versionManifest: VersionManifest = {
  minimumGhVersion: "2.88.1",
  recommendedGhVersion: "2.103.2",
  supportedGhVersionRange: ">=2.88.1 <3.0.0",
  copilotCompatibility: "Validated against GitHub CLI 2.103.2 with support for 2.88.1 and newer 2.x releases.",
  supportedPlatforms: [
    {
      platform: "win32",
      arch: "x64",
      archiveExtension: "zip",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.103.2/gh_2.103.2_windows_amd64.zip",
      binaryRelativePath: "gh_2.103.2_windows_amd64/bin/gh.exe"
    },
    {
      platform: "darwin",
      arch: "arm64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.103.2/gh_2.103.2_macOS_arm64.tar.gz",
      binaryRelativePath: "gh_2.103.2_macOS_arm64/bin/gh"
    },
    {
      platform: "darwin",
      arch: "x64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.103.2/gh_2.103.2_macOS_amd64.tar.gz",
      binaryRelativePath: "gh_2.103.2_macOS_amd64/bin/gh"
    },
    {
      platform: "linux",
      arch: "x64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.103.2/gh_2.103.2_linux_amd64.tar.gz",
      binaryRelativePath: "gh_2.103.2_linux_amd64/bin/gh"
    },
    {
      platform: "linux",
      arch: "arm64",
      archiveExtension: "tar.gz",
      downloadUrl:
        "https://github.com/cli/cli/releases/download/v2.103.2/gh_2.103.2_linux_arm64.tar.gz",
      binaryRelativePath: "gh_2.103.2_linux_arm64/bin/gh"
    }
  ]
};
