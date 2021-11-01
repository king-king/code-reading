'use strict';
import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { emojify } from '../../emojis';
import { GitLog, GitRevision, GitTag, GitTagReference, TagDateFormatting } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { debug, gate, Iterables, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { TagsView } from '../tagsView';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { insertDateMarkers } from './helpers';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, PageableViewNode, ViewNode, ViewRefNode } from './viewNode';

export class TagNode extends ViewRefNode<TagsView | RepositoriesView, GitTagReference> implements PageableViewNode {
	static key = ':tag';
	static getId(repoPath: string, name: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})`;
	}

	constructor(uri: GitUri, view: TagsView | RepositoriesView, parent: ViewNode, public readonly tag: GitTag) {
		super(uri, view, parent);
	}

	override toClipboard(): string {
		return this.tag.name;
	}

	override get id(): string {
		return TagNode.getId(this.tag.repoPath, this.tag.name);
	}

	get label(): string {
		return this.view.config.branches.layout === ViewBranchesLayout.Tree ? this.tag.getBasename() : this.tag.name;
	}

	get ref(): GitTagReference {
		return this.tag;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath, this.tag.name);
		const children = [
			...insertDateMarkers(
				Iterables.map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips),
				),
				this,
			),
		];

		if (log.hasMore) {
			children.push(
				new LoadMoreNode(this.view, this, children[children.length - 1], undefined, () =>
					Container.git.getCommitCount(this.tag.repoPath, this.tag.name),
				),
			);
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Tag;
		item.description = emojify(this.tag.message);
		item.tooltip = `${this.tag.name}${Strings.pad(GlyphChars.Dash, 2, 2)}${GitRevision.shorten(this.tag.sha, {
			force: true,
		})}\n${this.tag.formatDateFromNow()} (${this.tag.formatDate(TagDateFormatting.dateFormat)})\n\n${emojify(
			this.tag.message,
		)}${
			this.tag.commitDate != null && this.tag.date !== this.tag.commitDate
				? `\n${this.tag.formatCommitDateFromNow()} (${this.tag.formatCommitDate(TagDateFormatting.dateFormat)})`
				: ''
		}`;

		return item;
	}

	@gate()
	@debug()
	override refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log == null) {
			this._log = await Container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.tag.name,
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	@gate()
	async loadMore(limit?: number | { until?: any }) {
		let log = await window.withProgress(
			{
				location: { viewId: this.view.id },
			},
			() => this.getLog(),
		);
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
