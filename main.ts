import { Plugin, MarkdownView, TFile, Modal, PluginSettingTab, WorkspaceLeaf, Setting, Notice } from 'obsidian';
import { MarginaliaView, EditMarginaliaModal, DeleteConfirmationModal } from './src/sidebar';
import { MarginaliaEditorExtension } from './src/editorExtension';
import { MarginaliaData, MarginaliaItem } from './src/types';

// Settings are stored in data.json via Obsidian's loadData()/saveData()
// Marginalia data is stored in marginalia.json
// Note embeddings are stored in notes_embedding.json

// Interface for note embedding chunks
export interface NoteEmbeddingChunk {
	chunk_id: string;
	char_start: number;
	char_end: number;
	vector: number[];
}

// Interface for note embedding entries
export interface NoteEmbedding {
	embedding_id: string;
	source_path: string;
	noteEdited: string;
	chunks: NoteEmbeddingChunk[];
}

export interface MarginaliaSettings {
	highlightColor: string;
	opacity: number;
	ollamaAddress: string;
	ollamaPort: string;
	indicatorVisibility: 'pen' | 'highlight' | 'both' | 'neither';
	penIconPosition: 'left' | 'right'; // Position of pen icon in margin
	ollamaAvailable: boolean; // Track if Ollama is available (server reachable AND both models available)
	ollamaServerStatus: 'available' | 'unavailable' | 'unknown'; // Individual server status
	nomicModelStatus: 'available' | 'unavailable' | 'unknown'; // Individual nomic model status
	qwenModelStatus: 'available' | 'unavailable' | 'unknown'; // Individual qwen model status
	sortOrder: 'position' | 'date-asc' | 'date-desc'; // Sort order for current note marginalia
	defaultSimilarity: number; // Default similarity threshold for AI functions (0.5 to 1.0)
	embeddingOn: boolean; // Whether note embedding is active
	similarityFolders: string; // Folders to include in similarity analysis (comma-separated)
}

const DEFAULT_SETTINGS: MarginaliaSettings = {
	highlightColor: '#ffeb3d', // Yellow
	opacity: 0.5, // 50% opacity
	ollamaAddress: 'localhost',
	ollamaPort: '11434',
	indicatorVisibility: 'both',
	penIconPosition: 'right', // Default to right margin
	ollamaAvailable: false,
	ollamaServerStatus: 'unknown',
	nomicModelStatus: 'unknown',
	qwenModelStatus: 'unknown',
	sortOrder: 'position',
	defaultSimilarity: 0.60, // Default similarity threshold for AI functions
	embeddingOn: false, // Note embedding starts as inactive
	similarityFolders: '' // Empty by default, user specifies folders
};

export default class MarginaliaPlugin extends Plugin {
	public marginaliaData: Map<string, MarginaliaData> = new Map();
	private sidebarView: MarginaliaView | null = null;
	settings: MarginaliaSettings;
	public embeddingProgressCallback: (() => void) | null = null;
	private embeddingQueue: Set<string> = new Set(); // Queue of file paths to process
	private isProcessingEmbeddingQueue: boolean = false;
	private embeddingDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private embeddingRetryCount: Map<string, number> = new Map(); // Track retry count per file
	private readonly MAX_RETRIES = 3; // Maximum number of retries for a file
	private embeddingListenersRegistered: boolean = false; // Track if listeners are already registered

	async onload() {

		// Load settings and merge with defaults
		const loadedData = await this.loadData();
		
		// Backwards compatibility: Check if marginalia data exists in data.json and migrate it
		let loadedSettings: any = loadedData || {};
		let marginaliaDataToMigrate: Record<string, MarginaliaData> | null = null;
		
		// Check if data.json contains marginalia data (file paths as keys with MarginaliaData structure)
		// Settings have known property names, marginalia data has file paths as keys
		const settingsKeys = Object.keys(DEFAULT_SETTINGS);
		const potentialMarginaliaKeys: string[] = [];
		
		for (const key in loadedData) {
			// If key is not a known setting and looks like a file path, it might be marginalia data
			if (!settingsKeys.includes(key) && typeof loadedData[key] === 'object' && loadedData[key] !== null) {
				const value = loadedData[key];
				// Check if it has the structure of MarginaliaData (has 'items' array)
				if (Array.isArray(value.items) && value.items.length > 0) {
					// Verify items structure looks like MarginaliaItem
					const firstItem = value.items[0];
					if (firstItem && typeof firstItem === 'object' && ('id' in firstItem || 'text' in firstItem || 'note' in firstItem)) {
						potentialMarginaliaKeys.push(key);
					}
				}
			}
		}
		
		// If we found marginalia data, extract it
		if (potentialMarginaliaKeys.length > 0) {
			marginaliaDataToMigrate = {};
			for (const key of potentialMarginaliaKeys) {
				marginaliaDataToMigrate[key] = loadedData[key] as MarginaliaData;
				delete loadedSettings[key];
			}
		}
		
		// Handle migration from 'transparency' to 'opacity'
		if (loadedSettings && 'transparency' in loadedSettings && !('opacity' in loadedSettings)) {
			loadedSettings.opacity = (loadedSettings as any).transparency;
			delete (loadedSettings as any).transparency;
		}
		
		// Merge defaults with loaded settings (loaded settings take precedence)
		// This ensures new settings get defaults, but existing saved settings are preserved
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings || {});
		
		// Ensure critical settings have valid values (defensive programming)
		// Only validate/reset if the value is truly invalid (not just missing)
		// This prevents overwriting valid saved values with defaults
		if (loadedSettings && loadedSettings.highlightColor !== undefined) {
			// Value was explicitly loaded - validate it strictly
			if (typeof loadedSettings.highlightColor !== 'string' || loadedSettings.highlightColor.trim() === '') {
				// Invalid value - reset to default
				this.settings.highlightColor = DEFAULT_SETTINGS.highlightColor;
			}
			// If valid, keep the loaded value (already in this.settings from Object.assign)
		}
		// If highlightColor wasn't in loadedSettings, Object.assign already set it to default
		
		if (loadedSettings && loadedSettings.opacity !== undefined) {
			// Value was explicitly loaded - validate it strictly
			if (typeof loadedSettings.opacity !== 'number' || isNaN(loadedSettings.opacity) || loadedSettings.opacity < 0.1 || loadedSettings.opacity > 1) {
				// Invalid value - reset to default
				this.settings.opacity = DEFAULT_SETTINGS.opacity;
			}
			// If valid, keep the loaded value (already in this.settings from Object.assign)
		}
		// If opacity wasn't in loadedSettings, Object.assign already set it to default
		
		// Validate new settings fields
		if (loadedSettings && loadedSettings.embeddingOn !== undefined) {
			if (typeof loadedSettings.embeddingOn !== 'boolean') {
				this.settings.embeddingOn = DEFAULT_SETTINGS.embeddingOn;
			}
		}
		
		if (loadedSettings && loadedSettings.similarityFolders !== undefined) {
			if (typeof loadedSettings.similarityFolders !== 'string') {
				this.settings.similarityFolders = DEFAULT_SETTINGS.similarityFolders;
			}
		}
		
		// Backwards compatibility: Migrate marginalia data from data.json to marginalia.json if found
		if (marginaliaDataToMigrate) {
			try {
				const marginaliaPath = this.getMarginaliaFilePath();
				const marginaliaExists = await this.app.vault.adapter.exists(marginaliaPath);
				
				// Read existing marginalia data if it exists
				let existingMarginalia: Record<string, MarginaliaData> = {};
				if (marginaliaExists) {
					const existingData = await this.app.vault.adapter.read(marginaliaPath);
					if (existingData) {
						existingMarginalia = JSON.parse(existingData);
					}
				}
				
				// Merge migrated data with existing data (migrated data takes precedence for conflicts)
				const mergedMarginalia = Object.assign({}, existingMarginalia, marginaliaDataToMigrate);
				
				// Write to marginalia.json
				await this.app.vault.adapter.write(marginaliaPath, JSON.stringify(mergedMarginalia, null, 2));
				
				console.log(`Migrated ${Object.keys(marginaliaDataToMigrate).length} file(s) of marginalia data from data.json to marginalia.json`);
			} catch (error) {
				console.error('Error migrating marginalia data:', error);
			}
		}

		// Always save to ensure settings are persisted correctly (this will save cleaned settings without marginalia data)
		await this.saveData(this.settings);
		
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

