export interface MarginaliaItem {
	id: string;
	text: string;
	note: string;
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	line: number;
	ch: number;
	timestamp?: number; // Timestamp when the item was created
	embedding?: number[] | null; // Embedding vector from nomic-embed-text (for note text), null if no meaningful note text
	selectionEmbedding?: number[] | null; // Embedding vector for selected text (if any), null if no meaningful text
	color?: string; // Individual highlight color (overrides default)
}

export interface MarginaliaData {
	items: MarginaliaItem[];
}
