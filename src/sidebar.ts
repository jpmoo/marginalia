import { ItemView, WorkspaceLeaf, MarkdownView, Modal, TFile, Notice } from 'obsidian';
import type MarginaliaPlugin from '../main';
import { MarginaliaItem } from './types';

interface TreeNode {
	name: string;
	fullPath: string;
	children: Map<string, TreeNode>;
	files: Array<{ path: string; count: number }>;
	isExpanded: boolean;
}

export class MarginaliaView extends ItemView {
	private plugin: MarginaliaPlugin;
	private items: MarginaliaItem[] = [];
	private searchTerm: string = '';
	private currentNoteSearchTerm: string = '';

	constructor(leaf: WorkspaceLeaf, plugin: MarginaliaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return 'marginalia-view';
	}

	getDisplayText() {
		return 'Marginalia';
	}

	getIcon() {
		return 'book-open';
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('marginalia-sidebar');
		
		const header = this.contentEl.createDiv('marginalia-header');
		header.createEl('h2', { text: 'Marginalia' });

		// Create tab container
		const tabContainer = this.contentEl.createDiv('marginalia-tabs');
		tabContainer.style.display = 'flex';
		tabContainer.style.gap = '5px';
		tabContainer.style.marginBottom = '10px';
		tabContainer.style.borderBottom = '1px solid var(--background-modifier-border)';
		tabContainer.style.paddingBottom = '5px';

		// Create tabs with Obsidian icons
		const currentNoteTab = tabContainer.createEl('button');
		currentNoteTab.addClass('marginalia-tab');
		currentNoteTab.addClass('marginalia-tab-active');
		const currentNoteIcon = currentNoteTab.createSpan('marginalia-tab-icon');
		currentNoteIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';
		const currentNoteText = currentNoteTab.createSpan('marginalia-tab-text');
		currentNoteText.textContent = 'Current Note';
		
		const allNotesTab = tabContainer.createEl('button');
		allNotesTab.addClass('marginalia-tab');
		const allNotesIcon = allNotesTab.createSpan('marginalia-tab-icon');
		allNotesIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>';
		const allNotesText = allNotesTab.createSpan('marginalia-tab-text');
		allNotesText.textContent = 'All Notes';

		// Create content area
		const contentArea = this.contentEl.createDiv('marginalia-content-area');
		(this as any).contentArea = contentArea;
		(this as any).currentTab = 'current';

		// Tab click handlers
		currentNoteTab.onclick = () => {
			(this as any).currentTab = 'current';
			currentNoteTab.addClass('marginalia-tab-active');
			allNotesTab.removeClass('marginalia-tab-active');
			this.refresh();
		};

		allNotesTab.onclick = () => {
			(this as any).currentTab = 'all';
			allNotesTab.addClass('marginalia-tab-active');
			currentNoteTab.removeClass('marginalia-tab-active');
			this.refresh();
		};

		// Refresh when active file changes
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.refresh();
			})
		);
		
		// Also listen for active leaf changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.refresh();
			})
		);
		
		// Initial refresh with a small delay to ensure file is loaded
		setTimeout(() => {
			this.refresh();
		}, 100);
	}

	async onClose() {
		this.contentEl.empty();
	}

	refresh() {
		const contentArea = (this as any).contentArea as HTMLElement;
		if (!contentArea) return;

		const currentTab = (this as any).currentTab || 'current';

		// Clear content area
		contentArea.empty();

		if (currentTab === 'current') {
			this.refreshCurrentNote(contentArea);
		} else {
			this.refreshAllNotes(contentArea);
		}
	}

	private refreshCurrentNote(contentArea: HTMLElement) {
		const activeFile = this.app.workspace.getActiveFile();
		
		// Always create search input at the top
		const searchContainer = contentArea.createDiv();
		searchContainer.style.marginBottom = '10px';
		searchContainer.style.position = 'relative';
		
		const currentNoteSearchInput = searchContainer.createEl('input', {
			attr: {
				type: 'text',
				placeholder: 'Search marginalia...'
			}
		});
		currentNoteSearchInput.style.width = '100%';
		currentNoteSearchInput.style.padding = '6px 30px 6px 10px'; // Extra right padding for clear button
		currentNoteSearchInput.style.border = '1px solid var(--background-modifier-border)';
		currentNoteSearchInput.style.borderRadius = '4px';
		currentNoteSearchInput.style.fontSize = '0.9em';
		currentNoteSearchInput.value = this.currentNoteSearchTerm;
		
		// Clear button (X)
		const clearButton = searchContainer.createEl('button');
		clearButton.innerHTML = '×';
		clearButton.style.position = 'absolute';
		clearButton.style.right = '8px';
		clearButton.style.top = '50%';
		clearButton.style.transform = 'translateY(-50%)';
		clearButton.style.background = 'transparent';
		clearButton.style.border = 'none';
		clearButton.style.cursor = 'pointer';
		clearButton.style.fontSize = '20px';
		clearButton.style.color = 'var(--text-muted)';
		clearButton.style.padding = '0';
		clearButton.style.width = '20px';
		clearButton.style.height = '20px';
		clearButton.style.display = this.currentNoteSearchTerm ? 'block' : 'none';
		clearButton.style.lineHeight = '1';
		
		clearButton.onclick = (e) => {
			e.stopPropagation();
			this.currentNoteSearchTerm = '';
			currentNoteSearchInput.value = '';
			clearButton.style.display = 'none';
			renderFilteredItems();
		};
		
		// Show/hide clear button based on input
		currentNoteSearchInput.oninput = (e: Event) => {
			const target = e.target as HTMLInputElement;
			this.currentNoteSearchTerm = target.value;
			clearButton.style.display = target.value ? 'block' : 'none';
			renderFilteredItems();
		};
		
		// Store reference to content area for filtering
		const itemsContainer = contentArea.createDiv();
		itemsContainer.style.marginTop = '10px';
		
		// Function to render filtered items
		const renderFilteredItems = () => {
			itemsContainer.empty();
			
			if (!activeFile) {
				const emptyDiv = itemsContainer.createDiv('marginalia-empty');
				emptyDiv.textContent = 'No file open';
				return;
			}

			this.items = this.plugin.getMarginalia(activeFile.path);
			
			// Filter items based on search term
			const searchLower = this.currentNoteSearchTerm.toLowerCase().trim();
			let filteredItems = this.items;
			
			if (searchLower) {
				filteredItems = this.items.filter((item) => {
					const noteText = (item.note || '').toLowerCase();
					const selectionText = (item.text || '').toLowerCase();
					return noteText.includes(searchLower) || selectionText.includes(searchLower);
				});
			}
			
			if (filteredItems.length === 0) {
				const emptyDiv = itemsContainer.createDiv('marginalia-empty');
				emptyDiv.textContent = searchLower ? 'No matching marginalia found' : 'No marginalia in this file';
				return;
			}

			// Add sort controls
			const sortControls = itemsContainer.createDiv('marginalia-sort-controls');
			sortControls.style.display = 'flex';
			sortControls.style.justifyContent = 'flex-end';
			sortControls.style.marginBottom = '10px';
			sortControls.style.alignItems = 'center';
			sortControls.style.gap = '8px';

			const sortLabel = sortControls.createSpan();
			sortLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>';
			sortLabel.style.opacity = '0.7';
			sortLabel.style.display = 'flex';
			sortLabel.style.alignItems = 'center';

			const sortSelect = sortControls.createEl('select');
			sortSelect.style.padding = '4px 24px 4px 8px';
			sortSelect.style.border = '1px solid var(--background-modifier-border)';
			sortSelect.style.borderRadius = '4px';
			sortSelect.style.background = 'var(--background-primary)';
			sortSelect.style.fontSize = '0.9em';
			sortSelect.style.cursor = 'pointer';
			sortSelect.style.color = 'var(--text-normal)';
			sortSelect.style.minWidth = '180px';
			sortSelect.style.appearance = 'none';
			sortSelect.style.backgroundImage = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\'%3E%3Cpath d=\'M3 4l3 4 3-4\'/%3E%3C/svg%3E")';
			sortSelect.style.backgroundRepeat = 'no-repeat';
			sortSelect.style.backgroundPosition = 'right 6px center';
			sortSelect.style.backgroundSize = '12px';
			sortSelect.style.transition = 'border-color 0.2s';
			
			sortSelect.onmouseenter = () => {
				sortSelect.style.borderColor = 'var(--background-modifier-border-hover)';
			};
			sortSelect.onmouseleave = () => {
				sortSelect.style.borderColor = 'var(--background-modifier-border)';
			};

			const optionPosition = sortSelect.createEl('option', { value: 'position' });
			optionPosition.textContent = 'Order in note';
			const optionDateAsc = sortSelect.createEl('option', { value: 'date-asc' });
			optionDateAsc.textContent = 'Date modified (oldest first)';
			const optionDateDesc = sortSelect.createEl('option', { value: 'date-desc' });
			optionDateDesc.textContent = 'Date modified (newest first)';

			sortSelect.value = this.plugin.settings.sortOrder || 'position';
			sortSelect.onchange = async (e) => {
				const target = e.target as HTMLSelectElement;
				this.plugin.settings.sortOrder = target.value as 'position' | 'date-asc' | 'date-desc';
				await this.plugin.saveData(this.plugin.settings);
				renderFilteredItems(); // Re-render with new sort order
			};

			// Sort items based on current sort order
			const sortedItems = [...filteredItems];
			const sortOrder = this.plugin.settings.sortOrder || 'position';
			
			if (sortOrder === 'date-asc') {
				sortedItems.sort((a, b) => {
					const aTime = a.timestamp || 0;
					const bTime = b.timestamp || 0;
					return aTime - bTime;
				});
			} else if (sortOrder === 'date-desc') {
				sortedItems.sort((a, b) => {
					const aTime = a.timestamp || 0;
					const bTime = b.timestamp || 0;
					return bTime - aTime;
				});
			} else {
				// Sort by position in document (line, then character)
				sortedItems.sort((a, b) => {
					if (a.from.line !== b.from.line) {
						return a.from.line - b.from.line;
					}
					return a.from.ch - b.from.ch;
				});
			}

			sortedItems.forEach((item, index) => {
			const itemEl = itemsContainer.createDiv('marginalia-item');
			
			// Add colored left border based on item color or default
			const itemColor = item.color || this.plugin.settings.highlightColor;
			itemEl.style.borderLeft = `4px solid ${itemColor}`;
			itemEl.style.paddingLeft = '8px';
			itemEl.style.marginLeft = '0';
			itemEl.style.cursor = 'pointer';
			itemEl.title = 'Click to jump to location';
			
			// Make entire item clickable to jump (except buttons)
			itemEl.onclick = (e) => {
				const target = e.target as HTMLElement;
				// Don't jump if clicking on a button
				if (!target.closest('button')) {
					this.plugin.jumpToMarginalia(activeFile.path, item.id);
				}
			};
			
			const preview = itemEl.createDiv('marginalia-preview');
			const textPreview = item.text || `Line ${item.line + 1}`;
			const textDiv = preview.createDiv('marginalia-text-preview');
			textDiv.textContent = textPreview.substring(0, 50) + (textPreview.length > 50 ? '...' : '');
			const noteDiv = preview.createDiv('marginalia-note-preview');
			noteDiv.textContent = item.note;
			
			// Add date/time display (shows last modified time)
			if (item.timestamp) {
				const dateDiv = preview.createDiv('marginalia-date');
				const date = new Date(item.timestamp);
				// Format: "Jan 15, 2024 3:45 PM" or similar
				dateDiv.textContent = date.toLocaleString(undefined, {
					month: 'short',
					day: 'numeric',
					year: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
					hour12: true
				});
				dateDiv.style.fontSize = '0.85em';
				dateDiv.style.color = 'var(--text-muted)';
				dateDiv.style.marginTop = '4px';
			}

			const actions = itemEl.createDiv('marginalia-actions');
			
			// Edit button with icon
			const editButton = actions.createEl('button');
			editButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
			editButton.title = 'Edit';
			editButton.onmousedown = (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.showEditModal(item, activeFile.path);
			};

			// AI Functions button with zap icon
			const aiButton = actions.createEl('button');
			aiButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
			aiButton.title = 'AI Functions';
			aiButton.onmousedown = (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.showAIFunctionsModal(item, activeFile.path);
			};

			// Delete button with icon
			const deleteButton = actions.createEl('button');
			deleteButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
			deleteButton.title = 'Delete';
			deleteButton.onmousedown = (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.showDeleteConfirmation(item, activeFile.path);
			};
		});
		};
		
		// Initial render
		renderFilteredItems();
	}

	private refreshAllNotes(contentArea: HTMLElement) {
		// Get all files with marginalia
		const filesWithMarginalia: Array<{ path: string; count: number }> = [];
		
		// Access marginaliaData from plugin
		const marginaliaData = (this.plugin as any).marginaliaData;
		if (!marginaliaData) {
			const emptyDiv = contentArea.createDiv('marginalia-empty');
			emptyDiv.textContent = 'No notes with marginalia found';
			return;
		}
		
		// Filter files based on search term
		const searchLower = this.searchTerm.toLowerCase().trim();
		
		for (const [filePath, data] of marginaliaData) {
			if (data && data.items && data.items.length > 0) {
				// If there's a search term, check if any marginalia note matches
				if (searchLower) {
					const hasMatch = data.items.some((item: any) => {
						const noteText = (item.note || '').toLowerCase();
						return noteText.includes(searchLower);
					});
					
					if (!hasMatch) {
						continue; // Skip files without matching marginalia
					}
				}
				
				filesWithMarginalia.push({
					path: filePath,
					count: data.items.length
				});
			}
		}

		// Create search and controls container at the top
		const topControlsContainer = contentArea.createDiv();
		topControlsContainer.style.marginBottom = '10px';
		topControlsContainer.style.display = 'flex';
		topControlsContainer.style.gap = '10px';
		topControlsContainer.style.alignItems = 'center'; // Align items on the same horizontal line
		
		// Search input container (flexible)
		const searchContainer = topControlsContainer.createDiv();
		searchContainer.style.flex = '1';
		searchContainer.style.position = 'relative';
		searchContainer.style.display = 'flex';
		searchContainer.style.alignItems = 'center';
		
		const searchInput = searchContainer.createEl('input', {
			attr: {
				type: 'text',
				placeholder: 'Search marginalia...'
			}
		});
		searchInput.style.width = '100%';
		searchInput.style.padding = '6px 30px 6px 10px'; // Extra right padding for clear button
		searchInput.style.border = '1px solid var(--background-modifier-border)';
		searchInput.style.borderRadius = '4px';
		searchInput.style.fontSize = '0.9em';
		searchInput.value = this.searchTerm;
		
		// Clear button (X)
		const clearButton = searchContainer.createEl('button');
		clearButton.innerHTML = '×';
		clearButton.style.position = 'absolute';
		clearButton.style.right = '8px';
		clearButton.style.top = '50%';
		clearButton.style.transform = 'translateY(-50%)';
		clearButton.style.background = 'transparent';
		clearButton.style.border = 'none';
		clearButton.style.cursor = 'pointer';
		clearButton.style.fontSize = '20px';
		clearButton.style.color = 'var(--text-muted)';
		clearButton.style.padding = '0';
		clearButton.style.width = '20px';
		clearButton.style.height = '20px';
		clearButton.style.display = this.searchTerm ? 'block' : 'none';
		clearButton.style.lineHeight = '1';
		
		clearButton.onclick = (e) => {
			e.stopPropagation();
			this.searchTerm = '';
			searchInput.value = '';
			clearButton.style.display = 'none';
			renderFilteredTree();
		};
		
		// Expand/collapse buttons container (next to search)
		const controlsDiv = topControlsContainer.createDiv('marginalia-tree-controls');
		controlsDiv.style.display = 'flex';
		controlsDiv.style.gap = '5px';
		controlsDiv.style.flexShrink = '0';
		controlsDiv.style.alignItems = 'center';
		
		// Store reference to tree container for filtering
		const treeContainer = contentArea.createDiv('marginalia-tree');
		(this as any).treeContainer = treeContainer;
		
		// Function to render filtered tree
		const renderFilteredTree = () => {
			treeContainer.empty();
			
			// Rebuild the tree with filtered files
			const marginaliaData = (this.plugin as any).marginaliaData;
			if (!marginaliaData) {
				const emptyDiv = treeContainer.createDiv('marginalia-empty');
				emptyDiv.textContent = 'No notes with marginalia found';
				return;
			}
			
			const filesWithMarginalia: Array<{ path: string; count: number }> = [];
			const searchLower = this.searchTerm.toLowerCase().trim();
			
			for (const [filePath, data] of marginaliaData) {
				if (data && data.items && data.items.length > 0) {
					if (searchLower) {
						const hasMatch = data.items.some((item: any) => {
							const noteText = (item.note || '').toLowerCase();
							return noteText.includes(searchLower);
						});
						if (!hasMatch) continue;
					}
					filesWithMarginalia.push({
						path: filePath,
						count: data.items.length
					});
				}
			}
			
			if (filesWithMarginalia.length === 0) {
				const emptyDiv = treeContainer.createDiv('marginalia-empty');
				emptyDiv.textContent = searchLower ? 'No notes with matching marginalia found' : 'No notes with marginalia found';
				return;
			}
			
			// Rebuild tree structure
			const root: TreeNode = {
				name: '',
				fullPath: '',
				children: new Map(),
				files: [],
				isExpanded: true
			};
			
			filesWithMarginalia.sort((a: { path: string; count: number }, b: { path: string; count: number }) => a.path.localeCompare(b.path));
			
			for (const fileInfo of filesWithMarginalia) {
				const parts = fileInfo.path.split('/');
				const fileName = parts.pop() || fileInfo.path;
				let current = root;
				
				for (const part of parts) {
					if (!current.children.has(part)) {
						current.children.set(part, {
							name: part,
							fullPath: current.fullPath ? `${current.fullPath}/${part}` : part,
							children: new Map(),
							files: [],
							isExpanded: true
						});
					}
					current = current.children.get(part)!;
				}
				current.files.push({ path: fileInfo.path, count: fileInfo.count });
			}
			
			(this as any).treeRoot = root;
			this.renderTreeNode(treeContainer, root, 0);
		};
		
		// Update search term and filter on input (without full refresh)
		searchInput.oninput = (e: Event) => {
			const target = e.target as HTMLInputElement;
			this.searchTerm = target.value;
			clearButton.style.display = target.value ? 'block' : 'none';
			renderFilteredTree();
		};
		
		const expandAllBtn = controlsDiv.createEl('button');
		expandAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="3" x2="7" y2="11"/><line x1="3" y1="7" x2="11" y2="7"/></svg>';
		expandAllBtn.title = 'Expand all';
		expandAllBtn.style.padding = '4px 6px';
		expandAllBtn.style.border = '1px solid var(--background-modifier-border)';
		expandAllBtn.style.borderRadius = '3px';
		expandAllBtn.style.background = 'var(--background-primary)';
		expandAllBtn.style.cursor = 'pointer';
		
		const collapseAllBtn = controlsDiv.createEl('button');
		collapseAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="7" x2="11" y2="7"/></svg>';
		collapseAllBtn.title = 'Collapse all';
		collapseAllBtn.style.padding = '4px 6px';
		collapseAllBtn.style.border = '1px solid var(--background-modifier-border)';
		collapseAllBtn.style.borderRadius = '3px';
		collapseAllBtn.style.background = 'var(--background-primary)';
		collapseAllBtn.style.cursor = 'pointer';
		
		// Expand all handler
		expandAllBtn.onclick = () => {
			const treeRoot = (this as any).treeRoot;
			if (treeRoot) {
				this.setAllExpanded(treeRoot, true);
				renderFilteredTree();
			}
		};

		// Collapse all handler
		collapseAllBtn.onclick = () => {
			const treeRoot = (this as any).treeRoot;
			if (treeRoot) {
				this.setAllExpanded(treeRoot, false);
				renderFilteredTree();
			}
		};
		
		// Initial render
		renderFilteredTree();
	}

	private setAllExpanded(node: TreeNode, expanded: boolean) {
		node.isExpanded = expanded;
		for (const child of node.children.values()) {
			this.setAllExpanded(child, expanded);
		}
	}

	private renderTreeNode(container: HTMLElement, node: TreeNode, depth: number) {
		// Render folders
		const sortedFolders = Array.from(node.children.entries()).sort((a, b) => 
			a[0].localeCompare(b[0])
		);

		for (const [folderName, folderNode] of sortedFolders) {
			const folderItem = container.createDiv('marginalia-tree-item');
			folderItem.style.paddingLeft = `${depth * 16}px`;
			folderItem.style.display = 'flex';
			folderItem.style.alignItems = 'center';
			folderItem.style.gap = '4px';
			folderItem.style.paddingTop = '2px';
			folderItem.style.paddingBottom = '2px';
			folderItem.style.cursor = 'pointer';

			// Collapse/expand icon
			const toggleIcon = folderItem.createSpan('marginalia-tree-toggle');
			toggleIcon.innerHTML = folderNode.isExpanded 
				? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4l3 4 3-4"/></svg>'
				: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 3l4 3-4 3"/></svg>';
			toggleIcon.style.display = 'flex';
			toggleIcon.style.alignItems = 'center';
			toggleIcon.style.width = '12px';
			toggleIcon.style.flexShrink = '0';

			// Folder name
			const folderNameSpan = folderItem.createSpan('marginalia-tree-folder');
			folderNameSpan.textContent = folderName;
			folderNameSpan.style.fontWeight = '500';
			folderNameSpan.style.flex = '1';

			// Count of files in this folder (recursive)
			const totalCount = this.countFilesInNode(folderNode);
			if (totalCount > 0) {
				const countSpan = folderItem.createSpan('marginalia-tree-count');
				countSpan.textContent = `(${totalCount})`;
				countSpan.style.fontSize = '0.85em';
				countSpan.style.color = 'var(--text-muted)';
			}

			// Toggle expand/collapse
			folderItem.onclick = (e) => {
				e.stopPropagation();
				folderNode.isExpanded = !folderNode.isExpanded;
				// Re-render the entire tree from root
				const treeContainer = (this as any).treeContainer;
				const treeRoot = (this as any).treeRoot;
				if (treeContainer && treeRoot) {
					treeContainer.empty();
					this.renderTreeNode(treeContainer, treeRoot, 0);
				}
			};

			// Render children if expanded
			if (folderNode.isExpanded) {
				this.renderTreeNode(container, folderNode, depth + 1);
			}
		}

		// Render files in this node
		const sortedFiles = node.files.sort((a, b) => a.path.localeCompare(b.path));
		for (const fileInfo of sortedFiles) {
			const fileItem = container.createDiv('marginalia-tree-item');
			fileItem.style.paddingLeft = `${(depth + 1) * 16}px`;
			fileItem.style.display = 'flex';
			fileItem.style.alignItems = 'center';
			fileItem.style.gap = '4px';
			fileItem.style.paddingTop = '2px';
			fileItem.style.paddingBottom = '2px';
			fileItem.style.cursor = 'pointer';

			// File icon (simple line)
			const fileIcon = fileItem.createSpan('marginalia-tree-file-icon');
			fileIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h4l2 2v6H3V2z"/></svg>';
			fileIcon.style.display = 'flex';
			fileIcon.style.alignItems = 'center';
			fileIcon.style.width = '12px';
			fileIcon.style.flexShrink = '0';
			fileIcon.style.opacity = '0.6';

			// File name
			const fileNameSpan = fileItem.createSpan('marginalia-tree-file');
			const file = this.app.vault.getAbstractFileByPath(fileInfo.path);
			fileNameSpan.textContent = file ? file.name : fileInfo.path.split('/').pop() || fileInfo.path;
			fileNameSpan.style.flex = '1';

			// Count
			const countSpan = fileItem.createSpan('marginalia-tree-count');
			countSpan.textContent = `${fileInfo.count}`;
			countSpan.style.fontSize = '0.85em';
			countSpan.style.color = 'var(--text-muted)';

			fileItem.onmouseenter = () => {
				fileItem.style.backgroundColor = 'var(--background-modifier-hover)';
			};

			fileItem.onmouseleave = () => {
				fileItem.style.backgroundColor = '';
			};

			// Click to open file
			fileItem.onclick = async () => {
				const file = this.app.vault.getAbstractFileByPath(fileInfo.path);
				if (file instanceof TFile) {
					const leaf = this.app.workspace.getLeaf(false);
					await leaf.openFile(file);
				}
			};
		}
	}

	private countFilesInNode(node: TreeNode): number {
		let count = node.files.length;
		for (const child of node.children.values()) {
			count += this.countFilesInNode(child);
		}
		return count;
	}

	private showEditModal(item: MarginaliaItem, filePath: string) {
		const modal = new EditMarginaliaModal(this.app, item, this.plugin.settings.highlightColor, async (newNote: string, color?: string) => {
			await this.plugin.updateMarginalia(filePath, item.id, newNote, color);
			this.refresh();
		}, async () => {
			// Delete handler - show confirmation
			const deleteModal = new DeleteConfirmationModal(this.app, async () => {
				await this.plugin.deleteMarginalia(filePath, item.id);
				this.refresh();
			});
			deleteModal.open();
		});
		modal.open();
	}

	private showDeleteConfirmation(item: MarginaliaItem, filePath: string) {
		const modal = new DeleteConfirmationModal(this.app, async () => {
			await this.plugin.deleteMarginalia(filePath, item.id);
			this.refresh();
		});
		modal.open();
	}

	private showAIFunctionsModal(item: MarginaliaItem, filePath: string) {
		const modal = new AIFunctionsModal(this.app, this.plugin, item, filePath);
		modal.open();
	}
}

