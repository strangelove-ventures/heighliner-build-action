import * as core from "@actions/core";
import * as github from "@actions/github";
import * as tc from "@actions/tool-cache";
import os from "os";

// A friendly alias since the function returns an anonymous type
type Octokit = ReturnType<typeof github.getOctokit>;

interface GitRelease {
  owner: string;
  repo: string;
  tag: string;
}

export type InstallOptions = GitRelease & {
  githubToken: string;
};

function findAsset<T extends { name: string }>(
  assets: T[],
  arch: string,
  platform: string
): T | undefined {
  function match(input: string): boolean {
    switch (arch) {
      case "x86":
        arch = "386";
        break;
      case "x64":
        arch = "amd64";
    }
    return (
      input.match(new RegExp(arch)) !== null &&
      input.match(new RegExp(platform)) !== null
    );
  }
  return assets.find((asset) => match(asset.name));
}

async function getReleaseMetadata(octokit: Octokit, release: GitRelease) {
  const { owner, repo, tag } = release;

  if (!!tag) {
    core.info(`Fetching release for tag ${tag}`);
    return octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag,
    });
  } else {
    core.info("Fetching latest release");
    return octokit.rest.repos.getLatestRelease({ owner, repo });
  }
}

async function installRelease(
  url: string,
  version: string,
  arch: string
): Promise<void> {
  const downloadPath = await tc.downloadTool(url);
  const extractedFolder = await tc.extractTar(downloadPath);
  core.info(`Caching heighliner ${version} ${arch}`);
  const cachedPath = await tc.cacheDir(
    extractedFolder,
    "heighliner",
    version,
    arch
  );
  core.addPath(cachedPath);
}

export async function installAndCacheHeighliner(opts: InstallOptions) {
  const octokit = github.getOctokit(opts.githubToken);
  const arch = os.arch();
  const platform = os.platform();
  const releaseMetadata = await getReleaseMetadata(octokit, opts);
  const tag = releaseMetadata.data.tag_name;

  const cachedPath = tc.find("heighliner", tag, arch);
  if (cachedPath !== "") {
    core.info(`Found heighliner ${tag} ${arch} in cache`);
    core.addPath(cachedPath);
  } else {
    core.info(`Found release ${tag} ${arch}`);
    const asset = findAsset(releaseMetadata.data.assets, arch, platform);
    if (asset === undefined) {
      const err = new Error("Viable release asset not found");
      core.setFailed(err);
      throw err;
    }

    core.info(`Downloading asset ${asset.name}`);
    await installRelease(asset.browser_download_url, tag, arch);
  }
}
