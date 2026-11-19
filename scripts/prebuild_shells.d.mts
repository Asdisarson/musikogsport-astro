// Types for the helpers exported by prebuild_shells.mjs (the tests import them).
export class UsageError extends Error {}
export interface ShellRender {
  status: number;
  shell: string;
  ms: number;
  error?: string;
}
export interface ShellOptions {
  base: URL;
  allowRemote: boolean;
  forwardedHost: string | null;
  delayMs: number;
  slowMs: number;
  timeoutMs: number;
  maxFailures: number;
  limit: number;
}
export function parseArgs(argv: string[]): Record<string, string>;
export function readOptions(argv: string[], env?: Record<string, string | undefined>): ShellOptions;
export function isLocal(host: string): boolean;
export function isBad(r: ShellRender, slowMs: number): boolean;
export function tally(r: ShellRender, slowMs: number): 'bad' | 'miss' | 'hit' | 'stale' | 'refused' | 'other' | null;
export function nextPause(pause: number, bad: boolean, delayMs: number): number;
export function storeProblem(r: ShellRender): string | null;
