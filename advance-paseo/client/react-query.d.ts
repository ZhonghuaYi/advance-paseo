// Typecheck-only ambient module for "@tanstack/react-query". The host injects
// the app's own react-query instance into the plugin sandbox at runtime (it
// is one of the requireable module names), but the package is not a
// dependency of this plugin, so tsc needs the surface we touch declared
// here. Only the members the theme switcher uses are listed; if the plugin
// ever adopts react-query directly, delete this shim in favor of the real
// types.

declare module "@tanstack/react-query" {
  export interface QueryClient {
    getQueryData(queryKey: readonly unknown[]): unknown;
    setQueryData(queryKey: readonly unknown[], updater: unknown): unknown;
  }
  export function useQueryClient(): QueryClient;
}
