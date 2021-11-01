'use strict';
import { TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitReference } from '../git/git';
import { GitUri } from '../git/gitUri';
import { ActiveEditorCachedCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { executeGitCommand } from './gitCommands';

export interface ShowQuickBranchHistoryCommandArgs {
	repoPath?: string;
	branch?: string;
	tag?: string;
}

@command()
export class ShowQuickBranchHistoryCommand extends ActiveEditorCachedCommand {
	constructor() {
		super([Commands.ShowQuickBranchHistory, Commands.ShowQuickCurrentBranchHistory]);
	}

	protected override preExecute(context: CommandContext, args?: ShowQuickBranchHistoryCommandArgs) {
		if (context.command === Commands.ShowQuickCurrentBranchHistory) {
			args = { ...args };
			args.branch = 'HEAD';
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickBranchHistoryCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = args?.repoPath ?? gitUri?.repoPath ?? Container.git.getHighlanderRepoPath();
		let ref: GitReference | 'HEAD' | undefined;
		if (repoPath != null) {
			if (args?.branch != null) {
				ref =
					args.branch === 'HEAD'
						? 'HEAD'
						: GitReference.create(args.branch, repoPath, {
								refType: 'branch',
								name: args.branch,
								remote: false,
						  });
			} else if (args?.tag != null) {
				ref = GitReference.create(args.tag, repoPath, { refType: 'tag', name: args.tag });
			}
		}

		return executeGitCommand({
			command: 'log',
			state: repoPath != null ? { repo: repoPath, reference: ref } : {},
		});
	}
}
