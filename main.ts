import { Plugin, MarkdownView, TFile, Modal, PluginSettingTab, WorkspaceLeaf, Setting, Notice } from 'obsidian';
import { MarginaliaView, EditMarginaliaModal, DeleteConfirmationModal } from './src/sidebar';
import { MarginaliaEditorExtension } from './src/editorExtension';
import { MarginaliaData, MarginaliaItem } from './src/types';

const DATA_FILE = 'marginalia-data.json';

export interface MarginaliaSettings {
	highlightColor: string;
	transparency: number;
	ollamaAddress: string;
	ollamaPort: string;
	indicatorVisibility: 'pen' | 'highlight' | 'both' | 'neither';
	ollamaAvailable: boolean; // Track if Ollama is available
	sortOrder: 'position' | 'date-asc' | 'date-desc'; // Sort order for current note marginalia
	defaultSimilarity: number; // Default similarity threshold for AI functions (0.5 to 1.0)
}

const DEFAULT_SETTINGS: MarginaliaSettings = {
	highlightColor: '#ffeb3d', // Yellow
	transparency: 0.5, // 50% transparency
	ollamaAddress: 'localhost',
	ollamaPort: '11434',
	indicatorVisibility: 'both',
	ollamaAvailable: false,
	sortOrder: 'position',
	defaultSimilarity: 0.7 // Default similarity threshold for AI functions
};

export default class MarginaliaPlugin extends Plugin {
	public marginaliaData: Map<string, MarginaliaData> = new Map();
	private sidebarView: MarginaliaView | null = null;
	settings: MarginaliaSettings;

	async onload() {
		console.log('Loading Marginalia plugin');

		// Load settings and merge with defaults
		const loadedSettings = await this.loadData();
		
		// Merge defaults with loaded settings (loaded settings take precedence)
		// This ensures new settings get defaults, but existing saved settings are preserved
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings || {});
		
		// If no settings were loaded, save the defaults
		// If settings were loaded, ensure all required fields exist (for backwards compatibility)
		if (!loadedSettings || Object.keys(loadedSettings).length === 0) {
			// First run - save defaults
			await this.saveData(this.settings);
		} else {
			// Settings exist - ensure all fields are present and save
			// This handles cases where new settings were added
			await this.saveData(this.settings);
		}
		
		this.applySettings();

		// Register the sidebar view
		this.registerView('marginalia-view', (leaf: WorkspaceLeaf) => {
			this.sidebarView = new MarginaliaView(leaf, this);
			return this.sidebarView;
		});

		this.addRibbonIcon('book-open', 'Marginalia', () => {
			this.activateView();
		});

		// Register editor extension
		this.registerEditorExtension(MarginaliaEditorExtension(this));