export class AIFunctionsModal extends Modal {
	private plugin: MarginaliaPlugin;
	private item: MarginaliaItem;
	private filePath: string;
	private functionContent: HTMLElement;
	private currentSimilarItems: Array<{ item: MarginaliaItem; filePath: string; similarity: number }> = [];

	constructor(app: any, plugin: MarginaliaPlugin, item: MarginaliaItem, filePath: string) {
		super(app);
		this.plugin = plugin;
		this.item = item;
		this.filePath = filePath;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('marginalia-ai-modal');
		
		// Set minimum width and height for the modal content
		contentEl.style.minWidth = '450px';
		contentEl.style.width = 'auto';
		contentEl.style.minHeight = '500px';
		contentEl.style.maxHeight = '80vh';
		contentEl.style.overflow = 'visible';
		
		contentEl.createEl('h2', { text: 'AI Functions' });

		// Function selection dropdown
		const functionSelect = contentEl.createEl('select');
		functionSelect.style.width = '100%';
		functionSelect.style.minWidth = '400px';
		functionSelect.style.marginBottom = '20px';
		functionSelect.style.padding = '8px';
		functionSelect.style.fontSize = '14px';
		functionSelect.style.maxHeight = 'none';
		functionSelect.style.height = 'auto';
		functionSelect.style.overflow = 'visible';
		
		// Add placeholder option (no selection)
		const optionPlaceholder = functionSelect.createEl('option', { value: '' });
		optionPlaceholder.textContent = 'Select an AI function...';
		optionPlaceholder.disabled = true;
		optionPlaceholder.selected = true;
		
		const optionSimilar = functionSelect.createEl('option', { value: 'similar' });
		optionSimilar.textContent = 'Find Similar Marginalia';
		
		const optionSimilarSelection = functionSelect.createEl('option', { value: 'similar-selection' });
		optionSimilarSelection.textContent = 'Find Similar Selection';
		
		const optionSimilarCombined = functionSelect.createEl('option', { value: 'similar-combined' });
		optionSimilarCombined.textContent = 'Find Similar Selection + Marginalia';
		
		// No default selection
		functionSelect.value = '';
		
		// Content area for function-specific UI
		this.functionContent = contentEl.createDiv();
		this.functionContent.style.marginTop = '20px';
		
		// Update UI when function changes
		functionSelect.onchange = (e) => {
			const target = e.target as HTMLSelectElement;
			if (target.value) {
				this.showFunctionUI(target.value);
			} else {
				this.functionContent.empty();
			}
		};
	}

