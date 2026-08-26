export interface CliIo {
  readonly signal?: AbortSignal;
  openLocalArtifact?(absolutePath: string, signal?: AbortSignal): Promise<void>;
  writeOut(message: string): void;
  writeError(message: string): void;
}

export interface CliCommand {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly requiredArgument: string;
  execute(args: readonly string[], io: CliIo): Promise<number>;
}