		// Register markdown post-processor for reading view
		const plugin = this;
		this.registerMarkdownPostProcessor((element, context) => {
			const filePath = context.sourcePath;
			if (!filePath) return;
			
			const items = plugin.getMarginalia(filePath);
			if (items.length === 0) return;
			
			// Get the markdown content to map positions
			const markdownContent = context.getSectionInfo(element)?.text || '';
			if (!markdownContent) return;
			
			// Process each marginalia item
			for (const item of items) {
				try {
					// Get the text selection from the item
					const selectionText = item.text;
					if (!selectionText || selectionText.trim().length === 0) {
						// For cursor-only notes, we'll add a line indicator
						// Find the line in the rendered HTML
						const lineNum = item.from.line;
						const lines = element.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, code');
						if (lines[lineNum]) {
							const lineEl = lines[lineNum] as HTMLElement;
							const itemColor = item.color || this.settings.highlightColor;
							const itemTransparency = this.settings.transparency || 0.5;
							const rgb = this.hexToRgb(itemColor);
							const rgbaColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${itemTransparency})` : itemColor;
							
							// Add a left border indicator
							lineEl.style.borderLeft = `3px solid ${itemColor}`;
							lineEl.style.paddingLeft = '8px';
							lineEl.style.position = 'relative';
							lineEl.setAttribute('data-marginalia-id', item.id);
							lineEl.setAttribute('data-note', item.note);
							lineEl.classList.add('marginalia-reading-line');
							lineEl.style.cursor = 'pointer';
							
							// Add hover tooltip
							lineEl.addEventListener('mouseenter', (e) => {
								plugin.showReadingTooltip(lineEl, item.note, e);
							});
							lineEl.addEventListener('mouseleave', () => {
								plugin.hideReadingTooltip();
							});
							
							// Add click handler to jump to location
							lineEl.addEventListener('click', () => {
								plugin.jumpToMarginalia(filePath, item.id);
							});
						}
					} else {
						// For text selections, find and highlight the text
						// Walk through text nodes and find matching text
						const walker = document.createTreeWalker(
							element,
							NodeFilter.SHOW_TEXT,
							null
						);
						
						let node;
						while (node = walker.nextNode()) {
							const text = node.textContent || '';
							if (text.includes(selectionText)) {
								// Found matching text - wrap it in a highlight span
								const parent = node.parentElement;
								if (parent) {
									const itemColor = item.color || plugin.settings.highlightColor;
									const itemTransparency = plugin.settings.transparency || 0.5;
									const rgb = plugin.hexToRgb(itemColor);
									const rgbaColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${itemTransparency})` : itemColor;
									
									// Create highlight span
									const highlight = document.createElement('span');
									highlight.className = 'marginalia-highlight-reading';
									highlight.style.backgroundColor = rgbaColor;
									highlight.style.cursor = 'pointer';
									highlight.setAttribute('data-marginalia-id', item.id);
									highlight.setAttribute('data-note', item.note);
									
									// Replace text node with highlighted version
									const range = document.createRange();
									range.selectNodeContents(node);
									const textIndex = text.indexOf(selectionText);
									if (textIndex >= 0) {
										range.setStart(node, textIndex);
										range.setEnd(node, textIndex + selectionText.length);
										range.surroundContents(highlight);
										
										// Add hover tooltip
										highlight.addEventListener('mouseenter', (e) => {
											plugin.showReadingTooltip(highlight, item.note, e);
										});
										highlight.addEventListener('mouseleave', () => {
											plugin.hideReadingTooltip();
										});
										
										// Add click handler
										highlight.addEventListener('click', () => {
											plugin.jumpToMarginalia(filePath, item.id);
										});
										
										break; // Only highlight first occurrence
									}
								}
							}
						}
					}
				} catch (e) {
					console.error('Error processing marginalia in reading view:', e);
				}
			}
		});

		// Register context menu item
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (view instanceof MarkdownView) {
					this.addContextMenuItem(menu, editor, view);
				}
			})
		);

		// Load existing marginalia data
		await this.loadMarginaliaData();

		// Check Ollama availability on startup (non-blocking)
		setTimeout(async () => {
			await this.checkOllamaOnStartup();
			// Only generate embeddings if Ollama check succeeded
			if (this.settings.ollamaAvailable) {
				this.generateMissingEmbeddings();
				this.generateMissingSelectionEmbeddings();
			}
		}, 1000);

		// Refresh sidebar when file changes
		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				if (file instanceof TFile) {
					this.loadMarginaliaForFile(file.path);
				}
				if (this.sidebarView) {
					this.sidebarView.refresh();
				}
			})
		);

		// Register sidebar view
		this.addSettingTab(new MarginaliaSettingTab(this.app, this));
	}

	async onunload() {
		await this.saveMarginaliaData();
	}

	private async activateView() {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: 'marginalia-view',
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private addContextMenuItem(menu: any, editor: any, view: MarkdownView) {
		const file = view.file;
		if (!file) return;

		// Check if current selection would overlap with existing marginalia
		const selection = editor.getSelection();
		const cursor = editor.getCursor();
		let from = selection ? editor.getCursor('from') : cursor;
		let to = selection ? editor.getCursor('to') : cursor;

		if (!selection) {
			// For cursor-only notes, use the cursor position
			from = { line: cursor.line, ch: cursor.ch };
			to = { line: cursor.line, ch: cursor.ch };
		}

		// Create a temporary item to check for overlap
		const tempItem: MarginaliaItem = {
			id: '',
			text: selection || '',
			note: '',
			from: from,
			to: to,
			line: cursor.line,
			ch: cursor.ch
		};

		// Only show menu item if there's no overlap
		if (!this.wouldOverlap(file.path, tempItem)) {
			menu.addItem((item: any) => {
				item.setTitle('Add marginalia')
					.setIcon('sticky-note')
					.onClick(() => {
						this.showMarginNoteModal(editor, view);
					});
			});
		}
	}

	private showMarginNoteModal(editor: any, view: MarkdownView) {
		const selection = editor.getSelection();
		const cursor = editor.getCursor();
		const file = view.file;
		
		if (!file) return;

		// If no selection, try to get the word at cursor position
		let from = selection ? editor.getCursor('from') : cursor;
		let to = selection ? editor.getCursor('to') : cursor;
		let text = selection || '';

		if (!selection) {
			// For cursor-only notes, use the cursor position
			// Ensure from and to are the same for cursor positions
			from = { line: cursor.line, ch: cursor.ch };
			to = { line: cursor.line, ch: cursor.ch };
			text = ''; // Empty text indicates cursor-only note
		}

		// Create modal for entering margin note
		const modal = new MarginNoteModal(this.app, this.settings.highlightColor, async (note: string, color?: string) => {
			if (note.trim()) {
				await this.addMarginalia(file.path, {
					id: this.generateId(),
					text: text,
					note: note,
					from: from,
					to: to,
					line: cursor.line,
					ch: cursor.ch,
					timestamp: Date.now(),
					color: color
				});
			}
		});

		modal.open();
	}

	public async addMarginalia(filePath: string, item: MarginaliaItem) {
		// Check for overlaps before adding
		if (this.wouldOverlap(filePath, item)) {
			new Notice('Cannot create marginalia: This area overlaps with an existing highlight.');
			return;
		}

		// Ensure color is set (use default if not provided)
		if (!item.color) {
			item.color = this.settings.highlightColor;
		}

		if (!this.marginaliaData.has(filePath)) {
			this.marginaliaData.set(filePath, { items: [] });
		}
		
		const data = this.marginaliaData.get(filePath)!;
		data.items.push(item);
		
		// Generate embeddings for the new marginalia
		if (this.hasMeaningfulText(item.note)) {
			await this.generateEmbeddingForItem(item); // For note text
		} else {
			// Set to null if no meaningful note text
			item.embedding = null;
		}
		if (this.hasMeaningfulText(item.text)) {
			await this.generateSelectionEmbeddingForItem(item); // For selection text
		} else {
			// Set to null if no meaningful text (empty, whitespace, linefeeds, etc.)
			item.selectionEmbedding = null;
		}
		
		await this.saveMarginaliaForFile(filePath);
		
		this.refreshEditor(filePath);
		if (this.sidebarView) {
			this.sidebarView.refresh();
		}
	}

	public async updateMarginalia(filePath: string, id: string, note: string, color?: string) {
		const data = this.marginaliaData.get(filePath);
		if (data) {
			const item = data.items.find(i => i.id === id);
			if (item) {
				item.note = note;
				// Update color if provided
				if (color !== undefined) {
					item.color = color;
				}
				// Update timestamp to reflect the edit time
				item.timestamp = Date.now();
				// Regenerate embedding since note changed
				if (this.hasMeaningfulText(item.note)) {
					await this.generateEmbeddingForItem(item);
				} else {
					// Set to null if no meaningful note text
					item.embedding = null;
				}
				// Ensure selection embedding is null if selection text is not meaningful
				if (!this.hasMeaningfulText(item.text)) {
					item.selectionEmbedding = null;
				}
				await this.saveMarginaliaForFile(filePath);
				this.refreshEditor(filePath);
				if (this.sidebarView) {
					this.sidebarView.refresh();
				}
			}
		}
	}

	public async deleteMarginalia(filePath: string, id: string) {
		const data = this.marginaliaData.get(filePath);
		if (data) {
			data.items = data.items.filter(i => i.id !== id);
			await this.saveMarginaliaForFile(filePath);
			
			// Immediately refresh editor and reading view
			this.refreshEditor(filePath);
			this.refreshReadingView(filePath);
			
			if (this.sidebarView) {
				this.sidebarView.refresh();
			}
		}
	}

	public getMarginalia(filePath: string): MarginaliaItem[] {
		const data = this.marginaliaData.get(filePath);
		return data ? data.items : [];
	}

	/**
	 * Update marginalia positions when document changes
	 * Converts line/ch to absolute positions in OLD document, maps through changes, then converts back to line/ch in NEW document
	 */
	public async updateMarginaliaPositions(filePath: string, changes: any, oldDoc: any, newDoc: any): Promise<void> {
		const data = this.marginaliaData.get(filePath);
		if (!data || !data.items || data.items.length === 0) return;

		let needsSave = false;

		// Calculate leading blank lines offset for OLD document
		let oldLeadingBlankLinesOffset = 0;
		try {
			for (let i = 1; i <= oldDoc.lines; i++) {
				const line = oldDoc.line(i);
				if (line.text.trim().length === 0) {
					oldLeadingBlankLinesOffset++;
				} else {
					break;
				}
			}
		} catch (e) {
			// Ignore errors
		}

		// Calculate leading blank lines offset for NEW document
		let newLeadingBlankLinesOffset = 0;
		try {
			for (let i = 1; i <= newDoc.lines; i++) {
				const line = newDoc.line(i);
				if (line.text.trim().length === 0) {
					newLeadingBlankLinesOffset++;
				} else {
					break;
				}
			}
		} catch (e) {
			// Ignore errors
		}

		for (const item of data.items) {
			try {
				// Convert Obsidian line/ch to CodeMirror absolute positions in OLD document
				const fromLineNum = item.from.line + 1 + oldLeadingBlankLinesOffset;
				const toLineNum = item.to.line + 1 + oldLeadingBlankLinesOffset;

				if (fromLineNum < 1 || fromLineNum > oldDoc.lines) continue;
				if (toLineNum < 1 || toLineNum > oldDoc.lines) continue;

				const fromLine = oldDoc.line(fromLineNum);
				const toLine = oldDoc.line(toLineNum);

				const fromAbs = fromLine.from + Math.min(item.from.ch, fromLine.length);
				const toAbs = toLine.from + Math.min(item.to.ch, toLine.length);

				// Map through changes to get positions in NEW document
				const newFromAbs = changes.mapPos(fromAbs, 1);
				const newToAbs = changes.mapPos(toAbs, 1);

				// Convert back to line/ch in NEW document
				const newFromLine = newDoc.lineAt(newFromAbs);
				const newToLine = newDoc.lineAt(newToAbs);

				const newFromCh = newFromAbs - newFromLine.from;
				const newToCh = newToAbs - newToLine.from;

				// Convert CodeMirror line numbers (1-indexed) back to Obsidian (0-indexed)
				const newFromLineNum = newFromLine.number - 1 - newLeadingBlankLinesOffset;
				const newToLineNum = newToLine.number - 1 - newLeadingBlankLinesOffset;

				// Check if positions changed
				const positionsChanged = item.from.line !== newFromLineNum || item.from.ch !== newFromCh ||
					item.to.line !== newToLineNum || item.to.ch !== newToCh;
				
				// Get the text at the new position
				let newText = '';
				if (newFromAbs < newToAbs) {
					try {
						newText = newDoc.sliceString(newFromAbs, newToAbs);
					} catch (e) {
						// If text can't be read, it was likely deleted
						newText = '';
					}
				}
				
				// Check if text changed or was deleted
				const textChanged = item.text !== newText;
				const textDeleted = newFromAbs >= newToAbs || newText.length === 0;
				
				// Update if positions or text changed
				if (positionsChanged || textChanged) {
					const oldTimestamp = item.timestamp; // Preserve timestamp
					item.from = { line: newFromLineNum, ch: newFromCh };
					item.to = { line: newToLineNum, ch: newToCh };
					item.line = newFromLineNum;
					item.ch = newFromCh;
					
					// Update text - if deleted, set to empty and make from === to (cursor position)
					if (textDeleted) {
						item.text = '';
						item.to = { line: newFromLineNum, ch: newFromCh };
						// Clear selection embedding if text is deleted
						item.selectionEmbedding = null;
					} else {
						item.text = newText;
						// Regenerate selection embedding if text changed and is meaningful
						if (textChanged) {
							if (this.hasMeaningfulText(newText)) {
								await this.generateSelectionEmbeddingForItem(item);
							} else {
								// Set to null if no meaningful text (empty, whitespace, linefeeds, etc.)
								item.selectionEmbedding = null;
							}
						}
					}
					
					// Ensure timestamp exists (use preserved or current if missing)
					if (!item.timestamp || typeof item.timestamp !== 'number') {
						item.timestamp = oldTimestamp || Date.now();
					}
					needsSave = true;
				}
			} catch (e) {
				console.error('Error updating marginalia position:', e, item);
			}
		}

		if (needsSave) {
			await this.saveMarginaliaForFile(filePath);
		}
	}

	public getCurrentFileMarginalia(): MarginaliaItem[] {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			return this.getMarginalia(activeFile.path);
		}
		return [];
	}

	public async jumpToMarginalia(filePath: string, id: string) {
		const data = this.marginaliaData.get(filePath);
		if (data) {
			const item = data.items.find(i => i.id === id);
			if (item) {
				// Get or open the file
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					// Try to find existing leaf with this file
					let leaf = this.app.workspace.getLeavesOfType("markdown")
						.find(l => (l.view as MarkdownView).file?.path === filePath);
					
					// If not found, open in a new leaf
					if (!leaf) {
						leaf = this.app.workspace.getLeaf();
						await leaf.openFile(file);
					}
					
					// Get the markdown view
					const view = leaf.view;
					if (view instanceof MarkdownView) {
						const editor = view.editor;
						
						// Set cursor position
						const cursorPos = { line: item.line, ch: item.ch };
						editor.setCursor(cursorPos);
						
						// Try to select the range if it's valid
						try {
							const fromPos = { line: item.from.line, ch: item.from.ch };
							const toPos = { line: item.to.line, ch: item.to.ch };
							
							// Set selection
							editor.setSelection(fromPos, toPos);
							
							// Scroll into view - need EditorRange format
							const range = { from: fromPos, to: toPos };
							editor.scrollIntoView(range, true);
						} catch (e) {
							console.log('Error scrolling to marginalia:', e);
							// Fallback: just set cursor and scroll
							editor.setCursor(cursorPos);
							const range = { from: cursorPos, to: cursorPos };
							editor.scrollIntoView(range, true);
						}
					}
				}
			}
		}
	}

	public showEditModal(item: MarginaliaItem, filePath: string) {
		// Use the sidebar view's method if available, otherwise create modal directly
		if (this.sidebarView) {
			(this.sidebarView as any).showEditModal(item, filePath);
		} else {
			// Create modal directly
			const modal = new EditMarginaliaModal(this.app, item, this.settings.highlightColor, async (newNote: string, color?: string) => {
				await this.updateMarginalia(filePath, item.id, newNote, color);
				this.refreshEditor(filePath);
			}, async () => {
				// Delete handler
				const deleteModal = new DeleteConfirmationModal(this.app, async () => {
					await this.deleteMarginalia(filePath, item.id);
				});
				deleteModal.open();
			});
			modal.open();
		}
	}

	public refreshEditor(filePath: string) {
		// Trigger editor refresh by dispatching an update through the extension
		// The ViewPlugin will detect the change and update decorations
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view as MarkdownView;
			if (view.file && view.file.path === filePath) {
				// Force editor to refresh immediately
				const editor = view.editor;
				if (editor) {
					// Get marginalia items and trigger a refresh
					const items = this.getMarginalia(filePath);
					// Immediately trigger a refresh by dispatching a viewport change
					// This forces the ViewPlugin to update
					requestAnimationFrame(() => {
						// Trigger a refresh by reading and setting cursor
						const cursor = editor.getCursor();
						// Force a re-render by temporarily moving cursor
						editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
						editor.setCursor(cursor);
						
						// Also trigger a scroll to force viewport update
						setTimeout(() => {
							editor.scrollIntoView({ from: cursor, to: cursor }, true);
						}, 10);
					});
				}
			}
		}
		
		// Also refresh reading view if open
		this.refreshReadingView(filePath);
	}
	
	public refreshReadingView(filePath: string) {
		// Refresh reading view by re-rendering the markdown
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view as MarkdownView;
			if (view.file && view.file.path === filePath) {
				// Force markdown renderer to refresh
				if ((view as any).previewMode) {
					// Reading view - trigger a refresh
					const previewMode = (view as any).previewMode;
					if (previewMode && previewMode.rerender) {
						previewMode.rerender(true);
					}
				}
			}
		}
	}
	
	private readingTooltip: HTMLElement | null = null;
	
	public showReadingTooltip(element: HTMLElement, note: string, event: MouseEvent) {
		if (!note) return;
		
		this.hideReadingTooltip();
		
		this.readingTooltip = document.createElement('div');
		this.readingTooltip.className = 'marginalia-tooltip';
		this.readingTooltip.textContent = note;
		
		document.body.appendChild(this.readingTooltip);
		
		const rect = element.getBoundingClientRect();
		this.readingTooltip.style.position = 'absolute';
		this.readingTooltip.style.left = `${rect.left}px`;
		this.readingTooltip.style.top = `${rect.bottom + 5}px`;
		this.readingTooltip.style.zIndex = '10000';
	}
	
	public hideReadingTooltip() {
		if (this.readingTooltip) {
			this.readingTooltip.remove();
			this.readingTooltip = null;
		}
	}

	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substr(2);
	}

	/**
	 * Check if text has meaningful content (not just whitespace, linefeeds, spaces, etc.)
	 */
	public hasMeaningfulText(text: string | null | undefined): boolean {
		if (!text) return false;
		// Remove all whitespace (spaces, tabs, linefeeds, etc.) and check if anything remains
		return text.trim().length > 0;
	}

	/**
	 * Check if two ranges overlap
	 * Returns true if the ranges share any common area
	 */
	private rangesOverlap(
		from1: { line: number; ch: number },
		to1: { line: number; ch: number },
		from2: { line: number; ch: number },
		to2: { line: number; ch: number }
	): boolean {
		// If ranges are on completely different lines, they don't overlap
		if (to1.line < from2.line || to2.line < from1.line) {
			return false;
		}

		// If they're on the same line, check character positions
		if (from1.line === from2.line && to1.line === to2.line) {
			// Overlap if: from1 < to2 AND from2 < to1
			// Use <= for one end to allow touching ranges to be considered overlapping
			return from1.ch < to2.ch && from2.ch < to1.ch;
		}

		// For multi-line ranges, they overlap if:
		// The start of one is before or at the end of the other, AND
		// The start of the other is before or at the end of the first
		const range1BeforeRange2 = from1.line < to2.line || (from1.line === to2.line && from1.ch <= to2.ch);
		const range2BeforeRange1 = from2.line < to1.line || (from2.line === to1.line && from2.ch <= to1.ch);
		
		return range1BeforeRange2 && range2BeforeRange1;
	}

	/**
	 * Check if a new marginalia would overlap with any existing ones
	 * Only checks for actual text selections (not cursor-only positions)
	 */
	private wouldOverlap(filePath: string, newItem: MarginaliaItem): boolean {
		// Don't check overlaps for cursor-only positions (no selection)
		// Only check if there's actual selected text
		const hasSelection = newItem.from.line !== newItem.to.line || 
		                     newItem.from.ch !== newItem.to.ch ||
		                     (newItem.text && newItem.text.trim().length > 0);
		
		if (!hasSelection) {
			return false; // Cursor-only positions don't overlap
		}

		const data = this.marginaliaData.get(filePath);
		if (!data || !data.items || data.items.length === 0) {
			return false;
		}

		for (const existingItem of data.items) {
			// Only check against existing items that have actual selections
			const existingHasSelection = existingItem.from.line !== existingItem.to.line ||
			                            existingItem.from.ch !== existingItem.to.ch ||
			                            (existingItem.text && existingItem.text.trim().length > 0);
			
			if (existingHasSelection && this.rangesOverlap(
				newItem.from,
				newItem.to,
				existingItem.from,
				existingItem.to
			)) {
				return true;
			}
		}

		return false;
	}

	private getDataFilePath(): string {
		return `${this.app.vault.configDir}/plugins/marginalia/data.json`;
	}

	private async loadMarginaliaData() {
		try {
			const dataPath = this.getDataFilePath();
			const exists = await this.app.vault.adapter.exists(dataPath);
			if (exists) {
				const dataFile = await this.app.vault.adapter.read(dataPath);
				if (dataFile) {
					const data = JSON.parse(dataFile);
					let needsSave = false;
					const currentTime = Date.now();
					
					// Track which file paths to keep (those with items)
					const filesToKeep: Record<string, MarginaliaData> = {};
					
					for (const [filePath, marginaliaData] of Object.entries(data)) {
						const marginalia = marginaliaData as MarginaliaData;
						// Ensure timestamps exist, add color if missing, and generate selection embeddings
						if (marginalia.items && marginalia.items.length > 0) {
							for (const item of marginalia.items) {
								// Check if timestamp is missing or invalid
								if (!item.timestamp || typeof item.timestamp !== 'number' || item.timestamp <= 0) {
									// Use current time as default for items missing timestamps
									item.timestamp = currentTime;
									needsSave = true;
									console.log(`Added timestamp to marginalia item ${item.id} in ${filePath}`);
								}
								
								// Backwards compatibility: add color if missing
								if (!item.color) {
									item.color = this.settings.highlightColor;
									needsSave = true;
									console.log(`Added default color to marginalia item ${item.id} in ${filePath}`);
								}
								
								// Clean up: if no meaningful note text, always set embedding to null
								if (!this.hasMeaningfulText(item.note)) {
									// Always set to null if note text is not meaningful (even if field is undefined or has a value)
									item.embedding = null;
									needsSave = true;
									console.log(`Set note embedding to null for marginalia item ${item.id} in ${filePath} (no meaningful note text: "${item.note}")`);
								}
								
								// Clean up: if no meaningful selection text, always set selectionEmbedding to null
								if (!this.hasMeaningfulText(item.text)) {
									// Always set to null if text is not meaningful (even if field is undefined or has a value)
									item.selectionEmbedding = null;
									needsSave = true;
									console.log(`Set selection embedding to null for marginalia item ${item.id} in ${filePath} (no meaningful text: "${item.text}")`);
								}
							}
							// Only keep files that have items
							filesToKeep[filePath] = marginalia;
							this.marginaliaData.set(filePath, marginalia);
						} else {
							// File has no items or empty items array - mark for removal
							needsSave = true;
							console.log(`Removing empty file section: ${filePath}`);
						}
					}
					
					// Update marginaliaData to only include files with items
					this.marginaliaData.clear();
					for (const [filePath, marginalia] of Object.entries(filesToKeep)) {
						this.marginaliaData.set(filePath, marginalia);
					}
					
					// Save if we added timestamps
					if (needsSave) {
						console.log('Saving marginalia data with added timestamps...');
						await this.saveMarginaliaData();
						console.log('Marginalia data saved successfully');
					}
				}
			}
		} catch (e) {
			console.log('No existing marginalia data found, starting fresh', e);
		}
	}

	private async loadMarginaliaForFile(filePath: string) {
		// Data is loaded from the central data file, but we can refresh if needed
		// This is mainly for ensuring the data is up to date
	}

	private async saveMarginaliaData() {
		const data: Record<string, MarginaliaData> = {};
		for (const [filePath, marginaliaData] of this.marginaliaData) {
			data[filePath] = marginaliaData;
		}
		
		const dataStr = JSON.stringify(data, null, 2);
		const dataPath = this.getDataFilePath();
		
		try {
			// Ensure directory exists
			const dir = dataPath.substring(0, dataPath.lastIndexOf('/'));
			if (!(await this.app.vault.adapter.exists(dir))) {
				await this.app.vault.adapter.mkdir(dir);
			}
			
			await this.app.vault.adapter.write(dataPath, dataStr);
		} catch (e) {
			console.error('Error saving marginalia data:', e);
		}
	}

	private async saveMarginaliaForFile(filePath: string) {
		await this.saveMarginaliaData();
	}

	private async checkOllamaOnStartup() {
		// Check Ollama availability silently on startup
		const address = this.settings.ollamaAddress || 'localhost';
		const port = this.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		try {
			const response = await fetch(`${baseUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (response.ok) {
				const data = await response.json();
				const models = data.models || [];
				const modelNames = models.map((m: any) => m.name || m.model || '');

				// Check for required models
				const requiredModels = ['nomic-embed-text:latest', 'phi3:latest'];
				let allModelsAvailable = true;

				for (const requiredModel of requiredModels) {
					const found = modelNames.some((name: string) => 
						name === requiredModel || name.startsWith(requiredModel.split(':')[0])
					);
					if (!found) {
						allModelsAvailable = false;
						break;
					}
				}

				this.settings.ollamaAvailable = allModelsAvailable;
			} else {
				this.settings.ollamaAvailable = false;
			}
		} catch (error) {
			this.settings.ollamaAvailable = false;
		}

		await this.saveData(this.settings);
	}

	/**
	 * Estimate token count (rough approximation: ~4 characters per token)
	 */
	private estimateTokenCount(text: string): number {
		// Rough estimate: ~4 characters per token for English text
		return Math.ceil(text.length / 4);
	}

	/**
	 * Summarize long text using Phi3 to fit within token limit
	 */
	private async summarizeText(text: string): Promise<string> {
		if (!this.settings.ollamaAvailable) {
			console.warn('Ollama not available, cannot summarize');
			return text;
		}

		const address = this.settings.ollamaAddress || 'localhost';
		const port = this.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		try {
			const prompt = `Please provide a concise summary of the following text. The summary should be under 2000 tokens and capture the key points:\n\n${text}`;

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
				return data.response || text;
			} else {
				console.error('Error summarizing text:', response.statusText);
				return text;
			}
		} catch (error) {
			console.error('Error calling Phi3 for summarization:', error);
			return text;
		}
	}

	/**
	 * Generate embedding for a marginalia item using nomic-embed-text (for note text)
	 * Only works if Ollama check has succeeded
	 */
	private async generateEmbeddingForItem(item: MarginaliaItem): Promise<void> {
		if (!this.settings.ollamaAvailable) {
			// Silently skip if Ollama is not available
			return;
		}

		const address = this.settings.ollamaAddress || 'localhost';
		const port = this.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		try {
			// Use the note text for embedding
			const textToEmbed = item.note || '';
			if (!this.hasMeaningfulText(textToEmbed)) {
				// Clear embedding if note text is empty or just whitespace/linebreaks
				item.embedding = null;
				return;
			}

			// Check if text is too long (>2048 tokens)
			let finalText = textToEmbed;
			const tokenCount = this.estimateTokenCount(textToEmbed);
			
			if (tokenCount > 2048) {
				console.log(`Marginalia note ${item.id} is too long (${tokenCount} tokens), summarizing...`);
				finalText = await this.summarizeText(textToEmbed);
			}

			// Generate embedding using nomic-embed-text
			// Ollama embeddings API uses "prompt" parameter
			const response = await fetch(`${baseUrl}/api/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'nomic-embed-text:latest',
					prompt: finalText
				})
			});

			if (response.ok) {
				const data = await response.json();
				// Ollama returns embedding in data.embedding array
				if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
					item.embedding = data.embedding;
					console.log(`Generated embedding for marginalia note ${item.id} (${data.embedding.length} dimensions)`);
				} else {
					console.error('Invalid embedding response format:', data);
				}
			} else {
				const errorText = await response.text();
				console.error('Error generating embedding:', response.status, errorText);
			}
		} catch (error) {
			console.error('Error calling nomic-embed-text:', error);
		}
	}

	/**
	 * Generate embedding for the selected text (item.text)
	 * Only updates if text exists and is different from what's already embedded
	 */
	private async generateSelectionEmbeddingForItem(item: MarginaliaItem): Promise<void> {
		if (!this.settings.ollamaAvailable) {
			// Silently skip if Ollama is not available
			return;
		}

		const address = this.settings.ollamaAddress || 'localhost';
		const port = this.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		try {
			// Use the selection text for embedding
			const textToEmbed = item.text || '';
			if (!this.hasMeaningfulText(textToEmbed)) {
				// Clear embedding if text is empty or just whitespace/linebreaks
				item.selectionEmbedding = null;
				return;
			}

			// Check if text is too long (>2048 tokens)
			let finalText = textToEmbed;
			const tokenCount = this.estimateTokenCount(textToEmbed);
			
			if (tokenCount > 2048) {
				console.log(`Marginalia selection ${item.id} is too long (${tokenCount} tokens), summarizing...`);
				finalText = await this.summarizeText(textToEmbed);
			}

			// Generate embedding using nomic-embed-text
			const response = await fetch(`${baseUrl}/api/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'nomic-embed-text:latest',
					prompt: finalText
				})
			});

			if (response.ok) {
				const data = await response.json();
				// Ollama returns embedding in data.embedding array
				if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
					item.selectionEmbedding = data.embedding;
					console.log(`Generated selection embedding for marginalia ${item.id} (${data.embedding.length} dimensions)`);
				} else {
					console.error('Invalid embedding response format:', data);
				}
			} else {
				const errorText = await response.text();
				console.error('Error generating selection embedding:', response.status, errorText);
			}
		} catch (error) {
			console.error('Error calling nomic-embed-text for selection:', error);
		}
	}

	/**
	 * Scan all marginalia and generate embeddings for any that don't have them
	 * Only runs if Ollama check has succeeded
	 */
	private async generateMissingEmbeddings(): Promise<void> {
		if (!this.settings.ollamaAvailable) {
			console.log('Ollama check failed or not available, skipping embedding generation');
			return;
		}

		console.log('Scanning marginalia for missing note embeddings...');
		let count = 0;
		let needsSave = false;

		for (const [filePath, data] of this.marginaliaData) {
			if (data && data.items) {
				for (const item of data.items) {
					// Only generate if there's meaningful note text and no embedding
					if (this.hasMeaningfulText(item.note) && 
						(!item.embedding || !Array.isArray(item.embedding) || item.embedding.length === 0)) {
						console.log(`Generating note embedding for marginalia ${item.id} in ${filePath}...`);
						await this.generateEmbeddingForItem(item);
						count++;
						needsSave = true;
						
						// Small delay to avoid overwhelming the server
						await new Promise(resolve => setTimeout(resolve, 100));
					} else if (!this.hasMeaningfulText(item.note)) {
						// Clean up: if no meaningful note text, always set embedding to null
						item.embedding = null;
						needsSave = true;
						console.log(`Set note embedding to null for marginalia ${item.id} in ${filePath} (no meaningful note text: "${item.note}")`);
					}
				}
			}
		}

		if (needsSave) {
			console.log(`Generated ${count} missing note embeddings, saving...`);
			await this.saveMarginaliaData();
			console.log('Note embeddings saved successfully');
		} else {
			console.log('All marginalia already have note embeddings');
		}
	}

	/**
	 * Scan all marginalia and generate selection embeddings for any that have text but no selection embedding
	 * Only runs if Ollama check has succeeded
	 */
	private async generateMissingSelectionEmbeddings(): Promise<void> {
		if (!this.settings.ollamaAvailable) {
			console.log('Ollama check failed or not available, skipping selection embedding generation');
			return;
		}

		console.log('Scanning marginalia for missing selection embeddings...');
		let count = 0;
		let needsSave = false;

		for (const [filePath, data] of this.marginaliaData) {
			if (data && data.items) {
				for (const item of data.items) {
					// Only generate if there's meaningful text and no selection embedding
					if (this.hasMeaningfulText(item.text) && 
						(!item.selectionEmbedding || !Array.isArray(item.selectionEmbedding) || item.selectionEmbedding.length === 0)) {
						console.log(`Generating selection embedding for marginalia ${item.id} in ${filePath}...`);
						await this.generateSelectionEmbeddingForItem(item);
						count++;
						needsSave = true;
						
						// Small delay to avoid overwhelming the server
						await new Promise(resolve => setTimeout(resolve, 100));
					} else if (!this.hasMeaningfulText(item.text)) {
						// Clean up: if no meaningful text, always set selectionEmbedding to null
						item.selectionEmbedding = null;
						needsSave = true;
						console.log(`Set selection embedding to null for marginalia ${item.id} in ${filePath} (no meaningful text: "${item.text}")`);
					}
				}
			}
		}

		if (needsSave) {
			console.log(`Generated ${count} missing selection embeddings, saving...`);
			await this.saveMarginaliaData();
			console.log('Selection embeddings saved successfully');
		} else {
			console.log('All marginalia with text already have selection embeddings');
		}
	}

	/**
	 * Calculate cosine similarity between two embedding vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			return 0;
		}
		
		let dotProduct = 0;
		let normA = 0;
		let normB = 0;
		
		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		
		const denominator = Math.sqrt(normA) * Math.sqrt(normB);
		if (denominator === 0) {
			return 0;
		}
		
		return dotProduct / denominator;
	}

	/**
	 * Find similar marginalia items based on note embedding similarity
	 */
	public async findSimilarMarginalia(item: MarginaliaItem, threshold: number = 0.7): Promise<Array<{ item: MarginaliaItem; filePath: string; similarity: number }>> {
		if (!item.embedding || item.embedding === null || !Array.isArray(item.embedding) || item.embedding.length === 0) {
			throw new Error('Item does not have a note embedding');
		}

		const results: Array<{ item: MarginaliaItem; filePath: string; similarity: number }> = [];
		const activeFile = this.app.workspace.getActiveFile();
		const currentFilePath = activeFile ? activeFile.path : '';

		// Iterate through all marginalia
		for (const [filePath, data] of this.marginaliaData) {
			if (data && data.items) {
				for (const otherItem of data.items) {
					// Skip the same item
					if (otherItem.id === item.id && filePath === currentFilePath) {
						continue;
					}

					// Check if other item has embedding (skip if null or missing)
					if (!otherItem.embedding || otherItem.embedding === null || !Array.isArray(otherItem.embedding) || otherItem.embedding.length === 0) {
						continue;
					}

					// Calculate similarity
					const similarity = this.cosineSimilarity(item.embedding, otherItem.embedding);

					// Add if above threshold
					if (similarity >= threshold) {
						results.push({
							item: otherItem,
							filePath: filePath,
							similarity: similarity
						});
					}
				}
			}
		}

		// Sort by similarity (highest first)
		results.sort((a, b) => b.similarity - a.similarity);

		return results;
	}

	/**
	 * Find similar marginalia items based on selection embedding similarity
	 */
	public async findSimilarSelection(item: MarginaliaItem, threshold: number = 0.5): Promise<Array<{ item: MarginaliaItem; filePath: string; similarity: number }>> {
		if (!item.selectionEmbedding || item.selectionEmbedding === null || !Array.isArray(item.selectionEmbedding) || item.selectionEmbedding.length === 0) {
			throw new Error('Item does not have a selection embedding');
		}

		const results: Array<{ item: MarginaliaItem; filePath: string; similarity: number }> = [];
		const activeFile = this.app.workspace.getActiveFile();
		const currentFilePath = activeFile ? activeFile.path : '';

		// Iterate through all marginalia
		for (const [filePath, data] of this.marginaliaData) {
			if (data && data.items) {
				for (const otherItem of data.items) {
					// Skip the same item
					if (otherItem.id === item.id && filePath === currentFilePath) {
						continue;
					}

					// Check if other item has selection embedding (skip if null or missing)
					if (!otherItem.selectionEmbedding || otherItem.selectionEmbedding === null || !Array.isArray(otherItem.selectionEmbedding) || otherItem.selectionEmbedding.length === 0) {
						continue;
					}

					// Calculate similarity
					const similarity = this.cosineSimilarity(item.selectionEmbedding, otherItem.selectionEmbedding);

					// Add if above threshold
					if (similarity >= threshold) {
						results.push({
							item: otherItem,
							filePath: filePath,
							similarity: similarity
						});
					}
				}
			}
		}

		// Sort by similarity (highest first)
		results.sort((a, b) => b.similarity - a.similarity);

		return results;
	}

	/**
	 * Generate a combined embedding from note and selection text
	 */
	private async generateCombinedEmbedding(noteText: string, selectionText: string): Promise<number[] | null> {
		if (!this.settings.ollamaAvailable) {
			return null;
		}

		// Combine note and selection text
		const combinedText = [noteText, selectionText]
			.filter(text => this.hasMeaningfulText(text))
			.join(' ');

		if (!this.hasMeaningfulText(combinedText)) {
			return null;
		}

		const address = this.settings.ollamaAddress || 'localhost';
		const port = this.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		try {
			// Check if text is too long (>2048 tokens)
			let finalText = combinedText;
			const tokenCount = this.estimateTokenCount(combinedText);
			
			if (tokenCount > 2048) {
				console.log(`Combined text is too long (${tokenCount} tokens), summarizing...`);
				finalText = await this.summarizeText(combinedText);
			}

			// Generate embedding using nomic-embed-text
			const response = await fetch(`${baseUrl}/api/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'nomic-embed-text:latest',
					prompt: finalText
				})
			});

			if (response.ok) {
				const data = await response.json();
				if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
					return data.embedding;
				}
			}
		} catch (error) {
			console.error('Error generating combined embedding:', error);
		}

		return null;
	}

	/**
	 * Find similar marginalia items based on combined (note + selection) embedding similarity
	 */
	public async findSimilarCombined(item: MarginaliaItem, threshold: number = 0.5): Promise<Array<{ item: MarginaliaItem; filePath: string; similarity: number }>> {
		// Generate combined embedding for the current item
		const noteText = item.note || '';
		const selectionText = item.text || '';
		
		if (!this.hasMeaningfulText(noteText) && !this.hasMeaningfulText(selectionText)) {
			throw new Error('Item needs at least a note or selection text to generate a combined embedding');
		}

		const sourceEmbedding = await this.generateCombinedEmbedding(noteText, selectionText);
		if (!sourceEmbedding) {
			throw new Error('Failed to generate combined embedding');
		}

		const results: Array<{ item: MarginaliaItem; filePath: string; similarity: number }> = [];
		const activeFile = this.app.workspace.getActiveFile();
		const currentFilePath = activeFile ? activeFile.path : '';

		// Iterate through all marginalia
		for (const [filePath, data] of this.marginaliaData) {
			if (data && data.items) {
				for (const otherItem of data.items) {
					// Skip the same item
					if (otherItem.id === item.id && filePath === currentFilePath) {
						continue;
					}

					// Generate combined embedding for the other item
					const otherNoteText = otherItem.note || '';
					const otherSelectionText = otherItem.text || '';
					
					if (!this.hasMeaningfulText(otherNoteText) && !this.hasMeaningfulText(otherSelectionText)) {
						continue; // Skip items with no meaningful text
					}

					const otherEmbedding = await this.generateCombinedEmbedding(otherNoteText, otherSelectionText);
					if (!otherEmbedding) {
						continue; // Skip if embedding generation failed
					}

					// Calculate similarity
					const similarity = this.cosineSimilarity(sourceEmbedding, otherEmbedding);

					// Add if above threshold
					if (similarity >= threshold) {
						results.push({
							item: otherItem,
							filePath: filePath,
							similarity: similarity
						});
					}
				}
			}
		}

		// Sort by similarity (highest first)
		results.sort((a, b) => b.similarity - a.similarity);

		return results;
	}

	public getSidebarView(): MarginaliaView | null {
		return this.sidebarView;
	}

	public applySettings() {
		// Apply CSS variables for highlight color and transparency
		document.documentElement.style.setProperty('--marginalia-color', this.settings.highlightColor);
		document.documentElement.style.setProperty('--marginalia-transparency', this.settings.transparency.toString());
		
		// Calculate rgba color for highlights
		const rgb = this.hexToRgb(this.settings.highlightColor);
		if (rgb) {
			document.documentElement.style.setProperty(
				'--marginalia-highlight-bg',
				`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.settings.transparency})`
			);
			document.documentElement.style.setProperty(
				'--marginalia-highlight-border',
				`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.settings.transparency * 2})`
			);
			document.documentElement.style.setProperty(
				'--marginalia-highlight-hover',
				`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.settings.transparency + 0.2})`
			);
			document.documentElement.style.setProperty(
				'--marginalia-icon-color',
				`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`
			);
		}
	}

	private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
		const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		return result ? {
			r: parseInt(result[1], 16),
			g: parseInt(result[2], 16),
			b: parseInt(result[3], 16)
		} : null;
	}

}


