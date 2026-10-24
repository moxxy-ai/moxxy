export interface FakeCliOptions {
  /** On Windows: where the `.cmd` shim's script goes, relative to the shim's folder. */
  readonly windowsEntry?: string;
  readonly platform?: NodeJS.Platform;
}
export declare function writeFakeCli(file: string, script: string, opts?: FakeCliOptions): string;
export declare function fakeInstaller(dir: string, script: string): { readonly posix: string; readonly windows: string };
