import {
  Descriptor,
  LinkType,
  LocatorHash,
  MessageName,
  Plugin,
  Project,
  SettingsType,
  structUtils,
  Workspace,
} from "@yarnpkg/core";
import { InstallOptions } from "@yarnpkg/core/lib/Project";
import { ppath, xfs } from "@yarnpkg/fslib";
import { isCI } from "ci-info";

interface PackageInfo {
  version: string | null;
  resolution: string;
  dependencies: Map<string, string>;
  peerDependencies: Map<string, string>;
  bin: Map<string, string>;
  checksum: string;
  languageName: string;
  linkType: string;
}

// Function to generate workspace lockfile
async function generateWorkspaceLockfile(
  workspaceName: string,
  workspace: Workspace,
  project: Project,
  { report, immutable, cache, persistProject }: InstallOptions,
) {
  try {
    // Get all dependencies from the workspace
    const allDeps = new Set<Descriptor>();

    // Add direct dependencies
    const manifest = workspace.manifest;
    for (const depType of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const deps = manifest.getForScope(depType);
      if (project.configuration.get("enableVerboseLogging")) {
        report.reportInfo(MessageName.UNNAMED, `Found ${deps.size} ${depType}`);
      }

      for (const dep of deps.values()) {
        // Check if it's a workspace dependency
        const workspaceDep = project.workspaces.find(
          (ws) => ws.manifest.raw.name === dep.name || ws.manifest.raw.name === `@${dep.scope}/${dep.name}`,
        );

        if (workspaceDep) {
          // For workspace dependencies, use the workspace's manifest
          const descriptor = structUtils.makeDescriptor(structUtils.makeIdent(dep.scope || "", dep.name), dep.range);
          allDeps.add(descriptor);
          if (project.configuration.get("enableVerboseLogging")) {
            report.reportInfo(
              MessageName.UNNAMED,
              `Added workspace dependency: ${structUtils.stringifyDescriptor(descriptor)}`,
            );
          }

          // Also add all dependencies of the workspace dependency
          for (const innerDepType of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const innerDeps = workspaceDep.manifest.getForScope(innerDepType);
            for (const innerDep of innerDeps.values()) {
              const innerDescriptor = structUtils.makeDescriptor(
                structUtils.makeIdent(innerDep.scope || "npm", innerDep.name),
                innerDep.range,
              );
              allDeps.add(innerDescriptor);
              if (project.configuration.get("enableVerboseLogging")) {
                report.reportInfo(
                  MessageName.UNNAMED,
                  `Added transitive dependency from workspace: ${structUtils.stringifyDescriptor(innerDescriptor)}`,
                );
              }
            }
          }
        } else {
          const fullName = dep.scope ? `@${dep.scope}/${dep.name}` : dep.name;
          const ident = structUtils.parseIdent(fullName);

          // For non-workspace dependencies, ensure consistent npm: prefix
          const range = dep.range.startsWith("workspace:")
            ? dep.range
            : dep.range.startsWith("npm:")
              ? dep.range
              : `npm:${dep.range}`;

          const descriptor = structUtils.makeDescriptor(ident, range);
          allDeps.add(descriptor);
          if (project.configuration.get("enableVerboseLogging")) {
            report.reportInfo(MessageName.UNNAMED, `Added dependency: ${structUtils.stringifyDescriptor(descriptor)}`);
          }
        }
      }
    }

    // Build workspace lockfile entries
    const workspaceLockfile = new Map<string, PackageInfo>();
    const processedDeps = new Set<string>();
    const resolutionToDescriptors = new Map<LocatorHash, Set<Descriptor>>();

    // Helper to normalize descriptor keys
    const normalizeKey = (key: string) => {
      const descriptor = structUtils.parseDescriptor(key);
      return descriptor.range.startsWith("workspace:")
        ? structUtils.stringifyDescriptor(descriptor)
        : structUtils.stringifyDescriptor(
            structUtils.makeDescriptor(descriptor, `npm:${descriptor.range.replace(/^npm:/, "")}`),
          );
    };

    // Process dependencies recursively
    const processDependency = (descriptor: Descriptor) => {
      const descriptorStr = structUtils.stringifyDescriptor(descriptor);
      const normalizedKey = normalizeKey(descriptorStr);
      if (processedDeps.has(normalizedKey)) return;

      // First try to find the resolution in the project's lockfile
      const resolution = project.storedResolutions.get(descriptor.descriptorHash);
      if (!resolution) {
        if (project.configuration.get("enableVerboseLogging")) {
          report.reportInfo(MessageName.UNNAMED, `No resolution found for ${descriptorStr}`);
        }
        return;
      }

      // Group descriptors by their resolution
      if (!resolutionToDescriptors.has(resolution)) {
        resolutionToDescriptors.set(resolution, new Set());
      }
      resolutionToDescriptors.get(resolution)!.add(descriptor);

      const pkg = project.storedPackages.get(resolution);
      if (!pkg) {
        if (project.configuration.get("enableVerboseLogging")) {
          report.reportInfo(MessageName.UNNAMED, `No package found for ${descriptorStr}`);
        }
        return;
      }

      // Add the normalized key to the processed dependencies
      // Must add it after the checks above since it's possible to miss it for 1 package and find it for the next one
      processedDeps.add(normalizedKey);

      // Process dependencies recursively
      for (const [identStr, dep] of pkg.dependencies) {
        processDependency(dep);
      }

      for (const [identStr, dep] of pkg.peerDependencies) {
        processDependency(dep);
      }
    };

    // Process all direct dependencies
    for (const descriptor of allDeps) {
      processDependency(descriptor);
    }

    // Create lockfile entries from grouped resolutions
    for (const [resolution, descriptors] of resolutionToDescriptors) {
      const pkg = project.storedPackages.get(resolution);
      if (!pkg) continue;

      // Create combined key from all descriptors that resolve to this package
      // Filter out virtual dependencies
      const descriptorKeys = Array.from(descriptors)
        .map((d) => structUtils.stringifyDescriptor(d))
        .filter((key) => !key.includes("virtual:"))
        .sort();

      // Skip if all descriptors were virtual
      if (descriptorKeys.length === 0) continue;

      const combinedKey = descriptorKeys.join(", ");

      // Add the dependency to the workspace lockfile
      const dependencies = new Map<string, string>();
      const peerDependencies = new Map<string, string>();

      for (const [identStr, dep] of pkg.dependencies) {
        const range = dep.range.startsWith("virtual:")
          ? `npm:${dep.range.replace(/^virtual:[^#]+#npm:/, "")}`
          : dep.range.startsWith("workspace:")
            ? dep.range
            : dep.range.startsWith("npm:")
              ? dep.range
              : `npm:${dep.range}`;
        dependencies.set(structUtils.stringifyIdent(dep), range);
      }

      for (const [identStr, dep] of pkg.peerDependencies) {
        const depIdent = structUtils.stringifyIdent(dep);
        const range = dep.range.startsWith("virtual:")
          ? `npm:${dep.range.replace(/^virtual:[^#]+#npm:/, "")}`
          : dep.range.startsWith("workspace:")
            ? dep.range
            : dep.range.startsWith("npm:")
              ? dep.range
              : `npm:${dep.range}`;

        // Skip @types/* peer dependencies that aren't in the main lockfile
        if (depIdent.startsWith("@types/")) {
          // This is likely a peer dependency added by https://github.com/yarnpkg/berry/blob/master/packages/plugin-typescript/README.md
          // We can skip them since they're not required by the workspace
          // TODO:: Find a better way to check if it's a peer dependency added by the typescript plugin
          if (pkg.peerDependenciesMeta.get(depIdent)?.optional && dep.range === "*") {
            if (project.configuration.get("enableVerboseLogging")) {
              report.reportInfo(MessageName.UNNAMED, `Skipping optional @types peer dependency: ${depIdent}@${range}`);
            }
            continue;
          }
        }

        peerDependencies.set(depIdent, range);
      }

      workspaceLockfile.set(combinedKey, {
        version:
          pkg.linkType === LinkType.SOFT && pkg.reference.startsWith("workspace:") ? "0.0.0-use.local" : pkg.version,
        resolution: structUtils.stringifyLocator(pkg),
        dependencies,
        peerDependencies,
        bin: pkg.bin,
        checksum: project.storedChecksums.get(resolution) || "",
        languageName: pkg.languageName,
        linkType: pkg.linkType,
      });
    }

    if (project.configuration.get("enableVerboseLogging")) {
      report.reportInfo(MessageName.UNNAMED, `Generated ${workspaceLockfile.size} entries for workspace lockfile`);
    }

    // Generate the lockfile content
    const lockfilePackages = Array.from(workspaceLockfile.entries())
      .sort() // Sort entries alphabetically
      .map(([key, value]) => {
        const depsStr =
          value.dependencies.size > 0
            ? `  dependencies:\n${Array.from(value.dependencies.entries())
                .sort() // Sort dependencies alphabetically
                .map(([name, range]) => {
                  const depRange = range.startsWith("workspace:") ? range : `npm:${range.replace(/^npm:/, "")}`;
                  const quotedName = name.startsWith("@") ? `"${name}"` : name;
                  return `    ${quotedName}: "${depRange}"`;
                })
                .join("\n")}`
            : "";
        const peerDepsStr =
          value.peerDependencies.size > 0
            ? `  peerDependencies:\n${Array.from(value.peerDependencies.entries())
                .sort() // Sort peer dependencies alphabetically
                .map(([name, range]) => {
                  const depRange = range.startsWith("workspace:") ? range : `${range.replace(/^npm:/, "")}`;
                  // https://stackoverflow.com/a/22235064
                  const quotedRange = depRange.match(/[:\{\}\[\]\,&*#?<>=!%@\\]/) ? `"${depRange}"` : depRange;
                  const quotedName = name.startsWith("@") ? `"${name}"` : name;
                  return `    ${quotedName}: ${quotedRange}`;
                })
                .join("\n")}`
            : "";

        const lines = [
          `"${key}":`,
          `  version: ${value.version || "unknown"}`,
          `  resolution: "${value.resolution}"`,
          depsStr,
          peerDepsStr,
          value.bin.size > 0
            ? `  bin:\n${Array.from(value.bin.entries())
                .map(([name, path]) => `    ${name}: ${path}`)
                .join("\n")}`
            : "",
          `  checksum: ${value.checksum}`,
          `  languageName: ${value.languageName.toLowerCase()}`,
          `  linkType: ${value.linkType.toLowerCase()}`,
        ].filter(Boolean);

        return lines.join("\n") + "\n";
      })
      .join("\n");

    const cacheKey = cache.cacheKey;
    const lockfileContent = `# This file is generated by running "yarn install" inside your project through the workspace-lockfile plugin.
# Manual changes might be lost - proceed with caution!

__metadata:
  version: ${project.lockfileLastVersion ?? "6" /** Assume yarn v3? */}
  cacheKey: ${cacheKey}

${lockfilePackages}`;

    // Write the workspace lockfile
    const workspaceLockfilePath = ppath.join(workspace.cwd, "yarn.workspace.lock");

    if (immutable) {
      const existingLockfile = await xfs.readFilePromise(workspaceLockfilePath, "utf-8");
      if (existingLockfile === lockfileContent) {
        return;
      }

      report.reportError(
        MessageName.UNNAMED,
        `The lockfile ${workspaceLockfilePath} would have been modified by this install, which is explicitly forbidden`,
      );
    } else {
      await xfs.writeFilePromise(workspaceLockfilePath, lockfileContent);
      report.reportInfo(MessageName.UNNAMED, `Created ${workspaceLockfilePath}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    report.reportError(MessageName.UNNAMED, `Failed to generate lockfile for ${workspaceName}: ${errorMessage}`);
  }
}

interface WorkspaceFocus {
  isWorkspaceFocused: boolean;
  isProduction?: boolean;
  workspaces?: Workspace[];
}

function processWorkspaceFocus(project: Project, opts: InstallOptions): WorkspaceFocus {
  if (opts.persistProject !== false) {
    return {
      isWorkspaceFocused: false,
    };
  }

  // cli reference: https://yarnpkg.com/cli/workspaces/focus
  const args = process.argv.slice(2);
  const isWorkspaceFocused = args[0] === "workspaces" && args[1] === "focus";
  const isFocusProduction = isWorkspaceFocused && args.some((a) => a === "--production");
  const isAllWorkspaces = isWorkspaceFocused && args.some((a) => a === "--all" || a === "-A");

  if (!isWorkspaceFocused) {
    return {
      isWorkspaceFocused: false,
    };
  }

  // If --all is specified, we need to include all workspaces
  if (isAllWorkspaces) {
    return {
      isWorkspaceFocused: true,
      isProduction: isFocusProduction,
      workspaces: project.workspaces,
    };
  }

  // If --all is not specified, we need to include the workspaces specified in the command
  const workspaces = args.slice(2).filter((a) => !a.startsWith("-"));
  if (workspaces.length === 0) {
    const cwd = ppath.cwd();
    // If no workspaces are specified it will use workspace in the current directory
    const workspace = project.workspacesByCwd.get(cwd);
    if (!workspace) {
      throw new Error(`No workspace found in ${cwd}, please specify a workspace or use --all or -A`);
    }
    workspaces.push(workspace.manifest.raw.name);
  }

  // Walk the workspaces to include their dependencies recursively
  const projectByName = new Map<string, Workspace>(project.workspaces.map((w) => [w.manifest.raw.name, w]));
  const workspaceNames = new Set(workspaces);
  const focusedWorkspaces: Set<Workspace> = new Set();
  function includeWorkspace(workspace: Workspace) {
    if (focusedWorkspaces.has(workspace)) {
      return;
    }
    focusedWorkspaces.add(workspace);
    workspaceNames.add(workspace.manifest.raw.name);
    // Also include all "workspace:*" dependencies
    for (const [identStr, dep] of new Map([
      ...workspace.manifest.getForScope("dependencies").entries(),
      ...workspace.manifest.getForScope("devDependencies").entries(),
    ])) {
      if (dep.range.startsWith("workspace:")) {
        const dependentWorkspace = projectByName.get(dep.name);
        if (dependentWorkspace) {
          includeWorkspace(dependentWorkspace);
        }
      }
    }
  }
  for (const workspaceName of workspaceNames) {
    const workspace = projectByName.get(workspaceName);
    if (workspace) {
      includeWorkspace(workspace);
    } else {
      throw new Error(`Workspace ${workspaceName} not found in the project`);
    }
  }

  return {
    isWorkspaceFocused,
    isProduction: isFocusProduction,
    workspaces: Array.from(focusedWorkspaces),
  };
}

declare module "@yarnpkg/core" {
  interface ConfigurationValueMap {
    enableVerboseLogging: boolean;
  }
}

const plugin: Plugin = {
  configuration: {
    enableVerboseLogging: {
      description: "If true, enables verbose logging for workspace lockfile generation",
      type: SettingsType.BOOLEAN,
      default: false,
    },
  },
  hooks: {
    async afterAllInstalled(project: Project, opts: InstallOptions) {
      const workspaceFocus = processWorkspaceFocus(project, opts);
      if (workspaceFocus.isWorkspaceFocused && (workspaceFocus.isProduction || !workspaceFocus.workspaces?.length)) {
        // If we're focused on a production install or no workspaces are specified, we need to skip the lockfile generation
        // This is because yarn manipulates the manifest in focus mode, so we can't rely on the manifest to generate the lockfile
        return;
      }
      if (workspaceFocus.isWorkspaceFocused && isCI) {
        opts.immutable = true;
      }

      await opts.report.startTimerPromise(`Workspace lockfiles step`, async () => {
        for (const workspace of workspaceFocus.workspaces ?? project.workspaces) {
          const workspaceName = workspace.manifest.raw.name || workspace.cwd;
          await opts.report.startTimerPromise(`Generating lockfile for ${workspaceName}`, async () => {
            await generateWorkspaceLockfile(workspaceName, workspace, project, opts);
          });
        }
      });
    },
  },
};

export default plugin;
