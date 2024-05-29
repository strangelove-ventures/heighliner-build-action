import * as core from "@actions/core";
import * as github from "@actions/github";
import * as tc from "@actions/tool-cache";
import os from "os";
import path from "path";

// A friendly alias since the function returns an anonymous type
type Octokit = ReturnType<typeof github.getOctokit>;

interface GitRelease {
  owner: string;
  repo: string;
  tag: string;
}

export type InstallOptions = GitRelease & {
  name: string;
  githubToken: string;
  tarSubDir: string;
};

function findAsset<T extends { name: string }>(
  assets: T[],
  arch: string,
  platform: string,
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
      input.match(new RegExp(platform)) !== null &&
      input.endsWith(".tar.gz")
    );
  }
  return assets.find((asset) => match(asset.name));
}

async function getReleaseMetadata(octokit: Octokit, release: GitRelease) {
  const { owner, repo, tag } = release;

  if (!!tag) {
    core.info(`Fetching github.com/${owner}/${repo} release for tag ${tag}`);
    return octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag,
    });
  } else {
    core.info(`Fetching github.com/${owner}/${repo} latest release`);
    return octokit.rest.repos.getLatestRelease({ owner, repo });
  }
}

async function installRelease(
  name: string,
  url: string,
  version: string,
  arch: string,
  subdir: string,
): Promise<string> {
  const downloadPath = await tc.downloadTool(url);
  const extractedFolder = await tc.extractTar(downloadPath);
  core.info(`Caching ${name} ${version} ${arch}`);
  const cachedPath = await tc.cacheDir(extractedFolder, name, version, arch);

  const binPath = path.join(cachedPath, subdir);
  core.addPath(binPath);
  return binPath;
}

export async function installAndCache(opts: InstallOptions): Promise<string> {
  const octokit = github.getOctokit(opts.githubToken);
  const arch = os.arch();
  const platform = os.platform();
  const releaseMetadata = await getReleaseMetadata(octokit, opts);
  const tag = releaseMetadata.data.tag_name;

  const cachedPath = tc.find(opts.name, tag, arch);
  if (cachedPath !== "") {
    core.info(`Found ${opts.name} ${tag} ${arch} in cache`);
    const binPath = path.join(cachedPath, opts.tarSubDir);
    core.addPath(binPath);
    return binPath;
  }

  core.info(`Found release ${tag} ${arch}`);
  const asset = findAsset(releaseMetadata.data.assets, arch, platform);
  if (asset === undefined) {
    const err = new Error("Viable release asset not found");
    core.setFailed(err);
    throw err;
  }

  core.info(`Downloading asset ${asset.name}`);
  return await installRelease(
    opts.name,
    asset.browser_download_url,
    tag,
    arch,
    opts.tarSubDir,
  );
}
