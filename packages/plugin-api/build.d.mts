import type { PluginManifest } from './index.js'

/** Independently build a plugin project with the public SDK runtime bindings. */
export declare function buildPlugin(
  directory: string,
  options?: { outdir?: string },
): Promise<{ manifest: PluginManifest; main: string; styles: string }>
