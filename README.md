# Marginalia - Obsidian Plugin

> **⚠️ Important Note: This is a vibe-coded plugin**  
> This plugin was developed through iterative, user-driven refinement. The code reflects real-world usage patterns and evolving requirements rather than a pre-planned architecture. It works well, but may have some rough edges. Use at your own discretion.

A powerful Obsidian plugin that allows you to add margin notes (marginalia) to your notes with highlights, hover tooltips, and AI-powered features for finding related content.

## Features

### Core Functionality

- **Right-click to add marginalia**: Right-click on any selected text or cursor position to add a margin note
- **Visual highlights**: Selected areas remain highlighted with customizable colors and transparency
- **Hover tooltips**: Hover over highlighted text to see the margin note in a popup
- **Pen icon indicators**: Visual indicators in the right margin show where marginalia exist (even for cursor-only notes)
- **Automatic position adjustment**: Marginalia positions adjust automatically when you edit the note (add/remove lines)
- **Overlap detection**: Prevents creating overlapping highlights

### Sidebar Panel

- **Current Note tab**: View all marginalia in the active file
  - Sort by position, date modified (ascending/descending)
  - Search/filter marginalia by text
  - Click any item to jump to its location
  - Edit and delete buttons for each item
  - Color-coded left border showing each item's highlight color
  - Timestamps showing creation/last modified date and time
- **All Notes tab**: Browse all notes with marginalia
  - Folder tree structure with expand/collapse
  - Expand All / Collapse All buttons
  - Search functionality across all notes
  - Click any note to open it at the marginalia location

### Customization

- **Per-item colors**: Each marginalia can have its own highlight color (defaults to settings color)
- **Default highlight color**: Customizable color picker in settings
- **Transparency control**: Adjustable highlight transparency (default: 50%)
- **Indicator visibility**: Choose to show pen only, highlight only, both, or neither

### AI Features (Requires Ollama with specific models installed)

The plugin includes powerful AI features for finding related marginalia and notes, and creating visualizations:

**Similarity Search**:
The AI Functions modal provides a flexible dropdown-based interface for similarity searches. You can combine different search types:

- **Search Target** (first dropdown): Choose what to search for
  - **marginalia**: Find other marginalia with similar note text
  - **selections**: Find other marginalia with similar selected text
  - **combined marginalia and selections**: Find other marginalia with similar combined content
  - **notes**: Find notes in your vault with similar content (requires note embeddings)

- **Search Source** (second dropdown): Choose what to compare against
  - **this marginalia**: Use the current marginalia's note text
  - **this selection**: Use the current marginalia's selected text
  - **this combination of marginalia and selection**: Use both combined
  - **this note**: Use the entire current note's content (only available if the note has been embedded)

The interface displays the selected text and marginalia text side-by-side, includes an adjustable similarity threshold slider, and shows results with similarity scores. Click any result to jump directly to that location.

**Export Features**:
- **Create Table of Contents (TOC)**: Generate a formatted note with the current note (including selection and marginalia) at the top, followed by links to related notes
- **Create Canvas**: Generate a visual canvas with nodes for all related notes
- **AI-generated filenames**: Automatically generates descriptive filenames for TOC and Canvas files

All AI features use configurable similarity thresholds (default: 0.60) and include progress indicators.

## Requirements

### Basic Requirements

- **Obsidian**: Developed on version 1.11.4+
- **Node.js**: For building the plugin (development only)

### AI Features Requirements

To use the AI features, you need:

- **Ollama server**: Either installed locally or accessible on your network
- **Required models**:
  - `nomic-embed-text:latest` - For generating embeddings
  - `qwen2.5:3b-instruct` - For summarization and title generation

The plugin will automatically check for Ollama and model availability on startup and save the status. AI features are only available when Ollama is accessible and both models are installed. Connection checks have a 10-second timeout to prevent hanging.

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/jpmoo/marginalia.git
   cd marginalia
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Copy the entire folder to your Obsidian vault's `.obsidian/plugins/marginalia/` directory

5. Enable the plugin in Obsidian's settings (Settings → Community Plugins → Marginalia)

### Development

- `npm run dev` - Build in development mode with watch
- `npm run build` - Build for production

## Usage

### Adding Marginalia

1. **On selected text**: Select text in your note, right-click, and choose "Add marginalia"
2. **On cursor position**: Right-click at any cursor position (even empty areas) to add a marginalia note
3. Enter your note text in the modal (limited to 7000 characters with real-time countdown)
4. Optionally choose a custom highlight color (or use the default)
5. The selected area will be highlighted (or a visual indicator shown for cursor positions)

### Viewing Marginalia

- **Hover**: Hover over any highlighted text to see the marginalia in a tooltip
- **Sidebar**: Open the Marginalia sidebar (ribbon icon) to see all marginalia
- **Current Note tab**: View and manage marginalia in the active file
  - Shows a short preview (3 lines) of each marginalia
  - Click the view button (eye icon) to see the full marginalia in a modal with active wiki links
- **All Notes tab**: Browse all files that contain marginalia

### Managing Marginalia

- **Jump to location**: Click any marginalia item in the sidebar to jump to its location
- **View**: Click the view button (eye icon) to see the full marginalia with active wiki links
  - View modal includes buttons to edit, access AI functions, delete, or close
- **Edit**: Click the edit button (pencil icon) to modify a marginalia note
  - Marginalia notes are limited to 7000 characters with a real-time countdown
- **Delete**: Click the delete button (trash icon) to remove a marginalia (with confirmation)
- **AI Tools**: Click the AI button (lightning icon) to access similarity search and export features

### Settings

Access settings via: Settings → Marginalia

