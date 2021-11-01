'use strict';
import { randomBytes } from 'crypto';
import { TextDecoder } from 'util';
import {
	CancellationToken,
	commands,
	ConfigurationTarget,
	CustomTextEditorProvider,
	Disposable,
	Position,
	Range,
	TextDocument,
	Uri,
	WebviewPanel,
	window,
	workspace,
	WorkspaceEdit,
} from 'vscode';
import { ShowQuickCommitCommand } from '../commands';
import { configuration } from '../configuration';
import { BuiltInCommands } from '../constants';
import { Container } from '../container';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/git';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { debug, gate, Iterables, Strings } from '../system';
import {
	Author,
	Commit,
	IpcMessage,
	onIpcCommand,
	RebaseDidAbortCommandType,
	RebaseDidChangeEntryCommandType,
	RebaseDidChangeNotificationType,
	RebaseDidDisableCommandType,
	RebaseDidMoveEntryCommandType,
	RebaseDidStartCommandType,
	RebaseDidSwitchCommandType,
	RebaseEntry,
	RebaseEntryAction,
	RebaseState,
} from './protocol';

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === Number.MAX_SAFE_INTEGER) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `host:${ipcSequence}`;
}

let webviewId = 0;
function nextWebviewId() {
	if (webviewId === Number.MAX_SAFE_INTEGER) {
		webviewId = 1;
	} else {
		webviewId++;
	}

	return webviewId;
}

const rebaseRegex = /^\s?#\s?Rebase\s([0-9a-f]+)(?:..([0-9a-f]+))?\sonto\s([0-9a-f]+)\s.*$/im;
const rebaseCommandsRegex = /^\s?(p|pick|r|reword|e|edit|s|squash|f|fixup|d|drop)\s([0-9a-f]+?)\s(.*)$/gm;

const rebaseActionsMap = new Map<string, RebaseEntryAction>([
	['p', 'pick'],
	['pick', 'pick'],
	['r', 'reword'],
	['reword', 'reword'],
	['e', 'edit'],
	['edit', 'edit'],
	['s', 'squash'],
	['squash', 'squash'],
	['f', 'fixup'],
	['fixup', 'fixup'],
	['d', 'drop'],
	['drop', 'drop'],
]);

interface RebaseEditorContext {
	dispose(): void;

	readonly id: number;
	readonly document: TextDocument;
	readonly panel: WebviewPanel;
	readonly repoPath: string;
	readonly subscriptions: Disposable[];

	abortOnClose: boolean;
	pendingChange?: boolean;
}

export class RebaseEditorProvider implements CustomTextEditorProvider, Disposable {
	private readonly _disposable: Disposable;

