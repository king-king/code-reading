'use strict';
import { Disposable, TextEditor, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { Container } from '../../container';
import { GitUri } from '../../git/gitUri';
import { Logger } from '../../logger';
import { debug, Functions, gate } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, SubscribeableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class RepositoriesNode extends SubscribeableViewNode<RepositoriesView> {
	private _children: (RepositoryNode | MessageNode)[] | undefined;

	constructor(view: RepositoriesView) {
		super(unknownGitUri, view);
	}

	override dispose() {
		super.dispose();

		this.resetChildren();
	}

	@debug()
	private resetChildren() {
		if (this._children === undefined) return;

		for (const child of this._children) {
			if (child instanceof RepositoryNode) {
				child.dispose();
			}
		}
		this._children = undefined;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children === undefined) {
			const repositories = await Container.git.getOrderedRepositories();
			if (repositories.length === 0) return [new MessageNode(this.view, this, 'No repositories could be found.')];

			this._children = repositories.map(r => new RepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r));
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Repositories', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.Repositories;

		return item;
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false) {
		if (this._children === undefined) return;

		if (reset) {
			this.resetChildren();
			await this.unsubscribe();
			void this.ensureSubscription();

			return;
		}

		const repositories = await Container.git.getOrderedRepositories();
		if (repositories.length === 0 && (this._children === undefined || this._children.length === 0)) return;

		if (repositories.length === 0) {
			this._children = [new MessageNode(this.view, this, 'No repositories could be found.')];
			return;
		}

		const children = [];
		for (const repo of repositories) {
			const normalizedPath = repo.normalizedPath;
			const child = (this._children as RepositoryNode[]).find(c => c.repo.normalizedPath === normalizedPath);
			if (child !== undefined) {
				children.push(child);
				void child.refresh();
			} else {
				children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), this.view, this, repo));
			}
		}

		for (const child of this._children as RepositoryNode[]) {
			if (children.includes(child)) continue;

			child.dispose();
		}

		this._children = children;

		void this.ensureSubscription();
	}

	@debug()
	protected subscribe() {
		const subscriptions = [Container.git.onDidChangeRepositories(this.onRepositoriesChanged, this)];

		if (this.view.config.autoReveal) {
			subscriptions.push(
				window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
			);
		}

		return Disposable.from(...subscriptions);
	}

	protected override get requiresResetOnVisible(): boolean {
		return true;
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (editor == null || this._children === undefined || this._children.length === 1) {
			return;
		}

		try {
			const uri = editor.document.uri;
			const node = this._children.find(n => n instanceof RepositoryNode && n.repo.containsUri(uri)) as
				| RepositoryNode
				| undefined;
			if (node === undefined) return;

			// Check to see if this repo has a descendent that is already selected
			let parent = this.view.selection.length === 0 ? undefined : this.view.selection[0];
			while (parent !== undefined) {
				if (parent === node) return;

				parent = parent.getParent();
			}

			void this.view.reveal(node, { expand: true });
		} catch (ex) {
			Logger.error(ex);
		}
	}

	@debug()
	private onRepositoriesChanged() {
		void this.triggerChange();
	}
}
