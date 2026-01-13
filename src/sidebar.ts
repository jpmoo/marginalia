import { ItemView, WorkspaceLeaf, MarkdownView, Modal, TFile, Notice, MarkdownRenderer, Component } from 'obsidian';
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
			// Sync search term from all notes to current note when switching
			// Always sync to maintain search persistence across tabs
			if (this.searchTerm) {
				this.currentNoteSearchTerm = this.searchTerm;
			}
			this.refresh();
		};

		allNotesTab.onclick = () => {
			(this as any).currentTab = 'all';
			allNotesTab.addClass('marginalia-tab-active');
			currentNoteTab.removeClass('marginalia-tab-active');
			// Sync search term from current note to all notes when switching
			// Always sync to maintain search persistence across tabs
			if (this.currentNoteSearchTerm) {
				this.searchTerm = this.currentNoteSearchTerm;
			}
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
		// Clean up event listeners
		const closeHandler = (this as any).sortDropdownCloseHandler;
		if (closeHandler) {
			document.removeEventListener('click', closeHandler);
		}
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
		
		// Create search and controls container at the top
		const topControlsContainer = contentArea.createDiv();
		topControlsContainer.style.marginBottom = '10px';
		topControlsContainer.style.display = 'flex';
		topControlsContainer.style.gap = '8px';
		topControlsContainer.style.alignItems = 'center';
		
		// Search input container (flexible)
		const searchContainer = topControlsContainer.createDiv();
		searchContainer.style.flex = '1';
		searchContainer.style.position = 'relative';
		searchContainer.style.display = 'flex';
		searchContainer.style.alignItems = 'center';
		
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
		
		// Sort button with dropdown
		const sortButtonContainer = topControlsContainer.createDiv();
		sortButtonContainer.style.position = 'relative';
		sortButtonContainer.style.flexShrink = '0';
		
		const sortButton = sortButtonContainer.createEl('button');
		sortButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>';
		sortButton.title = 'Sort options';
		sortButton.style.padding = '4px 6px';
		sortButton.style.border = '1px solid var(--background-modifier-border)';
		sortButton.style.borderRadius = '4px';
		sortButton.style.background = 'var(--background-primary)';
		sortButton.style.cursor = 'pointer';
		sortButton.style.height = 'auto';
		sortButton.style.minHeight = 'auto';
		sortButton.style.width = '32px';
		sortButton.style.display = 'flex';
		sortButton.style.alignItems = 'center';
		sortButton.style.justifyContent = 'center';
		
		// Dropdown menu (initially hidden)
		const sortDropdown = sortButtonContainer.createDiv();
		sortDropdown.style.display = 'none';
		sortDropdown.style.position = 'absolute';
		sortDropdown.style.top = '100%';
		sortDropdown.style.right = '0';
		sortDropdown.style.marginTop = '4px';
		sortDropdown.style.backgroundColor = 'var(--background-primary)';
		sortDropdown.style.border = '1px solid var(--background-modifier-border)';
		sortDropdown.style.borderRadius = '4px';
		sortDropdown.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
		sortDropdown.style.zIndex = '1000';
		sortDropdown.style.minWidth = '200px';
		sortDropdown.style.overflow = 'hidden';
		
		// Function to update dropdown menu items with current sort order
		const updateSortDropdown = () => {
			sortDropdown.empty();
			const currentSortOrder = this.plugin.settings.sortOrder || 'position';
			
			// Create menu items
			const menuItems = [
				{ value: 'position', label: 'Order in note' },
				{ value: 'date-asc', label: 'Modified (oldest first)' },
				{ value: 'date-desc', label: 'Modified (newest first)' }
			];
			
			menuItems.forEach((item) => {
				const menuItem = sortDropdown.createDiv();
				menuItem.style.padding = '8px 12px';
				menuItem.style.cursor = 'pointer';
				menuItem.style.fontSize = '0.9em';
				menuItem.style.color = 'var(--text-normal)';
				menuItem.style.display = 'flex';
				menuItem.style.alignItems = 'center';
				menuItem.style.gap = '8px';
				
				// Checkmark for selected item
				if (item.value === currentSortOrder) {
					const checkmark = menuItem.createSpan();
					checkmark.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l3 3 5-5"/></svg>';
					checkmark.style.flexShrink = '0';
					checkmark.style.color = 'var(--text-accent)';
				} else {
					const spacer = menuItem.createSpan();
					spacer.style.width = '14px';
					spacer.style.flexShrink = '0';
				}
				
				const label = menuItem.createSpan();
				label.textContent = item.label;
				
				menuItem.onmouseenter = () => {
					menuItem.style.backgroundColor = 'var(--background-modifier-hover)';
				};
				menuItem.onmouseleave = () => {
					menuItem.style.backgroundColor = '';
				};
				
				menuItem.onclick = async (e) => {
					e.stopPropagation();
					this.plugin.settings.sortOrder = item.value as 'position' | 'date-asc' | 'date-desc';
					await this.plugin.saveData(this.plugin.settings);
					sortDropdown.style.display = 'none';
					updateSortDropdown(); // Update dropdown to show new selection
					renderFilteredItems();
				};
			});
		};
		
		// Initialize dropdown
		updateSortDropdown();
		
		// Toggle dropdown on button click
		sortButton.onmousedown = (e) => {
			e.stopPropagation();
			e.preventDefault();
			const isVisible = sortDropdown.style.display === 'block';
			if (!isVisible) {
				// Update dropdown before showing to ensure current selection is shown
				updateSortDropdown();
			}
			sortDropdown.style.display = isVisible ? 'none' : 'block';
		};
		
		// Close dropdown when clicking outside
		const closeDropdown = (e: MouseEvent) => {
			if (!sortButtonContainer.contains(e.target as Node)) {
				sortDropdown.style.display = 'none';
			}
		};
		document.addEventListener('click', closeDropdown);
		(this as any).sortDropdownCloseHandler = closeDropdown;
		
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
			// Show only 3 lines preview of the marginalia note
			const noteLines = (item.note || '').split('\n');
			const previewLines = noteLines.slice(0, 3);
			let previewText = previewLines.join('\n');
			if (noteLines.length > 3 || previewText.length > 150) {
				previewText = previewText.substring(0, 150) + '...';
			}
			noteDiv.textContent = previewText;
			noteDiv.style.maxHeight = '3em'; // Approximately 3 lines
			noteDiv.style.overflow = 'hidden';
			noteDiv.style.textOverflow = 'ellipsis';
			
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
			actions.style.display = 'flex';
			actions.style.justifyContent = 'space-between';
			actions.style.alignItems = 'center';
			
			// Left side: View, Edit, AI Functions buttons
			const leftButtons = actions.createDiv();
			leftButtons.style.display = 'flex';
			leftButtons.style.gap = '5px';
			
			// View button with icon
			const viewButton = leftButtons.createEl('button');
			viewButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
			viewButton.title = 'View';
			viewButton.onmousedown = (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.showViewModal(item, activeFile.path);
			};

			// Edit button with icon
			const editButton = leftButtons.createEl('button');
			editButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
			editButton.title = 'Edit';
			editButton.onmousedown = (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.showEditModal(item, activeFile.path);
			};

			// AI Functions button with zap icon
			const aiButton = leftButtons.createEl('button');
			aiButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
			aiButton.title = 'AI Functions';
			aiButton.onmousedown = (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.showAIFunctionsModal(item, activeFile.path);
			};

			// Right side: Delete button (all the way to the right)
			const rightButtons = actions.createDiv();
			rightButtons.style.display = 'flex';
			rightButtons.style.gap = '5px';
			
			// Delete button with icon (colored red)
			const deleteButton = rightButtons.createEl('button');
			deleteButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
			deleteButton.title = 'Delete';
			deleteButton.style.color = 'var(--text-error)';
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
		topControlsContainer.style.gap = '8px';
		topControlsContainer.style.alignItems = 'center'; // Center align items
		
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
		
		// Store reference to tree container for filtering
		const treeContainer = contentArea.createDiv('marginalia-tree');
		(this as any).treeContainer = treeContainer;
		
		// Track whether all folders are expanded
		let allExpanded = true;
		
		// Function to check if all folders are expanded
		const checkAllExpanded = (node: TreeNode): boolean => {
			if (node.children.size === 0) return true;
			for (const child of node.children.values()) {
				if (!child.isExpanded) return false;
				if (!checkAllExpanded(child)) return false;
			}
			return true;
		};
		
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
				isExpanded: allExpanded // Use tracked state
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
							isExpanded: allExpanded // Use tracked state
						});
					}
					current = current.children.get(part)!;
				}
				current.files.push({ path: fileInfo.path, count: fileInfo.count });
			}
			
			(this as any).treeRoot = root;
			this.renderTreeNode(treeContainer, root, 0);
			
			// Update button state after rendering
			updateToggleButton();
		};
		
		// Single toggle button for expand/collapse
		const toggleButton = topControlsContainer.createEl('button');
		toggleButton.style.flexShrink = '0';
		toggleButton.style.padding = '4px 6px';
		toggleButton.style.border = '1px solid var(--background-modifier-border)';
		toggleButton.style.borderRadius = '4px';
		toggleButton.style.background = 'var(--background-primary)';
		toggleButton.style.cursor = 'pointer';
		toggleButton.style.height = 'auto';
		toggleButton.style.minHeight = 'auto';
		toggleButton.style.width = '32px';
		toggleButton.style.display = 'flex';
		toggleButton.style.alignItems = 'center';
		toggleButton.style.justifyContent = 'center';
		
		// Function to update button icon and tooltip
		const updateToggleButton = () => {
			const treeRoot = (this as any).treeRoot;
			if (treeRoot) {
				allExpanded = checkAllExpanded(treeRoot);
			}
			if (allExpanded) {
				// Show collapse icon (> < - pointing outward)
				toggleButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4l2 2-2 2"/><path d="M11 4l-2 2 2 2"/></svg>';
				toggleButton.title = 'Collapse all folders';
			} else {
				// Show expand icon (<> - pointing outward)
				toggleButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4l-2 2 2 2"/><path d="M11 4l2 2-2 2"/></svg>';
				toggleButton.title = 'Expand all folders';
			}
		};
		
		// Store reference for use in renderTreeNode
		(this as any).updateToggleButtonRef = updateToggleButton;
		
		// Initialize button state
		updateToggleButton();
		
		// Toggle button handler
		toggleButton.onmousedown = (e) => {
			e.stopPropagation();
			e.preventDefault();
			const treeRoot = (this as any).treeRoot;
			if (treeRoot) {
				allExpanded = !allExpanded;
				this.setAllExpanded(treeRoot, allExpanded);
				renderFilteredTree();
			}
		};
		
		// Update search term and filter on input (without full refresh)
		searchInput.oninput = (e: Event) => {
			const target = e.target as HTMLInputElement;
			this.searchTerm = target.value;
			clearButton.style.display = target.value ? 'block' : 'none';
			renderFilteredTree();
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
					// Update toggle button state after individual folder click
					const updateFn = (this as any).updateToggleButtonRef;
					if (updateFn) {
						updateFn();
					}
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

	private showViewModal(item: MarginaliaItem, filePath: string) {
		const modal = new ViewMarginaliaModal(this.app, this.plugin, item, filePath, () => {
			// Edit handler - close view and open edit
			modal.close();
			this.showEditModal(item, filePath);
		}, () => {
			// Delete handler - refresh view after deletion
			this.refresh();
		});
		modal.open();
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
		}, this.plugin);
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
	private resultsContainer: HTMLElement;
	private currentSimilarItems: Array<{ item: MarginaliaItem; filePath: string; similarity: number }> = [];
	private currentFunctionType: string = '';
	private menu1Select: HTMLSelectElement;
	private menu2Select: HTMLSelectElement;
	private slider: HTMLInputElement;
	private sliderValue: HTMLElement;
	private hasNoteEmbedding: boolean = false;
	private exportSection: HTMLElement | null = null;

	constructor(app: any, plugin: MarginaliaPlugin, item: MarginaliaItem, filePath: string) {
		super(app);
		this.plugin = plugin;
		this.item = item;
		this.filePath = filePath;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('marginalia-ai-modal');
		
		// Set modal width to 800px
		// Style the modal container itself, not just contentEl
		const modalEl = (this as any).modalEl || contentEl.closest('.modal');
		if (modalEl) {
			(modalEl as HTMLElement).style.minWidth = '800px';
			(modalEl as HTMLElement).style.maxWidth = '800px';
			(modalEl as HTMLElement).style.width = '800px';
			(modalEl as HTMLElement).style.padding = '0';
			(modalEl as HTMLElement).style.margin = '0';
			(modalEl as HTMLElement).style.boxSizing = 'border-box';
		}
		const modalContent = contentEl.closest('.modal-content');
		if (modalContent) {
			(modalContent as HTMLElement).style.minWidth = '800px';
			(modalContent as HTMLElement).style.maxWidth = '800px';
			(modalContent as HTMLElement).style.width = '800px';
			(modalContent as HTMLElement).style.padding = '0';
			(modalContent as HTMLElement).style.margin = '0';
			(modalContent as HTMLElement).style.boxSizing = 'border-box';
		}
		contentEl.style.minWidth = '780px';
		contentEl.style.maxWidth = '780px';
		contentEl.style.width = '780px';
		contentEl.style.padding = '8px';
		contentEl.style.margin = '0';
		contentEl.style.boxSizing = 'border-box';
		contentEl.style.minHeight = '600px';
		contentEl.style.maxHeight = '85vh';
		contentEl.style.overflow = 'hidden';
		
		contentEl.createEl('h2', { text: 'AI Functions' });

		// Check if current note has embedding
		this.hasNoteEmbedding = await this.checkNoteHasEmbedding();

		// Two scrollable windows side by side
		const textWindowsContainer = contentEl.createDiv();
		textWindowsContainer.style.display = 'flex';
		textWindowsContainer.style.gap = '6px';
		textWindowsContainer.style.marginBottom = '12px';
		textWindowsContainer.style.height = '120px';
		textWindowsContainer.style.width = '100%';
		textWindowsContainer.style.maxWidth = '100%';
		textWindowsContainer.style.boxSizing = 'border-box';
		textWindowsContainer.style.overflow = 'hidden';
		textWindowsContainer.style.padding = '0';
		textWindowsContainer.style.marginLeft = '0';
		textWindowsContainer.style.marginRight = '0';

		// Selected text window
		const selectionWindow = textWindowsContainer.createDiv();
		selectionWindow.style.flex = '1 1 0';
		selectionWindow.style.border = '1px solid var(--background-modifier-border)';
		selectionWindow.style.borderRadius = '4px';
		selectionWindow.style.padding = '4px';
		selectionWindow.style.backgroundColor = 'var(--background-secondary)';
		selectionWindow.style.overflowY = 'auto';
		selectionWindow.style.overflowX = 'hidden';
		selectionWindow.style.maxHeight = '120px';
		selectionWindow.style.fontSize = '0.8em';
		selectionWindow.style.boxSizing = 'border-box';
		selectionWindow.style.minWidth = '0';
		selectionWindow.style.width = '0';
		selectionWindow.style.margin = '0';
		
		const selectionLabel = selectionWindow.createEl('div', { text: 'Selected Text' });
		selectionLabel.style.fontWeight = 'bold';
		selectionLabel.style.marginBottom = '8px';
		selectionLabel.style.fontSize = '0.85em';
		selectionLabel.style.color = 'var(--text-muted)';
		
		const selectionText = selectionWindow.createEl('div');
		selectionText.style.whiteSpace = 'pre-wrap';
		selectionText.style.color = 'var(--text-normal)';
		selectionText.textContent = this.item.text || '(No selection)';

		// Marginalia text window
		const marginaliaWindow = textWindowsContainer.createDiv();
		marginaliaWindow.style.flex = '1 1 0';
		marginaliaWindow.style.border = '1px solid var(--background-modifier-border)';
		marginaliaWindow.style.borderRadius = '4px';
		marginaliaWindow.style.padding = '4px';
		marginaliaWindow.style.backgroundColor = 'var(--background-secondary)';
		marginaliaWindow.style.overflowY = 'auto';
		marginaliaWindow.style.overflowX = 'hidden';
		marginaliaWindow.style.maxHeight = '120px';
		marginaliaWindow.style.fontSize = '0.8em';
		marginaliaWindow.style.boxSizing = 'border-box';
		marginaliaWindow.style.minWidth = '0';
		marginaliaWindow.style.width = '0';
		marginaliaWindow.style.margin = '0';
		
		const marginaliaLabel = marginaliaWindow.createEl('div', { text: 'Marginalia' });
		marginaliaLabel.style.fontWeight = 'bold';
		marginaliaLabel.style.marginBottom = '8px';
		marginaliaLabel.style.fontSize = '0.85em';
		marginaliaLabel.style.color = 'var(--text-muted)';
		
		const marginaliaText = marginaliaWindow.createEl('div');
		marginaliaText.style.whiteSpace = 'pre-wrap';
		marginaliaText.style.color = 'var(--text-normal)';
		marginaliaText.textContent = this.item.note || '(No marginalia)';

		// Dropdown menus container
		const dropdownsContainer = contentEl.createDiv();
		dropdownsContainer.style.display = 'flex';
		dropdownsContainer.style.alignItems = 'center';
		dropdownsContainer.style.gap = '4px';
		dropdownsContainer.style.marginBottom = '12px';
		dropdownsContainer.style.flexWrap = 'nowrap';
		dropdownsContainer.style.width = '100%';
		dropdownsContainer.style.maxWidth = '100%';
		dropdownsContainer.style.boxSizing = 'border-box';
		dropdownsContainer.style.overflow = 'hidden';
		dropdownsContainer.style.marginLeft = '0';
		dropdownsContainer.style.marginRight = '0';

		// "Find" label
		const findLabel = dropdownsContainer.createEl('span');
		findLabel.textContent = 'Find';
		findLabel.style.fontSize = '11px';
		findLabel.style.flexShrink = '0';
		findLabel.style.whiteSpace = 'nowrap';

		// Menu1 dropdown
		this.menu1Select = dropdownsContainer.createEl('select');
		this.menu1Select.style.padding = '3px 4px';
		this.menu1Select.style.border = '1px solid var(--background-modifier-border)';
		this.menu1Select.style.borderRadius = '4px';
		this.menu1Select.style.fontSize = '11px';
		this.menu1Select.style.background = 'var(--background-primary)';
		this.menu1Select.style.width = '130px';
		this.menu1Select.style.maxWidth = '130px';
		this.menu1Select.style.minWidth = '130px';
		this.menu1Select.style.boxSizing = 'border-box';
		this.menu1Select.style.flexShrink = '0';

		this.menu1Select.createEl('option', { value: 'marginalia', text: 'marginalia' });
		this.menu1Select.createEl('option', { value: 'selections', text: 'selections' });
		this.menu1Select.createEl('option', { value: 'combined', text: 'combined marginalia and selections' });
		this.menu1Select.createEl('option', { value: 'notes', text: 'notes' });

		// "that are similar to" label
		const thatLabel = dropdownsContainer.createEl('span');
		thatLabel.textContent = 'similar to';
		thatLabel.style.fontSize = '11px';
		thatLabel.style.flexShrink = '0';
		thatLabel.style.whiteSpace = 'nowrap';

		// Menu2 dropdown
		this.menu2Select = dropdownsContainer.createEl('select');
		this.menu2Select.style.padding = '3px 4px';
		this.menu2Select.style.border = '1px solid var(--background-modifier-border)';
		this.menu2Select.style.borderRadius = '4px';
		this.menu2Select.style.fontSize = '11px';
		this.menu2Select.style.background = 'var(--background-primary)';
		this.menu2Select.style.width = '160px';
		this.menu2Select.style.maxWidth = '160px';
		this.menu2Select.style.minWidth = '160px';
		this.menu2Select.style.boxSizing = 'border-box';
		this.menu2Select.style.flexShrink = '0';

		this.menu2Select.createEl('option', { value: 'this-marginalia', text: 'this marginalia' });
		this.menu2Select.createEl('option', { value: 'this-selection', text: 'this selection' });
		this.menu2Select.createEl('option', { value: 'this-combined', text: 'this combination of marginalia and selection' });
		
		// Only add "this note" if current note has embedding
		if (this.hasNoteEmbedding) {
			this.menu2Select.createEl('option', { value: 'this-note', text: 'this note' });
		}

		// Similarity threshold slider
		const sliderContainer = contentEl.createDiv();
		sliderContainer.style.marginBottom = '12px';
		sliderContainer.style.display = 'flex';
		sliderContainer.style.alignItems = 'center';
		sliderContainer.style.gap = '6px';
		sliderContainer.style.width = '100%';
		sliderContainer.style.maxWidth = '100%';
		sliderContainer.style.boxSizing = 'border-box';
		sliderContainer.style.overflow = 'hidden';
		
		const sliderLabel = sliderContainer.createEl('label');
		sliderLabel.textContent = 'Threshold:';
		sliderLabel.style.fontSize = '11px';
		sliderLabel.style.flexShrink = '0';
		sliderLabel.style.whiteSpace = 'nowrap';
		
		this.sliderValue = sliderContainer.createSpan();
		const defaultThreshold = this.plugin.settings.defaultSimilarity || 0.6;
		this.sliderValue.textContent = defaultThreshold.toFixed(2);
		this.sliderValue.style.fontWeight = 'bold';
		this.sliderValue.style.minWidth = '40px';
		
		this.slider = sliderContainer.createEl('input', { 
			attr: { 
				type: 'range', 
				min: '0.5', 
				max: '1', 
				step: '0.01',
				value: defaultThreshold.toString()
			} 
		});
		this.slider.style.flex = '1 1 0';
		this.slider.style.maxWidth = '200px';
		this.slider.style.minWidth = '0';
		
		this.slider.oninput = (e) => {
			const target = e.target as HTMLInputElement;
			this.sliderValue.textContent = parseFloat(target.value).toFixed(2);
		};

		// Search button
		const searchButton = contentEl.createEl('button', { text: 'Search' });
		searchButton.addClass('mod-cta');
		searchButton.style.width = '100%';
		searchButton.style.maxWidth = '100%';
		searchButton.style.marginBottom = '12px';
		searchButton.style.marginLeft = '0';
		searchButton.style.marginRight = '0';
		searchButton.style.padding = '6px';
		searchButton.style.fontSize = '12px';
		searchButton.style.boxSizing = 'border-box';
		searchButton.style.overflow = 'hidden';

		// Results container (scrollable)
		this.resultsContainer = contentEl.createDiv();
		this.resultsContainer.style.maxHeight = '300px';
		this.resultsContainer.style.overflowY = 'auto';
		this.resultsContainer.style.overflowX = 'hidden';
		this.resultsContainer.style.marginBottom = '12px';
		this.resultsContainer.style.marginLeft = '0';
		this.resultsContainer.style.marginRight = '0';
		this.resultsContainer.style.border = '1px solid var(--background-modifier-border)';
		this.resultsContainer.style.borderRadius = '4px';
		this.resultsContainer.style.padding = '6px';
		this.resultsContainer.style.width = '100%';
		this.resultsContainer.style.maxWidth = '100%';
		this.resultsContainer.style.boxSizing = 'border-box';

		// Search button handler
		searchButton.onclick = async () => {
			await this.performSearch();
		};
	}

	private async checkNoteHasEmbedding(): Promise<boolean> {
		try {
			const embeddings = await (this.plugin as any).loadEmbeddings();
			const normalizedPath = (this.plugin as any).normalizePath(this.filePath);
			return embeddings.some((e: any) => (this.plugin as any).normalizePath(e.source_path) === normalizedPath);
		} catch (error) {
			console.error('Error checking note embedding:', error);
			return false;
		}
	}

	private async performSearch() {
		const menu1 = this.menu1Select.value;
		const menu2 = this.menu2Select.value;
		const threshold = parseFloat(this.slider.value);

		if (!menu1 || !menu2) {
			new Notice('Please select both dropdown options');
			return;
		}

		// Clear previous results
		this.resultsContainer.empty();
		this.resultsContainer.createEl('div', { text: 'Searching...' });

		// Determine function type from menu selections
		let functionType = '';
		let searchMode: 'marginalia' | 'selection' | 'combined' | 'note' = 'marginalia';
		
		// Map menu2 to search mode
		if (menu2 === 'this-marginalia') {
			searchMode = 'marginalia';
		} else if (menu2 === 'this-selection') {
			searchMode = 'selection';
		} else if (menu2 === 'this-combined') {
			searchMode = 'combined';
		} else if (menu2 === 'this-note') {
			searchMode = 'note';
		}

		// Build function type string
		if (menu1 === 'notes') {
			if (searchMode === 'marginalia') {
				functionType = 'notes-similar';
			} else if (searchMode === 'selection') {
				functionType = 'notes-similar-selection';
			} else if (searchMode === 'combined') {
				functionType = 'notes-similar-combined';
			} else if (searchMode === 'note') {
				functionType = 'notes-similar-note';
			}
		} else {
			if (searchMode === 'marginalia') {
				functionType = 'similar';
			} else if (searchMode === 'selection') {
				functionType = 'similar-selection';
			} else if (searchMode === 'combined') {
				functionType = 'similar-combined';
			}
		}

		this.currentFunctionType = functionType;

		try {
			let results: Array<{ item: MarginaliaItem; filePath: string; similarity: number }> = [];
			let resultLabel = '';

			if (menu1 === 'notes') {
				// Note-based search
				if (searchMode === 'marginalia') {
					const similarNotes = await this.plugin.findNotesSimilarToMarginalia(this.item, this.filePath, threshold);
					results = similarNotes.map(note => ({
						item: { id: '', text: '', note: '', from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, line: 0, ch: 0 } as MarginaliaItem,
						filePath: note.filePath,
						similarity: note.similarity
					}));
					resultLabel = 'similar notes (by marginalia)';
				} else if (searchMode === 'selection') {
					const similarNotes = await this.plugin.findNotesSimilarToSelection(this.item, this.filePath, threshold);
					results = similarNotes.map(note => ({
						item: { id: '', text: '', note: '', from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, line: 0, ch: 0 } as MarginaliaItem,
						filePath: note.filePath,
						similarity: note.similarity
					}));
					resultLabel = 'similar notes (by selection)';
				} else if (searchMode === 'combined') {
					const similarNotes = await this.plugin.findNotesSimilarToCombined(this.item, this.filePath, threshold);
					results = similarNotes.map(note => ({
						item: { id: '', text: '', note: '', from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, line: 0, ch: 0 } as MarginaliaItem,
						filePath: note.filePath,
						similarity: note.similarity
					}));
					resultLabel = 'similar notes (by combined)';
				} else if (searchMode === 'note') {
					// Find notes similar to this note (using note embedding)
					const similarNotes = await this.findNotesSimilarToNote(threshold);
					results = similarNotes.map(note => ({
						item: { id: '', text: '', note: '', from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, line: 0, ch: 0 } as MarginaliaItem,
						filePath: note.filePath,
						similarity: note.similarity
					}));
					resultLabel = 'similar notes (by note content)';
				}
			} else {
				// Marginalia-based search
				if (searchMode === 'marginalia') {
					results = await this.plugin.findSimilarMarginalia(this.item, threshold);
					resultLabel = 'similar marginalia (by note)';
				} else if (searchMode === 'selection') {
					results = await this.plugin.findSimilarSelection(this.item, threshold);
					resultLabel = 'similar selections';
				} else if (searchMode === 'combined') {
					results = await this.plugin.findSimilarCombined(this.item, threshold);
					resultLabel = 'similar combined (note + selection)';
				}
			}

			// Store results
			this.currentSimilarItems = results;

			// Display results
			this.resultsContainer.empty();
			
			if (results.length === 0) {
				this.resultsContainer.createEl('p', { text: `No ${resultLabel} found above the threshold.` });
			} else {
				this.resultsContainer.createEl('h3', { text: `Found ${results.length} ${resultLabel}:` });
				
				const list = this.resultsContainer.createEl('ul');
				list.style.listStyle = 'none';
				list.style.padding = '0';
				
				for (const result of results) {
					const li = list.createEl('li');
					li.style.marginBottom = '10px';
					li.style.padding = '8px';
					li.style.border = '1px solid var(--background-modifier-border)';
					li.style.borderRadius = '4px';
					
					const link = li.createEl('a', { text: result.filePath });
					link.style.cursor = 'pointer';
					link.style.textDecoration = 'underline';
					link.style.color = 'var(--text-accent)';
					link.onclick = async () => {
						if (result.item.id) {
							// Marginalia result - jump to marginalia
							this.plugin.jumpToMarginalia(result.filePath, result.item.id);
						} else {
							// Note result - open note
							const file = this.app.vault.getAbstractFileByPath(result.filePath);
							if (file instanceof TFile) {
								await this.app.workspace.openLinkText(result.filePath, '', true);
							}
						}
						this.close();
					};
					
					// Show marginalia/selection text if available
					if (result.item.id && (result.item.note || result.item.text)) {
						li.createEl('br');
						const preview = li.createSpan();
						preview.textContent = result.item.note || result.item.text || 'No text';
						preview.style.fontSize = '0.9em';
						preview.style.color = 'var(--text-muted)';
					}
					
					li.createEl('br');
					const similarity = li.createSpan();
					similarity.textContent = `Similarity: ${(result.similarity * 100).toFixed(1)}%`;
					similarity.style.fontSize = '0.85em';
					similarity.style.color = 'var(--text-muted)';
				}

				// Add export buttons below results
				this.addExportButtons();
			}
		} catch (error: any) {
			this.resultsContainer.empty();
			this.resultsContainer.createEl('p', { 
				text: `Error: ${error.message}`,
				cls: 'mod-warning'
			});
		}
	}

	private async findNotesSimilarToNote(threshold: number): Promise<Array<{ filePath: string; similarity: number }>> {
		const embeddings = await (this.plugin as any).loadEmbeddings();
		const normalizedCurrentPath = (this.plugin as any).normalizePath(this.filePath);
		
		// Find current note's embedding
		const currentNoteEmbedding = embeddings.find((e: any) => 
			(this.plugin as any).normalizePath(e.source_path) === normalizedCurrentPath
		);

		if (!currentNoteEmbedding || !currentNoteEmbedding.chunks || currentNoteEmbedding.chunks.length === 0) {
			throw new Error('Current note does not have embeddings');
		}

		// Use the first chunk as the reference (or average all chunks)
		const currentEmbedding = currentNoteEmbedding.chunks[0].vector;
		
		const results = new Map<string, number>();

		for (const noteEmbedding of embeddings) {
			const normalizedPath = (this.plugin as any).normalizePath(noteEmbedding.source_path);
			if (normalizedPath === normalizedCurrentPath) {
				continue; // Skip current note
			}

			let bestSimilarity = 0;
			for (const chunk of noteEmbedding.chunks) {
				const similarity = (this.plugin as any).cosineSimilarity(currentEmbedding, chunk.vector);
				if (similarity > bestSimilarity) {
					bestSimilarity = similarity;
				}
			}

			if (bestSimilarity >= threshold) {
				const existingSimilarity = results.get(noteEmbedding.source_path);
				if (!existingSimilarity || bestSimilarity > existingSimilarity) {
					results.set(noteEmbedding.source_path, bestSimilarity);
				}
			}
		}

		const resultArray = Array.from(results.entries()).map(([filePath, similarity]) => ({
			filePath,
			similarity
		}));

		resultArray.sort((a, b) => b.similarity - a.similarity);
		return resultArray;
	}

	private addExportButtons() {
		// Remove existing export section if it exists
		if (this.exportSection) {
			this.exportSection.remove();
			this.exportSection = null;
		}

		// Create export section below results container
		this.exportSection = this.contentEl.createDiv();
		const exportSection = this.exportSection;
		exportSection.style.marginTop = '12px';
		exportSection.style.marginLeft = '0';
		exportSection.style.marginRight = '0';
		exportSection.style.padding = '8px';
		exportSection.style.backgroundColor = 'var(--background-secondary)';
		exportSection.style.borderRadius = '4px';
		exportSection.style.border = '1px solid var(--background-modifier-border)';
		exportSection.style.width = '100%';
		exportSection.style.maxWidth = '100%';
		exportSection.style.boxSizing = 'border-box';
		exportSection.style.overflow = 'hidden';

		const filenameLabel = exportSection.createEl('label');
		filenameLabel.textContent = 'Export file name:';
		filenameLabel.style.display = 'block';
		filenameLabel.style.marginBottom = '8px';
		filenameLabel.style.fontWeight = '500';

		const filenameInputContainer = exportSection.createDiv();
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
		filenameInput.style.minWidth = '0';
		filenameInput.style.padding = '6px 10px';
		filenameInput.style.border = '1px solid var(--background-modifier-border)';
		filenameInput.style.borderRadius = '4px';
		filenameInput.style.fontSize = '0.9em';
		filenameInput.style.boxSizing = 'border-box';

		const regenerateButton = filenameInputContainer.createEl('button', { text: 'Regenerate Name' });
		regenerateButton.style.padding = '6px 12px';
		regenerateButton.style.border = '1px solid var(--background-modifier-border)';
		regenerateButton.style.borderRadius = '4px';
		regenerateButton.style.background = 'var(--background-primary)';
		regenerateButton.style.cursor = 'pointer';
		regenerateButton.style.fontSize = '0.9em';
		regenerateButton.style.whiteSpace = 'nowrap';

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
		filenameInput.oninput = () => {
			currentFileName = filenameInput.value.trim();
		};

		// Generate initial suggestion
		generateFileName();

		// Add action buttons
		const buttonContainer = exportSection.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.width = '100%';
		buttonContainer.style.boxSizing = 'border-box';
		buttonContainer.style.overflow = 'hidden';

		const tocButtonContainer = buttonContainer.createDiv();
		tocButtonContainer.style.display = 'flex';
		tocButtonContainer.style.alignItems = 'center';
		tocButtonContainer.style.gap = '6px';
		tocButtonContainer.style.flex = '1 1 0';
		tocButtonContainer.style.minWidth = '0';

		const tocButton = tocButtonContainer.createEl('button', { text: 'Create Table of Contents Note' });
		tocButton.addClass('mod-cta');
		tocButton.style.flex = '1 1 0';
		tocButton.style.minWidth = '0';
		tocButton.style.boxSizing = 'border-box';
		tocButton.style.overflow = 'hidden';
		tocButton.style.textOverflow = 'ellipsis';
		tocButton.style.whiteSpace = 'nowrap';

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
		canvasButtonContainer.style.gap = '6px';
		canvasButtonContainer.style.flex = '1 1 0';
		canvasButtonContainer.style.minWidth = '0';

		const canvasButton = canvasButtonContainer.createEl('button', { text: 'Create Canvas' });
		canvasButton.addClass('mod-cta');
		canvasButton.style.flex = '1 1 0';
		canvasButton.style.minWidth = '0';
		canvasButton.style.boxSizing = 'border-box';
		canvasButton.style.overflow = 'hidden';
		canvasButton.style.textOverflow = 'ellipsis';
		canvasButton.style.whiteSpace = 'nowrap';

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

	private getFunctionDisplayName(functionType: string): string {
		const menu1 = this.menu1Select?.value || '';
		const menu2 = this.menu2Select?.value || '';
		
		if (!menu1 || !menu2) {
			return 'Unknown Function';
		}

		const menu1Text = this.menu1Select?.options[this.menu1Select.selectedIndex]?.text || menu1;
		const menu2Text = this.menu2Select?.options[this.menu2Select.selectedIndex]?.text || menu2;
		
		return `Find ${menu1Text} that are similar to ${menu2Text}`;
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
			
			// Add similar items text (only if they have marginalia items, not just file paths)
			for (const similar of this.currentSimilarItems) {
				if (similar.item && similar.item.id) {
					// This is a marginalia result
					if (similar.item.text) {
						allText += `Selection: "${similar.item.text}"\n`;
					}
					if (similar.item.note) {
						allText += `Marginalia: ${similar.item.note}\n`;
					}
				} else {
					// This is a note result - just add the file path
					const similarFile = this.app.vault.getAbstractFileByPath(similar.filePath);
					const similarFileName = similarFile instanceof TFile ? similarFile.basename : similar.filePath;
					allText += `Note: ${similarFileName}\n`;
				}
				allText += '\n---\n\n';
			}

			// Call qwen2.5:3b-instruct to generate a title
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
					model: 'qwen2.5:3b-instruct',
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
				throw new Error(`qwen2.5:3b-instruct API error: ${response.statusText}`);
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
			
			// Detect if this is a note-based search (new functions) vs marginalia-based search (old functions)
			// Note results have items with empty IDs, marginalia results have items with actual IDs
			const isNoteBasedSearch = this.currentSimilarItems.length > 0 && 
				this.currentSimilarItems.every(item => !item.item.id || item.item.id === '');
			
			// Build table of contents content
			let content = `# Table of Contents - Similar ${isNoteBasedSearch ? 'Notes' : 'Marginalia'}\n\n`;
			content += `Generated: ${new Date().toLocaleString()}\n\n`;
			
			// Add note about which function was used
			if (this.currentFunctionType) {
				const functionName = this.getFunctionDisplayName(this.currentFunctionType);
				content += `**Function Used:** ${functionName}\n\n`;
			}
			
			// Always include current note with selection and marginalia at the top
			const originalFile = this.app.vault.getAbstractFileByPath(this.filePath);
			const originalFileName = originalFile instanceof TFile ? originalFile.basename : this.filePath;
			content += `## Current Note\n\n`;
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
			
			// Related notes section (exclude current note from this list)
			content += `## Related Notes\n\n`;
			for (const similar of this.currentSimilarItems) {
				// Skip the current note in the related notes list
				if (similar.filePath === this.filePath) {
					continue;
				}
				
				const similarFile = this.app.vault.getAbstractFileByPath(similar.filePath);
				const similarFileName = similarFile instanceof TFile ? similarFile.basename : similar.filePath;
				content += `- [[${similar.filePath}|${similarFileName}]] (Similarity: ${(similar.similarity * 100).toFixed(1)}%)\n`;
				
				// Only show selection/marginalia if this is a marginalia result (not a note result)
				if (similar.item && similar.item.id) {
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
			
			// Add all file paths from currentSimilarItems (which already includes current note for new functions)
			// This handles both old functions (marginalia results) and new functions (note results)
			for (const similar of this.currentSimilarItems) {
				if (!addedFiles.has(similar.filePath)) {
					const similarFile = this.app.vault.getAbstractFileByPath(similar.filePath);
					if (similarFile instanceof TFile) {
						allFilePaths.push(similar.filePath);
						addedFiles.add(similar.filePath);
					}
				}
			}
			
			// Also add original note path if it exists and wasn't already added
			// (This ensures it's included for old functions that don't add it to currentSimilarItems)
			const originalFile = this.app.vault.getAbstractFileByPath(this.filePath);
			if (originalFile instanceof TFile && !addedFiles.has(this.filePath)) {
				allFilePaths.push(this.filePath);
				addedFiles.add(this.filePath);
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
		this.exportSection = null;
	}
}

export class EditMarginaliaModal extends Modal {
	private item: MarginaliaItem;
	private onSubmit: (note: string, color?: string) => void;
	private onDelete?: () => void;
	private defaultColor: string;
	private plugin: MarginaliaPlugin;

	constructor(app: any, item: MarginaliaItem, defaultColor: string, onSubmit: (note: string, color?: string) => void, onDelete?: () => void, plugin?: MarginaliaPlugin) {
		super(app);
		this.item = item;
		this.onSubmit = onSubmit;
		this.onDelete = onDelete;
		this.defaultColor = defaultColor;
		// Get plugin instance from app if not provided
		this.plugin = plugin || (app.plugins.plugins['marginalia'] as MarginaliaPlugin);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Edit Marginalia' });

		const textPreview = contentEl.createDiv();
		textPreview.style.marginBottom = '15px';
		textPreview.style.padding = '10px';
		textPreview.style.backgroundColor = 'var(--background-secondary)';
		textPreview.style.borderRadius = '4px';
		textPreview.style.maxHeight = '20em'; // Max 20 lines high (approximately 1em per line)
		textPreview.style.overflowY = 'auto';
		textPreview.style.whiteSpace = 'pre-wrap';
		textPreview.style.height = 'auto';
		textPreview.createEl('p', { 
			text: `Selected text: "${this.item.text || 'No selection'}"`,
			attr: { style: 'margin: 0; font-size: 0.9em; color: var(--text-muted);' }
		});

		const input = contentEl.createEl('textarea', {
			attr: {
				placeholder: 'Enter your margin note...',
				rows: '5',
				maxlength: '7000'
			}
		});
		input.style.width = '100%';
		input.style.minHeight = '100px';
		input.value = this.item.note;

		// Character counter
		const charCounter = contentEl.createDiv();
		charCounter.style.marginTop = '5px';
		charCounter.style.fontSize = '0.85em';
		charCounter.style.color = 'var(--text-muted)';
		charCounter.style.textAlign = 'right';
		const MAX_CHARS = 7000;
		
		const updateCounter = () => {
			const currentLength = input.value.length;
			const remaining = MAX_CHARS - currentLength;
			charCounter.textContent = `${currentLength}/${MAX_CHARS} characters`;
			if (remaining < 100) {
				charCounter.style.color = 'var(--text-error)';
			} else if (remaining < 500) {
				charCounter.style.color = 'var(--text-warning)';
			} else {
				charCounter.style.color = 'var(--text-muted)';
			}
		};

		// Limit input to 7000 characters
		input.addEventListener('input', (e: Event) => {
			const target = e.target as HTMLTextAreaElement;
			if (target.value.length > MAX_CHARS) {
				target.value = target.value.substring(0, MAX_CHARS);
			}
			updateCounter();
		});

		// Hidden feature: detect "/ghost" and generate monk-style marginalia
		input.addEventListener('keydown', async (e: KeyboardEvent) => {
			const target = e.target as HTMLTextAreaElement;
			const value = target.value;
			
			// Check if user typed "/ghost" (case-insensitive)
			if (value.toLowerCase().includes('/ghost')) {
				e.preventDefault();
				
				// Show loading state
				const originalValue = target.value;
				target.value = 'Summoning the ghost of the scribe...';
				target.disabled = true;
				
				try {
					const monkText = await this.plugin.generateMonkMarginalia(this.item.text || '');
					if (monkText) {
						target.value = monkText;
						updateCounter();
					} else {
						target.value = originalValue;
						// Show error notice
						const notice = new (this.app as any).Notice('Failed to generate monk marginalia. Check Ollama connection.');
						setTimeout(() => notice.hide(), 3000);
					}
				} catch (error) {
					console.error('Error generating monk marginalia:', error);
					target.value = originalValue;
					const notice = new (this.app as any).Notice('Error generating monk marginalia.');
					setTimeout(() => notice.hide(), 3000);
				} finally {
					target.disabled = false;
					target.focus();
				}
			}
		});

		// Initialize counter
		updateCounter();

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
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';

		// Right side: Cancel and Save buttons
		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = 'flex';
		rightButtons.style.gap = '10px';

		const cancelButton = rightButtons.createEl('button');
		cancelButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg> Cancel';
		cancelButton.onclick = () => this.close();

		const submitButton = rightButtons.createEl('button');
		submitButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Save';
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

export class ViewMarginaliaModal extends Modal {
	private item: MarginaliaItem;
	private plugin: MarginaliaPlugin;
	private filePath: string;
	private onEdit: () => void;
	private onDelete: () => void;
	private component: Component;

	constructor(app: any, plugin: MarginaliaPlugin, item: MarginaliaItem, filePath: string, onEdit: () => void, onDelete: () => void) {
		super(app);
		this.item = item;
		this.plugin = plugin;
		this.filePath = filePath;
		this.onEdit = onEdit;
		this.onDelete = onDelete;
		// Create a Component instance for markdown rendering
		this.component = new Component();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'View Marginalia' });

		// Show selected text preview
		if (this.item.text) {
			const textPreview = contentEl.createDiv();
			textPreview.style.marginBottom = '15px';
			textPreview.style.padding = '10px';
			textPreview.style.backgroundColor = 'var(--background-secondary)';
			textPreview.style.borderRadius = '4px';
			textPreview.style.maxHeight = '20em'; // Max 20 lines high (approximately 1em per line)
			textPreview.style.overflowY = 'auto';
			textPreview.style.whiteSpace = 'pre-wrap';
			textPreview.style.height = 'auto';
			textPreview.createEl('p', { 
				text: `Selected text: "${this.item.text}"`,
				attr: { style: 'margin: 0; font-size: 0.9em; color: var(--text-muted);' }
			});
		}

		// Render note with active wiki links
		const noteContainer = contentEl.createDiv();
		noteContainer.style.marginBottom = '20px';
		noteContainer.style.padding = '15px';
		noteContainer.style.backgroundColor = 'var(--background-primary)';
		noteContainer.style.border = '1px solid var(--background-modifier-border)';
		noteContainer.style.borderRadius = '4px';
		noteContainer.style.height = '20em'; // 20 lines high (approximately 1em per line)
		noteContainer.style.overflowY = 'auto';

		// Use Obsidian's MarkdownRenderer to render with active wiki links
		// Load the component before using it to manage lifecycle
		this.component.load();
		MarkdownRenderer.renderMarkdown(
			this.item.note || '(No note)',
			noteContainer,
			this.filePath,
			this.component
		);

		// Button container - matching edit modal layout
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.marginTop = '10px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'space-between';
		buttonContainer.style.gap = '10px';

		// Left side: Delete button
		const leftButtons = buttonContainer.createDiv();
		leftButtons.style.display = 'flex';
		leftButtons.style.gap = '10px';
		
		const deleteButton = leftButtons.createEl('button');
		deleteButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg> Delete';
		deleteButton.addClass('mod-warning');
		deleteButton.onclick = () => {
			const deleteModal = new DeleteConfirmationModal(this.app, async () => {
				await this.plugin.deleteMarginalia(this.filePath, this.item.id);
				this.close();
				this.onDelete(); // Refresh the parent view
			});
			deleteModal.open();
		};

		// Right side: Edit, AI Functions, and Close buttons (Close all the way to the right)
		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = 'flex';
		rightButtons.style.gap = '10px';

		// Edit button with icon
		const editButton = rightButtons.createEl('button');
		editButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit';
		editButton.addClass('mod-cta');
		editButton.onclick = () => {
			this.onEdit();
		};

		// AI Functions button with icon
		const aiFunctionsButton = rightButtons.createEl('button');
		aiFunctionsButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> AI Functions';
		aiFunctionsButton.onclick = () => {
			this.close();
			const aiModal = new AIFunctionsModal(this.app, this.plugin, this.item, this.filePath);
			aiModal.open();
		};

		// Close button with X icon (all the way to the right)
		const closeButton = rightButtons.createEl('button');
		closeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg> Close';
		closeButton.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// Unload the component to clean up resources
		if (this.component) {
			this.component.unload();
		}
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
