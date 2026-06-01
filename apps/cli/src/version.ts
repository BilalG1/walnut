// Compiled binaries have no package.json at runtime, so the version is a constant.
// The build can override it with `bun build --define WALNUT_VERSION='"x.y.z"'`.
declare const WALNUT_VERSION: string | undefined
export const VERSION = typeof WALNUT_VERSION === 'string' ? WALNUT_VERSION : '0.1.0'