	constructor() {
		this._disposable = Disposable.from(
			window.registerCustomEditorProvider('gitlens.rebase', this, {
				supportsMultipleEditorsPerDocument: false,
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			}),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	get enabled(): boolean {
		const associations = configuration.inspectAny<
			{ [key: string]: string } | { viewType: string; filenamePattern: string }[]
		>('workbench.editorAssociations')?.globalValue;
		if (associations == null || associations.length === 0) return true;

		if (Array.isArray(associations)) {
			const association = associations.find(a => a.filenamePattern === 'git-rebase-todo');
			return association != null ? association.viewType === 'gitlens.rebase' : true;
		}

		const association = associations['git-rebase-todo'];
		return association != null ? association === 'gitlens.rebase' : true;
	}

	private _disableAfterNextUse: boolean = false;
	async enableForNextUse() {
		if (!this.enabled) {
			await this.setEnabled(true);
			this._disableAfterNextUse = true;
		}
	}

	async setEnabled(enabled: boolean): Promise<void> {
		this._disableAfterNextUse = false;

		const inspection = configuration.inspectAny<
			{ [key: string]: string } | { viewType: string; filenamePattern: string }[]
		>('workbench.editorAssociations');

		let associations = inspection?.globalValue;
		if (Array.isArray(associations)) {
			associations = associations.reduce((accumulator, current) => {
				accumulator[current.filenamePattern] = current.viewType;
				return accumulator;
			}, Object.create(null) as Record<string, string>);
		}

		if (associations == null) {
			if (enabled) return;

			associations = {
				'git-rebase-todo': 'default',
			};
		} else {
			associations['git-rebase-todo'] = enabled ? 'gitlens.rebase' : 'default';
		}

		await configuration.updateAny('workbench.editorAssociations', associations, ConfigurationTarget.Global);
	}

	@debug<RebaseEditorProvider['resolveCustomTextEditor']>({ args: false })
	async resolveCustomTextEditor(document: TextDocument, panel: WebviewPanel, _token: CancellationToken) {
		const repoPath = Strings.normalizePath(Uri.joinPath(document.uri, '..', '..', '..').fsPath);
		const repo = await Container.git.getRepository(repoPath);

		const subscriptions: Disposable[] = [];
		const context: RebaseEditorContext = {
			dispose: () => Disposable.from(...subscriptions).dispose(),

			id: nextWebviewId(),
			subscriptions: subscriptions,
			document: document,
			panel: panel,
			repoPath: repo?.path ?? repoPath,
			abortOnClose: true,
		};

		subscriptions.push(
			panel.onDidDispose(() => {
				// If the user closed this without taking an action, consider it an abort
				if (context.abortOnClose) {
					void this.abort(context);
				}
				Disposable.from(...subscriptions).dispose();
			}),
			panel.onDidChangeViewState(() => {
				if (!context.pendingChange) return;

				void this.getStateAndNotify(context);
			}),
			panel.webview.onDidReceiveMessage(e => this.onMessageReceived(context, e)),
			workspace.onDidChangeTextDocument(e => {
				if (e.contentChanges.length === 0 || e.document.uri.toString() !== document.uri.toString()) return;

				void this.getStateAndNotify(context);
			}),
			workspace.onDidSaveTextDocument(e => {
				if (e.uri.toString() !== document.uri.toString()) return;

				void this.getStateAndNotify(context);
			}),
		);

		if (repo != null) {
			subscriptions.push(
				repo.onDidChange(e => {
					if (!e.changed(RepositoryChange.Rebase, RepositoryChangeComparisonMode.Any)) return;

					void this.getStateAndNotify(context);
				}),
			);
		}

		panel.webview.options = { enableCommandUris: true, enableScripts: true };
		panel.webview.html = await this.getHtml(context);

		if (this._disableAfterNextUse) {
			this._disableAfterNextUse = false;
			void this.setEnabled(false);
		}
	}

	@gate((context: RebaseEditorContext) => `${context.id}`)
	private async getStateAndNotify(context: RebaseEditorContext) {
		if (!context.panel.visible) {
			context.pendingChange = true;

			return;
		}

		const state = await this.parseState(context);
		void this.postMessage(context, {
			id: nextIpcId(),
			method: RebaseDidChangeNotificationType.method,
			params: { state: state },
		});
	}

	private async parseState(context: RebaseEditorContext): Promise<RebaseState> {
		const branch = await Container.git.getBranch(context.repoPath);
		const state = await parseRebaseTodo(context.document.getText(), context.repoPath, branch?.name);
		return state;
	}

	private async postMessage(context: RebaseEditorContext, message: IpcMessage) {
		try {
			const success = await context.panel.webview.postMessage(message);
			context.pendingChange = !success;
			return success;
		} catch (ex) {
			Logger.error(ex);

			context.pendingChange = true;
			return false;
		}
	}

	private onMessageReceived(context: RebaseEditorContext, e: IpcMessage) {
		switch (e.method) {
			// case ReadyCommandType.method:
			// 	onIpcCommand(ReadyCommandType, e, params => {
			// 		this.parseDocumentAndSendChange(panel, document);
			// 	});

			// 	break;

			case RebaseDidAbortCommandType.method:
				onIpcCommand(RebaseDidAbortCommandType, e, () => this.abort(context));

				break;

			case RebaseDidDisableCommandType.method:
				onIpcCommand(RebaseDidDisableCommandType, e, () => this.disable(context));
				break;

			case RebaseDidStartCommandType.method:
				onIpcCommand(RebaseDidStartCommandType, e, () => this.rebase(context));
				break;

			case RebaseDidSwitchCommandType.method:
				onIpcCommand(RebaseDidSwitchCommandType, e, () => this.switch(context));
				break;

			case RebaseDidChangeEntryCommandType.method:
				onIpcCommand(RebaseDidChangeEntryCommandType, e, async params => {
					const entries = parseRebaseTodoEntries(context.document);

					const entry = entries.find(e => e.ref === params.ref);
					if (entry == null) return;

					const start = context.document.positionAt(entry.index);
					const range = context.document.validateRange(
						new Range(new Position(start.line, 0), new Position(start.line, Number.MAX_SAFE_INTEGER)),
					);

					let action = params.action;
					const edit = new WorkspaceEdit();

					// Fake the new set of entries, to check if last entry is a squash/fixup
					const newEntries = [...entries];
					newEntries.splice(entries.indexOf(entry), 1, {
						...entry,
						action: params.action,
					});

					let squashing = false;

					for (const entry of newEntries) {
						if (entry.action === 'squash' || entry.action === 'fixup') {
							squashing = true;
						} else if (squashing) {
							if (entry.action !== 'drop') {
								squashing = false;
							}
						}
					}

					// Ensure that the last entry isn't a squash/fixup
					if (squashing) {
						const lastEntry = newEntries[newEntries.length - 1];
						if (entry.ref === lastEntry.ref) {
							action = 'pick';
						} else {
							const start = context.document.positionAt(lastEntry.index);
							const range = context.document.validateRange(
								new Range(
									new Position(start.line, 0),
									new Position(start.line, Number.MAX_SAFE_INTEGER),
								),
							);

							edit.replace(context.document.uri, range, `pick ${lastEntry.ref} ${lastEntry.message}`);
						}
					}

					edit.replace(context.document.uri, range, `${action} ${entry.ref} ${entry.message}`);
					await workspace.applyEdit(edit);
				});

				break;

			case RebaseDidMoveEntryCommandType.method:
				onIpcCommand(RebaseDidMoveEntryCommandType, e, async params => {
					const entries = parseRebaseTodoEntries(context.document);

					const entry = entries.find(e => e.ref === params.ref);
					if (entry == null) return;

					const index = entries.findIndex(e => e.ref === params.ref);

					let newIndex;
					if (params.relative) {
						if ((params.to === -1 && index === 0) || (params.to === 1 && index === entries.length - 1)) {
							return;
						}

						newIndex = index + params.to;
					} else {
						if (index === params.to) return;

						newIndex = params.to;
					}

					const newEntry = entries[newIndex];
					let newLine = context.document.positionAt(newEntry.index).line;
					if (newIndex < index) {
						newLine++;
					}

					const start = context.document.positionAt(entry.index);
					const range = context.document.validateRange(
						new Range(new Position(start.line, 0), new Position(start.line + 1, 0)),
					);

					// Fake the new set of entries, so we can ensure that the last entry isn't a squash/fixup
					const newEntries = [...entries];
					newEntries.splice(index, 1);
					newEntries.splice(newIndex, 0, entry);

					let squashing = false;

					for (const entry of newEntries) {
						if (entry.action === 'squash' || entry.action === 'fixup') {
							squashing = true;
						} else if (squashing) {
							if (entry.action !== 'drop') {
								squashing = false;
							}
						}
					}

					const edit = new WorkspaceEdit();

					let action = entry.action;

					// Ensure that the last entry isn't a squash/fixup
					if (squashing) {
						const lastEntry = newEntries[newEntries.length - 1];
						if (entry.ref === lastEntry.ref) {
							action = 'pick';
						} else {
							const start = context.document.positionAt(lastEntry.index);
							const range = context.document.validateRange(
								new Range(
									new Position(start.line, 0),
									new Position(start.line, Number.MAX_SAFE_INTEGER),
								),
							);

							edit.replace(context.document.uri, range, `pick ${lastEntry.ref} ${lastEntry.message}`);
						}
					}

					edit.delete(context.document.uri, range);
					edit.insert(
						context.document.uri,
						new Position(newLine, 0),
						`${action} ${entry.ref} ${entry.message}\n`,
					);

					await workspace.applyEdit(edit);
				});

				break;
		}
	}

	private async abort(context: RebaseEditorContext) {
		context.abortOnClose = false;

		// Avoid triggering events by disposing them first
		context.dispose();

		// Delete the contents to abort the rebase
		const edit = new WorkspaceEdit();
		edit.replace(context.document.uri, new Range(0, 0, context.document.lineCount, 0), '');
		await workspace.applyEdit(edit);
		await context.document.save();

		context.panel.dispose();
	}

	private async disable(context: RebaseEditorContext) {
		await this.abort(context);
		await this.setEnabled(false);
	}

	private async rebase(context: RebaseEditorContext) {
		context.abortOnClose = false;

		// Avoid triggering events by disposing them first
		context.dispose();

		await context.document.save();

		context.panel.dispose();
	}

	private switch(context: RebaseEditorContext) {
		context.abortOnClose = false;

		void Messages.showRebaseSwitchToTextWarningMessage();

		// Open the text version of the document
		void commands.executeCommand(BuiltInCommands.Open, context.document.uri, {
			override: false,
			preview: false,
		});
	}

	private async getHtml(context: RebaseEditorContext): Promise<string> {
		const uri = Uri.joinPath(Container.context.extensionUri, 'dist', 'webviews', 'rebase.html');
		const content = new TextDecoder('utf8').decode(await workspace.fs.readFile(uri));

		const bootstrap = await this.parseState(context);
		const cspSource = context.panel.webview.cspSource;
		const cspNonce = randomBytes(16).toString('base64');
		const root = context.panel.webview.asWebviewUri(Container.context.extensionUri).toString();

		const html = content
			.replace(/#{(head|body|endOfBody)}/i, (_substring, token) => {
				switch (token) {
					case 'endOfBody':
						return `<script type="text/javascript" nonce="#{cspNonce}">window.bootstrap = ${JSON.stringify(
							bootstrap,
						)};</script>`;
					default:
						return '';
				}
			})
			.replace(/#{(cspSource|cspNonce|root)}/g, (substring, token) => {
				switch (token) {
					case 'cspSource':
						return cspSource;
					case 'cspNonce':
						return cspNonce;
					case 'root':
						return root;
					default:
						return '';
				}
			});

		return html;
	}
}

