import {
  Descriptor,
  LocatorHash,
  MessageName,
  Plugin,
  Project,
  Report,
  SettingsType,
  StreamReport,
  structUtils,
  Workspace,
} from "@yarnpkg/core";
import { ppath, xfs } from "@yarnpkg/fslib";

interface PackageInfo {
  version: string | null;
  resolution: string;
  checksum: string | null;
  dependencies: Map<string, string>;
  peerDependencies: Map<string, string>;
}

// Helper function to check if a package is in the main lockfile
function isPackageInMainLockfile(project: Project, packageName: string, range: string): boolean {
  const descriptor = structUtils.makeDescriptor(
    structUtils.parseIdent(packageName),
    range.startsWith("npm:") ? range : `npm:${range}`,
  );
  return project.storedResolutions.has(descriptor.descriptorHash);
}

// Function to generate workspace lockfile
async function generateWorkspaceLockfile(workspace: Workspace, project: Project, report: Report) {
  const workspaceName = workspace.manifest.raw.name || workspace.cwd;
  report.reportInfo(MessageName.UNNAMED, `Generating lockfile for ${workspaceName}...`);

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
          if (!isPackageInMainLockfile(project, depIdent, range)) {
            if (project.configuration.get("enableVerboseLogging")) {
              report.reportInfo(
                MessageName.UNNAMED,
                `Skipping @types peer dependency not in main lockfile: ${depIdent}@${range}`,
              );
            }
            continue;
          }
        }

        peerDependencies.set(depIdent, range);
      }

      workspaceLockfile.set(combinedKey, {
        version: pkg.version,
        resolution: structUtils.stringifyLocator(pkg),
        checksum: pkg.identHash,
        dependencies,
        peerDependencies,
      });
    }

    if (project.configuration.get("enableVerboseLogging")) {
      report.reportInfo(MessageName.UNNAMED, `Generated ${workspaceLockfile.size} entries for workspace lockfile`);
    }

    // Generate the lockfile content
    const lockfileContent = Array.from(workspaceLockfile.entries())
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
          // Not getting the right checksum at this time
          // value.checksum ? `  checksum: ${value.checksum}` : "",
        ].filter(Boolean);

        return lines.join("\n") + "\n";
      })
      .join("\n");

    // Write the workspace lockfile
    const workspaceLockfilePath = ppath.join(workspace.cwd, "yarn.workspace.lock");
    await xfs.writeFilePromise(workspaceLockfilePath, lockfileContent);
    report.reportInfo(MessageName.UNNAMED, `Created ${workspaceLockfilePath}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    report.reportError(MessageName.UNNAMED, `Failed to generate lockfile for ${workspaceName}: ${errorMessage}`);
  }
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
    async afterAllInstalled(project: Project, opts: { report: Report }) {
      for (const workspace of project.workspaces) {
        await generateWorkspaceLockfile(workspace, project, opts.report);
      }
    },

    async afterWorkspaceDependencyAddition(
      workspace: Workspace,
      target: string,
      descriptor: Descriptor,
      strategies: Array<string>,
    ) {
      await StreamReport.start(
        {
          configuration: workspace.project.configuration,
          stdout: process.stdout,
        },
        async (report) => {
          await generateWorkspaceLockfile(workspace, workspace.project, report);
        },
      );
    },

    async afterWorkspaceDependencyRemoval(workspace: Workspace, target: string, descriptor: Descriptor) {
      await StreamReport.start(
        {
          configuration: workspace.project.configuration,
          stdout: process.stdout,
        },
        async (report) => {
          await generateWorkspaceLockfile(workspace, workspace.project, report);
        },
      );
    },

    async afterWorkspaceDependencyReplacement(
      workspace: Workspace,
      target: string,
      fromDescriptor: Descriptor,
      toDescriptor: Descriptor,
    ) {
      await StreamReport.start(
        {
          configuration: workspace.project.configuration,
          stdout: process.stdout,
        },
        async (report) => {
          await generateWorkspaceLockfile(workspace, workspace.project, report);
        },
      );
    },
  },
};

export default plugin;
