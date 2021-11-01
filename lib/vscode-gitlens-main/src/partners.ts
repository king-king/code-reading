'use strict';
import { CancellationTokenSource, commands, Extension, ExtensionContext, extensions, Uri } from 'vscode';
import type { ActionContext, HoverCommandsActionContext } from './api/gitlens';
import { Commands, executeCommand, InviteToLiveShareCommandArgs } from './commands';
import { BuiltInCommands } from './constants';
import { Container } from './container';

export async function installExtension<T>(
	extensionId: string,
	tokenSource: CancellationTokenSource,
	timeout: number,
	vsix?: Uri,
): Promise<Extension<T> | undefined> {
	try {
		let timer: any = 0;
		const extension = new Promise<Extension<any> | undefined>(resolve => {
			const disposable = extensions.onDidChange(() => {
				const extension = extensions.getExtension(extensionId);
				if (extension != null) {
					clearTimeout(timer);
					disposable.dispose();

					resolve(extension);
				}
			});

			tokenSource.token.onCancellationRequested(() => {
				disposable.dispose();

				resolve(undefined);
			});
		});

		await commands.executeCommand(BuiltInCommands.InstallExtension, vsix ?? extensionId);
		// Wait for extension activation until timeout expires
		timer = setTimeout(() => tokenSource.cancel(), timeout);

		return extension;
	} catch {
		tokenSource.cancel();
		return undefined;
	}
}

export function registerPartnerActionRunners(context: ExtensionContext): void {
	registerLiveShare(context);
}

function registerLiveShare(context: ExtensionContext) {
	context.subscriptions.push(
		Container.actionRunners.registerBuiltInPartner<HoverCommandsActionContext>('liveshare', 'hover.commands', {
			name: 'Live Share',
			label: (context: ActionContext) => {
				if (context.type === 'hover.commands') {
					if (context.commit.author.name !== 'You') {
						return `$(live-share) Invite ${context.commit.author.name}${
							// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
							context.commit.author.presence?.statusText
								? ` (${context.commit.author.presence?.statusText})`
								: ''
						} to a Live Share Session`;
					}
				}

				return '$(live-share) Start a Live Share Session';
			},
			run: async (context: ActionContext) => {
				if (context.type !== 'hover.commands' || context.commit.author.name === 'You') {
					await executeCommand<InviteToLiveShareCommandArgs>(Commands.InviteToLiveShare, {});

					return;
				}

				await executeCommand<InviteToLiveShareCommandArgs>(Commands.InviteToLiveShare, {
					email: context.commit.author.email,
				});
			},
		}),
	);
}
