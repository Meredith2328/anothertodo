import { execa } from "execa";

export type GitResult = { exitCode: number; stdout: string; stderr: string };

export interface GitRunner {
  run(args: readonly string[], options?: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<GitResult>;
}

export const gitRunner: GitRunner = {
  async run(args, options) {
    const result = await execa("git", [...args], { cwd: options?.cwd ?? process.cwd(), ...(options?.env ? { env: options.env } : {}), reject: false });
    return { exitCode: result.exitCode ?? 1, stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""), stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "") };
  },
};

export const gitOrThrow = async (runner: GitRunner, args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<GitResult> => {
  const result = await runner.run(args, env ? { cwd, env } : { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} 失败：${(result.stderr || result.stdout).trim()}`);
  return result;
};
