import * as core from "@actions/core";
import * as exec from "@actions/exec";
import YAML from "yaml";
import fs from "fs/promises";
import path from "path";

export async function heighliner(
  args?: string[],
  opts?: exec.ExecOptions
): Promise<exec.ExecOutput> {
  return exec.getExecOutput("heighliner", args, opts);
}

const buildKeysString = [
  "chain",
  "chains-spec-file",
  "tag",
  "github-organization",
  "github-repo",
  "clone-key",
  "registry",
  "platform",
  "buildkit-address",
  "git-ref",
  "tar-export-path",
  "additional-args",
] as const;

const buildKeysBoolean = ["local", "buildkit", "skip"] as const;

type BuildOptionsString = {
  [K in (typeof buildKeysString)[number]]?: string;
};

type BuildOptionsBoolean = {
  [K in (typeof buildKeysBoolean)[number]]?: boolean;
};

type BuildOptions = BuildOptionsString & BuildOptionsBoolean;

export function getBuildOptions(): BuildOptions {
  const stringOptions = buildKeysString.reduce((opts, key) => {
    const input = core.getInput(key);
    if (input !== "") {
      opts[key] = core.getInput(key);
    }
    return opts;
  }, {} as BuildOptionsString);
  const booleanOptions = buildKeysBoolean.reduce((opts, key) => {
    opts[key] = core.getBooleanInput(key);
    return opts;
  }, {} as BuildOptionsBoolean);

  return {
    ...stringOptions,
    ...booleanOptions,
  };
}

const chainSpecKeys = [
  "repo-host",
  "dockerfile",
  "build-env",
  "pre-build",
  "build-target",
  "binaries",
  "libraries",
  "build-dir",
] as const;

type ChainSpecInput = {
  [K in (typeof chainSpecKeys)[number]]?: string;
};

type ChainSpec = ChainSpecInput & { name: string };

type YAMLReadyChainSpec = Omit<
  ChainSpec,
  "build-env" | "binaries" | "libraries"
> & {
  "build-env": string[];
  libraries: string[];
  binaries: string[];
};

function prepareChainSpecForYAMLSerialization(
  spec: ChainSpec
): YAMLReadyChainSpec {
  return {
    ...spec,
    "build-env": spec["build-env"] && YAML.parse(spec["build-env"]),
    libraries: spec.libraries && YAML.parse(spec.libraries),
    binaries: spec.binaries && YAML.parse(spec.binaries),
  };
}

function buildOptionsToArguments(opts: BuildOptions): string[] {
  let args = ["build"];

  if (opts.chain !== undefined) {
    args = [...args, "--chain", opts.chain];
  }

  if (opts["chains-spec-file"] !== undefined) {
    args = [...args, "--file", opts["chains-spec-file"]];
  }

  if (opts.local) {
    args = [...args, "--local"];
  }

  if (opts["github-organization"] !== undefined) {
    args = [...args, "--org", opts["github-organization"]];
  }

  if (opts["github-repo"] !== undefined) {
    args = [...args, "--repo", opts["github-repo"]];
  }

  if (opts.registry !== undefined) {
    args = [...args, "--registry", opts.registry];
  }

  if (opts["git-ref"] !== undefined) {
    args = [...args, "--git-ref", opts["git-ref"]];
  }

  if (opts["clone-key"] !== undefined) {
    args = [...args, "--clone-key", opts["clone-key"]];
  }

  if (opts.tag !== undefined) {
    args = [...args, "--tag", opts.tag];
  }

  if (opts.buildkit) {
    args = [...args, "--use-buildkit"];
  }

  if (opts.skip) {
    args = [...args, "--skip"];
  }

  if (opts["tar-export-path"] !== undefined) {
    args = [...args, "--tar-export-path", opts["tar-export-path"]];
  }

  if (opts.platform !== undefined) {
    args = [...args, "--platform", opts.platform];
  }

  if (opts["buildkit-address"] !== undefined) {
    args = [...args, "--buildkit-addr", opts["buildkit-address"]];
  }

  if (opts["additional-args"] !== undefined) {
    args = [...args, ...opts["additional-args"].split(" ")];
  }

  return args;
}