	private showFunctionUI(functionType: string) {
		this.functionContent.empty();
		
		if (functionType === 'similar') {
			this.showFindSimilarUI('note');
		} else if (functionType === 'similar-selection') {
			this.showFindSimilarUI('selection');
		} else if (functionType === 'similar-combined') {
			this.showFindSimilarUI('combined');
		}
	}

	private showFindSimilarUI(mode: 'note' | 'selection' | 'combined') {
		// Check if item has the required embedding based on mode
		let hasRequiredEmbedding = false;
		let errorMessage = '';
		
		if (mode === 'note') {
			hasRequiredEmbedding = !!(this.item.embedding && Array.isArray(this.item.embedding) && this.item.embedding.length > 0);
			errorMessage = 'This marginalia does not have a note embedding. Please ensure Ollama is available and embeddings are generated.';
		} else if (mode === 'selection') {
			hasRequiredEmbedding = !!(this.item.selectionEmbedding && Array.isArray(this.item.selectionEmbedding) && this.item.selectionEmbedding.length > 0);
			errorMessage = 'This marginalia does not have a selection embedding. The selected text may be empty or embeddings may not be generated.';
		} else if (mode === 'combined') {
			// For combined, we need at least one of note or selection text
			const hasNote = this.plugin.hasMeaningfulText(this.item.note);
			const hasSelection = this.plugin.hasMeaningfulText(this.item.text);
			hasRequiredEmbedding = hasNote || hasSelection;
			errorMessage = 'This marginalia needs at least a note or selection text to generate a combined embedding.';
		}
		
		if (!hasRequiredEmbedding) {
			this.functionContent.createEl('p', { 
				text: errorMessage,
				cls: 'mod-warning'
			});
			return;
		}

		// Similarity threshold slider
		const sliderContainer = this.functionContent.createDiv();
		sliderContainer.style.marginBottom = '15px';
		
		const label = sliderContainer.createEl('label');
		label.textContent = 'Similarity Threshold: ';
		label.style.display = 'block';
		label.style.marginBottom = '5px';
		
		const sliderValue = sliderContainer.createSpan();
		const defaultThreshold = this.plugin.settings.defaultSimilarity || 0.7;
		sliderValue.textContent = defaultThreshold.toFixed(2);
		sliderValue.style.marginLeft = '10px';
		sliderValue.style.fontWeight = 'bold';
		
		const slider = sliderContainer.createEl('input', { 
			attr: { 
				type: 'range', 
				min: '0.5', 
				max: '1', 
				step: '0.01', 
				value: defaultThreshold.toString()
			} 
		});
		slider.style.width = '100%';
		slider.style.marginTop = '5px';
		
		slider.oninput = (e) => {
			const target = e.target as HTMLInputElement;
			sliderValue.textContent = parseFloat(target.value).toFixed(2);
		};

		// Run button
		const runButton = this.functionContent.createEl('button', { text: 'Find Similar' });
		runButton.addClass('mod-cta');
		runButton.style.width = '100%';
		runButton.style.marginTop = '10px';
		runButton.style.marginBottom = '20px';
		
		// Results container
		const resultsContainer = this.functionContent.createDiv();
		resultsContainer.style.marginTop = '20px';
		
		runButton.onclick = async () => {
			const threshold = parseFloat(slider.value);
			runButton.disabled = true;
			runButton.textContent = 'Searching...';
			resultsContainer.empty();
			
			try {
				let similarItems: Array<{ item: MarginaliaItem; filePath: string; similarity: number }>;
				let resultLabel = '';
				
				if (mode === 'note') {
					similarItems = await this.plugin.findSimilarMarginalia(this.item, threshold);
					resultLabel = 'similar marginalia (by note)';
				} else if (mode === 'selection') {
					similarItems = await this.plugin.findSimilarSelection(this.item, threshold);
					resultLabel = 'similar selections';
				} else {
					similarItems = await this.plugin.findSimilarCombined(this.item, threshold);
					resultLabel = 'similar combined (note + selection)';
				}
				
				// Store similar items for use by buttons
				this.currentSimilarItems = similarItems;
				
				if (similarItems.length === 0) {
					resultsContainer.createEl('p', { text: `No ${resultLabel} found above the threshold.` });
				} else {
					resultsContainer.createEl('h3', { text: `Found ${similarItems.length} ${resultLabel}:` });
					
					const list = resultsContainer.createEl('ul');
					list.style.listStyle = 'none';
					list.style.padding = '0';
					
					for (const similar of similarItems) {
						const li = list.createEl('li');
						li.style.marginBottom = '10px';
						li.style.padding = '8px';
						li.style.border = '1px solid var(--background-modifier-border)';
						li.style.borderRadius = '4px';
						
						const link = li.createEl('a', { text: similar.filePath });
						link.style.cursor = 'pointer';
						link.style.textDecoration = 'underline';
						link.style.color = 'var(--text-accent)';
						link.onclick = () => {
							this.plugin.jumpToMarginalia(similar.filePath, similar.item.id);
							this.close();
						};
						
						li.createEl('br');
						const preview = li.createSpan();
						preview.textContent = similar.item.note || similar.item.text || 'No text';
						preview.style.fontSize = '0.9em';
						preview.style.color = 'var(--text-muted)';
						
						li.createEl('br');
						const similarity = li.createSpan();
						similarity.textContent = `Similarity: ${(similar.similarity * 100).toFixed(1)}%`;
						similarity.style.fontSize = '0.85em';
						similarity.style.color = 'var(--text-muted)';
					}
					
					// Add filename input section with buttons inside
					const filenameContainer = resultsContainer.createDiv();
					filenameContainer.style.marginTop = '20px';
					filenameContainer.style.marginBottom = '20px';
					filenameContainer.style.padding = '15px';
					filenameContainer.style.backgroundColor = 'var(--background-secondary)';
					filenameContainer.style.borderRadius = '4px';
					filenameContainer.style.border = '1px solid var(--background-modifier-border)';
					
					const filenameLabel = filenameContainer.createEl('label');
					filenameLabel.textContent = 'Export file name:';
					filenameLabel.style.display = 'block';
					filenameLabel.style.marginBottom = '8px';
					filenameLabel.style.fontWeight = '500';
					
					const filenameInputContainer = filenameContainer.createDiv();
					filenameInputContainer.style.display = 'flex';
					filenameInputContainer.style.gap = '8px';
					filenameInputContainer.style.alignItems = 'center';
					filenameInputContainer.style.marginBottom = '15px';
					
					const filenameInput = filenameInputContainer.createEl('input', {
						attr: {
							type: 'text',
							placeholder: 'Enter filename...'
						}
					});
					filenameInput.style.flex = '1';
					filenameInput.style.padding = '6px 10px';
					filenameInput.style.border = '1px solid var(--background-modifier-border)';
					filenameInput.style.borderRadius = '4px';
					filenameInput.style.fontSize = '0.9em';
					
					const regenerateButton = filenameInputContainer.createEl('button', { text: 'Regenerate Name' });
					regenerateButton.style.padding = '6px 12px';
					regenerateButton.style.border = '1px solid var(--background-modifier-border)';
					regenerateButton.style.borderRadius = '4px';
					regenerateButton.style.background = 'var(--background-primary)';
					regenerateButton.style.cursor = 'pointer';
					regenerateButton.style.fontSize = '0.9em';
					regenerateButton.style.whiteSpace = 'nowrap';
					
					// Generate initial AI suggestion
					let currentFileName = '';
					const generateFileName = async () => {
						regenerateButton.disabled = true;
						regenerateButton.textContent = 'Generating...';
						try {
							const suggestedName = await this.generateAITitle('TOC');
							currentFileName = suggestedName;
							filenameInput.value = suggestedName;
						} catch (error) {
							const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
							currentFileName = `Marginalia ${timestamp}`;
							filenameInput.value = currentFileName;
						}
						regenerateButton.disabled = false;
						regenerateButton.textContent = 'Regenerate Name';
					};
					
					regenerateButton.onclick = generateFileName;
					
					// Update currentFileName when user types
					filenameInput.oninput = () => {
						currentFileName = filenameInput.value.trim();
					};
					
					// Generate initial suggestion
					await generateFileName();
					
					// Add action buttons inside the filename container
					const buttonContainer = filenameContainer.createDiv();
					buttonContainer.style.display = 'flex';
					buttonContainer.style.gap = '10px';
					
					const tocButtonContainer = buttonContainer.createDiv();
					tocButtonContainer.style.display = 'flex';
					tocButtonContainer.style.alignItems = 'center';
					tocButtonContainer.style.gap = '8px';
					tocButtonContainer.style.flex = '1';
					
					const tocButton = tocButtonContainer.createEl('button', { text: 'Create Table of Contents Note' });
					tocButton.addClass('mod-cta');
					tocButton.style.flex = '1';
					
					const tocProgress = tocButtonContainer.createSpan();
					tocProgress.style.display = 'none';
					tocProgress.style.width = '16px';
					tocProgress.style.height = '16px';
					tocProgress.style.border = '2px solid var(--text-muted)';
					tocProgress.style.borderTop = '2px solid var(--text-accent)';
					tocProgress.style.borderRadius = '50%';
					tocProgress.style.animation = 'spin 1s linear infinite';
					
					tocButton.onclick = async () => {
						const fileName = filenameInput.value.trim() || currentFileName || 'Marginalia TOC';
						if (!fileName) {
							new Notice('Please enter a filename');
							return;
						}
						tocButton.disabled = true;
						tocButton.style.opacity = '0.6';
						tocProgress.style.display = 'block';
						try {
							await this.createTableOfContents(fileName);
						} finally {
							tocButton.disabled = false;
							tocButton.style.opacity = '1';
							tocProgress.style.display = 'none';
						}
					};
					
					const canvasButtonContainer = buttonContainer.createDiv();
					canvasButtonContainer.style.display = 'flex';
					canvasButtonContainer.style.alignItems = 'center';
					canvasButtonContainer.style.gap = '8px';
					canvasButtonContainer.style.flex = '1';
					
					const canvasButton = canvasButtonContainer.createEl('button', { text: 'Create Canvas' });
					canvasButton.addClass('mod-cta');
					canvasButton.style.flex = '1';
					
					const canvasProgress = canvasButtonContainer.createSpan();
					canvasProgress.style.display = 'none';
					canvasProgress.style.width = '16px';
					canvasProgress.style.height = '16px';
					canvasProgress.style.border = '2px solid var(--text-muted)';
					canvasProgress.style.borderTop = '2px solid var(--text-accent)';
					canvasProgress.style.borderRadius = '50%';
					canvasProgress.style.animation = 'spin 1s linear infinite';
					
					canvasButton.onclick = async () => {
						const fileName = filenameInput.value.trim() || currentFileName || 'Marginalia Canvas';
						if (!fileName) {
							new Notice('Please enter a filename');
							return;
						}
						canvasButton.disabled = true;
						canvasButton.style.opacity = '0.6';
						canvasProgress.style.display = 'block';
						try {
							await this.createCanvas(fileName);
						} finally {
							canvasButton.disabled = false;
							canvasButton.style.opacity = '1';
							canvasProgress.style.display = 'none';
						}
					};
				}
			} catch (error: any) {
				resultsContainer.createEl('p', { 
					text: `Error: ${error.message}`,
					cls: 'mod-warning'
				});
			} finally {
				runButton.disabled = false;
				runButton.textContent = 'Find Similar';
			}
		};
	}

