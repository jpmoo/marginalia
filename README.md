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

### AI Features (Requires Ollama)

The plugin includes powerful AI features for finding related marginalia and creating visualizations:

- **Find Similar Marginalia**: Compare marginalia note text using embeddings
- **Find Similar Selection**: Compare selected text across all marginalia using embeddings
- **Find Similar Selection + Marginalia**: Combined comparison of both selection and note text using embeddings
- **Create Table of Contents (TOC)**: Generate a formatted note linking to related marginalia/selections
- **Create Canvas**: Generate a visual canvas with nodes for notes with related marginalia/selections
- **AI-generated filenames**: Automatically generates descriptive filenames for TOC and Canvas files

All AI features use configurable similarity thresholds and include progress indicators.

## Requirements

### Basic Requirements

- **Obsidian**: Developed on version 1.11.4+
- **Node.js**: For building the plugin (development only)

### AI Features Requirements

To use the AI features, you need:

- **Ollama server**: Either installed locally or accessible on your network
- **Required models**:
  - `nomic-embed-text:latest` - For generating embeddings
  - `phi3:latest` - For summarization and title generation

The plugin will automatically check for Ollama availability on startup and save the status. AI features are only available when Ollama is accessible and both models are installed.

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
3. Enter your note text in the modal
4. Optionally choose a custom highlight color (or use the default)
5. The selected area will be highlighted (or a visual indicator shown for cursor positions)

### Viewing Marginalia

- **Hover**: Hover over any highlighted text to see the marginalia in a tooltip
- **Sidebar**: Open the Marginalia sidebar (ribbon icon) to see all marginalia
- **Current Note tab**: View and manage marginalia in the active file
- **All Notes tab**: Browse all files that contain marginalia

### Managing Marginalia

- **Jump to location**: Click any marginalia item in the sidebar to jump to its location
- **Edit**: Click the edit button (pencil icon) to modify a marginalia note
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
- Check Ollama: Verify server and model availability
- Default Similarity Threshold: Default threshold for AI similarity searches (0.5-1.0)

## Data Storage

Marginalia data including settings is stored in `.obsidian/plugins/marginalia/data.json` and includes:
- All marginalia items with their text, positions, timestamps, and colors
- Embeddings for AI features (when available)

## AI Features Details

### Similarity Search

The plugin uses cosine similarity on embeddings to find related marginalia:
- **Find Similar Marginalia**: Compares the note text embeddings
- **Find Similar Selection**: Compares the selected text embeddings
- **Find Similar Selection + Marginalia**: Creates combined embeddings for more comprehensive matching

Results show similarity scores and allow you to jump directly to related notes.

### Export Features

**Table of Contents**:
- Creates a formatted note with links to the original note and all related notes
- Includes selection text and marginalia text in code blocks
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
- Embeddings generated via Ollama's `/api/embeddings` endpoint
- Summarization and title generation via Ollama's `/api/generate` endpoint

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

This is a vibe-coded plugin, so contributions that improve functionality or fix issues are welcome! Please feel free to submit issues or pull requests.

## Acknowledgments

Developed through iterative, user-driven refinement. The feature set reflects real-world usage patterns and evolving requirements.
