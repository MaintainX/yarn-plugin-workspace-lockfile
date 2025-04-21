# Yarn Workspace Lockfile Plugin

This Yarn Berry plugin automatically generates workspace-specific lockfiles for each workspace in your monorepo whenever you run `yarn install`. These lockfiles represent what the `yarn.lock` would look like if each workspace was a standalone project.

## Installation

```bash
yarn plugin import https://raw.githubusercontent.com/MaintainX/yarn-plugin-workspace-lockfile/master/bundles/@yarnpkg/plugin-workspace-lockfile.js
```

## Development

The plugin is built using `@yarnpkg/builder`, which is the official tool for building Yarn plugins. To develop:

1. Make changes to the source code in `src/`
2. Run `yarn build` to rebuild the plugin
3. Run `yarn clean` to clean build artifacts

The builder will:

- Type check your code
- Bundle all dependencies
- Generate proper plugin metadata
- Create CommonJS bundles

## Usage

The plugin automatically runs after every `yarn install` operation. It will:

1. Generate a `yarn.workspace.lock` file for each workspace
2. Use the same cache as your main project
3. Preserve workspace-specific dependencies

You can use these workspace lockfiles for:

1. Dependabot scanning at the workspace level
2. GitHub Action cache keys for focused workspace installs
3. Analyzing dependencies for individual workspaces in CI/CD pipelines when using `yarn workspaces focus`

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
