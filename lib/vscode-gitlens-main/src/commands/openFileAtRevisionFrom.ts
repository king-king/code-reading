'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import { GitReference } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Messages } from '../messages';
import { ReferencePicker } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { GitActions } from './gitCommands';

export interface OpenFileAtRevisionFromCommandArgs {
	reference?: GitReference;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenFileAtRevisionFromCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenFileAtRevisionFrom);
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileAtRevisionFromCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) {
			void Messages.showNoRepositoryWarningMessage('Unable to open file revision');
			return;
		}

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		if (args.reference == null) {
			const title = `Open File at Branch or Tag${Strings.pad(GlyphChars.Dot, 2, 2)}`;
			const pick = await ReferencePicker.show(
				gitUri.repoPath,
				`${title}${gitUri.getFormattedFilename({ truncateTo: quickPickTitleMaxChars - title.length })}`,
				'Choose a branch or tag to open the file revision from',
				{
					allowEnteringRefs: true,
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (key, quickpick) => {
						const [item] = quickpick.activeItems;
						if (item != null) {
							void (await GitActions.Commit.openFileAtRevision(
								GitUri.toRevisionUri(item.ref, gitUri.fsPath, gitUri.repoPath!),
								{
									annotationType: args!.annotationType,
									line: args!.line,
									preserveFocus: true,
									preview: false,
								},
							));
						}
					},
				},
			);
			if (pick == null) return;

			args.reference = pick;
		}

		void (await GitActions.Commit.openFileAtRevision(
			GitUri.toRevisionUri(args.reference.ref, gitUri.fsPath, gitUri.repoPath),
			{
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			},
		));
	}
}
