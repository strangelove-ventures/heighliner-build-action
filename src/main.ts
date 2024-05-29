import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { buildImage, getBuildOptions, getChainSpecInputs } from "./build";
import { installAndCache } from "./install";
import path from "path";
import waitPort from "wait-port";

async function run(): Promise<void> {
  const githubToken = core.getInput("github-token");
  const buildOpts = getBuildOptions();
  const chainSpec = getChainSpecInputs();

  const [_, binPathBuildkit] = await Promise.all([
    installAndCache({
      name: "heighliner",
      owner: core.getInput("heighliner-owner"),
      repo: core.getInput("heighliner-repo"),
      tag: core.getInput("heighliner-tag"),
      tarSubDir: "",
      githubToken,
    }),
    installAndCache({
      name: "buildkit",
      owner: "moby",
      repo: "buildkit",
      tag: core.getInput("buildkit-tag"),
      tarSubDir: "bin",
      githubToken,
    }),
  ]);

  exec.exec("sudo", [
    path.join(binPathBuildkit, "buildkitd"),
    "--allow-insecure-entitlement",
    "network.host",
    "--addr",
    "tcp://127.0.0.1:8125",
  ]);

  // wait for buildkit to be booted
  await waitPort({ host: "127.0.0.1", port: 8125, timeout: 10000 });

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

  process.exit(0);
}

run();