class MarginNoteModal extends Modal {
	private onSubmit: (note: string, color?: string) => void;
	private defaultColor: string;

	constructor(app: any, defaultColor: string, onSubmit: (note: string, color?: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.defaultColor = defaultColor;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Add marginalia' });

		const input = contentEl.createEl('textarea', {
			attr: {
				placeholder: 'Enter your margin note...',
				rows: '5'
			}
		});
		input.style.width = '100%';
		input.style.minHeight = '100px';

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
		colorPicker.value = this.defaultColor;
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

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const submitButton = buttonContainer.createEl('button', { text: 'Add marginalia' });
		submitButton.addClass('mod-cta');
		submitButton.onclick = () => {
			// Always save the color value (default or custom) to the item
			const selectedColor = colorPicker.value;
			this.onSubmit(input.value, selectedColor);
			this.close();
		};

		input.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class MarginaliaSettingTab extends PluginSettingTab {
	plugin: MarginaliaPlugin;

	constructor(app: any, plugin: MarginaliaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Marginalia Settings' });

		// Ollama Info Section
		const ollamaInfo = containerEl.createDiv('marginalia-ollama-info');
		ollamaInfo.style.padding = '10px';
		ollamaInfo.style.marginBottom = '15px';
		ollamaInfo.style.backgroundColor = 'var(--background-secondary)';
		ollamaInfo.style.borderRadius = '4px';
		ollamaInfo.style.border = '1px solid var(--background-modifier-border)';
		
		const infoText = ollamaInfo.createEl('p', { 
			text: 'AI features require access to an Ollama server, either installed locally or accessible on a network. The server must have the nomic-embed-text:latest and phi3:latest models available.' 
		});
		infoText.style.margin = '0';
		infoText.style.fontSize = '0.9em';
		infoText.style.color = 'var(--text-normal)';
		
		const statusText = ollamaInfo.createEl('p');
		statusText.style.margin = '5px 0 0 0';
		statusText.style.fontSize = '0.85em';
		statusText.style.fontWeight = '500';
		
		if (this.plugin.settings.ollamaAvailable) {
			statusText.textContent = '✓ Ollama is available';
			statusText.style.color = 'var(--text-success)';
		} else {
			statusText.textContent = '✗ Ollama is not available';
			statusText.style.color = 'var(--text-error)';
		}

		// Ollama Settings Section
		containerEl.createEl('h3', { text: 'Ollama Configuration' });

		// Ollama Address
		new Setting(containerEl)
			.setName('Ollama Address')
			.setDesc('The address of your Ollama server (e.g., localhost)')
			.addText(text => {
				text
					.setPlaceholder('localhost')
					.setValue(this.plugin.settings.ollamaAddress)
					.onChange(async (value) => {
						this.plugin.settings.ollamaAddress = value;
						await this.plugin.saveData(this.plugin.settings);
					});
			});

		// Ollama Port
		new Setting(containerEl)
			.setName('Ollama Port')
			.setDesc('The port of your Ollama server (default: 11434)')
			.addText(text => {
				text
					.setPlaceholder('11434')
					.setValue(this.plugin.settings.ollamaPort)
					.onChange(async (value) => {
						this.plugin.settings.ollamaPort = value;
						await this.plugin.saveData(this.plugin.settings);
					});
			});

		// Check Ollama Button
		const checkOllamaSetting = new Setting(containerEl)
			.setName('Check Ollama Connection')
			.setDesc('Verify that Ollama server is running and required models are available')
			.addButton(button => {
				button
					.setButtonText('Check Ollama')
					.setCta()
					.onClick(async () => {
						await this.checkOllama();
						// Update status text after check
						const ollamaInfo = containerEl.querySelector('.marginalia-ollama-info');
						if (ollamaInfo) {
							const statusText = ollamaInfo.querySelector('p:last-child') as HTMLElement;
							if (statusText) {
								if (this.plugin.settings.ollamaAvailable) {
									statusText.textContent = '✓ Ollama is available';
									statusText.style.color = 'var(--text-success)';
								} else {
									statusText.textContent = '✗ Ollama is not available';
									statusText.style.color = 'var(--text-error)';
								}
							}
						}
					});
			});

		// Default Similarity Threshold Slider (under Ollama Configuration)
		new Setting(containerEl)
			.setName('Default Similarity Threshold')
			.setDesc(`Default similarity threshold for AI functions (${(this.plugin.settings.defaultSimilarity * 100).toFixed(0)}%)`)
			.addSlider(slider => {
				slider
					.setLimits(0.5, 1.0, 0.01)
					.setValue(this.plugin.settings.defaultSimilarity)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultSimilarity = value;
						try {
							await this.plugin.saveData(this.plugin.settings);
							console.log('Settings saved: defaultSimilarity =', value);
						} catch (error) {
							console.error('Error saving settings:', error);
						}
					});
			});

		// Status display area
		const statusDiv = containerEl.createDiv('ollama-status');
		statusDiv.style.marginTop = '10px';
		statusDiv.style.padding = '10px';
		statusDiv.style.borderRadius = '4px';
		statusDiv.style.display = 'none';

		// Store reference for updates
		(this as any).statusDiv = statusDiv;

		// Highlight Color Picker
		containerEl.createEl('h3', { text: 'Appearance' });

		new Setting(containerEl)
			.setName('Default Highlight Color')
			.setDesc('Default color for marginalia highlights. Individual marginalia can override this with their own color.')
			.addColorPicker(colorPicker => {
				colorPicker.setValue(this.plugin.settings.highlightColor);
				colorPicker.onChange(async (value) => {
					this.plugin.settings.highlightColor = value;
					try {
						await this.plugin.saveData(this.plugin.settings);
						console.log('Settings saved: highlightColor =', value);
					} catch (error) {
						console.error('Error saving settings:', error);
					}
					this.plugin.applySettings();
					// Refresh editor to apply new color
					this.plugin.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
						const view = leaf.view as MarkdownView;
						if (view.file) {
							this.plugin.refreshEditor(view.file.path);
						}
					});
				});
			});

