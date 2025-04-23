# Yarn Workspace Lockfile Plugin

This Yarn Berry plugin automatically generates workspace-specific lockfiles for each workspace in your monorepo whenever you run `yarn install`.
These lockfiles represent what the `yarn.lock` would look like as much as possible if each workspace was a standalone project (not exactly yarn.lock compatible).

## Work in Progress

This plugin is still under development and not all features have been tested and verified.

## Installation

```bash
yarn plugin import https://raw.githubusercontent.com/MaintainX/yarn-plugin-workspace-lockfile/refs/tags/v0.2.2/bundles/%40yarnpkg/plugin-workspace-lockfile.js
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

1. Dependabot scanning at the workspace level (not yet supported/tested)
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

## Differences between yarn.lock and yarn.workspace.lock

The workspace lockfile aims to be as similar as possible to Yarn's main lockfile format, but there are some key differences:

### Content Scope
- `yarn.lock`: Contains ALL dependencies from all workspaces and their transitive dependencies
- `yarn.workspace.lock`: Contains only the dependencies specific to the current workspace and its direct workspace dependencies

### Format Similarities
Both files use the same format for common fields:
- Quoted package identifiers: `"@algolia/cache-browser-local-storage@npm:4.24.0"`
- Unquoted version numbers: `version: 4.24.0`
- Quoted resolution values: `resolution: "@algolia/cache-browser-local-storage@npm:4.24.0"`
- Dependencies follow specific quoting rules:
  - Scoped packages are quoted: `"@algolia/cache-common": "npm:4.24.0"`
  - Non-scoped packages are not quoted: `fastq: "npm:^1.6.0"`
- Alphabetical ordering of packages and their dependencies

### Missing Metadata (Potential Future Additions)
The following fields from `yarn.lock` are currently not included in `yarn.workspace.lock`:
- `checksum`: Package integrity checksums
- `languageName`: The language of the package (e.g., "node")
- `linkType`: How the package should be linked (e.g., "hard")
- `__metadata`: Top-level metadata about the lockfile itself (e.g., version, cacheKey)

These metadata fields could be added in future versions if they prove useful for workspace-specific use cases.