**Appearance**:
- Default Highlight Color: Choose the default color for highlights
- Highlight Transparency: Adjust transparency level (0-100%, default: 50%)
- Indicator Visibility: Control what indicators are shown (pen, highlight, both, neither)

**Ollama Configuration**:
- Ollama Address: Server address (default: localhost)
- Ollama Port: Server port (default: 11434)
- Check Ollama Status: Verify server and model availability with real-time status indicators
  - Three status circles show: Ollama server, nomic-embed-text model, and qwen2.5:3b-instruct model
  - Green = available, Red = unavailable, Gray = not checked
  - Status persists across sessions and updates when address/port changes
  - 10-second timeout for connection checks
- Default Similarity Threshold: Default threshold for AI similarity searches (0.5-1.0, default: 0.60)

**Semantic Similarity**:
- Marginalia uses AI-powered semantic similarity analysis to help surface similar notes, marginalia, and selections
- Note that these features will be limited until embedding is 100% complete
- Leave embedding active to continue to watch for new files and changes in the specified folders in your vault
- Embedding Progress: Shows progress of note embedding process
  - Not all AI functions will be available until embedding is complete
  - System may slow until embedding is complete
  - Takes longest the very first time
  - May need to think about (and appear to pause on) bigger notes
- Similarity Folders: Specify folders to monitor for note embedding (one per line)
  - All subfolders are recursively processed
  - Files are automatically embedded when created or modified
  - Embedding can be paused/resumed at any time

## Data Storage

Marginalia data is stored in `.obsidian/plugins/marginalia/`:
- **`data.json`**: Plugin settings
- **`marginalia.json`**: All marginalia items with their text, positions, timestamps, colors, and embeddings
- **`notes_embedding.json`**: Note embeddings for semantic similarity searches (created when embedding is enabled)

## AI Features Details

### Similarity Search

The plugin uses cosine similarity on embeddings to find related marginalia and notes. The AI Functions modal provides an intuitive dropdown-based interface that lets you combine different search types:

**How it works**:
1. Open the AI Functions modal from any marginalia (lightning icon)
2. The modal displays the selected text and marginalia text side-by-side
3. Use the first dropdown to choose what to search for:
   - **marginalia**: Search for marginalia
   - **selections**: Search for text selections in notes
   - **combined marginalia and selections**: Search using both combined
   - **notes**: Search all embedded notes in your vault (requires note embeddings)
4. Use the second dropdown to choose what to compare against:
   - **this marginalia**: Compare using the current marginalia's text
   - **this selection**: Compare using the current marginalia's selection
   - **this combination**: Compare using both combined
   - **this note**: Compare using the entire current note (only if note is embedded)
5. Adjust the similarity threshold slider (default: 0.60)
6. Click "Search" to find similar items

Results show similarity scores and allow you to jump directly to related notes. The current note is always included at the top of TOC exports with its selection and marginalia text.

### Export Features

**Table of Contents**:
- Creates a formatted note with the current note (including selection and marginalia text) at the top
- Followed by links to all related notes with similarity scores
- For marginalia-based searches, includes selection and marginalia text for each related item
- Links jump directly to the marginalia location

**Canvas**:
- Creates a visual canvas with nodes for all related notes
- No edges/connections (clean layout)
- Nodes are draggable and fully functional
- Uses Obsidian's default new file location

Both export features use AI to generate descriptive filenames based on the content.

## Technical Details

- Built with TypeScript via Cursor vibe-coder
- Uses CodeMirror 6 for editor integration
- Uses Obsidian's Plugin API
- Canvas files use Obsidian's native canvas format
- Embeddings generated via Ollama's `/api/embeddings` endpoint using `nomic-embed-text`
- Summarization and title generation via Ollama's `/api/generate` endpoint using `qwen2.5:3b-instruct`

## Version History

### Beta04
- **Improved text chunking**: Enhanced Qwen prompt to prevent concept extraction and ensure proper character position ranges
- **Better chunking reliability**: Strengthened validation and error handling for semantic text chunking
- **Consistent embedding logic**: Unified chunking rules and prompts across initial embedding and file system listeners
- **Periodic embedding checks**: Listener now periodically scans for files needing embedding (e.g., files added outside Obsidian)
- **UI improvements**: Redesigned AI Functions modal with dropdown-based similarity search interface (800px width, improved layout)
- **Deterministic chunking**: Automatic splitting of oversized chunks using paragraph/newline/sentence boundaries
- **Delete and Redo Embeddings**: Added button in settings to delete all embeddings and start fresh (visible when embeddings are not 0% complete)

### Beta03
- **AI Functions modal**: Introduced comprehensive similarity search interface with dropdown menus
- **Default similarity threshold**: Set to 0.60 with configurable slider
- **TOC improvements**: Enhanced table of contents exports with function names and better formatting
- **View modal**: Added full marginalia view modal with active wiki links
- **Character limits**: Added 7000 character limit for marginalia notes with real-time countdown

### Beta02
- **Reading view support**: Added support for viewing marginalia in reading mode
- **UI improvements**: Fixed button alignment and search text persistence between sidebar tabs
- **Deletion updates**: Improved deletion handling and UI updates

### Beta01
- **Initial version**: Core marginalia functionality with highlights, hover tooltips, and sidebar panel
- **Version and author**: Set to JPMoo

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

This is a vibe-coded plugin, so contributions that improve functionality or fix issues are welcome! Please feel free to submit issues or pull requests.

## Acknowledgments

Developed through iterative, user-driven refinement. The feature set reflects real-world usage patterns and evolving requirements.

Credit also goes to the anonymous and exhausted medieval Celtic monks who wrote interesting, funny, and heart-felt notes in the margins of all of those gloriously illuminated manuscripts.

/ghost
