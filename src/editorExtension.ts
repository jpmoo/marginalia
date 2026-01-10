import { MarkdownView } from 'obsidian';
import { EditorView, Decoration, ViewPlugin, ViewUpdate, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import type MarginaliaPlugin from '../main';
import { MarginaliaItem } from './types';

// Helper function to convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : null;
}

const addMarginaliaEffect = StateEffect.define<MarginaliaItem[]>();
const clearMarginaliaEffect = StateEffect.define();

class MarginaliaIconWidget extends WidgetType {
	constructor(
		private note: string, 
		private id: string,
		private plugin: MarginaliaPlugin,
		private filePath: string,
		private item: MarginaliaItem,
		private verticalOffset: number = 0 // Offset for stacking multiple icons
	) {
		super();
	}

	toDOM() {
		const span = document.createElement('span');
		span.className = 'marginalia-icon';
		span.setAttribute('data-marginalia-id', this.id);
		span.setAttribute('data-note', this.note);
		span.innerHTML = '✎'; // Quill/pen icon
		span.title = 'Click to edit marginalia note';
		span.style.position = 'absolute';
		// Use pen icon position setting
		const penPosition = this.plugin.settings?.penIconPosition || 'right';
		if (penPosition === 'left') {
			span.style.left = '0';
			span.style.right = 'auto';
		} else {
			span.style.right = '0';
			span.style.left = 'auto';
		}
		// Stack vertically if multiple icons on same line
		// Use margin-top to push icons down when stacked
		if (this.verticalOffset > 0) {
			span.style.marginTop = `${this.verticalOffset * 24}px`; // 24px spacing between icons
		}
		span.style.cursor = 'pointer';
		
		// Use item color or default from settings
		const highlightColor = this.item.color || this.plugin.settings?.highlightColor || '#ffeb3d';
		
		// Determine if color is light or dark
		const isLight = this.isLightColor(highlightColor);
		
		// Set background color and icon color
		span.style.backgroundColor = highlightColor;
		span.style.color = isLight ? '#000000' : '#ffffff';
		
		// Add click handler to open edit modal
		span.onclick = (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.openEditModal();
		};
		
		// Also handle mousedown to ensure it works on first click
		span.onmousedown = (e) => {
			e.stopPropagation();
		};
		
		return span;
	}

	private openEditModal() {
		// Use the plugin's method to open the edit modal
		this.plugin.showEditModal(this.item, this.filePath);
	}

