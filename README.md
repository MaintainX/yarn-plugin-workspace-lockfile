# Yarn Workspace Lockfile Plugin

This Yarn Berry plugin automatically generates workspace-specific lockfiles for each workspace in your monorepo whenever you run `yarn install`. These lockfiles represent what the `yarn.lock` would look like if each workspace was a standalone project.

## Installation

1. Build the plugin:

```bash
cd tools/yarn-plugin-workspace-lockfile
yarn install
yarn build
```

The build process will generate the plugin in the `bundles` directory:

- `bundles/@maintainx/plugin-workspace-lockfile.js`: The CommonJS bundle
- `bundles/@maintainx/plugin-workspace-lockfile.cjs`: The CommonJS bundle (copy)

2. Enable the plugin in your project:

```bash
cd ../..  # Back to project root
yarn plugin import ../tools/yarn-plugin-workspace-lockfile/bundles/@yarnpkg/plugin-workspace-lockfile.js
```

## Development

The plugin is built using `@yarnpkg/builder`, which is the official tool for building Yarn plugins. To develop:

1. Make changes to the source code in `sources/`
2. Run `yarn build` to rebuild the plugin
3. Run `yarn clean` to clean build artifacts

The builder will:

- Type check your code
- Bundle all dependencies
- Generate proper plugin metadata
- Create both CommonJS and ESM bundles

## Usage

The plugin automatically runs after every `yarn install` operation. It will:

1. Generate a `yarn.workspace.lock` file for each workspace
2. Use the same cache as your main project
3. Preserve workspace-specific dependencies

You can use these workspace lockfiles for:

1. Dependabot scanning at the workspace level
2. GitHub Action cache keys for focused workspace installs
3. Analyzing dependencies for individual workspaces

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

      - name: Get workspace lockfile hash
        id: lockfile
        run: echo "hash=$(sha256sum frontend/yarn.workspace.lock | cut -d' ' -f1)" >> $GITHUB_OUTPUT

      - name: Cache workspace dependencies
        uses: actions/cache@v4
        with:
          path: frontend/.yarn/cache
          key: yarn-${{ steps.lockfile.outputs.hash }}
          restore-keys: yarn-

      - name: Install dependencies
        run: cd frontend && yarn workspaces focus
```

## How it Works

The plugin hooks into Yarn's `afterAllInstalled` lifecycle event to:

1. Create a temporary project configuration for each workspace
2. Generate a lockfile as if the workspace was a standalone project
3. Rename the generated `yarn.lock` to `yarn.workspace.lock`
4. Clean up temporary changes

This ensures that each workspace has its own lockfile that accurately represents its dependencies, making it easier to:

- Track dependency changes at the workspace level
- Cache dependencies efficiently in CI/CD pipelines
- Analyze dependencies for individual workspaces