export function getChainSpecInputs(): ChainSpec | undefined {
  const spec = chainSpecKeys.reduce((spec, key) => {
    const value = core.getInput(key);
    if (value !== "") {
      spec[key] = value;
    }
    return spec;
  }, {} as ChainSpec);

  if (Object.keys(spec).length > 0) {
    // We alias chain to name
    spec.name = core.getInput("chain");
    return spec;
  }

  return;
}

interface ImageMetadata {
  Id: string;
  RepoDigests: string[];
}

async function getImageMetadata(
  imageId: string
): Promise<[ImageMetadata, string]> {
  const inspectOutput = await exec.getExecOutput("docker", [
    "inspect",
    imageId,
  ]);
  const inspectJSON = inspectOutput.stdout;
  const metadata = JSON.parse(inspectJSON) as ImageMetadata[];

  if (metadata.length < 1) {
    throw new Error(
      "Expected docker metadata to include at least one result, got none."
    );
  }

  return [metadata[0], inspectJSON];
}

interface BuildOutput {
  imageid: string;
  digest?: string;
  metadata: string;
  tag: string;
}

export async function buildImage(
  opts: BuildOptions,
  spec?: ChainSpec
): Promise<BuildOutput> {
  // If a custom chain config is provided, override chains.yaml
  if (spec !== undefined) {
    const preparedSpec = prepareChainSpecForYAMLSerialization(spec);
    const specYAML = YAML.stringify([preparedSpec]);
    const mktempOutput = await exec.getExecOutput("mktemp", ["-d"]);
    const dir = mktempOutput.stdout.trim();
    const filepath = path.join(dir, "chains.yaml");
    await fs.writeFile(filepath, specYAML);
    opts["chains-spec-file"] = filepath;
  }

  const args = buildOptionsToArguments(opts);
  const buildOutput = await heighliner(args, {
    env: { BUILDKIT_PROGRESS: "plain" },
  });
  const outputLines = buildOutput.stdout.split("\n");
  const matches = [];

  if (opts.buildkit) {
    const stderrLines = buildOutput.stderr.split("\n");

    for (const line of stderrLines) {
      const manifestMatch = line.match(/exporting manifest (\S+:\S+)/);
      if (manifestMatch != null) {
        matches.push(manifestMatch);
      }
    }

    for (const line of outputLines) {
      const tagMatch = line.match(/resulting docker image tags: \+\[(.*)?\]/);
      if (tagMatch != null) {
        matches.push(tagMatch);
      }
    }
  } else {
    for (const line of outputLines) {
      const match = line.match(/Successfully (tagged|built) (\S+)/);
      if (match != null) matches.push(match);
    }
  }

  if (opts.buildkit) {
    if (matches.length < 2) {
      const err = new Error(
        `Couldn't find buildkit necessary info, matches: ${matches}`
      );
      core.setFailed(err);
      throw err;
    }
    let imageid = "";
    const tags = [];
    for (const match of matches) {
      if (match[0].startsWith("exporting manifest")) {
        imageid = match[1];
      } else if (match[0].startsWith("resulting docker image tags")) {
        tags.push(...match[1].split(" "));
      }
    }

    const digest = `${opts.registry}/${opts.chain}@${imageid}`;
    return {
      imageid,
      tag: tags.length > 0 ? tags[0].split(":").pop() ?? "" : "",
      digest,
      metadata: JSON.stringify([
        { Id: imageid, RepoDigests: [digest], RepoTags: tags },
      ]),
    };
  }

  const imageIdMatch = matches.find((match) => match[1] === "built");
  if (imageIdMatch === undefined) {
    const err = new Error("Couldn't find imageid");
    core.setFailed(err);
    throw err;
  }
  const shortId = imageIdMatch[2];
  const tagMatch = matches.find((match) => match[1] === "tagged");
  if (tagMatch === undefined) {
    const err = new Error("Couldn't find tag");
    core.setFailed(err);
    throw err;
  }

  const [parsedMetadata, metadata] = await getImageMetadata(shortId);

  return {
    imageid: parsedMetadata.Id,
    digest: parsedMetadata.RepoDigests[0],
    metadata,
    tag: tagMatch[2],
  };
}