		// Register context menu item for editor mode
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (view instanceof MarkdownView) {
					this.addContextMenuItem(menu, editor, view);
				}
			})
		);


		// Load existing marginalia data
		await this.loadMarginaliaData();

		// If embedding is on, ensure the embedding file exists and start monitoring
		if (this.settings.embeddingOn) {
			try {
				await this.initializeEmbeddingFile();
				// Start monitoring folders for embedding
				this.startEmbeddingMonitor();
			} catch (error) {
				console.error('Error initializing embedding file on load:', error);
				// Don't fail plugin load, just log the error
			}
		}

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
		}, text);

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
			
			// Immediately refresh editor
			this.refreshEditor(filePath);
			
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

	private getMarginaliaFilePath(): string {
		return `${this.app.vault.configDir}/plugins/marginalia/marginalia.json`;
	}

	private getEmbeddingFilePath(): string {
		return `${this.app.vault.configDir}/plugins/marginalia/notes_embedding.json`;
	}

	public async initializeEmbeddingFile(): Promise<void> {
		const embeddingPath = this.getEmbeddingFilePath();
		const exists = await this.app.vault.adapter.exists(embeddingPath);
		
		if (!exists) {
			// Create the file with empty array structure
			// The file will contain an array of NoteEmbedding objects
			// Each NoteEmbedding can have multiple chunks (though most notes will have just one)
			const initialData: NoteEmbedding[] = [];
			try {
				await this.app.vault.adapter.write(embeddingPath, JSON.stringify(initialData, null, 2));
			} catch (error) {
				console.error('Error creating notes_embedding.json:', error);
				throw error;
			}
		}
	}

	/**
	 * Queue a file for embedding processing (with debouncing)
	 */
	private queueFileForEmbedding(filePath: string): void {
		if (!this.settings.embeddingOn) {
			return;
		}

		// Clear existing debounce timer for this file
		const existingTimer = this.embeddingDebounceTimers.get(filePath);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Add to queue
		this.embeddingQueue.add(filePath);

		// Set debounce timer (wait 2 seconds after last change before processing)
		const timer = setTimeout(() => {
			this.embeddingDebounceTimers.delete(filePath);
			this.processEmbeddingQueue();
		}, 2000);

		this.embeddingDebounceTimers.set(filePath, timer);
	}

	/**
	 * Process the embedding queue one file at a time
	 */
	private async processEmbeddingQueue(): Promise<void> {
		if (this.isProcessingEmbeddingQueue || this.embeddingQueue.size === 0 || !this.settings.embeddingOn) {
			return;
		}

		this.isProcessingEmbeddingQueue = true;

		while (this.embeddingQueue.size > 0 && this.settings.embeddingOn) {
			// Get the first file from the queue
			const filePath = this.embeddingQueue.values().next().value;
			this.embeddingQueue.delete(filePath);

			// Get the file object
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				try {
					await this.processFileForEmbedding(file);
				} catch (error) {
					console.error(`Error processing file ${filePath} from queue:`, error);
				}
			}

			// Small delay between files to avoid overwhelming the server
			if (this.embeddingQueue.size > 0 && this.settings.embeddingOn) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
		}

		this.isProcessingEmbeddingQueue = false;
	}

	/**
	 * Clear the embedding queue and stop processing
	 */
	public clearEmbeddingQueue(): void {
		this.embeddingQueue.clear();
		
		// Clear all debounce timers
		for (const timer of this.embeddingDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.embeddingDebounceTimers.clear();
		
		// Clear retry counts
		this.embeddingRetryCount.clear();
		
		// Note: We don't reset embeddingListenersRegistered here because
		// the listeners are still registered, just paused
	}

	/**
	 * Start monitoring folders for embedding generation
	 */
	public startEmbeddingMonitor(): void {
		if (!this.settings.embeddingOn) {
			return;
		}

		// Prevent duplicate listener registration
		if (this.embeddingListenersRegistered) {
			// Listeners already registered, just process files if needed
			this.processFoldersForEmbedding();
			return;
		}

		// Process files after a short delay to ensure vault is fully loaded
		// The listener will catch any files that are created/modified after this
		setTimeout(() => {
			this.processFoldersForEmbedding();
		}, 2000);

		// Register file system events to watch for changes (only once)
		this.registerEvent(
			this.app.vault.on('modify', (file: TFile) => {
				if (this.settings.embeddingOn && file.extension === 'md' && this.isFileInSimilarityFolders(file.path)) {
					this.queueFileForEmbedding(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('create', (file: TFile) => {
				if (this.settings.embeddingOn && file.extension === 'md' && this.isFileInSimilarityFolders(file.path)) {
					this.queueFileForEmbedding(file.path);
				}
			})
		);

		this.embeddingListenersRegistered = true;
		console.log('Embedding file system listeners registered');
	}

	/**
	 * Process all folders specified in settings for embedding
	 */
	private async processFoldersForEmbedding(): Promise<void> {
		if (!this.settings.embeddingOn || !this.settings.similarityFolders) {
			return;
		}

		const folders = this.settings.similarityFolders
			.split(',')
			.map(f => f.trim())
			.filter(f => f.length > 0);

		if (folders.length === 0) {
			return;
		}

		console.log(`Starting embedding processing for ${folders.length} folder(s): ${folders.join(', ')}`);

		for (let i = 0; i < folders.length; i++) {
			const folderPath = folders[i];
			console.log(`Processing folder ${i + 1}/${folders.length}: "${folderPath}"`);
			await this.processFolderForEmbedding(folderPath);
		}

		console.log('Initial embedding processing complete');
	}

	/**
	 * Process a single folder for embedding
	 */
	private async processFolderForEmbedding(folderPath: string): Promise<void> {
		try {
			// Always use file-based approach (same as listener) - more reliable than folder objects
			// Use the same matching logic as isFileInSimilarityFolders
			const normalizedPath = this.normalizePath(folderPath);
			
			// Wait for vault to be ready (retry if no files found initially)
			let allFiles = this.app.vault.getMarkdownFiles();
			if (allFiles.length === 0) {
				// Vault might not be ready yet, wait a bit and retry
				console.log(`No files found in vault yet, waiting for vault to be ready...`);
				await new Promise(resolve => setTimeout(resolve, 1000));
				allFiles = this.app.vault.getMarkdownFiles();
				console.log(`After wait, found ${allFiles.length} total markdown file(s) in vault`);
			} else {
				console.log(`Found ${allFiles.length} total markdown file(s) in vault`);
			}
			
			const mdFiles = allFiles.filter(file => {
				return file.path === folderPath || file.path.startsWith(folderPath + '/');
			});
			
			if (mdFiles.length > 0) {
				console.log(`Found ${mdFiles.length} markdown file(s) matching folder path: "${folderPath}"`);
				console.log(`Sample matching files:`, mdFiles.slice(0, 5).map(f => f.path));
				for (const file of mdFiles) {
					if (!this.settings.embeddingOn) {
						return;
					}
					await this.processFileForEmbedding(file);
				}
				console.log(`Completed processing files for folder path: ${folderPath}`);
				return;
			}
			
			// Try with normalized path as fallback
			const mdFilesNormalized = allFiles.filter(file => {
				const normalizedFilePath = this.normalizePath(file.path);
				return normalizedFilePath === normalizedPath || normalizedFilePath.startsWith(normalizedPath + '/');
			});
			
			if (mdFilesNormalized.length > 0) {
				console.log(`Found ${mdFilesNormalized.length} markdown file(s) matching normalized folder path: "${normalizedPath}"`);
				console.log(`Sample matching files:`, mdFilesNormalized.slice(0, 5).map(f => f.path));
				for (const file of mdFilesNormalized) {
					if (!this.settings.embeddingOn) {
						return;
					}
					await this.processFileForEmbedding(file);
				}
				console.log(`Completed processing files for normalized folder path: ${normalizedPath}`);
				return;
			}
			
			// If still no files found, log debugging information
			console.error(`No files found matching folder path: "${folderPath}" (also tried: "${normalizedPath}")`);
			console.error(`Searched ${allFiles.length} total markdown file(s) in vault`);
			// List some available folders and sample file paths for debugging
			const allFolders = this.app.vault.getAllFolders();
			if (allFolders.length > 0) {
				console.error(`Available folders in vault (first 20):`, 
					allFolders.slice(0, 20).map(f => f.path));
			}
			// Show some sample file paths that might match
			const sampleFiles = allFiles.slice(0, 10);
			if (sampleFiles.length > 0) {
				console.error(`Sample file paths in vault:`, sampleFiles.map(f => f.path));
				// Show files that start with similar names
				const similarFiles = allFiles.filter(f => 
					f.path.toLowerCase().includes(folderPath.toLowerCase()) || 
					f.path.toLowerCase().includes(normalizedPath.toLowerCase())
				).slice(0, 5);
				if (similarFiles.length > 0) {
					console.error(`Files with similar names:`, similarFiles.map(f => f.path));
				}
			} else {
				console.error(`No markdown files found in vault at all - vault may not be ready yet`);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error(`Error processing folder "${folderPath}" for embedding: ${errorMessage}`);
			if (errorStack) {
				console.error(`Stack trace:`, errorStack);
			}
		}
	}

	/**
	 * Check if a file path is within one of the specified similarity folders
	 */
	private isFileInSimilarityFolders(filePath: string): boolean {
		if (!this.settings.similarityFolders) {
			return false;
		}

		const folders = this.settings.similarityFolders
			.split(',')
			.map(f => f.trim())
			.filter(f => f.length > 0);

		for (const folderPath of folders) {
			// Check if file path starts with the folder path (handles both exact match and subfolders)
			if (filePath === folderPath || filePath.startsWith(folderPath + '/')) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Recursively collect all .md files from a folder
	 */
	private collectMarkdownFiles(folder: any, mdFiles: TFile[]): void {
		if (folder instanceof TFile && folder.extension === 'md') {
			mdFiles.push(folder);
		} else if (folder.children) {
			for (const child of folder.children) {
				this.collectMarkdownFiles(child, mdFiles);
			}
		}
	}

	/**
	 * Process a single file for embedding
	 */
	private async processFileForEmbedding(file: TFile): Promise<void> {
		if (!this.settings.embeddingOn || !this.settings.ollamaAvailable) {
			return;
		}

		try {
			// Load existing embeddings
			const embeddings = await this.loadEmbeddings();
			
			// Check if file needs processing
			const filePath = this.normalizePath(file.path);
			const fileStat = await this.app.vault.adapter.stat(file.path);
			if (!fileStat) {
				return;
			}

			const existingEmbedding = embeddings.find(e => this.normalizePath(e.source_path) === filePath);
			const needsProcessing = !existingEmbedding || 
				new Date(fileStat.mtime) > new Date(existingEmbedding.noteEdited);

			if (!needsProcessing) {
				return; // File is up to date
			}

			// Read file content
			const content = await this.app.vault.read(file);
			
			// Clean content (remove frontmatter, links, etc.)
			const cleanedContent = this.cleanMarkdownForEmbedding(content);
			
			if (cleanedContent.length === 0) {
				return; // No meaningful content
			}

			// Check if embedding was paused before chunking
			if (!this.settings.embeddingOn) {
				return; // Stop processing if embedding was paused
			}

			// Check if file needs chunking (>7000 characters)
			let chunks: Array<{ char_start: number; char_end: number }> = [];
			
			if (cleanedContent.length > 7000) {
				console.log(`Note longer than 7000 characters found: ${filePath} (${cleanedContent.length} characters)`);
				// Check again before sending qwen2.5:3b-instruct query
				if (!this.settings.embeddingOn) {
					return; // Stop if embedding was paused
				}
				// Use qwen2.5:3b-instruct to chunk the file
				try {
					chunks = await this.chunkFileWithQwen(cleanedContent, filePath);
					console.log(`File ${filePath} chunked into ${chunks.length} chunks:`, chunks);
					// Reset retry count on success
					this.embeddingRetryCount.delete(filePath);
				} catch (chunkingError) {
					// Chunking failed - check retry count
					const retryCount = this.embeddingRetryCount.get(filePath) || 0;
					const errorMessage = chunkingError instanceof Error ? chunkingError.message : String(chunkingError);
					
					if (retryCount < this.MAX_RETRIES) {
						console.error(`Chunking failed for ${filePath} (attempt ${retryCount + 1}/${this.MAX_RETRIES}): ${errorMessage}`);
						console.log(`Will retry in ${5000 * (retryCount + 1)}ms`);
						this.embeddingRetryCount.set(filePath, retryCount + 1);
						// Re-queue the file for retry after a delay
						setTimeout(() => {
							this.queueFileForEmbedding(file.path);
						}, 5000 * (retryCount + 1)); // Exponential backoff: 5s, 10s, 15s
						return; // Exit without processing
					} else {
						console.error(`Chunking failed for ${filePath} after ${this.MAX_RETRIES} retries. Error: ${errorMessage}`);
						console.error(`Skipping file. It will be retried on next Obsidian restart (retry counts are per-session only).`);
						this.embeddingRetryCount.delete(filePath);
						throw chunkingError; // Re-throw to be caught by outer try-catch
					}
				}
			} else {
				// Single chunk - entire file
				chunks = [{ char_start: 0, char_end: cleanedContent.length }];
			}

			// Check if embedding was paused before generating embeddings
			if (!this.settings.embeddingOn) {
				return; // Stop processing if embedding was paused
			}

			// Generate embeddings for each chunk
			const embeddingChunks: NoteEmbeddingChunk[] = [];
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				// Check if embedding was paused before processing each chunk
				if (!this.settings.embeddingOn) {
					return; // Stop processing if embedding was paused (current chunk can complete, but no new chunks)
				}
				const chunkText = cleanedContent.substring(chunk.char_start, chunk.char_end);
				
				try {
					const embedding = await this.generateEmbeddingForText(chunkText);
					
					// Check again after embedding generation (in case it was paused during the async call)
					if (!this.settings.embeddingOn) {
						return; // Stop if embedding was paused during processing
					}
					
					if (embedding) {
						embeddingChunks.push({
							chunk_id: this.generateUUID(),
							char_start: chunk.char_start,
							char_end: chunk.char_end,
							vector: embedding
						});
					} else {
						console.error(`Failed to generate embedding for chunk ${i + 1}/${chunks.length} of ${filePath} (characters ${chunk.char_start}-${chunk.char_end}). Embedding returned null.`);
					}
				} catch (embeddingError) {
					const errorMessage = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
					console.error(`Error generating embedding for chunk ${i + 1}/${chunks.length} of ${filePath} (characters ${chunk.char_start}-${chunk.char_end}): ${errorMessage}`);
					// Continue with other chunks even if one fails
				}
			}

			if (embeddingChunks.length === 0) {
				console.error(`Failed to generate any embeddings for ${filePath}. All ${chunks.length} chunk(s) failed.`);
				return; // No embeddings generated
			}

			if (embeddingChunks.length < chunks.length) {
				console.warn(`Partially embedded ${filePath}: ${embeddingChunks.length}/${chunks.length} chunk(s) succeeded.`);
			}

			// Update or create embedding entry
			const embeddingId = existingEmbedding?.embedding_id || this.generateUUID();
			const newEmbedding: NoteEmbedding = {
				embedding_id: embeddingId,
				source_path: filePath,
				noteEdited: new Date(fileStat.mtime).toISOString(),
				chunks: embeddingChunks
			};

			// Remove old entry if exists (compare normalized paths)
			const updatedEmbeddings = embeddings.filter(e => this.normalizePath(e.source_path) !== filePath);
			updatedEmbeddings.push(newEmbedding);

			// Save embeddings
			await this.saveEmbeddings(updatedEmbeddings);
			
			// Clear retry count on successful embedding
			this.embeddingRetryCount.delete(filePath);
			
			// Log successful embedding
			console.log(`✓ Successfully embedded note: ${filePath} (${embeddingChunks.length} chunk${embeddingChunks.length !== 1 ? 's' : ''})`);
			
			// Trigger embedding progress update callback if registered
			// Use setTimeout to ensure the callback runs after the file system write completes
			if (this.embeddingProgressCallback) {
				setTimeout(() => {
					if (this.embeddingProgressCallback) {
						this.embeddingProgressCallback();
					}
				}, 200);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error(`Failed to process file ${file.path} for embedding. Error: ${errorMessage}`);
			if (errorStack) {
				console.error(`Stack trace:`, errorStack);
			}
			// Note: Retry counts are per-session only. File will be retried on next Obsidian restart.
		}
	}

	/**
	 * Clean markdown content for embedding (remove frontmatter, links, etc.)
	 */
	private cleanMarkdownForEmbedding(content: string): string {
		let cleaned = content;

		// Remove frontmatter
		const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
		cleaned = cleaned.replace(frontmatterRegex, '');

		// Remove markdown links but keep the text: [text](url) -> text
		cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

		// Remove image links: ![alt](url) -> alt
		cleaned = cleaned.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1');

		// Remove reference-style links: [text][ref] -> text
		cleaned = cleaned.replace(/\[([^\]]+)\]\[[^\]]+\]/g, '$1');

		// Remove HTML tags but keep text content
		cleaned = cleaned.replace(/<[^>]+>/g, '');

		// Remove markdown code blocks but keep content
		cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
		cleaned = cleaned.replace(/`[^`]+`/g, '');

		// Remove markdown headers but keep text
		cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

		// Remove markdown emphasis but keep text
		cleaned = cleaned.replace(/\*\*([^\*]+)\*\*/g, '$1');
		cleaned = cleaned.replace(/\*([^\*]+)\*/g, '$1');
		cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
		cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

		// Remove markdown lists markers
		cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');
		cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

		// Clean up extra whitespace
		cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
		cleaned = cleaned.trim();

		return cleaned;
	}

	/**
	 * Validate chunks to ensure they're within bounds (but allow gaps)
	 * Gaps are acceptable as they may represent discarded metadata, links, etc.
	 */
	private validateChunks(chunks: Array<{ char_start: number; char_end: number }>, contentLength: number): Array<{ char_start: number; char_end: number }> {
		if (!chunks || chunks.length === 0) {
			return [];
		}

		// Validate and clamp chunks to content bounds, but preserve gaps
		const validated: Array<{ char_start: number; char_end: number }> = [];

		for (const chunk of chunks) {
			const start = Math.max(0, Math.min(chunk.char_start, contentLength));
			const end = Math.max(start, Math.min(chunk.char_end, contentLength));
			
			// Only add chunk if it has valid range
			if (start < end && start < contentLength) {
				validated.push({
					char_start: start,
					char_end: end
				});
			}
		}

		return validated;
	}

	/**
	 * Use qwen2.5:3b-instruct to chunk a long file into semantic chunks
	 */
	private async chunkFileWithQwen(content: string, filePath?: string): Promise<Array<{ char_start: number; char_end: number }>> {
		const address = this.settings.ollamaAddress || 'localhost';
		const port = this.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		const prompt = `You are a text chunking assistant. Divide the text below into chunks by providing character position ranges.

YOUR TASK: Read the text and determine where to split it. Return a JSON array where each element is an object with "char_start" and "char_end" properties showing the character positions of each chunk.

IMPORTANT: You are NOT extracting concepts, topics, keywords, or any other content. You are ONLY providing character position numbers that indicate where chunks begin and end in the original text.

REQUIREMENTS:
- Each chunk must be less than 7000 characters
- Make chunks as close to 7000 characters as possible while maintaining semantic boundaries
- You may skip irrelevant content like metadata, links, or other non-semantic text
- Chunks do not need to be contiguous - gaps are acceptable
- Return ONLY a JSON array - no explanations, no text before or after, no markdown code blocks

REQUIRED OUTPUT FORMAT:
[{"char_start": 0, "char_end": 5000}, {"char_start": 5200, "char_end": 10000}]

Each object must have:
- "char_start": a number (starting character position)
- "char_end": a number (ending character position)

Text to chunk (total length: ${content.length} characters):
${content}

Output ONLY the JSON array with char_start and char_end objects.`;

		console.log(`Sending qwen2.5:3b-instruct query for chunking${filePath ? ` (file: ${filePath})` : ''} (${content.length} characters)`);

		const controller = new AbortController();
		// Use longer timeout for chunking as large files can take time to analyze
		// Calculate timeout based on file size: base 60s + 1s per 1000 characters (max 180s)
		const timeoutMs = Math.min(60000 + Math.floor(content.length / 1000) * 1000, 180000);
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		const timeoutSeconds = Math.floor(timeoutMs / 1000);

		try {
			const response = await fetch(`${baseUrl}/api/generate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'qwen2.5:3b-instruct',
					prompt: prompt,
					stream: false
				}),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`qwen2.5:3b-instruct chunking query failed with status ${response.status}:`, errorText);
				throw new Error(`qwen2.5:3b-instruct API returned status ${response.status}: ${errorText}`);
			}

			const data = await response.json();
			const responseText = data.response || '';
			
			console.log(`qwen2.5:3b-instruct chunking response received (${responseText.length} characters):`, responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
			
			// Try to extract JSON from the response
			// First, try to find JSON array in the response (may be wrapped in text)
			let jsonMatch = responseText.match(/\[[\s\S]*\]/);
			
			// If no match, try to find JSON code blocks
			if (!jsonMatch) {
				const codeBlockMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
				if (codeBlockMatch) {
					jsonMatch = [codeBlockMatch[1]];
				}
			}
			
			if (jsonMatch) {
				try {
					const chunks = JSON.parse(jsonMatch[0]);
					if (Array.isArray(chunks) && chunks.every(c => c.char_start !== undefined && c.char_end !== undefined)) {
						console.log(`qwen2.5:3b-instruct returned valid chunks:`, chunks);
						// Validate chunks are within bounds (but don't force them to be contiguous)
						// Gaps are acceptable as they may represent discarded metadata, links, etc.
						return this.validateChunks(chunks, content.length);
					} else {
						console.error('qwen2.5:3b-instruct returned chunks but they do not match expected format:', chunks);
					}
				} catch (parseError) {
					console.error('Error parsing JSON from qwen2.5:3b-instruct response:', parseError);
					console.error('JSON match was:', jsonMatch[0]);
				}
			} else {
				console.error('qwen2.5:3b-instruct response does not contain a JSON array. Full response:', responseText);
			}
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`qwen2.5:3b-instruct chunking request timeout (${timeoutSeconds}s)`);
			} else {
				throw error;
			}
		}

		// If we get here, chunking failed - throw error to trigger retry
		throw new Error('qwen2.5:3b-instruct failed to return valid chunks. File will be retried.');
	}

	/**
	 * Generate embedding for text using nomic
	 */
	private async generateEmbeddingForText(text: string): Promise<number[] | null> {
		if (!this.settings.ollamaAvailable || !text || text.trim().length === 0) {
			return null;
		}

		const address = this.settings.ollamaAddress || 'localhost';
		const port = this.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		try {
			const response = await fetch(`${baseUrl}/api/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'nomic-embed-text:latest',
					prompt: text
				}),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				const data = await response.json();
				if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
					return data.embedding;
				}
			}
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				console.error('Error generating embedding: Request timeout (30s)');
			} else {
				console.error('Error generating embedding:', error);
			}
		}

		return null;
	}

	/**
	 * Load embeddings from JSON file
	 */
	private async loadEmbeddings(): Promise<NoteEmbedding[]> {
		const embeddingPath = this.getEmbeddingFilePath();
		try {
			const exists = await this.app.vault.adapter.exists(embeddingPath);
			if (!exists) {
				return [];
			}

			const content = await this.app.vault.adapter.read(embeddingPath);
			if (!content) {
				return [];
			}

			const embeddings = JSON.parse(content);
			return Array.isArray(embeddings) ? embeddings : [];
		} catch (error) {
			console.error('Error loading embeddings:', error);
			return [];
		}
	}

	/**
	 * Save embeddings to JSON file
	 */
	private async saveEmbeddings(embeddings: NoteEmbedding[]): Promise<void> {
		const embeddingPath = this.getEmbeddingFilePath();
		try {
			await this.app.vault.adapter.write(embeddingPath, JSON.stringify(embeddings, null, 2));
		} catch (error) {
			console.error('Error saving embeddings:', error);
			throw error;
		}
	}


	/**
	 * Generate a UUID
	 */
	private generateUUID(): string {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	/**
	 * Normalize file path for comparison (remove leading/trailing slashes, ensure consistency)
	 */
	private normalizePath(path: string): string {
		return path.replace(/^\/+|\/+$/g, ''); // Remove leading and trailing slashes
	}

	/**
	 * Calculate embedding progress
	 */
	public async getEmbeddingProgress(): Promise<{ total: number; embedded: number; percentage: number }> {
		if (!this.settings.similarityFolders) {
			return { total: 0, embedded: 0, percentage: 0 };
		}

		const folders = this.settings.similarityFolders
			.split(',')
			.map(f => f.trim())
			.filter(f => f.length > 0);

		// Collect all .md files in target folders
		const mdFiles: TFile[] = [];
		for (const folderPath of folders) {
			// Try both original and normalized path
			let folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				const normalizedPath = this.normalizePath(folderPath);
				if (normalizedPath !== folderPath) {
					folder = this.app.vault.getAbstractFileByPath(normalizedPath);
				}
			}
			if (folder) {
				this.collectMarkdownFiles(folder, mdFiles);
			} else {
				console.warn(`Folder not found in getEmbeddingProgress: "${folderPath}"`);
			}
		}

		const total = mdFiles.length;

		// Load embeddings and count embedded files
		const embeddings = await this.loadEmbeddings();
		// Normalize paths for comparison
		const embeddedPaths = new Set(embeddings.map(e => this.normalizePath(e.source_path)));
		const embedded = mdFiles.filter(f => embeddedPaths.has(this.normalizePath(f.path))).length;

		const percentage = total > 0 ? Math.round((embedded / total) * 100) : 0;

		return { total, embedded, percentage };
	}

	private async loadMarginaliaData() {
		try {
			const dataPath = this.getMarginaliaFilePath();
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
								}
								
								// Backwards compatibility: add color if missing
								if (!item.color) {
									item.color = this.settings.highlightColor;
									needsSave = true;
								}
								
								// Clean up: if no meaningful note text, always set embedding to null
								if (!this.hasMeaningfulText(item.note)) {
									// Always set to null if note text is not meaningful (even if field is undefined or has a value)
									item.embedding = null;
									needsSave = true;
								}
								
								// Clean up: if no meaningful selection text, always set selectionEmbedding to null
								if (!this.hasMeaningfulText(item.text)) {
									// Always set to null if text is not meaningful (even if field is undefined or has a value)
									item.selectionEmbedding = null;
									needsSave = true;
								}
							}
							// Only keep files that have items
							filesToKeep[filePath] = marginalia;
							this.marginaliaData.set(filePath, marginalia);
						} else {
							// File has no items or empty items array - mark for removal
							needsSave = true;
						}
					}
					
					// Update marginaliaData to only include files with items
					this.marginaliaData.clear();
					for (const [filePath, marginalia] of Object.entries(filesToKeep)) {
						this.marginaliaData.set(filePath, marginalia);
					}
					
					// Save if we added timestamps
					if (needsSave) {
						await this.saveMarginaliaData();
					}
				}
			}
		} catch (e) {
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
		const dataPath = this.getMarginaliaFilePath();
		
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

		// Set up timeout (10 seconds)
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000);

		try {
			const response = await fetch(`${baseUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				},
				signal: controller.signal
			});
			
			clearTimeout(timeoutId);

			if (response.ok) {
				const data = await response.json();
				const models = data.models || [];
				const modelNames = models.map((m: any) => m.name || m.model || '');

				// Check for required models
				let nomicAvailable = false;
				let qwenAvailable = false;

				// Check for nomic-embed-text
				const nomicFound = modelNames.some((name: string) => 
					name === 'nomic-embed-text:latest' || name.startsWith('nomic-embed-text')
				);
				if (nomicFound) {
					nomicAvailable = true;
				}

				// Check for qwen2.5:3b-instruct
				const qwenFound = modelNames.some((name: string) => 
					name === 'qwen2.5:3b-instruct' || name.startsWith('qwen2.5:3b-instruct') || name.startsWith('qwen2.5')
				);
				if (qwenFound) {
					qwenAvailable = true;
				}

				// Update individual statuses
				this.settings.ollamaServerStatus = 'available';
				this.settings.nomicModelStatus = nomicAvailable ? 'available' : 'unavailable';
				this.settings.qwenModelStatus = qwenAvailable ? 'available' : 'unavailable';
				
				// Update overall availability (only true if server is reachable AND both models are available)
				this.settings.ollamaAvailable = nomicAvailable && qwenAvailable;
			} else {
				this.settings.ollamaServerStatus = 'unavailable';
				this.settings.nomicModelStatus = 'unknown';
				this.settings.qwenModelStatus = 'unknown';
				this.settings.ollamaAvailable = false;
			}
		} catch (error: any) {
			clearTimeout(timeoutId);
			this.settings.ollamaServerStatus = 'unavailable';
			this.settings.nomicModelStatus = 'unknown';
			this.settings.qwenModelStatus = 'unknown';
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
	 * Summarize long text using qwen2.5:3b-instruct to fit within token limit
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
					model: 'qwen2.5:3b-instruct',
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
			console.error('Error calling qwen2.5:3b-instruct for summarization:', error);
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

		let timeoutId: NodeJS.Timeout | null = null;

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
				finalText = await this.summarizeText(textToEmbed);
			}

			// Generate embedding using nomic-embed-text
			// Ollama embeddings API uses "prompt" parameter
			const controller = new AbortController();
			timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

			const response = await fetch(`${baseUrl}/api/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'nomic-embed-text:latest',
					prompt: finalText
				}),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				const data = await response.json();
				// Ollama returns embedding in data.embedding array
				if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
					item.embedding = data.embedding;
				} else {
					console.error('Invalid embedding response format:', data);
				}
			} else {
				const errorText = await response.text();
				console.error('Error generating embedding:', response.status, errorText);
			}
		} catch (error) {
			if (timeoutId) clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				console.error('Error calling nomic-embed-text: Request timeout (30s)');
			} else {
				console.error('Error calling nomic-embed-text:', error);
			}
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

		let timeoutId: NodeJS.Timeout | null = null;

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
				finalText = await this.summarizeText(textToEmbed);
			}

			// Generate embedding using nomic-embed-text
			const controller = new AbortController();
			timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

			const response = await fetch(`${baseUrl}/api/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'nomic-embed-text:latest',
					prompt: finalText
				}),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				const data = await response.json();
				// Ollama returns embedding in data.embedding array
				if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
					item.selectionEmbedding = data.embedding;
				} else {
					console.error('Invalid embedding response format:', data);
				}
			} else {
				const errorText = await response.text();
				console.error('Error generating selection embedding:', response.status, errorText);
			}
		} catch (error) {
			if (timeoutId) clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				console.error('Error calling nomic-embed-text for selection: Request timeout (30s)');
			} else {
				console.error('Error calling nomic-embed-text for selection:', error);
			}
		}
	}

	/**
	 * Scan all marginalia and generate embeddings for any that don't have them
	 * Only runs if Ollama check has succeeded
	 */
	private async generateMissingEmbeddings(): Promise<void> {
		if (!this.settings.ollamaAvailable) {
			return;
		}

		let count = 0;
		let needsSave = false;

		for (const [filePath, data] of this.marginaliaData) {
			if (data && data.items) {
				for (const item of data.items) {
					// Only generate if there's meaningful note text and no embedding
					if (this.hasMeaningfulText(item.note) && 
						(!item.embedding || !Array.isArray(item.embedding) || item.embedding.length === 0)) {
						await this.generateEmbeddingForItem(item);
						count++;
						needsSave = true;
						
						// Small delay to avoid overwhelming the server
						await new Promise(resolve => setTimeout(resolve, 100));
					} else if (!this.hasMeaningfulText(item.note)) {
						// Clean up: if no meaningful note text, always set embedding to null
						item.embedding = null;
						needsSave = true;
					}
				}
			}
		}

		if (needsSave) {
			await this.saveMarginaliaData();
		}
	}

	/**
	 * Scan all marginalia and generate selection embeddings for any that have text but no selection embedding
	 * Only runs if Ollama check has succeeded
	 */
	private async generateMissingSelectionEmbeddings(): Promise<void> {
		if (!this.settings.ollamaAvailable) {
			return;
		}

		let count = 0;
		let needsSave = false;

		for (const [filePath, data] of this.marginaliaData) {
			if (data && data.items) {
				for (const item of data.items) {
					// Only generate if there's meaningful text and no selection embedding
					if (this.hasMeaningfulText(item.text) && 
						(!item.selectionEmbedding || !Array.isArray(item.selectionEmbedding) || item.selectionEmbedding.length === 0)) {
						await this.generateSelectionEmbeddingForItem(item);
						count++;
						needsSave = true;
						
						// Small delay to avoid overwhelming the server
						await new Promise(resolve => setTimeout(resolve, 100));
					} else if (!this.hasMeaningfulText(item.text)) {
						// Clean up: if no meaningful text, always set selectionEmbedding to null
						item.selectionEmbedding = null;
						needsSave = true;
					}
				}
			}
		}

		if (needsSave) {
			await this.saveMarginaliaData();
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

		let timeoutId: NodeJS.Timeout | null = null;

		try {
			// Check if text is too long (>2048 tokens)
			let finalText = combinedText;
			const tokenCount = this.estimateTokenCount(combinedText);
			
			if (tokenCount > 2048) {
				finalText = await this.summarizeText(combinedText);
			}

			// Generate embedding using nomic-embed-text
			const controller = new AbortController();
			timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

			const response = await fetch(`${baseUrl}/api/embeddings`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'nomic-embed-text:latest',
					prompt: finalText
				}),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				const data = await response.json();
				if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
					return data.embedding;
				}
			}
		} catch (error) {
			if (timeoutId) clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				console.error('Error generating combined embedding: Request timeout (30s)');
			} else {
				console.error('Error generating combined embedding:', error);
			}
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

	/**
	 * Find notes similar to marginalia by comparing marginalia embedding to note chunk embeddings
	 */
	public async findNotesSimilarToMarginalia(item: MarginaliaItem, filePath: string, threshold: number = 0.7): Promise<Array<{ filePath: string; similarity: number }>> {
		if (!item.embedding || item.embedding === null || !Array.isArray(item.embedding) || item.embedding.length === 0) {
			throw new Error('Item does not have a note embedding');
		}

		const noteEmbeddings = await this.loadEmbeddings();
		const results: Map<string, number> = new Map(); // Map of filePath -> best similarity
		const normalizedCurrentPath = this.normalizePath(filePath);

		for (const noteEmbedding of noteEmbeddings) {
			// Skip the current file if it's the same as the item's file
			if (this.normalizePath(noteEmbedding.source_path) === normalizedCurrentPath) {
				continue;
			}

			// Compare to each chunk in the note and find the best match
			let bestSimilarity = 0;
			for (const chunk of noteEmbedding.chunks) {
				if (chunk.vector && Array.isArray(chunk.vector) && chunk.vector.length > 0) {
					const similarity = this.cosineSimilarity(item.embedding, chunk.vector);
					if (similarity > bestSimilarity) {
						bestSimilarity = similarity;
					}
				}
			}

			// Add if above threshold
			if (bestSimilarity >= threshold) {
				const existingSimilarity = results.get(noteEmbedding.source_path);
				if (!existingSimilarity || bestSimilarity > existingSimilarity) {
					results.set(noteEmbedding.source_path, bestSimilarity);
				}
			}
		}

		// Convert to array and sort
		const resultArray: Array<{ filePath: string; similarity: number }> = [];
		for (const [filePath, similarity] of results.entries()) {
			resultArray.push({ filePath, similarity });
		}

		resultArray.sort((a, b) => b.similarity - a.similarity);
		return resultArray;
	}

	/**
	 * Find notes similar to selection by comparing selection embedding to note chunk embeddings
	 */
	public async findNotesSimilarToSelection(item: MarginaliaItem, filePath: string, threshold: number = 0.5): Promise<Array<{ filePath: string; similarity: number }>> {
		if (!item.selectionEmbedding || item.selectionEmbedding === null || !Array.isArray(item.selectionEmbedding) || item.selectionEmbedding.length === 0) {
			throw new Error('Item does not have a selection embedding');
		}

		const noteEmbeddings = await this.loadEmbeddings();
		const results: Map<string, number> = new Map(); // Map of filePath -> best similarity
		const normalizedCurrentPath = this.normalizePath(filePath);

		for (const noteEmbedding of noteEmbeddings) {
			// Skip the current file if it's the same as the item's file
			if (this.normalizePath(noteEmbedding.source_path) === normalizedCurrentPath) {
				continue;
			}

			// Compare to each chunk in the note and find the best match
			let bestSimilarity = 0;
			for (const chunk of noteEmbedding.chunks) {
				if (chunk.vector && Array.isArray(chunk.vector) && chunk.vector.length > 0) {
					const similarity = this.cosineSimilarity(item.selectionEmbedding, chunk.vector);
					if (similarity > bestSimilarity) {
						bestSimilarity = similarity;
					}
				}
			}

			// Add if above threshold
			if (bestSimilarity >= threshold) {
				const existingSimilarity = results.get(noteEmbedding.source_path);
				if (!existingSimilarity || bestSimilarity > existingSimilarity) {
					results.set(noteEmbedding.source_path, bestSimilarity);
				}
			}
		}

		// Convert to array and sort
		const resultArray: Array<{ filePath: string; similarity: number }> = [];
		for (const [filePath, similarity] of results.entries()) {
			resultArray.push({ filePath, similarity });
		}

		resultArray.sort((a, b) => b.similarity - a.similarity);
		return resultArray;
	}

	/**
	 * Find notes similar to combined (selection + marginalia) by comparing combined embedding to note chunk embeddings
	 */
	public async findNotesSimilarToCombined(item: MarginaliaItem, filePath: string, threshold: number = 0.5): Promise<Array<{ filePath: string; similarity: number }>> {
		// Generate combined embedding for the current item
		const noteText = item.note || '';
		const selectionText = item.text || '';
		
		if (!this.hasMeaningfulText(noteText) && !this.hasMeaningfulText(selectionText)) {
			throw new Error('Item needs at least a note or selection text to generate combined embedding');
		}

		const sourceEmbedding = await this.generateCombinedEmbedding(noteText, selectionText);
		if (!sourceEmbedding || sourceEmbedding.length === 0) {
			throw new Error('Failed to generate combined embedding');
		}

		const noteEmbeddings = await this.loadEmbeddings();
		const results: Map<string, number> = new Map(); // Map of filePath -> best similarity
		const normalizedCurrentPath = this.normalizePath(filePath);

		for (const noteEmbedding of noteEmbeddings) {
			// Skip the current file if it's the same as the item's file
			if (this.normalizePath(noteEmbedding.source_path) === normalizedCurrentPath) {
				continue;
			}

			// Compare to each chunk in the note and find the best match
			let bestSimilarity = 0;
			for (const chunk of noteEmbedding.chunks) {
				if (chunk.vector && Array.isArray(chunk.vector) && chunk.vector.length > 0) {
					const similarity = this.cosineSimilarity(sourceEmbedding, chunk.vector);
					if (similarity > bestSimilarity) {
						bestSimilarity = similarity;
					}
				}
			}

			// Add if above threshold
			if (bestSimilarity >= threshold) {
				const existingSimilarity = results.get(noteEmbedding.source_path);
				if (!existingSimilarity || bestSimilarity > existingSimilarity) {
					results.set(noteEmbedding.source_path, bestSimilarity);
				}
			}
		}

		// Convert to array and sort
		const resultArray: Array<{ filePath: string; similarity: number }> = [];
		for (const [filePath, similarity] of results.entries()) {
			resultArray.push({ filePath, similarity });
		}

		resultArray.sort((a, b) => b.similarity - a.similarity);
		return resultArray;
	}

	public getSidebarView(): MarginaliaView | null {
		return this.sidebarView;
	}

	public applySettings() {
		// Apply CSS variables for highlight color and transparency
		document.documentElement.style.setProperty('--marginalia-color', this.settings.highlightColor);
		document.documentElement.style.setProperty('--marginalia-opacity', this.settings.opacity.toString());
		
		// Calculate rgba color for highlights
		const rgb = this.hexToRgb(this.settings.highlightColor);
		if (rgb) {
			document.documentElement.style.setProperty(
				'--marginalia-highlight-bg',
				`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.settings.opacity})`
			);
			document.documentElement.style.setProperty(
				'--marginalia-highlight-border',
				`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.settings.opacity * 2})`
			);
			document.documentElement.style.setProperty(
				'--marginalia-highlight-hover',
				`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.settings.opacity + 0.2})`
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

	public isLightColor(hex: string): boolean {
		// Remove # if present
		hex = hex.replace('#', '');
		
		// Convert to RGB
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		
		// Calculate luminance
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		
		// Return true if light (luminance > 0.5)
		return luminance > 0.5;
	}

}


class MarginNoteModal extends Modal {
	private onSubmit: (note: string, color?: string) => void;
	private defaultColor: string;
	private selectedText: string;

	constructor(app: any, defaultColor: string, onSubmit: (note: string, color?: string) => void, selectedText?: string) {
		super(app);
		this.onSubmit = onSubmit;
		this.defaultColor = defaultColor;
		this.selectedText = selectedText || '';
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Add marginalia' });

		// Show selected text preview if available
		if (this.selectedText) {
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
				text: `Selected text: "${this.selectedText}"`,
				attr: { style: 'margin: 0; font-size: 0.9em; color: var(--text-muted);' }
			});
		}

		const input = contentEl.createEl('textarea', {
			attr: {
				placeholder: 'Enter your margin note...',
				rows: '5',
				maxlength: '7000'
			}
		});
		input.style.width = '100%';
		input.style.minHeight = '100px';

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

		const cancelButton = buttonContainer.createEl('button');
		cancelButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Cancel';
		cancelButton.onclick = () => this.close();

		const submitButton = buttonContainer.createEl('button');
		submitButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add marginalia';
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

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Marginalia Settings' });

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
						// Reset availability flags to force a new check
						this.plugin.settings.ollamaAvailable = false;
						this.plugin.settings.ollamaServerStatus = 'unknown';
						this.plugin.settings.nomicModelStatus = 'unknown';
						this.plugin.settings.qwenModelStatus = 'unknown';
						await this.plugin.saveData(this.plugin.settings);
						// Update status circles to show unknown state
						const ollamaCircle = (this as any).ollamaCircle as HTMLElement;
						const nomicCircle = (this as any).nomicCircle as HTMLElement;
						const qwenCircle = (this as any).qwenCircle as HTMLElement;
						if (ollamaCircle && nomicCircle && qwenCircle) {
							this.updateStatusCircles(ollamaCircle, nomicCircle, qwenCircle);
						}
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
						// Reset availability flags to force a new check
						this.plugin.settings.ollamaAvailable = false;
						this.plugin.settings.ollamaServerStatus = 'unknown';
						this.plugin.settings.nomicModelStatus = 'unknown';
						this.plugin.settings.qwenModelStatus = 'unknown';
						await this.plugin.saveData(this.plugin.settings);
						// Update status circles to show unknown state
						const ollamaCircle = (this as any).ollamaCircle as HTMLElement;
						const nomicCircle = (this as any).nomicCircle as HTMLElement;
						const qwenCircle = (this as any).qwenCircle as HTMLElement;
						if (ollamaCircle && nomicCircle && qwenCircle) {
							this.updateStatusCircles(ollamaCircle, nomicCircle, qwenCircle);
						}
					});
			});

		// Note about required models (below Port, above Check)
		const modelNote = containerEl.createDiv();
		modelNote.style.marginTop = '10px';
		modelNote.style.marginBottom = '20px';
		modelNote.style.padding = '10px';
		modelNote.style.backgroundColor = 'var(--background-secondary)';
		modelNote.style.borderRadius = '4px';
		modelNote.style.fontSize = '0.9em';
		modelNote.style.color = 'var(--text-muted)';
		modelNote.innerHTML = '<strong>Required Models:</strong> The following models must be installed in Ollama for AI features to work:<br>' +
			'• <code>nomic-embed-text:latest</code> - For generating embeddings<br>' +
			'• <code>qwen2.5:3b-instruct</code> - For summarization and title generation';

		// Check Ollama Status
		const checkOllamaSetting = new Setting(containerEl)
			.setName('Check Ollama Status')
			.setDesc('Verify that Ollama server is running and required models are available. The three status indicators below will turn green when all systems are "Go".')
			.addButton(button => {
				button
					.setButtonText('Check Ollama')
					.setCta()
					.onClick(async () => {
						await this.checkOllama();
					});
			});

		// Status display area with three circles (below the setting, not inside controlEl)
		const statusDiv = containerEl.createDiv('ollama-status');
		statusDiv.style.marginTop = '10px';
		statusDiv.style.marginBottom = '20px';
		statusDiv.style.padding = '10px';
		statusDiv.style.backgroundColor = 'var(--background-secondary)';
		statusDiv.style.borderRadius = '4px';
		statusDiv.style.display = 'flex';
		statusDiv.style.gap = '15px';
		statusDiv.style.alignItems = 'center';
		statusDiv.style.justifyContent = 'center';

		// Create three status circles
		const ollamaCircle = statusDiv.createDiv('ollama-status-circle');
		const nomicCircle = statusDiv.createDiv('ollama-status-circle');
		const qwenCircle = statusDiv.createDiv('ollama-status-circle');

		// Style circles
		[ollamaCircle, nomicCircle, qwenCircle].forEach(circle => {
			circle.style.width = '20px';
			circle.style.height = '20px';
			circle.style.borderRadius = '50%';
			circle.style.border = '2px solid var(--background-modifier-border)';
			circle.style.backgroundColor = 'var(--background-modifier-border)';
			circle.style.cursor = 'help';
		});

		// Set initial tooltips and colors based on last saved status
		this.updateStatusCircles(ollamaCircle, nomicCircle, qwenCircle);

		// Store references for updates
		(this as any).statusDiv = statusDiv;
		(this as any).ollamaCircle = ollamaCircle;
		(this as any).nomicCircle = nomicCircle;
		(this as any).qwenCircle = qwenCircle;

		// Semantic Similarity Sub-section
		containerEl.createEl('h4', { text: 'Semantic Similarity' });
		
		// Note about semantic similarity
		const similarityNote = containerEl.createDiv();
		similarityNote.style.marginBottom = '15px';
		similarityNote.style.padding = '10px';
		similarityNote.style.backgroundColor = 'var(--background-secondary)';
		similarityNote.style.borderRadius = '4px';
		similarityNote.style.fontSize = '0.9em';
		similarityNote.style.color = 'var(--text-muted)';
		similarityNote.innerHTML = 'Marginalia uses AI-powered semantic similarity analysis to help surface similar notes, marginalia, and selections. Note that these features will be limited until embedding, below, is 100% complete. Leave embedding active to continue to watch for new files and changes in the specified folders in your vault.';
		
		// Similarity Threshold Slider
		new Setting(containerEl)
			.setName('Similarity Threshold')
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
						} catch (error) {
							console.error('Error saving settings:', error);
						}
					});
			});

		// Folders to Include in Similarity Analysis
		new Setting(containerEl)
			.setName('Folders to Include')
			.setDesc('Comma-separated list of folders to include in similarity analysis. Only .md files will be used.')
			.addText(text => {
				text
					.setPlaceholder('folder1, folder2/subfolder')
					.setValue(this.plugin.settings.similarityFolders || '')
					.onChange(async (value) => {
						this.plugin.settings.similarityFolders = value;
						try {
							await this.plugin.saveData(this.plugin.settings);
						} catch (error) {
							console.error('Error saving settings:', error);
							new Notice('Error saving folder settings');
						}
					});
			});

		// Embedding Toggle Button
		const embeddingSetting = new Setting(containerEl)
			.setName('Note Embedding')
			.setDesc('Loading progress...')
			.addButton(button => {
				button
					.setButtonText(this.plugin.settings.embeddingOn ? 'Pause Embedding' : 'Activate Note Embedding')
					.setCta()
					.onClick(async () => {
						// Toggle the embedding state
						const wasOff = !this.plugin.settings.embeddingOn;
						this.plugin.settings.embeddingOn = !this.plugin.settings.embeddingOn;
						
						try {
							await this.plugin.saveData(this.plugin.settings);
							
							// If embedding was just turned off, clear the queue
							if (!wasOff && !this.plugin.settings.embeddingOn) {
								this.plugin.clearEmbeddingQueue();
							}
							
							// If embedding was just turned on, initialize the embedding file and start monitoring
							if (wasOff && this.plugin.settings.embeddingOn) {
								try {
									await this.plugin.initializeEmbeddingFile();
									// Start monitoring immediately
									this.plugin.startEmbeddingMonitor();
								} catch (error) {
									console.error('Error initializing embedding file:', error);
									new Notice('Error initializing embedding file');
									// Revert the toggle if file creation failed
									this.plugin.settings.embeddingOn = false;
									await this.plugin.saveData(this.plugin.settings);
									return;
								}
							}
							
							// Update button text and description
							button.setButtonText(this.plugin.settings.embeddingOn ? 'Pause Embedding' : 'Activate Note Embedding');
							await this.updateEmbeddingProgress(embeddingSetting);
							new Notice(this.plugin.settings.embeddingOn 
								? 'Note embedding activated' 
								: 'Note embedding paused');
						} catch (error) {
							console.error('Error saving settings:', error);
							new Notice('Error saving embedding state');
						}
					});
			});

		// Update embedding progress display on initial load (await to ensure it completes)
		await this.updateEmbeddingProgress(embeddingSetting);
		
		// Register callback with plugin to update progress after files are embedded
		this.plugin.embeddingProgressCallback = () => {
			this.updateEmbeddingProgress(embeddingSetting);
		};

		// Highlight Color Picker
		containerEl.createEl('h3', { text: 'Appearance' });

		new Setting(containerEl)
			.setName('Default Highlight Color')
			.setDesc('Default color for marginalia highlights. Individual marginalia can override this with their own color.')
			.addColorPicker(colorPicker => {
				// Ensure we have a valid color value
				const currentColor = this.plugin.settings.highlightColor || DEFAULT_SETTINGS.highlightColor;
				colorPicker.setValue(currentColor);
				colorPicker.onChange(async (value) => {
					this.plugin.settings.highlightColor = value;
					try {
						await this.plugin.saveData(this.plugin.settings);
					} catch (error) {
						console.error('Error saving settings:', error);
						new Notice('Error saving color setting');
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

		// Highlight Opacity Slider
		new Setting(containerEl)
			.setName('Highlight Opacity')
			.setDesc(`Adjust the opacity of highlights (${Math.round((typeof this.plugin.settings.opacity === 'number' ? this.plugin.settings.opacity : DEFAULT_SETTINGS.opacity) * 100)}%)`)
			.addSlider(slider => {
				// Ensure we have a valid opacity value
				const currentOpacity = typeof this.plugin.settings.opacity === 'number' 
					? this.plugin.settings.opacity 
					: DEFAULT_SETTINGS.opacity;
				slider
					.setLimits(0.1, 1, 0.05)
					.setValue(currentOpacity)
					.setDynamicTooltip()
					.onChange(async (value) => {
						// Update the setting immediately
						this.plugin.settings.opacity = value;
						// Save to JSON immediately
						try {
							await this.plugin.saveData(this.plugin.settings);
						} catch (error) {
							console.error('Error saving settings:', error);
							new Notice('Error saving opacity setting');
						}
						// Apply the new opacity
						this.plugin.applySettings();
						// Refresh editor to apply new opacity
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
			.setName('Indicator Visibility (Edit Mode)')
			.setDesc('Control visibility of highlights and pen icons in edit mode')
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

		// Pen Icon Position Setting (under Appearance)
		new Setting(containerEl)
			.setName('Pen Icon Position (Edit Mode)')
			.setDesc('Choose whether the pen icon appears in the left or right margin in edit mode')
			.addDropdown(dropdown => {
				dropdown
					.addOption('right', 'Right Margin')
					.addOption('left', 'Left Margin')
					.setValue(this.plugin.settings.penIconPosition || 'right')
					.onChange(async (value: 'left' | 'right') => {
						this.plugin.settings.penIconPosition = value;
						await this.plugin.saveData(this.plugin.settings);
						// Refresh all editors
						this.plugin.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
							const view = leaf.view as MarkdownView;
							if (view.file) {
								this.plugin.refreshEditor(view.file.path);
							}
						});
						// Refresh reading view
						this.plugin.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
							const view = leaf.view as MarkdownView;
							if (view.file) {
							}
						});
					});
			});


	}


	private async checkOllama() {
		const statusDiv = (this as any).statusDiv as HTMLElement;
		const ollamaCircle = (this as any).ollamaCircle as HTMLElement;
		const nomicCircle = (this as any).nomicCircle as HTMLElement;
		const qwenCircle = (this as any).qwenCircle as HTMLElement;
		
		if (!statusDiv || !ollamaCircle || !nomicCircle || !qwenCircle) return;

		const address = this.plugin.settings.ollamaAddress || 'localhost';
		const port = this.plugin.settings.ollamaPort || '11434';
		const baseUrl = `http://${address}:${port}`;

		// Set circles to gray (checking)
		[ollamaCircle, nomicCircle, qwenCircle].forEach(circle => {
			circle.style.backgroundColor = 'var(--background-modifier-border)';
			circle.style.borderColor = 'var(--background-modifier-border)';
		});
		ollamaCircle.title = 'Ollama server: Checking...';
		nomicCircle.title = 'nomic-embed-text: Checking...';
		qwenCircle.title = 'qwen2.5:3b-instruct: Checking...';

		let ollamaAvailable = false;
		let nomicAvailable = false;
		let qwenAvailable = false;

		// Set up timeout (10 seconds)
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000);

		try {
			// Check if server is reachable
			const response = await fetch(`${baseUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				},
				signal: controller.signal
			});
			
			clearTimeout(timeoutId);

			if (!response.ok) {
				// Ollama server not available
				ollamaCircle.style.backgroundColor = '#ef4444'; // red
				ollamaCircle.style.borderColor = '#ef4444';
				ollamaCircle.title = `Ollama server: Connection failed (${response.status} ${response.statusText})`;
				
				nomicCircle.style.backgroundColor = 'var(--background-modifier-border)';
				nomicCircle.style.borderColor = 'var(--background-modifier-border)';
				nomicCircle.title = 'nomic-embed-text: Cannot check (server unavailable)';
				
				qwenCircle.style.backgroundColor = 'var(--background-modifier-border)';
				qwenCircle.style.borderColor = 'var(--background-modifier-border)';
				qwenCircle.title = 'qwen2.5:3b-instruct: Cannot check (server unavailable)';
				
				this.plugin.settings.ollamaAvailable = false;
			} else {
				// Ollama server is available
				ollamaAvailable = true;
				ollamaCircle.style.backgroundColor = '#22c55e'; // green
				ollamaCircle.style.borderColor = '#22c55e';
				ollamaCircle.title = 'Ollama server: Connected successfully';

				const data = await response.json();
				const models = data.models || [];
				const modelNames = models.map((m: any) => m.name || m.model || '');

				// Check for nomic-embed-text
				const nomicFound = modelNames.some((name: string) => 
					name === 'nomic-embed-text:latest' || name.startsWith('nomic-embed-text')
				);
				if (nomicFound) {
					nomicAvailable = true;
					nomicCircle.style.backgroundColor = '#22c55e'; // green
					nomicCircle.style.borderColor = '#22c55e';
					nomicCircle.title = 'nomic-embed-text: Available';
				} else {
					nomicCircle.style.backgroundColor = '#ef4444'; // red
					nomicCircle.style.borderColor = '#ef4444';
					nomicCircle.title = 'nomic-embed-text: Not found';
				}

				// Check for qwen2.5:3b-instruct
				const qwenFound = modelNames.some((name: string) => 
					name === 'qwen2.5:3b-instruct' || name.startsWith('qwen2.5:3b-instruct') || name.startsWith('qwen2.5')
				);
				if (qwenFound) {
					qwenAvailable = true;
					qwenCircle.style.backgroundColor = '#22c55e'; // green
					qwenCircle.style.borderColor = '#22c55e';
					qwenCircle.title = 'qwen2.5:3b-instruct: Available';
				} else {
					qwenCircle.style.backgroundColor = '#ef4444'; // red
					qwenCircle.style.borderColor = '#ef4444';
					qwenCircle.title = 'qwen2.5:3b-instruct: Not found';
				}

				// Update overall availability
				this.plugin.settings.ollamaAvailable = ollamaAvailable && nomicAvailable && qwenAvailable;
			}
			
			// Save the availability state
			await this.plugin.saveData(this.plugin.settings);
		} catch (error: any) {
			clearTimeout(timeoutId);
			// Connection error or timeout
			const errorMessage = error.name === 'AbortError' ? 'Connection timeout (10 seconds)' : (error.message || 'Network error');
			ollamaCircle.style.backgroundColor = '#ef4444'; // red
			ollamaCircle.style.borderColor = '#ef4444';
			ollamaCircle.title = `Ollama server: Connection failed (${errorMessage})`;
			
			nomicCircle.style.backgroundColor = 'var(--background-modifier-border)';
			nomicCircle.style.borderColor = 'var(--background-modifier-border)';
			nomicCircle.title = 'nomic-embed-text: Cannot check (server unavailable)';
			
			qwenCircle.style.backgroundColor = 'var(--background-modifier-border)';
			qwenCircle.style.borderColor = 'var(--background-modifier-border)';
			qwenCircle.title = 'qwen2.5:3b-instruct: Cannot check (server unavailable)';
			
			// Update individual statuses
			this.plugin.settings.ollamaServerStatus = 'unavailable';
			this.plugin.settings.nomicModelStatus = 'unknown';
			this.plugin.settings.qwenModelStatus = 'unknown';
			this.plugin.settings.ollamaAvailable = false;
			await this.plugin.saveData(this.plugin.settings);
		}
	}

	/**
	 * Update status circles based on saved status
	 */
	private updateStatusCircles(ollamaCircle: HTMLElement, nomicCircle: HTMLElement, qwenCircle: HTMLElement): void {
		// Update Ollama server circle
		if (this.plugin.settings.ollamaServerStatus === 'available') {
			ollamaCircle.style.backgroundColor = '#22c55e'; // green
			ollamaCircle.style.borderColor = '#22c55e';
			ollamaCircle.title = 'Ollama server: Connected successfully';
		} else if (this.plugin.settings.ollamaServerStatus === 'unavailable') {
			ollamaCircle.style.backgroundColor = '#ef4444'; // red
			ollamaCircle.style.borderColor = '#ef4444';
			ollamaCircle.title = 'Ollama server: Connection failed';
		} else {
			ollamaCircle.style.backgroundColor = 'var(--background-modifier-border)';
			ollamaCircle.style.borderColor = 'var(--background-modifier-border)';
			ollamaCircle.title = 'Ollama server: Not checked';
		}

		// Update nomic-embed-text circle
		if (this.plugin.settings.nomicModelStatus === 'available') {
			nomicCircle.style.backgroundColor = '#22c55e'; // green
			nomicCircle.style.borderColor = '#22c55e';
			nomicCircle.title = 'nomic-embed-text: Available';
		} else if (this.plugin.settings.nomicModelStatus === 'unavailable') {
			nomicCircle.style.backgroundColor = '#ef4444'; // red
			nomicCircle.style.borderColor = '#ef4444';
			nomicCircle.title = 'nomic-embed-text: Not found';
		} else {
			nomicCircle.style.backgroundColor = 'var(--background-modifier-border)';
			nomicCircle.style.borderColor = 'var(--background-modifier-border)';
			nomicCircle.title = 'nomic-embed-text: Not checked';
		}

		// Update qwen2.5:3b-instruct circle
		if (this.plugin.settings.qwenModelStatus === 'available') {
			qwenCircle.style.backgroundColor = '#22c55e'; // green
			qwenCircle.style.borderColor = '#22c55e';
			qwenCircle.title = 'qwen2.5:3b-instruct: Available';
		} else if (this.plugin.settings.qwenModelStatus === 'unavailable') {
			qwenCircle.style.backgroundColor = '#ef4444'; // red
			qwenCircle.style.borderColor = '#ef4444';
			qwenCircle.title = 'qwen2.5:3b-instruct: Not found';
		} else {
			qwenCircle.style.backgroundColor = 'var(--background-modifier-border)';
			qwenCircle.style.borderColor = 'var(--background-modifier-border)';
			qwenCircle.title = 'qwen2.5:3b-instruct: Not checked';
		}
	}

	/**
	 * Update embedding progress display
	 */
	private async updateEmbeddingProgress(embeddingSetting: Setting): Promise<void> {
		try {
			const progress = await this.plugin.getEmbeddingProgress();
			const remaining = progress.total - progress.embedded;
			
			let descText = '';
			if (this.plugin.settings.embeddingOn) {
				descText = `Note embedding is active. Click to pause.`;
			} else {
				descText = `Note embedding is paused. Click to activate.`;
			}
			
			if (progress.total > 0) {
				descText += ` Progress: ${progress.percentage}% (${progress.embedded}/${progress.total} embedded, ${remaining} remaining)`;
			} else if (this.plugin.settings.similarityFolders) {
				descText += ` No .md files found in specified folders.`;
			} else {
				descText += ` No folders specified for similarity analysis.`;
			}
			
			// Add note about embedding process
			if (this.plugin.settings.embeddingOn && progress.total > 0 && remaining > 0) {
				descText += ` Note: Not all AI functions will be available and the system may slow until embedding is complete. This process takes longest the very first time and may need to think about (and appear to pause on) bigger notes.`;
			}
			
			embeddingSetting.setDesc(descText);
		} catch (error) {
			console.error('Error updating embedding progress:', error);
			embeddingSetting.setDesc(this.plugin.settings.embeddingOn 
				? 'Note embedding is active. Click to pause.' 
				: 'Note embedding is paused. Click to activate.');
		}
	}

	onClose(): void {
		// Clear embedding progress callback when settings tab closes
		this.plugin.embeddingProgressCallback = null;
	}
}
