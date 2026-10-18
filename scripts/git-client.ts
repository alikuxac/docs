import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

export interface IExecGitOptions {
  cwd?: string;
  maxBuffer?: number;
}

export class GitClient {
  public static async runGit(args: string[], options: IExecGitOptions = {}): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: options.cwd,
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      });
      return stdout.trim();
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Git command failed: git ${args.join(' ')}\nCause: ${errMsg}`);
    }
  }

  public static async ensureRepoClone(remote: string, targetDir: string): Promise<void> {
    const gitDir = path.join(targetDir, '.git');
    const isCloned = await this.directoryExists(gitDir);

    if (!isCloned) {
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await this.runGit(['clone', '--filter=blob:none', '--no-checkout', remote, targetDir]);
      await this.runGit(['sparse-checkout', 'init', '--cone'], { cwd: targetDir });
    } else {
      await this.runGit(['fetch', '--all', '--tags', '--prune'], { cwd: targetDir });
    }
  }

  public static async checkoutSparse(
    repoDir: string,
    ref: string,
    docRoot: string
  ): Promise<void> {
    const normalizedRoot = docRoot === '.' ? '' : docRoot;
    if (normalizedRoot) {
      await this.runGit(['sparse-checkout', 'set', normalizedRoot], { cwd: repoDir });
    } else {
      await this.runGit(['sparse-checkout', 'disable'], { cwd: repoDir });
    }
    await this.runGit(['checkout', ref, '--force'], { cwd: repoDir });
  }

  public static async getLatestTagOnBranch(
    repoDir: string,
    branch: string
  ): Promise<string | null> {
    try {
      const output = await this.runGit(
        ['tag', '--merged', `origin/${branch}`, '--sort=-creatordate'],
        { cwd: repoDir }
      );
      const tags = output.split('\n').map((t) => t.trim()).filter(Boolean);
      return tags.length > 0 ? tags[0] : null;
    } catch {
      return null;
    }
  }

  public static async getDefaultBranch(
    repoDir: string,
    fallbackBranch = 'main'
  ): Promise<string> {
    try {
      const output = await this.runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: repoDir,
      });
      const branch = output.trim().replace(/^refs\/remotes\/origin\//, '');
      if (branch) return branch;
    } catch {
      try {
        await this.runGit(['remote', 'set-head', 'origin', '-a'], { cwd: repoDir });
        const output = await this.runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
          cwd: repoDir,
        });
        const branch = output.trim().replace(/^refs\/remotes\/origin\//, '');
        if (branch) return branch;
      } catch {
      }
    }

    if (await this.hasBranch(repoDir, 'main')) return 'main';
    if (await this.hasBranch(repoDir, 'master')) return 'master';
    return fallbackBranch;
  }

  public static async hasBranch(repoDir: string, branch: string): Promise<boolean> {
    try {
      const output = await this.runGit(['branch', '-r', '--list', `origin/${branch}`], {
        cwd: repoDir,
      });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  public static async getCommitSha(repoDir: string, ref: string): Promise<string | null> {
    try {
      const output = await this.runGit(['rev-parse', `${ref}^{commit}`], {
        cwd: repoDir,
      });
      return output.trim();
    } catch {
      return null;
    }
  }

  public static async isBranchHeadSameAsTag(
    repoDir: string,
    branch: string,
    tag: string
  ): Promise<boolean> {
    try {
      const branchSha = await this.getCommitSha(repoDir, `origin/${branch}`);
      const tagSha = await this.getCommitSha(repoDir, tag);
      return Boolean(branchSha && tagSha && branchSha === tagSha);
    } catch {
      return false;
    }
  }

  public static async hasDocDiffBetween(
    repoDir: string,
    baseRef: string,
    targetRef: string,
    docRoot: string
  ): Promise<boolean> {
    try {
      const normalizedRoot = docRoot === '.' ? '' : docRoot;
      const args = ['diff', '--name-only', baseRef, targetRef];
      if (normalizedRoot) {
        args.push('--', normalizedRoot);
      }
      const output = await this.runGit(args, { cwd: repoDir });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  private static async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