	private async generateAITitle(fileType: 'TOC' | 'Canvas'): Promise<string> {
		// Check if Ollama is available
		if (!this.plugin.settings.ollamaAvailable) {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
			return fileType === 'TOC' ? `Marginalia TOC ${timestamp}` : `Marginalia Canvas ${timestamp}`;
		}

		try {
			// Collect all marginalia text
			let allText = '';
			
			// Add original item text
			if (this.item.text) {
				allText += `Selection: "${this.item.text}"\n`;
			}
			if (this.item.note) {
				allText += `Marginalia: ${this.item.note}\n`;
			}
			allText += '\n---\n\n';
			
			// Add similar items text
			for (const similar of this.currentSimilarItems) {
				if (similar.item.text) {
					allText += `Selection: "${similar.item.text}"\n`;
				}
				if (similar.item.note) {
					allText += `Marginalia: ${similar.item.note}\n`;
				}
				allText += '\n---\n\n';
			}

			// Call Phi3 to generate a title
			const address = this.plugin.settings.ollamaAddress || 'localhost';
			const port = this.plugin.settings.ollamaPort || '11434';
			const baseUrl = `http://${address}:${port}`;

			const prompt = `Based on the following collection of marginalia notes and their selected text, generate a VERY SHORT descriptive phrase (2-3 words maximum, under 25 characters) that describes the main topic or subject.

Requirements:
- Maximum 2-3 words only
- Use title case (capitalize first letter of each word)
- ONLY letters and spaces - NO numbers, punctuation, or special characters
- NO words like "title", "filename", "name", "file", "document", "note", or any reference to files
- Just descriptive words about the topic/subject matter
- No explanations or notes
- Keep it under 25 characters total
- Make it a simple, concise phrase describing the content

Examples of good titles: "Reading Knowledge", "Education Importance", "Learning Path"

Return ONLY the descriptive phrase with words and spaces, nothing else.

Text to analyze:
${allText}`;

			const response = await fetch(`${baseUrl}/api/generate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'phi3:latest',
					prompt: prompt,
					stream: false
				})
			});

			if (response.ok) {
				const data = await response.json();
				let title = (data.response || '').trim();
				
				// Clean up the title - extract just the title text
				// Remove quotes, newlines, and explanations
				title = title.replace(/["'`]/g, '').replace(/\n/g, ' ').trim();
				
				// Remove common prefixes/suffixes that AI might add
				title = title.replace(/^(title|filename|name|file|document|note):\s*/i, '');
				title = title.replace(/\s*(title|filename|name|file|document|note)$/i, '');
				
				// Remove any standalone occurrences of file-related words
				title = title.replace(/\b(title|filename|name|file|document|note)\b/gi, '').trim();
				// Clean up any double spaces that might result
				title = title.replace(/\s+/g, ' ').trim();
				
				// Remove ALL numbers
				title = title.replace(/\d/g, '');
				
				// Remove ALL punctuation and special characters (keep only letters and spaces)
				title = title.replace(/[^a-zA-Z\s]/g, '');
				
				// Replace multiple spaces with single space
				title = title.replace(/\s+/g, ' ').trim();
				
				// Limit length to 25 characters and ensure it's not empty
				// Truncate at word boundaries to avoid cutting off words
				if (title.length > 25) {
					// Find the last space before the 25 character limit
					const truncated = title.substring(0, 25);
					const lastSpace = truncated.lastIndexOf(' ');
					if (lastSpace > 10) {
						// If we found a space and it's not too early, cut there
						title = truncated.substring(0, lastSpace).trim();
					} else {
						// Otherwise just truncate at word boundary
						title = truncated.trim();
					}
				}
				
				// Final cleanup - ensure only letters and spaces remain
				title = title.replace(/[^a-zA-Z\s]/g, '').trim();
				
				// If title still contains underscores or looks like gibberish, try to clean it further
				if (title.includes('_') || /^[A-Z][a-z]+_[A-Z]/.test(title)) {
					// Split on underscores and capitalize each word properly
					const words = title.split(/[_\s]+/).filter((w: string) => w.length > 0);
					title = words.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
				}
				if (!title || title.length === 0) {
					throw new Error('Empty title generated');
				}
				
				return title;
			} else {
				throw new Error(`Phi3 API error: ${response.statusText}`);
			}
		} catch (error) {
			console.error('Error generating AI title:', error);
			// Fallback to timestamp-based name
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
			return fileType === 'TOC' ? `Marginalia TOC ${timestamp}` : `Marginalia Canvas ${timestamp}`;
		}
	}

	private async createTableOfContents(fileName: string) {
		try {
			// Get default new file location using Obsidian's new file parent
			const currentFile = this.app.workspace.getActiveFile();
			const sourcePath = currentFile ? currentFile.path : '';
			const newFileParent = this.app.fileManager.getNewFileParent(sourcePath);
			const basePath = newFileParent.path;
			
			// Use provided filename (ensure it has .md extension)
			const cleanFileName = fileName.replace(/\.md$/, '').trim();
			const finalFileName = `${cleanFileName}.md`;
			const filePath = basePath ? `${basePath}/${finalFileName}` : finalFileName;
			
			// Build table of contents content
			let content = `# Table of Contents - Similar Marginalia\n\n`;
			content += `Generated: ${new Date().toLocaleString()}\n\n`;
			
			// Original note section
			content += `## Original Note\n\n`;
			const originalFile = this.app.vault.getAbstractFileByPath(this.filePath);
			const originalFileName = originalFile instanceof TFile ? originalFile.basename : this.filePath;
			content += `- [[${this.filePath}|${originalFileName}]]\n`;
			if (this.item.text) {
				content += `    - **Selection:**\n`;
				// Indent each line of the text under the subheading
				const textLines = this.item.text.split('\n');
				for (const line of textLines) {
					content += `        ${line}\n`;
				}
			}
			if (this.item.note) {
				content += `    - **Marginalia:**\n`;
				// Indent each line of the note under the subheading
				const noteLines = this.item.note.split('\n');
				for (const line of noteLines) {
					content += `        ${line}\n`;
				}
			}
			content += `\n`;
			
			// Related notes section
			content += `## Related Notes\n\n`;
			for (const similar of this.currentSimilarItems) {
				const similarFile = this.app.vault.getAbstractFileByPath(similar.filePath);
				const similarFileName = similarFile instanceof TFile ? similarFile.basename : similar.filePath;
				content += `- [[${similar.filePath}|${similarFileName}]] (Similarity: ${(similar.similarity * 100).toFixed(1)}%)\n`;
				if (similar.item.text) {
					content += `    - **Selection:**\n`;
					// Indent each line of the text under the subheading
					const textLines = similar.item.text.split('\n');
					for (const line of textLines) {
						content += `        ${line}\n`;
					}
				}
				if (similar.item.note) {
					content += `    - **Marginalia:**\n`;
					// Indent each line of the note under the subheading
					const noteLines = similar.item.note.split('\n');
					for (const line of noteLines) {
						content += `        ${line}\n`;
					}
				}
				content += `\n`;
			}
			
			// Create the file
			const file = await this.app.vault.create(filePath, content);
			
			// Open the new file
			const leaf = this.app.workspace.getLeaf();
			await leaf.openFile(file);
			
			new Notice(`Table of contents note created: ${finalFileName}`);
		} catch (error: any) {
			new Notice(`Error creating table of contents: ${error.message}`);
			console.error('Error creating table of contents:', error);
		}
	}

	private async createCanvas(fileName: string) {
		try {
			// Get default new file location using Obsidian's new file parent
			const currentFile = this.app.workspace.getActiveFile();
			const sourcePath = currentFile ? currentFile.path : '';
			const newFileParent = this.app.fileManager.getNewFileParent(sourcePath);
			const basePath = newFileParent.path;
			
			// Use provided filename (ensure it has .canvas extension)
			const cleanFileName = fileName.replace(/\.canvas$/, '').trim();
			const finalFileName = `${cleanFileName}.canvas`;
			const filePath = basePath ? `${basePath}/${finalFileName}` : finalFileName;
			
			// Check if canvas is already open
			const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
			const wasOpen = canvasLeaves.some(leaf => {
				const view = leaf.view as any;
				return view?.file?.path === filePath;
			});
			
			// Close canvas views for this file if open
			for (const leaf of canvasLeaves) {
				const view = leaf.view as any;
				if (view?.file?.path === filePath) {
					await leaf.detach();
				}
			}
			
			// Build canvas structure
			const nodes: any[] = [];
			
			// Track unique file paths to avoid duplicates
			const addedFiles = new Set<string>();
			
			// Collect all unique file paths (original + similar items)
			const allFilePaths: string[] = [];
			
			// Add original note path if it exists
			const originalFile = this.app.vault.getAbstractFileByPath(this.filePath);
			if (originalFile instanceof TFile && !addedFiles.has(this.filePath)) {
				allFilePaths.push(this.filePath);
				addedFiles.add(this.filePath);
			}
			
			// Add similar item file paths (avoiding duplicates)
			for (const similar of this.currentSimilarItems) {
				if (!addedFiles.has(similar.filePath)) {
					const similarFile = this.app.vault.getAbstractFileByPath(similar.filePath);
					if (similarFile instanceof TFile) {
						allFilePaths.push(similar.filePath);
						addedFiles.add(similar.filePath);
					}
				}
			}
			
			// Create nodes in a grid layout
			let x = 0;
			let y = 0;
			const nodeWidth = 400;
			const nodeHeight = 400;
			const spacing = 50;
			const nodesPerRow = 3;
			
			// Helper to generate 16-character hex ID (matching Obsidian's format)
			const generateNodeId = () => {
				return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
			};
			
			for (let i = 0; i < allFilePaths.length; i++) {
				const filePath = allFilePaths[i];
				const nodeId = generateNodeId();
				
				// Create node with proper Obsidian canvas format
				const node: any = {
					id: nodeId,
					type: 'file',
					file: filePath,
					x: Math.round(x),
					y: Math.round(y),
					width: nodeWidth,
					height: nodeHeight,
					styleAttributes: {} // Required by Obsidian
				};
				
				nodes.push(node);
				
				// Move to next position (grid layout)
				if ((i + 1) % nodesPerRow === 0) {
					x = 0;
					y += nodeHeight + spacing;
				} else {
					x += nodeWidth + spacing;
				}
			}
			
			// Create canvas JSON with proper Obsidian canvas format
			// Obsidian canvas files require specific structure with metadata
			const canvasData = {
				nodes: nodes,
				edges: [], // No edges - user requested no arrows
				metadata: {
					version: '1.0-1.0'
				}
			};
			
			// Filter out invalid nodes
			const validNodes = nodes.filter((n: any) => n != null && n.id && n.type && n.file);
			
			const cleanCanvas = {
				nodes: validNodes,
				edges: [],
				metadata: canvasData.metadata
			};
			
			// Use tabs for indentation (Obsidian's format)
			const canvasContent = JSON.stringify(cleanCanvas, null, '\t');
			
			// Check if file already exists
			const existingFile = this.app.vault.getAbstractFileByPath(filePath);
			let file: TFile;
			
			if (existingFile instanceof TFile) {
				// File exists - modify it
				await this.app.vault.modify(existingFile, canvasContent);
				file = existingFile;
			} else {
				// File doesn't exist - create it
				file = await this.app.vault.create(filePath, canvasContent);
			}
			
			// If it was open, reopen it after a delay
			if (wasOpen) {
				setTimeout(async () => {
					await this.app.workspace.openLinkText(filePath, '', true);
				}, 300);
			} else {
				// Open in new leaf
				await this.app.workspace.openLinkText(filePath, '', true);
			}
			
			new Notice(`Canvas created: ${finalFileName}`);
		} catch (error: any) {
			new Notice(`Error creating canvas: ${error.message}`);
			console.error('Error creating canvas:', error);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.currentSimilarItems = [];
	}
}

