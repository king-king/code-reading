'use strict';
import { TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitLog, GitLogCommit } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import {
	ActiveEditorCachedCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandContextViewNodeHasCommit,
} from './common';
import { executeGitCommand, GitActions } from './gitCommands';

export interface ShowQuickCommitCommandArgs {
	repoPath?: string;
	sha?: string;
	commit?: GitCommit | GitLogCommit;
	repoLog?: GitLog;
	revealInView?: boolean;
}

@command()
export class ShowQuickCommitCommand extends ActiveEditorCachedCommand {
	static getMarkdownCommandArgs(sha: string, repoPath?: string): string;
	static getMarkdownCommandArgs(args: ShowQuickCommitCommandArgs): string;
	static getMarkdownCommandArgs(argsOrSha: ShowQuickCommitCommandArgs | string, repoPath?: string): string {
		const args = typeof argsOrSha === 'string' ? { sha: argsOrSha, repoPath: repoPath } : argsOrSha;
		return super.getMarkdownCommandArgsCore<ShowQuickCommitCommandArgs>(Commands.ShowQuickCommit, args);
	}

	constructor() {
		super([Commands.RevealCommitInView, Commands.ShowQuickCommit]);
	}

	protected override preExecute(context: CommandContext, args?: ShowQuickCommitCommandArgs) {
		if (context.command === Commands.RevealCommitInView) {
			args = { ...args };
			args.revealInView = true;
		}

		if (context.type === 'viewItem') {
			args = { ...args };
			args.sha = context.node.uri.sha;

			if (isCommandContextViewNodeHasCommit(context)) {
				args.commit = context.node.commit;
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickCommitCommandArgs) {
		let gitUri;
		let repoPath;
		if (args?.commit == null) {
			if (args?.repoPath != null && args.sha != null) {
				repoPath = args.repoPath;
				gitUri = GitUri.fromRepoPath(repoPath);
			} else {
				uri = getCommandUri(uri, editor);
				if (uri == null) return;

				gitUri = await GitUri.fromUri(uri);
				repoPath = gitUri.repoPath;
			}
		} else {
			if (args.sha == null) {
				args.sha = args.commit.sha;
			}

			gitUri = args.commit.toGitUri();
			repoPath = args.commit.repoPath;

			if (uri == null) {
				uri = args.commit.uri;
			}
		}

		args = { ...args };
		if (args.sha == null) {
			if (editor == null) return;

			const blameline = editor.selection.active.line;
			if (blameline < 0) return;

			try {
				const blame = await Container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) {
					void Messages.showFileNotUnderSourceControlWarningMessage('Unable to show commit');

					return;
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					void Messages.showLineUncommittedWarningMessage('Unable to show commit');

					return;
				}

				args.sha = blame.commit.sha;
				repoPath = blame.commit.repoPath;

				args.commit = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'ShowQuickCommitCommand', `getBlameForLine(${blameline})`);
				void Messages.showGenericErrorMessage('Unable to show commit');

				return;
			}
		}

		try {
			if (args.commit == null || args.commit.isFile) {
				if (args.repoLog != null) {
					args.commit = args.repoLog.commits.get(args.sha);
					// If we can't find the commit, kill the repoLog
					if (args.commit == null) {
						args.repoLog = undefined;
					}
				}

				if (args.repoLog == null) {
					args.commit = await Container.git.getCommit(repoPath!, args.sha);
				}
			}

			if (args.commit == null) {
				void Messages.showCommitNotFoundWarningMessage('Unable to show commit');

				return;
			}

			if (args.revealInView) {
				void (await GitActions.Commit.reveal(args.commit, {
					select: true,
					focus: true,
					expand: true,
				}));

				return;
			}

			void (await executeGitCommand({
				command: 'show',
				state: {
					repo: repoPath!,
					reference: args.commit as GitLogCommit,
				},
			}));
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCommitCommand');
			void Messages.showGenericErrorMessage('Unable to show commit');
		}
	}
}
