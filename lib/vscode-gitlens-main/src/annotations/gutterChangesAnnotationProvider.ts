'use strict';
import {
	CancellationToken,
	DecorationOptions,
	Disposable,
	Hover,
	languages,
	Position,
	Range,
	Selection,
	TextDocument,
	TextEditor,
	TextEditorDecorationType,
	TextEditorRevealType,
} from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitDiff, GitLogCommit } from '../git/git';
import { Hovers } from '../hovers/hovers';
import { Logger } from '../logger';
import { log, Strings } from '../system';
import { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';
import { AnnotationContext, AnnotationProviderBase } from './annotationProvider';
import { Decorations } from './fileAnnotationController';

export interface ChangesAnnotationContext extends AnnotationContext {
	sha?: string;
	only?: boolean;
}

export class GutterChangesAnnotationProvider extends AnnotationProviderBase<ChangesAnnotationContext> {
	private state: { commit: GitLogCommit | undefined; diffs: GitDiff[] } | undefined;
	private hoverProviderDisposable: Disposable | undefined;

	constructor(editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>) {
		super(FileAnnotationType.Changes, editor, trackedDocument);
	}

	override mustReopen(context?: ChangesAnnotationContext): boolean {
		return this.annotationContext?.sha !== context?.sha || this.annotationContext?.only !== context?.only;
	}

	override clear() {
		this.state = undefined;
		if (this.hoverProviderDisposable != null) {
			this.hoverProviderDisposable.dispose();
			this.hoverProviderDisposable = undefined;
		}
		super.clear();
	}

	selection(_selection?: AnnotationContext['selection']): Promise<void> {
		return Promise.resolve();
	}

	validate(): Promise<boolean> {
		return Promise.resolve(true);
	}

	@log()
	async onProvideAnnotation(context?: ChangesAnnotationContext): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		if (this.mustReopen(context)) {
			this.clear();
		}

		this.annotationContext = context;

		let ref1 = this.trackedDocument.uri.sha;
		let ref2 = context?.sha != null && context.sha !== ref1 ? `${context.sha}^` : undefined;

		let commit: GitLogCommit | undefined;

		let localChanges = ref1 == null && ref2 == null;
		if (localChanges) {
			let ref = await Container.git.getOldestUnpushedRefForFile(
				this.trackedDocument.uri.repoPath!,
				this.trackedDocument.uri.fsPath,
			);
			if (ref != null) {
				ref = `${ref}^`;
				commit = await Container.git.getCommitForFile(
					this.trackedDocument.uri.repoPath,
					this.trackedDocument.uri.fsPath,
					{ ref: ref },
				);
				if (commit != null) {
					if (ref2 != null) {
						ref2 = ref;
					} else {
						ref1 = ref;
						ref2 = '';
					}
				} else {
					localChanges = false;
				}
			} else {
				const status = await Container.git.getStatusForFile(
					this.trackedDocument.uri.repoPath!,
					this.trackedDocument.uri.fsPath,
				);
				const commits = status?.toPsuedoCommits(
					await Container.git.getCurrentUser(this.trackedDocument.uri.repoPath!),
				);
				if (commits?.length) {
					commit = await Container.git.getCommitForFile(
						this.trackedDocument.uri.repoPath,
						this.trackedDocument.uri.fsPath,
					);
					ref1 = 'HEAD';
				} else if (this.trackedDocument.dirty) {
					ref1 = 'HEAD';
				} else {
					localChanges = false;
				}
			}
		}

		if (!localChanges) {
			commit = await Container.git.getCommitForFile(
				this.trackedDocument.uri.repoPath,
				this.trackedDocument.uri.fsPath,
				{
					ref: ref2 ?? ref1,
				},
			);
			if (commit == null) return false;

			if (ref2 != null) {
				ref2 = commit.ref;
			} else {
				ref1 = `${commit.ref}^`;
				ref2 = commit.ref;
			}
		}

		const diffs = (
			await Promise.all(
				ref2 == null && this.editor.document.isDirty
					? [
							Container.git.getDiffForFileContents(
								this.trackedDocument.uri,
								ref1!,
								this.editor.document.getText(),
							),
							Container.git.getDiffForFile(this.trackedDocument.uri, ref1, ref2),
					  ]
					: [Container.git.getDiffForFile(this.trackedDocument.uri, ref1, ref2)],
			)
		).filter(<T>(d?: T): d is T => Boolean(d));
		if (!diffs?.length) return false;

		let start = process.hrtime();

		const decorationsMap = new Map<
			string,
			{ decorationType: TextEditorDecorationType; rangesOrOptions: DecorationOptions[] }
		>();

		// If we want to only show changes from the specified sha, get the blame so we can compare with "visible" shas
		const blame =
			context?.sha != null && context?.only
				? this.editor?.document.isDirty
					? await Container.git.getBlameForFileContents(
							this.trackedDocument.uri,
							this.editor.document.getText(),
					  )
					: await Container.git.getBlameForFile(this.trackedDocument.uri)
				: undefined;

		let selection: Selection | undefined;

		for (const diff of diffs) {
			for (const hunk of diff.hunks) {
				// Only show "visible" hunks
				if (blame != null) {
					let skip = true;

					const sha = context!.sha;
					for (let i = hunk.current.position.start - 1; i < hunk.current.position.end; i++) {
						if (blame.lines[i].sha === sha) {
							skip = false;
						}
					}

					if (skip) {
						continue;
					}
				}

				// Subtract 2 because editor lines are 0-based and we will be adding 1 in the first iteration of the loop
				let count = Math.max(hunk.current.position.start - 2, -1);
				let index = -1;
				for (const hunkLine of hunk.lines) {
					index++;
					count++;

					if (hunkLine.current?.state === 'unchanged') continue;

					// Uncomment this if we want to only show "visible" lines, rather than just visible hunks
					// if (blame != null && blame.lines[count].sha !== context!.sha) {
					// 	continue;
					// }

					const range = this.editor.document.validateRange(
						new Range(new Position(count, 0), new Position(count, Number.MAX_SAFE_INTEGER)),
					);
					if (selection == null) {
						selection = new Selection(range.start, range.end);
					}

					let state;
					if (hunkLine.current == null) {
						const previous = hunk.lines[index - 1];
						if (hunkLine.previous != null && (previous == null || previous.current != null)) {
							// Check if there are more deleted lines than added lines show a deleted indicator
							if (hunk.previous.count > hunk.current.count) {
								state = 'removed';
							} else {
								continue;
							}
						} else {
							continue;
						}
					} else if (hunkLine.current?.state === 'added') {
						if (hunkLine.previous?.state === 'removed') {
							state = 'changed';
						} else {
							state = 'added';
						}
					} else if (hunkLine?.current.state === 'removed') {
						// Check if there are more deleted lines than added lines show a deleted indicator
						if (hunk.previous.count > hunk.current.count) {
							state = 'removed';
						} else {
							continue;
						}
					} else {
						state = 'changed';
					}

					let decoration = decorationsMap.get(state);
					if (decoration == null) {
						decoration = {
							decorationType: (state === 'added'
								? Decorations.changesLineAddedAnnotation
								: state === 'removed'
								? Decorations.changesLineDeletedAnnotation
								: Decorations.changesLineChangedAnnotation)!,
							rangesOrOptions: [{ range: range }],
						};
						decorationsMap.set(state, decoration);
					} else {
						decoration.rangesOrOptions.push({ range: range });
					}
				}
			}
		}

		Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute recent changes annotations`);

		if (decorationsMap.size) {
			start = process.hrtime();

			this.setDecorations([...decorationsMap.values()]);

			Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply recent changes annotations`);

			if (selection != null && context?.selection !== false) {
				this.editor.selection = selection;
				this.editor.revealRange(selection, TextEditorRevealType.InCenterIfOutsideViewport);
			}
		}

		this.state = { commit: commit, diffs: diffs };
		this.registerHoverProvider();
		return true;
	}

	registerHoverProvider() {
		if (!Container.config.hovers.enabled || !Container.config.hovers.annotations.enabled) {
			return;
		}

		this.hoverProviderDisposable = languages.registerHoverProvider(
			{ pattern: this.document.uri.fsPath },
			{
				provideHover: (document: TextDocument, position: Position, token: CancellationToken) =>
					this.provideHover(document, position, token),
			},
		);
	}

	provideHover(document: TextDocument, position: Position, _token: CancellationToken): Hover | undefined {
		if (this.state == null) return undefined;
		if (Container.config.hovers.annotations.over !== 'line' && position.character !== 0) return undefined;

		const { commit, diffs } = this.state;

		for (const diff of diffs) {
			for (const hunk of diff.hunks) {
				// If we have a "mixed" diff hunk, check if we have more deleted lines than added, to include a trailing line for the deleted indicator
				const hasMoreDeletedLines = hunk.state === 'changed' && hunk.previous.count > hunk.current.count;
				if (
					position.line >= hunk.current.position.start - 1 &&
					position.line <= hunk.current.position.end - (hasMoreDeletedLines ? 0 : 1)
				) {
					return new Hover(
						Hovers.localChangesMessage(commit, this.trackedDocument.uri, position.line, hunk),
						document.validateRange(
							new Range(
								hunk.current.position.start - 1,
								0,
								hunk.current.position.end - (hasMoreDeletedLines ? 0 : 1),
								Number.MAX_SAFE_INTEGER,
							),
						),
					);
				}
			}
		}

		return undefined;
	}
}
