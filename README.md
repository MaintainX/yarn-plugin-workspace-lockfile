# Yarn Workspace Lockfile Plugin

This Yarn Berry plugin automatically generates workspace-specific lockfiles for each workspace in your monorepo whenever you run `yarn install`.
These lockfiles represent what the `yarn.lock` would look like as much as possible if each workspace was a standalone project (not exactly yarn.lock compatible).

You can use these workspace lockfiles for:

- GitHub Action cache keys for focused workspace installs
- Analyzing dependencies for individual workspaces in CI/CD pipelines when using `yarn workspaces focus`

## Installation

```bash
yarn plugin import https://raw.githubusercontent.com/MaintainX/yarn-plugin-workspace-lockfile/refs/tags/v0.4.0/bundles/%40yarnpkg/plugin-workspace-lockfile.js
```

## Example GitHub Actions Usage

```yaml
name: Build Workspace
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "yarn"
          cache-dependency-path: "frontend/yarn.workspace.lock"

      # Alternatively, instead of using the cache-dependency-path, you can use the hashFiles function to hash the lockfile
      - name: Cache workspace dependencies
        uses: actions/cache@v4
        with:
          path: frontend/.yarn/cache
          key: yarn-${{ hashFiles('frontend/yarn.workspace.lock') }}
          restore-keys: yarn-

      - name: Install dependencies
        run: yarn workspaces focus frontend
```

## How it Works

The plugin hooks into Yarn's `afterAllInstalled` lifecycle event to:

1. Collect all dependencies (direct and transitive) for each workspace, including:

   - Regular dependencies, devDependencies, and peerDependencies
   - Dependencies from workspace packages, including their nested dependencies
   - Resolving package information from the project's stored packages

2. Build a workspace-specific lockfile by:

   - Processing each dependency recursively
   - Extracting resolution information from the main project's lockfile
   - Preserving version, resolution, dependencies, and peer dependencies information
   - Skipping already processed dependencies to avoid duplicates

3. Generate a `yarn.workspace.lock` file that contains:
   - Package versions and resolutions
   - Dependency relationships between packages
   - Peer dependency requirements

This ensures that each workspace has its own lockfile that accurately represents its dependencies, making it easier to:

- Track dependency changes at the workspace level
- Cache dependencies efficiently in CI/CD pipelines
- Analyze dependencies for individual workspaces

## Environment Variables

### `WORKSPACE_LOCKFILE_FORCE_WRITE`

If set to `true`, this environment variable will force the plugin to write workspace lockfiles even when Yarn is run with the `--immutable` flag. This is useful in CI or automation scenarios where you want to ensure lockfiles are always updated, regardless of the immutable setting.

**Example:**

```sh
WORKSPACE_LOCKFILE_FORCE_WRITE=true yarn install --immutable
```

This will override the immutable check and update the `yarn.workspace.lock` files as needed.

## Publishing

TODO: Automatically create new releases on merge to master

To publish a new version of the plugin, bump the version in `package.json` and in the [Installation section above](#installation).
Then create a new release on Github with the same name as the new version.

- https://github.com/MaintainX/yarn-plugin-workspace-lockfile/releases/new
- You can create a new tag right there, give it the same name as the new version
- Provide a description of the changes you made (or use "Generate release notes" to auto-generate them from Pull Requests)
- Publish the release as "Pre-release" until we reach version 1.0.0
