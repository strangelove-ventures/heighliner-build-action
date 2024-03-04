# heighliner-build-action

A GitHub action for building docker images with [heighliner](https://github.com/strangelove-ventures/heighliner)

## Example: Publish images in CI

Build and push multi-architecture (linux/amd64 and linux/arm64) images to the repo's package (ghcr) when branches and tags are pushed.

`.github/workflows/docker-publish.yaml`

```yaml
name: Create and Push Docker Image

on:
  push:
    tags:
    - '**'
    branches:
    - '**'

jobs:
  build-and-push-image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v2

      - name: Log in to the Container registry
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: strangelove-ventures/heighliner-build-action@v1.0.0
        with:
          chain: noble
          dockerfile: cosmos
          build-target: make install
          binaries: |
            - /go/bin/nobled
```

## Example: multi-stage e2e testing 

Build a single docker image that will be shared across different test runners

`.github/workflows/e2e-testing.yaml`

```yaml
name: End to End Tests

on:
  pull_request:

env:
  TAR_PATH: heighliner.tar

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Docker image
        uses: strangelove-ventures/heighliner-build-action@v1.0.0
        with:
          registry: # empty registry, image only shared for e2e testing
          tag: local # emulate local environment for consistency in interchaintest cases
          tar-export-path: ${{ env.TAR_PATH }} # export a tarball that can be uploaded as an artifact for the e2e jobs
          platform: linux/amd64 # test runner architecture only
          git-ref: ${{ github.head_ref }} # source code ref

          # Heighliner chains.yaml config
          chain: noble
          dockerfile: cosmos
          build-target: make install
          binaries: |
            - /go/bin/nobled

        # Use github actions artifacts for temporary storage of the docker image tarball
      - name: Publish Tarball as Artifact
        uses: actions/upload-artifact@v3
        with:
          name: noble-docker-image
          path: ${{ env.TAR_PATH }}

  e2e-tests:
    needs: build-docker
    runs-on: ubuntu-latest
    strategy:
        matrix:
            # names of `make` commands to run tests
            test: ["ictest-tkn-factory", "ictest-packet-forward", "ictest-paramauthority", "ictest-chain-upgrade-noble-1", "ictest-chain-upgrade-grand-1", "ictest-globalFee", "ictest-ics20-bps-fees"]
        fail-fast: false

    steps:
      # Load the docker image tarball from github actions artifacts and run tests (one runner per test due to matrix)
      - name: Download Tarball Artifact
        uses: actions/download-artifact@v3
        with:
          name: noble-docker-image

      - name: Load Docker Image
        run: docker image load -i ${{ env.TAR_PATH }}
      - name: Set up Go 1.19
        uses: actions/setup-go@v3
        with:
          go-version: 1.19
              
      - name: checkout chain
        uses: actions/checkout@v3

      - name: run test
        run: make ${{ matrix.test }}
```
