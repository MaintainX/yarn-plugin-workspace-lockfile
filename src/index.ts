import { Descriptor, MessageName, Plugin, Project, Report, StreamReport, structUtils, Workspace } from "@yarnpkg/core";
import { ppath, xfs } from "@yarnpkg/fslib";

interface PackageInfo {
  version: string | null;
  resolution: string;
  dependencies: Map<string, string>;
  peerDependencies: Map<string, string>;
}

// Function to generate workspace lockfile
async function generateWorkspaceLockfile(workspace: Workspace, project: Project, report: Report) {
  // Skip the root workspace
  if (workspace.cwd === project.cwd) {
    return;
  }

  const workspaceName = workspace.manifest.raw.name || workspace.cwd;
  report.reportInfo(MessageName.UNNAMED, `Generating lockfile for ${workspaceName}...`);

  try {
    // Get all dependencies from the workspace
    const allDeps = new Set<Descriptor>();

    // Add direct dependencies
    const manifest = workspace.manifest;
    for (const depType of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const deps = manifest.getForScope(depType);
      report.reportInfo(MessageName.UNNAMED, `Found ${deps.size} ${depType}`);

      for (const dep of deps.values()) {
        // Check if it's a workspace dependency
        const workspaceDep = project.workspaces.find(
          (ws) => ws.manifest.raw.name === dep.name || ws.manifest.raw.name === `@${dep.scope}/${dep.name}`,
        );

        if (workspaceDep) {
          // For workspace dependencies, use the workspace's manifest
          const descriptor = structUtils.makeDescriptor(structUtils.makeIdent(dep.scope || "", dep.name), dep.range);
          allDeps.add(descriptor);
          report.reportInfo(
            MessageName.UNNAMED,
            `Added workspace dependency: ${structUtils.stringifyDescriptor(descriptor)}`,
          );

          // Also add all dependencies of the workspace dependency
          for (const innerDepType of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const innerDeps = workspaceDep.manifest.getForScope(innerDepType);
            for (const innerDep of innerDeps.values()) {
              const innerDescriptor = structUtils.makeDescriptor(
                structUtils.makeIdent(innerDep.scope || "npm", innerDep.name),
                innerDep.range,
              );
              allDeps.add(innerDescriptor);
              report.reportInfo(
                MessageName.UNNAMED,
                `Added transitive dependency from workspace: ${structUtils.stringifyDescriptor(innerDescriptor)}`,
              );
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
          report.reportInfo(MessageName.UNNAMED, `Added dependency: ${structUtils.stringifyDescriptor(descriptor)}`);
        }
      }
    }

    // Build workspace lockfile entries
    const workspaceLockfile = new Map<string, PackageInfo>();
    const processedDeps = new Set<string>();

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
      processedDeps.add(normalizedKey);

      // First try to find the resolution in the project's lockfile
      const resolution = project.storedResolutions.get(descriptor.descriptorHash);
      if (!resolution) {
        // If no resolution found, try to find the package directly
        const pkgKey = Array.from(project.storedPackages.keys()).find((key) => {
          const pkg = project.storedPackages.get(key);
          return pkg && pkg.identHash === descriptor.identHash;
        });

        if (!pkgKey) {
          report.reportInfo(MessageName.UNNAMED, `No resolution found for ${descriptorStr}`);
          return;
        }

        const pkg = project.storedPackages.get(pkgKey);
        if (!pkg) {
          report.reportInfo(MessageName.UNNAMED, `No package found for ${descriptorStr}`);
          return;
        }

        // Add the dependency to the workspace lockfile
        const dependencies = new Map<string, string>();
        const peerDependencies = new Map<string, string>();

        for (const [identStr, dep] of pkg.dependencies) {
          dependencies.set(structUtils.stringifyIdent(dep), dep.range);
          processDependency(dep);
        }

        for (const [identStr, dep] of pkg.peerDependencies) {
          peerDependencies.set(structUtils.stringifyIdent(dep), dep.range);
          processDependency(dep);
        }

        workspaceLockfile.set(descriptorStr, {
          version: pkg.version,
          resolution: structUtils.stringifyLocator(pkg),
          dependencies,
          peerDependencies,
        });
      } else {
        const pkg = project.storedPackages.get(resolution);
        if (!pkg) {
          report.reportInfo(MessageName.UNNAMED, `No package found for ${descriptorStr}`);
          return;
        }

        // Add the dependency to the workspace lockfile
        const dependencies = new Map<string, string>();
        const peerDependencies = new Map<string, string>();

        for (const [identStr, dep] of pkg.dependencies) {
          dependencies.set(structUtils.stringifyIdent(dep), dep.range);
          processDependency(dep);
        }

        for (const [identStr, dep] of pkg.peerDependencies) {
          peerDependencies.set(structUtils.stringifyIdent(dep), dep.range);
          processDependency(dep);
        }

        workspaceLockfile.set(descriptorStr, {
          version: pkg.version,
          resolution: structUtils.stringifyLocator(pkg),
          dependencies,
          peerDependencies,
        });
      }
    };

    // Process all direct dependencies
    for (const descriptor of allDeps) {
      processDependency(descriptor);
    }

    report.reportInfo(MessageName.UNNAMED, `Generated ${workspaceLockfile.size} entries for workspace lockfile`);

    // Generate the lockfile content
    const lockfileContent = Array.from(workspaceLockfile.entries())
      .map(([key, value]) => {
        const normalizedKey = normalizeKey(key);

        const depsStr =
          value.dependencies.size > 0
            ? `  dependencies:\n${Array.from(value.dependencies.entries())
                .map(([name, range]) => {
                  const depRange = range.startsWith("workspace:") ? range : `npm:${range.replace(/^npm:/, "")}`;
                  return `    "${name}": "${depRange}"\n`;
                })
                .join("")}`
            : "";
        const peerDepsStr =
          value.peerDependencies.size > 0
            ? `  peerDependencies:\n${Array.from(value.peerDependencies.entries())
                .map(([name, range]) => {
                  const depRange = range.startsWith("workspace:") ? range : `npm:${range.replace(/^npm:/, "")}`;
                  return `    "${name}": "${depRange}"\n`;
                })
                .join("")}`
            : "";

        return `"${normalizedKey}":\n  version: "${value.version || "unknown"}"\n  resolution: "${
          value.resolution
        }"\n${depsStr}${peerDepsStr}`;
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

const plugin: Plugin = {
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
