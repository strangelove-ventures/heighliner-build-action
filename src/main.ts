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

  const {
    imageid,
    metadata,
    digest,
    tag: outputTag,
  } = await buildImage(buildOpts, chainSpec);

  if (digest !== undefined) {
    core.setOutput("digest", digest);
  }

  core.setOutput("imageid", imageid);
  core.setOutput("metadata", metadata);
  core.setOutput("tag", outputTag);
}

run();