		// Highlight Transparency Slider
		new Setting(containerEl)
			.setName('Highlight Transparency')
			.setDesc(`Adjust the transparency of highlights (${Math.round(this.plugin.settings.transparency * 100)}%)`)
			.addSlider(slider => {
				slider
					.setLimits(0.1, 1, 0.05)
					.setValue(this.plugin.settings.transparency)
					.setDynamicTooltip()
					.onChange(async (value) => {
						// Update the setting immediately
						this.plugin.settings.transparency = value;
						// Save to JSON immediately
						try {
							await this.plugin.saveData(this.plugin.settings);
							console.log('Settings saved: transparency =', value);
						} catch (error) {
							console.error('Error saving settings:', error);
							new Notice('Error saving transparency setting');
						}
						// Apply the new transparency
						this.plugin.applySettings();
						// Refresh editor to apply new transparency
						this.plugin.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
							const view = leaf.view as MarkdownView;
							if (view.file) {
								this.plugin.refreshEditor(view.file.path);
							}
						});
					});
			});

		// Indicator Visibility Setting (under Appearance)
		new Setting(containerEl)
			.setName('Indicator Visibility')
			.setDesc('Choose what indicators to show for marginalia')
			.addDropdown(dropdown => {
				dropdown
					.addOption('both', 'Both (Pen + Highlight)')
					.addOption('pen', 'Pen Only')
					.addOption('highlight', 'Highlight Only')
					.addOption('neither', 'Neither')
					.setValue(this.plugin.settings.indicatorVisibility)
					.onChange(async (value: 'pen' | 'highlight' | 'both' | 'neither') => {
						this.plugin.settings.indicatorVisibility = value;
						await this.plugin.saveData(this.plugin.settings);
						// Refresh all editors by forcing a re-render
						this.plugin.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
							const view = leaf.view as MarkdownView;
							if (view.file) {
								// Force a complete refresh by triggering editor update
								const editor = view.editor;
								if (editor) {
									// Get items and force re-dispatch
									const items = this.plugin.getMarginalia(view.file.path);
									// Trigger refresh multiple times to ensure it works
									this.plugin.refreshEditor(view.file.path);
									setTimeout(() => {
										if (view.file) {
											this.plugin.refreshEditor(view.file.path);
										}
									}, 50);
									setTimeout(() => {
										if (view.file) {
											this.plugin.refreshEditor(view.file.path);
										}
									}, 200);
								}
							}
						});
					});
			});

	}

	private async checkOllamaOnStartup() {
		// Check Ollama availability silently on startup
		const address = this.plugin.settings.ollamaAddress || 'localhost';
		const port = this.plugin.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		try {
			const response = await fetch(`${baseUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (response.ok) {
				const data = await response.json();
				const models = data.models || [];
				const modelNames = models.map((m: any) => m.name || m.model || '');

				// Check for required models
				const requiredModels = ['nomic-embed-text:latest', 'phi3:latest'];
				let allModelsAvailable = true;

				for (const requiredModel of requiredModels) {
					const found = modelNames.some((name: string) => 
						name === requiredModel || name.startsWith(requiredModel.split(':')[0])
					);
					if (!found) {
						allModelsAvailable = false;
						break;
					}
				}

				this.plugin.settings.ollamaAvailable = allModelsAvailable;
			} else {
				this.plugin.settings.ollamaAvailable = false;
			}
		} catch (error) {
			this.plugin.settings.ollamaAvailable = false;
		}

		await this.plugin.saveData(this.plugin.settings);
	}

	private async checkOllama() {
		const statusDiv = (this as any).statusDiv as HTMLElement;
		if (!statusDiv) return;

		const address = this.plugin.settings.ollamaAddress || 'localhost';
		const port = this.plugin.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		statusDiv.style.display = 'block';
		statusDiv.innerHTML = '<p>Checking Ollama connection...</p>';
		statusDiv.style.backgroundColor = 'var(--background-secondary)';
		statusDiv.style.color = 'var(--text-normal)';

		const warnings: string[] = [];
		const errors: string[] = [];

		try {
			// Check if server is reachable
			const response = await fetch(`${baseUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				errors.push(`Server returned error: ${response.status} ${response.statusText}`);
				this.plugin.settings.ollamaAvailable = false;
			} else {
				const data = await response.json();
				const models = data.models || [];
				const modelNames = models.map((m: any) => m.name || m.model || '');

				// Check for required models
				const requiredModels = ['nomic-embed-text:latest', 'phi3:latest'];
				const missingModels: string[] = [];

				for (const requiredModel of requiredModels) {
					const found = modelNames.some((name: string) => 
						name === requiredModel || name.startsWith(requiredModel.split(':')[0])
					);
					if (!found) {
						missingModels.push(requiredModel);
					}
				}

				if (missingModels.length > 0) {
					warnings.push(`Missing required models: ${missingModels.join(', ')}`);
					this.plugin.settings.ollamaAvailable = false;
				} else {
					this.plugin.settings.ollamaAvailable = true;
				}

				// Display results
				if (errors.length > 0) {
					statusDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
					statusDiv.style.border = '1px solid rgba(255, 0, 0, 0.3)';
					statusDiv.innerHTML = `
						<p style="color: var(--text-error); font-weight: bold;">❌ Connection Failed</p>
						<ul style="margin: 5px 0; padding-left: 20px;">
							${errors.map(e => `<li>${e}</li>`).join('')}
						</ul>
					`;
				} else if (warnings.length > 0) {
					statusDiv.style.backgroundColor = 'rgba(255, 193, 7, 0.1)';
					statusDiv.style.border = '1px solid rgba(255, 193, 7, 0.3)';
					statusDiv.innerHTML = `
						<p style="color: var(--text-warning); font-weight: bold;">⚠️ Warnings</p>
						<ul style="margin: 5px 0; padding-left: 20px;">
							${warnings.map(w => `<li>${w}</li>`).join('')}
						</ul>
					`;
				} else {
					statusDiv.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
					statusDiv.style.border = '1px solid rgba(0, 255, 0, 0.3)';
					statusDiv.innerHTML = `
						<p style="color: var(--text-success); font-weight: bold;">✅ Connection Successful</p>
						<p style="margin: 5px 0;">Ollama server is running and all required models are available.</p>
						<p style="margin: 5px 0; font-size: 0.9em; color: var(--text-muted);">
							Required models found: nomic-embed-text:latest, phi3:latest
						</p>
					`;
				}
			}
			
			// Save the availability state
			await this.plugin.saveData(this.plugin.settings);
		} catch (error: any) {
			this.plugin.settings.ollamaAvailable = false;
			await this.plugin.saveData(this.plugin.settings);
			
			statusDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
			statusDiv.style.border = '1px solid rgba(255, 0, 0, 0.3)';
			statusDiv.innerHTML = `
				<p style="color: var(--text-error); font-weight: bold;">❌ Connection Failed</p>
				<p style="margin: 5px 0;">Unable to connect to Ollama server at ${baseUrl}</p>
				<p style="margin: 5px 0; font-size: 0.9em; color: var(--text-muted);">
					Error: ${error.message || 'Network error or server not running'}
				</p>
				<p style="margin: 5px 0; font-size: 0.9em; color: var(--text-muted);">
					Make sure Ollama is running and the address/port are correct.
				</p>
			`;
		}
	}
}
