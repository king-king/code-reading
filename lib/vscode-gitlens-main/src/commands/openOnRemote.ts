'use strict';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitRemote, GitRevision, RemoteProvider, RemoteResource, RemoteResourceType } from '../git/git';
import { Logger } from '../logger';
import { Messages } from '../messages';
import {
	CopyOrOpenRemoteCommandQuickPickItem,
	RemoteProviderPicker,
	SetADefaultRemoteCommandQuickPickItem,
} from '../quickpicks';
import { Strings } from '../system';
import { Command, command, Commands } from './common';

export type OpenOnRemoteCommandArgs =
	| {
			resource: RemoteResource;
			repoPath: string;

			remote?: string;
			clipboard?: boolean;
	  }
	| {
			resource: RemoteResource;
			remotes: GitRemote<RemoteProvider>[];

			remote?: string;
			clipboard?: boolean;
	  };

@command()
export class OpenOnRemoteCommand extends Command {
	constructor() {
		super([Commands.OpenOnRemote, Commands.Deprecated_OpenInRemote]);
	}

	async execute(args?: OpenOnRemoteCommandArgs) {
		if (args?.resource == null) return;

		let remotes = 'remotes' in args ? args.remotes : await Container.git.getRemotes(args.repoPath);

		if (args.remote != null) {
			const filtered = remotes.filter(r => r.name === args.remote);
			// Only filter if we get some results
			if (remotes.length > 0) {
				remotes = filtered;
			}
		}

		try {
			if (args.resource.type === RemoteResourceType.Branch) {
				// Check to see if the remote is in the branch
				const [remoteName, branchName] = Strings.splitSingle(args.resource.branch, '/');
				if (branchName != null) {
					const remote = remotes.find(r => r.name === remoteName);
					if (remote != null) {
						args.resource.branch = branchName;
						remotes = [remote];
					}
				}
			} else if (args.resource.type === RemoteResourceType.Revision) {
				const { commit, fileName } = args.resource;
				if (commit != null) {
					const file = commit?.files.find(f => f.fileName === fileName);
					if (file?.status === 'D') {
						// Resolve to the previous commit to that file
						args.resource.sha = await Container.git.resolveReference(
							commit.repoPath,
							`${commit.sha}^`,
							fileName,
						);
					} else {
						args.resource.sha = commit.sha;
					}
				}
			}

			const providers = GitRemote.getHighlanderProviders(remotes);
			const provider = providers?.length ? providers[0].name : 'Remote';

			const options: Parameters<typeof RemoteProviderPicker.show>[4] = {
				autoPick: 'default',
				clipboard: args.clipboard,
				setDefault: true,
			};
			let title;
			let placeHolder = `Choose which remote to ${args.clipboard ? 'copy the url for' : 'open on'}`;

			switch (args.resource.type) {
				case RemoteResourceType.Branch:
					title = `${
						args.clipboard ? `Copy ${provider} Branch Url` : `Open Branch on ${provider}`
					}${Strings.pad(GlyphChars.Dot, 2, 2)}${args.resource.branch}`;
					break;

				case RemoteResourceType.Branches:
					title = `${args.clipboard ? `Copy ${provider} Branches Url` : `Open Branches on ${provider}`}`;
					break;

				case RemoteResourceType.Commit:
					title = `${
						args.clipboard ? `Copy ${provider} Commit Url` : `Open Commit on ${provider}`
					}${Strings.pad(GlyphChars.Dot, 2, 2)}${GitRevision.shorten(args.resource.sha)}`;
					break;

				case RemoteResourceType.Comparison:
					title = `${
						args.clipboard ? `Copy ${provider} Comparison Url` : `Open Comparison on ${provider}`
					}${Strings.pad(GlyphChars.Dot, 2, 2)}${GitRevision.createRange(
						args.resource.base,
						args.resource.compare,
						args.resource.notation ?? '...',
					)}`;
					break;

				case RemoteResourceType.CreatePullRequest:
					options.autoPick = true;
					options.setDefault = false;

					title = `${
						args.clipboard
							? `Copy ${provider} Create Pull Request Url`
							: `Create Pull Request on ${provider}`
					}${Strings.pad(GlyphChars.Dot, 2, 2)}${
						args.resource.base?.branch
							? GitRevision.createRange(args.resource.base.branch, args.resource.compare.branch, '...')
							: args.resource.compare.branch
					}`;

					placeHolder = `Choose which remote to ${
						args.clipboard ? 'copy the create pull request url for' : 'create the pull request on'
					}`;
					break;

				case RemoteResourceType.File:
					title = `${args.clipboard ? `Copy ${provider} File Url` : `Open File on ${provider}`}${Strings.pad(
						GlyphChars.Dot,
						2,
						2,
					)}${args.resource.fileName}`;
					break;

				case RemoteResourceType.Repo:
					title = `${args.clipboard ? `Copy ${provider} Repository Url` : `Open Repository on ${provider}`}`;
					break;

				case RemoteResourceType.Revision: {
					title = `${args.clipboard ? `Copy ${provider} File Url` : `Open File on ${provider}`}${Strings.pad(
						GlyphChars.Dot,
						2,
						2,
					)}${GitRevision.shorten(args.resource.sha)}${Strings.pad(GlyphChars.Dot, 1, 1)}${
						args.resource.fileName
					}`;
					break;
				}
			}

			const pick = await RemoteProviderPicker.show(title, placeHolder, args.resource, remotes, options);

			if (pick instanceof SetADefaultRemoteCommandQuickPickItem) {
				const remote = await pick.execute();
				if (remote != null) {
					void (await new CopyOrOpenRemoteCommandQuickPickItem(
						remote,
						args.resource,
						args.clipboard,
					).execute());
				}

				return;
			}

			void (await pick?.execute());
		} catch (ex) {
			Logger.error(ex, 'OpenOnRemoteCommand');
			void Messages.showGenericErrorMessage('Unable to open in remote provider');
		}
	}
}
