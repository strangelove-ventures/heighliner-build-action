import * as core from "@actions/core";
import { buildImage, getBuildOptions, getChainSpecInputs } from "./build";
import { installAndCacheHeighliner } from "./install";

async function run(): Promise<void> {
  const githubToken = core.getInput("github-token");
  const owner = core.getInput("heighliner-owner");
  const repo = core.getInput("heighliner-repo");
  const tag = core.getInput("heighliner-tag");
  const buildOpts = getBuildOptions();
  const chainSpec = getChainSpecInputs();

  await installAndCacheHeighliner({
    githubToken,
    owner,
    repo,
    tag,
  });

  await buildImage(buildOpts, chainSpec);
}

run();
