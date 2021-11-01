'use strict';
import { Range, TextEditor, TextEditorDecorationType } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { GitBlameCommit } from '../git/git';
import { Logger } from '../logger';
import { log, Strings } from '../system';
import { GitDocumentState } from '../trackers/gitDocumentTracker';
import { TrackedDocument } from '../trackers/trackedDocument';
import { AnnotationContext } from './annotationProvider';
import { Annotations } from './annotations';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider';

export class GutterHeatmapBlameAnnotationProvider extends BlameAnnotationProviderBase {
	constructor(editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>) {
		super(FileAnnotationType.Heatmap, editor, trackedDocument);
	}

	@log()
	async onProvideAnnotation(context?: AnnotationContext, _type?: FileAnnotationType): Promise<boolean> {
		const cc = Logger.getCorrelationContext();

		this.annotationContext = context;

		const blame = await this.getBlame();
		if (blame == null) return false;

		let start = process.hrtime();

		const decorationsMap = new Map<
			string,
			{ decorationType: TextEditorDecorationType; rangesOrOptions: Range[] }
		>();
		const computedHeatmap = await this.getComputedHeatmap(blame);

		let commit: GitBlameCommit | undefined;
		for (const l of blame.lines) {
			// editor lines are 0-based
			const editorLine = l.line - 1;

			commit = blame.commits.get(l.sha);
			if (commit == null) continue;

			Annotations.addOrUpdateGutterHeatmapDecoration(
				commit.date,
				computedHeatmap,
				new Range(editorLine, 0, editorLine, 0),
				decorationsMap,
			);
		}

		Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute heatmap annotations`);

		if (decorationsMap.size) {
			start = process.hrtime();

			this.setDecorations([...decorationsMap.values()]);

			Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply recent changes annotations`);
		}

		// this.registerHoverProviders(Container.config.hovers.annotations);
		return true;
	}

	selection(_selection?: AnnotationContext['selection']): Promise<void> {
		return Promise.resolve();
	}
}