async function parseRebaseTodo(
	contents: string | { entries: RebaseEntry[]; onto: string },
	repoPath: string,
	branch: string | undefined,
): Promise<Omit<RebaseState, 'rebasing'>> {
	let onto: string;
	let entries;
	if (typeof contents === 'string') {
		entries = parseRebaseTodoEntries(contents);
		[, , , onto] = rebaseRegex.exec(contents) ?? ['', '', ''];
	} else {
		({ entries, onto } = contents);
	}

	const authors = new Map<string, Author>();
	const commits: Commit[] = [];

	const log = await Container.git.getLogForSearch(repoPath, {
		pattern: `${onto ? `#:${onto} ` : ''}${Iterables.join(
			Iterables.map(entries, e => `#:${e.ref}`),
			' ',
		)}`,
	});
	const foundCommits = log != null ? [...log.commits.values()] : [];

	const ontoCommit = onto ? foundCommits.find(c => c.ref.startsWith(onto)) : undefined;
	if (ontoCommit != null) {
		if (!authors.has(ontoCommit.author)) {
			authors.set(ontoCommit.author, {
				author: ontoCommit.author,
				avatarUrl: (
					await ontoCommit.getAvatarUri({ defaultStyle: Container.config.defaultGravatarsStyle })
				).toString(true),
				email: ontoCommit.email,
			});
		}

		commits.push({
			ref: ontoCommit.ref,
			author: ontoCommit.author,
			date: ontoCommit.formatDate(Container.config.defaultDateFormat),
			dateFromNow: ontoCommit.formatDateFromNow(),
			message: ontoCommit.message || 'root',
		});
	}

	for (const entry of entries) {
		const commit = foundCommits.find(c => c.ref.startsWith(entry.ref));
		if (commit == null) continue;

		// If the onto commit is contained in the list of commits, remove it and clear the 'onto' value — See #1201
		if (commit.ref === ontoCommit?.ref) {
			commits.splice(0, 1);
			onto = '';
		}

		if (!authors.has(commit.author)) {
			authors.set(commit.author, {
				author: commit.author,
				avatarUrl: (
					await commit.getAvatarUri({ defaultStyle: Container.config.defaultGravatarsStyle })
				).toString(true),
				email: commit.email,
			});
		}

		commits.push({
			ref: commit.ref,
			author: commit.author,
			date: commit.formatDate(Container.config.defaultDateFormat),
			dateFromNow: commit.formatDateFromNow(),
			message: commit.message,
		});
	}

	return {
		branch: branch ?? '',
		onto: onto,
		entries: entries,
		authors: [...authors.values()],
		commits: commits,
		commands: {
			commit: ShowQuickCommitCommand.getMarkdownCommandArgs(`\${commit}`, repoPath),
		},
	};
}

function parseRebaseTodoEntries(contents: string): RebaseEntry[];
function parseRebaseTodoEntries(document: TextDocument): RebaseEntry[];
function parseRebaseTodoEntries(contentsOrDocument: string | TextDocument): RebaseEntry[] {
	const contents = typeof contentsOrDocument === 'string' ? contentsOrDocument : contentsOrDocument.getText();

	const entries: RebaseEntry[] = [];

	let match;
	let action;
	let ref;
	let message;

	do {
		match = rebaseCommandsRegex.exec(contents);
		if (match == null) break;

		[, action, ref, message] = match;

		entries.push({
			index: match.index,
			action: rebaseActionsMap.get(action) ?? 'pick',
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			ref: ` ${ref}`.substr(1),
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			message: message == null || message.length === 0 ? '' : ` ${message}`.substr(1),
		});
	} while (true);

	return entries.reverse();
}
