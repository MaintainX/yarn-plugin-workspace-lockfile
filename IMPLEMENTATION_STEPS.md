# Implementation Steps for Workspace Lockfile Generation

## Goal
Make the `yarn.workspace.lock` format identical to `yarn.lock` format while maintaining workspace-specific focus. The workspace lockfile should:
- Include only dependencies relevant to the specific workspace
- Match the exact format and structure of the main lockfile
- Maintain all metadata and configuration that helps with dependency resolution

## Current Status
The workspace lockfile plugin currently:
- Filters out virtual dependencies
- Combines multiple versions that resolve to the same package
- Normalizes dependency ranges by removing `virtual:` prefix

However, it differs from the main lockfile in several ways that need to be addressed.

## Implementation Steps

### 1. Version Range Format
**Goal**: Match main lockfile's version range format
**Implementation**:
- [ ] Preserve multiple version references in package names when present in main lockfile
- [ ] Keep the exact format of version ranges as they appear in the main lockfile
- [ ] Maintain the same resolution strategy for version ranges
**Complexity**: Low - Mostly string formatting changes

### 2. Preserve Binary Information
**Goal**: Keep `bin` entries in workspace lockfile
**Implementation**:
- [ ] Preserve all `bin` field entries when creating package info
- [ ] These entries are important for package resolution and execution
**Complexity**: Low - Simply preserve existing data

### 3. Add Metadata Section
**Goal**: Include the `__metadata` section from main lockfile
**Implementation**:
- [ ] Copy the `__metadata` section from the main lockfile
- [ ] Ensure version and cacheKey are preserved
- [ ] This helps maintain consistency with Yarn's lockfile format
**Complexity**: Medium - Requires understanding metadata handling

### 4. Development Dependencies
**Goal**: Match development dependency handling
**Implementation**:
- [ ] Include debug and development packages when they're workspace dependencies
- [ ] Preserve all tool configurations that appear in the main lockfile
**Complexity**: Medium - Requires dependency analysis

### 5. Optional Dependencies
**Goal**: Match optional dependency handling
**Implementation**:
- [ ] Preserve `optionalDependencies` field in package entries
- [ ] Keep `dependenciesMeta` and `peerDependenciesMeta` sections
- [ ] Maintain optional status of dependencies
**Complexity**: Medium - Requires careful handling of metadata

### 6. Match Peer Dependencies Format
**Goal**: Match the main lockfile's peer dependency format
**Implementation**:
- [X] Remove added `@types/*` entries that aren't in the main lockfile
- [ ] Keep `peerDependenciesMeta` sections
- [ ] Match the exact format of optional peer dependencies
**Complexity**: High - Requires careful dependency resolution

### 7. Workspace References Handling
**Goal**: Properly handle workspace references
**Implementation**:
- [ ] Include workspace entries where they are direct dependencies
- [ ] Maintain the `workspace:` protocol in resolutions
- [ ] Keep version as `0.0.0-use.local` for workspace packages
**Complexity**: High - Requires workspace resolution understanding

## Testing Strategy

For each implementation step:
1. Write test cases in `tests/` directory
2. Compare generated workspace lockfile with main lockfile format
3. Verify that only workspace-relevant dependencies are included
4. Ensure dependency resolution works correctly
5. Check that yarn commands (install, add, remove) work as expected

## Regression Prevention

Before implementing each step:
1. Create a snapshot of current lockfiles
2. Run `yarn install` in test projects to verify current behavior
3. After changes, run `yarn install` again and compare results
4. Ensure all workspaces can still resolve their dependencies
5. Verify that changes maintain workspace-specific focus

## Implementation Order Rationale

1. Version Range Format: Simple string manipulation with immediate visual feedback
2. Binary Information: Straightforward data preservation
3. Metadata Section: Self-contained change with clear success criteria
4. Development Dependencies: Builds on version handling
5. Optional Dependencies: Requires metadata understanding
6. Peer Dependencies: Complex dependency relationships
7. Workspace References: Most complex due to workspace interactions

This order minimizes risk by:
- Starting with simple, isolated changes
- Building complexity gradually
- Tackling dependency-related changes after format changes
- Leaving the most complex workspace interactions for last

## Notes

- Each change should be tested in isolation
- Run the full test suite after each change
- Document any edge cases discovered during implementation
- Monitor performance impacts
- Focus on maintaining exact format compatibility with yarn.lock
- Ensure workspace-specific dependency filtering is preserved 