	private isLightColor(hex: string): boolean {
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

	ignoreEvent() {
		return true; // Return true to prevent CodeMirror from handling the event, allowing our click handler to work
	}
}

function marginaliaField(plugin: MarginaliaPlugin) {
	return StateField.define<DecorationSet>({
		create() {
			return Decoration.none;
		},
		update(decorations, tr) {
			decorations = decorations.map(tr.changes);

			for (const effect of tr.effects) {
				if (effect.is(addMarginaliaEffect)) {
					const items = effect.value;
					// Clear existing decorations first
					decorations = Decoration.none;
					
					// If no items, return empty decorations
					if (!items || items.length === 0) {
						return decorations;
					}
					const marks: any[] = [];
					
					// Get file path from plugin's active file
					let filePath: string | null = null;
					try {
						const app = (plugin as any).app;
						if (app && app.workspace) {
							const activeFile = app.workspace.getActiveFile();
							if (activeFile) {
								filePath = activeFile.path;
							}
						}
					} catch (e) {
						// Ignore errors
					}
					
					// CRITICAL: Editor extension ALWAYS sorts by document position (line, then character)
					// This is completely independent of sidebar sort order setting
					// Sidebar sort (position/date-asc/date-desc) only affects the sidebar display
					// Editor decorations are always in document order for proper CodeMirror rendering
					const sortedItems = [...items].sort((a, b) => {
						if (a.from.line !== b.from.line) {
							return a.from.line - b.from.line;
						}
						return a.from.ch - b.from.ch;
					});
					
					// Create marks with their positions for sorting
					// We'll collect all decoration info first, then create and sort them
					const decorationInfo: Array<{ 
						from: number; 
						to?: number; 
						side: number; 
						type: 'mark' | 'widget' | 'line';
						item: MarginaliaItem;
						config: any;
					}> = [];
					
					// Track widgets by line number to stack them vertically
					const widgetPositions = new Map<number, number>(); // line number -> count
					
					// Calculate offset for leading blank lines
					// Obsidian's editor line numbers exclude leading blank lines, but CodeMirror includes them
					let leadingBlankLinesOffset = 0;
					try {
						// Count leading blank lines in CodeMirror document
						for (let i = 1; i <= tr.state.doc.lines; i++) {
							const line = tr.state.doc.line(i);
							if (line.text.trim().length === 0) {
								leadingBlankLinesOffset++;
							} else {
								// Stop at first non-blank line
								break;
							}
						}
					} catch (e) {
						// If we can't determine, assume no offset
						leadingBlankLinesOffset = 0;
					}
					
					for (const item of sortedItems) {
						try {
							// CodeMirror lines are 1-indexed, Obsidian stores 0-indexed
							// Obsidian's editor line numbers exclude leading blank lines, so add offset
							// Convert 0-indexed to 1-indexed, then add leading blank lines offset
							const fromLineNum = item.from.line + 1 + leadingBlankLinesOffset;
							const toLineNum = item.to.line + 1 + leadingBlankLinesOffset;
							
							// Get line objects - ensure line numbers are valid
							if (fromLineNum < 1 || fromLineNum > tr.state.doc.lines) continue;
							if (toLineNum < 1 || toLineNum > tr.state.doc.lines) continue;
							
							const fromLine = tr.state.doc.line(fromLineNum);
							const toLine = tr.state.doc.line(toLineNum);
							
							// Calculate absolute positions
							// fromLine.from is the start of the line, add character offset
							// Clamp character position to line length to avoid out-of-bounds
							const from = fromLine.from + Math.min(item.from.ch, fromLine.length);
							const to = toLine.from + Math.min(item.to.ch, toLine.length);
							
							
							// Get visibility setting
							const visibility = plugin.settings?.indicatorVisibility || 'both';
							const showHighlight = visibility === 'highlight' || visibility === 'both';
							const showPen = visibility === 'pen' || visibility === 'both';
							
							// Check if there's actual text selected (more than just a cursor position)
							// A cursor-only note has from === to or empty text
							const hasSelection = from < to && 
								(item.from.line !== item.to.line || item.from.ch !== item.to.ch) &&
								item.text && item.text.trim().length > 0;
							
							if (hasSelection && from >= 0 && to <= tr.state.doc.length) {
								// For selected text
								if (showHighlight) {
									// Use item color or default
									const itemColor = item.color || plugin.settings?.highlightColor || '#ffeb3d';
									const itemOpacity = plugin.settings?.opacity || 0.5;
									const rgb = hexToRgb(itemColor);
									const rgbaColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${itemOpacity})` : itemColor;
									
									decorationInfo.push({
										from,
										to,
										side: 0,
										type: 'mark',
										item,
										config: {
											class: 'marginalia-highlight',
											attributes: {
												'data-marginalia-id': item.id,
												'data-note': item.note,
												style: `background-color: ${rgbaColor};`
											}
										}
									});
								}
								
								// Add icon widget at the start of the highlight (top of multi-line selections)
								if (showPen && filePath) {
									// CRITICAL: Position widget 1 character after mark start to avoid sorting conflicts
									// Since startSide isn't being set correctly, we need different positions
									// This ensures mark (from=X) comes before widget (from=X+1) in sort order
									const widgetPos = Math.min(from + 1, to); // Position after mark start, but before mark end
									const penPosition = plugin.settings?.penIconPosition || 'right';
									
									// Track stacking by line number (more reliable than position)
									const widgetLine = tr.state.doc.lineAt(widgetPos).number;
									const currentCount = widgetPositions.get(widgetLine) || 0;
									widgetPositions.set(widgetLine, currentCount + 1);
									
									decorationInfo.push({
										from: widgetPos,
										side: penPosition === 'left' ? -1 : 1, // -1 for left margin, 1 for right margin
										type: 'widget',
										item,
										config: {
											widget: new MarginaliaIconWidget(item.note, item.id, plugin, filePath, item, currentCount)
										}
									});
								}
							} else {
								// For cursor position (no selection) - from === to or empty text
								// CodeMirror lines are 1-indexed, Obsidian stores 0-indexed
								const lineNum = item.from.line + 1;
								if (lineNum < 1 || lineNum > tr.state.doc.lines) continue;
								const line = tr.state.doc.line(lineNum);
								const lineEnd = line.to;
								const highlightFrom = from;
								const highlightTo = from < lineEnd ? from + 1 : lineEnd;
								
								// Use item color or default
								const itemColor = item.color || plugin.settings?.highlightColor || '#ffeb3d';
								const itemOpacity = plugin.settings?.opacity || 0.5;
								const rgb = hexToRgb(itemColor);
								const rgbaColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${itemOpacity})` : itemColor;
								
								if (showHighlight && highlightFrom < highlightTo) {
									// Add a subtle highlight for cursor positions
									decorationInfo.push({
										from: highlightFrom,
										to: highlightTo,
										side: 0,
										type: 'mark',
										item,
										config: {
											class: 'marginalia-highlight-cursor',
											attributes: {
												'data-marginalia-id': item.id,
												'data-note': item.note,
												style: `background-color: ${rgbaColor};`
											}
										}
									});
								} else if (!showHighlight) {
									// If highlight is off, add a vertical line indicator (use item color)
									decorationInfo.push({
										from: line.from,
										side: 0,
										type: 'line',
										item,
										config: {
											class: 'marginalia-line-indicator',
											attributes: {
												'data-marginalia-id': item.id,
												'data-note': item.note,
												style: `border-left-color: ${itemColor};`
											}
										}
									});
								}
								
								// Add icon widget in right margin
								if (showPen && filePath) {
									// For cursor position, widget must be AFTER any highlight/line indicator
									const line = tr.state.doc.line(item.from.line + 1);
									let widgetPos: number;
									if (showHighlight && highlightFrom < highlightTo) {
										// Widget after highlight ends (highlightTo is the end position)
										widgetPos = highlightTo;
									} else if (!showHighlight) {
										// Widget after line indicator (line.from is the start of the line)
										// Place at line.from + 1 to be after the line indicator
										widgetPos = line.from + 1;
									} else {
										// No highlight/indicator, place at cursor + 1 to ensure it's after
										widgetPos = from + 1;
									}
									// Ensure widget is within line bounds
									// Position widget 1 character after the highlight/cursor to avoid sorting conflicts
									const basePos = showHighlight && highlightFrom < highlightTo ? highlightTo : widgetPos;
									const finalWidgetPos = Math.min(basePos + 1, line.to);
									const penPosition = plugin.settings?.penIconPosition || 'right';
									
									// Track stacking by line number
									const widgetLine = line.number;
									const currentCount = widgetPositions.get(widgetLine) || 0;
									widgetPositions.set(widgetLine, currentCount + 1);
									
									decorationInfo.push({
										from: finalWidgetPos,
										side: penPosition === 'left' ? -1 : 1, // -1 for left margin, 1 for right margin
										type: 'widget',
										item,
										config: {
											widget: new MarginaliaIconWidget(item.note, item.id, plugin, filePath, item, currentCount)
										}
									});
								}
							}
						} catch (e) {
							// Line might not exist, skip this item
							// Error adding marginalia decoration - item may be invalid
						}
					}
					
					if (decorationInfo.length > 0) {
						// CRITICAL: CodeMirror requires ranges sorted by from position, then by startSide
						// Sort decoration info carefully - this is the ONLY place we sort
						decorationInfo.sort((a, b) => {
							// Primary sort: by from position (ascending)
							const fromDiff = a.from - b.from;
							if (fromDiff !== 0) {
								return fromDiff;
							}
							// Secondary sort: by side (startSide)
							// side: -1 (left) < 0 (inline/mark) < 1 (right)
							// This ensures marks (0) come before widgets (1) at the same position
							return a.side - b.side;
						});
						
						
						// Create ranges in sorted order
						const ranges: any[] = [];
						for (const info of decorationInfo) {
							try {
								if (info.type === 'mark' && info.to !== undefined) {
									// Ensure valid range
									if (info.from < info.to && info.from >= 0 && info.to <= tr.state.doc.length) {
										try {
											const mark = Decoration.mark(info.config);
											const range = mark.range(info.from, info.to);
											ranges.push(range);
										} catch (e) {
											console.error('Error creating mark decoration:', e, info);
										}
									}
								} else if (info.type === 'widget') {
									// Ensure valid position
									if (info.from >= 0 && info.from <= tr.state.doc.length) {
										try {
											// Create widget decoration with side property
											// CodeMirror 6: side must be -1 (left), 0 (inline), or 1 (right)
											const widget = Decoration.widget({
												widget: info.config.widget,
												side: info.side // -1 for left, 1 for right
											});
											const range = widget.range(info.from);
											ranges.push(range);
										} catch (e) {
											console.error('Error creating widget decoration:', e, info);
										}
									}
								} else if (info.type === 'line') {
									// Ensure valid position
									if (info.from >= 0 && info.from <= tr.state.doc.length) {
										const lineMark = Decoration.line(info.config);
										const range = lineMark.range(info.from);
										ranges.push(range);
									}
								}
							} catch (e) {
								console.error('Error creating decoration range:', e, info);
							}
						}
						
						// Final sort of ranges by their actual from and startSide properties
						// This ensures CodeMirror's strict requirements are met
						// CRITICAL: CodeMirror requires ranges sorted by from, then by startSide
						// We need to sort BEFORE creating ranges, but also after to ensure startSide is set
						ranges.sort((a: any, b: any) => {
							const aFrom = a.from ?? 0;
							const bFrom = b.from ?? 0;
							if (aFrom !== bFrom) {
								return aFrom - bFrom;
							}
							// If from positions are equal, sort by startSide
							// Marks (side 0, startSide undefined or 0) should come before widgets (side 1, startSide 1)
							const aSide = a.startSide !== undefined ? a.startSide : 0;
							const bSide = b.startSide !== undefined ? b.startSide : 0;
							return aSide - bSide;
						});
						
						// Pass to Decoration.set - ranges MUST be in sorted order
						if (ranges.length > 0) {
							try {
								decorations = Decoration.set(ranges);
							} catch (e: any) {
								// Silently fail - decorations won't show but won't crash the editor
								decorations = Decoration.none;
							}
						}
					}
				} else if (effect.is(clearMarginaliaEffect)) {
					decorations = Decoration.none;
				}
			}

			return decorations;
		},
		provide: f => EditorView.decorations.from(f)
	});
}

function marginaliaHoverPlugin(plugin: MarginaliaPlugin) {
	return ViewPlugin.fromClass(class {
		private tooltip: HTMLElement | null = null;

		constructor(private view: EditorView) {
			this.setupHoverListeners();
		}

		setupHoverListeners() {
			this.view.dom.addEventListener('mouseover', (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				if (target.classList.contains('marginalia-highlight') || 
					target.classList.contains('marginalia-highlight-cursor') ||
					target.classList.contains('marginalia-line-indicator') ||
					target.classList.contains('marginalia-icon')) {
					this.showTooltip(target, e);
				}
			});

			this.view.dom.addEventListener('mouseout', (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				if (target.classList.contains('marginalia-highlight') || 
					target.classList.contains('marginalia-highlight-cursor') ||
					target.classList.contains('marginalia-line-indicator') ||
					target.classList.contains('marginalia-icon')) {
					this.hideTooltip();
				}
			});
		}

		showTooltip(element: HTMLElement, event: MouseEvent) {
			const note = element.getAttribute('data-note');
			if (!note) return;

			this.hideTooltip();

			this.tooltip = document.createElement('div');
			this.tooltip.className = 'marginalia-tooltip';
			this.tooltip.textContent = note;

			document.body.appendChild(this.tooltip);

			const rect = element.getBoundingClientRect();
			this.tooltip.style.position = 'absolute';
			this.tooltip.style.left = `${rect.left}px`;
			this.tooltip.style.top = `${rect.bottom + 5}px`;
			this.tooltip.style.zIndex = '10000';
		}

		hideTooltip() {
			if (this.tooltip) {
				this.tooltip.remove();
				this.tooltip = null;
			}
		}

		destroy() {
			this.hideTooltip();
		}
	});
}

export function MarginaliaEditorExtension(plugin: MarginaliaPlugin) {
	return [
		marginaliaField(plugin),
		marginaliaHoverPlugin(plugin),
		ViewPlugin.fromClass(class {
			private filePath: string | null = null;

			private updateTimeout: number | null = null;

			constructor(private view: EditorView) {
				// Initial update after a short delay to ensure view is ready
				setTimeout(() => this.updateMarginalia(), 100);
			}

			update(update: ViewUpdate) {
				// Get file path from the editor view
				const newFilePath = this.getFilePath();
				// Also check if settings changed (for visibility updates)
				const settingsChanged = update.state && (update.state as any).settingsChanged;
				
				// If document changed, update stored marginalia positions
				if (update.docChanged && newFilePath && update.transactions.length > 0) {
					for (const tr of update.transactions) {
						if (tr.changes && !tr.changes.empty) {
							// Update positions asynchronously to avoid blocking
							// Use startState.doc (old) and state.doc (new) to properly map positions
							plugin.updateMarginaliaPositions(newFilePath, tr.changes, update.startState.doc, update.state.doc).catch(e => {
								console.error('Error updating marginalia positions:', e);
							});
						}
					}
				}
				
				if (newFilePath !== this.filePath || update.viewportChanged || update.docChanged || update.selectionSet || settingsChanged) {
					this.filePath = newFilePath;
					// Debounce updates but make them faster
					if (this.updateTimeout) {
						clearTimeout(this.updateTimeout);
					}
					this.updateTimeout = window.setTimeout(() => {
						this.updateMarginalia();
					}, 10);
				}
			}

			private getFilePath(): string | null {
				// Try multiple methods to get the file path
				const view = this.view;
				
				// Method 1: From workspace leaf
				const workspaceLeaf = view.dom.closest('.workspace-leaf');
				if (workspaceLeaf) {
					const markdownView = (workspaceLeaf as any).view;
					if (markdownView && markdownView.file) {
						return markdownView.file.path;
					}
				}

				// Method 2: From app workspace (access through plugin)
				try {
					const app = (plugin as any).app;
					if (app && app.workspace) {
						const activeFile = app.workspace.getActiveFile();
						if (activeFile) {
							return activeFile.path;
						}
					}
				} catch (e) {
					// Ignore errors
				}

				return null;
			}

			private updateMarginalia() {
				const filePath = this.getFilePath();
				if (filePath) {
					// Get items - this returns unsorted items
					const items = plugin.getMarginalia(filePath);
					// Editor extension ALWAYS sorts by document position, ignoring sidebar sort order
					// Force update by dispatching effect
					this.view.dispatch({
						effects: [addMarginaliaEffect.of(items)]
					});
				} else {
					// Clear decorations if no file
					this.view.dispatch({
						effects: [clearMarginaliaEffect.of(null)]
					});
				}
			}

			destroy() {
				if (this.updateTimeout) {
					clearTimeout(this.updateTimeout);
				}
			}
		})
	];
}