export class EditMarginaliaModal extends Modal {
	private item: MarginaliaItem;
	private onSubmit: (note: string, color?: string) => void;
	private onDelete?: () => void;
	private defaultColor: string;

	constructor(app: any, item: MarginaliaItem, defaultColor: string, onSubmit: (note: string, color?: string) => void, onDelete?: () => void) {
		super(app);
		this.item = item;
		this.onSubmit = onSubmit;
		this.onDelete = onDelete;
		this.defaultColor = defaultColor;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Edit Margin Note' });

		const textPreview = contentEl.createDiv();
		textPreview.createEl('p', { 
			text: `Selected text: "${this.item.text || 'No selection'}"` 
		});

		const input = contentEl.createEl('textarea', {
			attr: {
				placeholder: 'Enter your margin note...',
				rows: '5'
			}
		});
		input.style.width = '100%';
		input.style.minHeight = '100px';
		input.value = this.item.note;

		// Color picker
		const colorContainer = contentEl.createDiv();
		colorContainer.style.marginTop = '15px';
		colorContainer.style.marginBottom = '10px';
		
		const colorLabel = colorContainer.createEl('label');
		colorLabel.textContent = 'Highlight Color (optional, defaults to settings):';
		colorLabel.style.display = 'block';
		colorLabel.style.marginBottom = '5px';
		colorLabel.style.fontSize = '0.9em';
		
		const colorPickerContainer = colorContainer.createDiv();
		colorPickerContainer.style.display = 'flex';
		colorPickerContainer.style.gap = '10px';
		colorPickerContainer.style.alignItems = 'center';
		
		const colorPicker = colorPickerContainer.createEl('input', {
			attr: {
				type: 'color'
			}
		});
		colorPicker.value = this.item.color || this.defaultColor;
		colorPicker.style.flex = '1';
		colorPicker.style.height = '40px';
		colorPicker.style.border = '1px solid var(--background-modifier-border)';
		colorPicker.style.borderRadius = '4px';
		colorPicker.style.cursor = 'pointer';
		
		const resetButton = colorPickerContainer.createEl('button', { text: 'Reset to Default' });
		resetButton.style.flexShrink = '0';
		resetButton.onclick = () => {
			colorPicker.value = this.defaultColor;
		};

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.marginTop = '10px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'space-between';
		buttonContainer.style.gap = '10px';

		// Left side: Delete button
		const leftButtons = buttonContainer.createDiv();
		leftButtons.style.display = 'flex';
		leftButtons.style.gap = '10px';
		
		if (this.onDelete) {
			const deleteButton = leftButtons.createEl('button', { text: 'Delete' });
			deleteButton.onclick = () => {
				this.close();
				this.onDelete!();
			};
		}

		// Right side: Cancel and Save buttons
		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = 'flex';
		rightButtons.style.gap = '10px';

		const cancelButton = rightButtons.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const submitButton = rightButtons.createEl('button', { text: 'Save' });
		submitButton.addClass('mod-cta');
		submitButton.onclick = () => {
			// Always save the color value (default or custom) to the item
			const selectedColor = colorPicker.value;
			this.onSubmit(input.value, selectedColor);
			this.close();
		};

		input.focus();
		input.select();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class DeleteConfirmationModal extends Modal {
	private onConfirm: () => void;

	constructor(app: any, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Delete Margin Note?' });
		contentEl.createEl('p', { 
			text: 'Are you sure you want to delete this margin note? This action cannot be undone.' 
		});

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.marginTop = '20px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const confirmButton = buttonContainer.createEl('button', { text: 'Delete' });
		confirmButton.addClass('mod-warning');
		confirmButton.onclick = () => {
			this.onConfirm();
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
