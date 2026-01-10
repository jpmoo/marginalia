# Marginalia - Obsidian Plugin

A plugin for Obsidian that allows you to add margin notes to your notes with highlights and hover tooltips.

## Features

- **Right-click to add margin notes**: Right-click on any selected text or cursor position to add a margin note
- **Visual highlights**: Selected areas remain highlighted in yellow
- **Hover tooltips**: Hover over highlighted text to see the margin note in a popup
- **Sidebar panel**: View all margin notes for the current file in a dedicated sidebar
- **Jump to location**: Click on any margin note in the sidebar to jump to its location in the note
- **Edit notes**: Edit margin notes directly from the sidebar
- **Delete with confirmation**: Delete margin notes with a confirmation dialog

## Installation

1. Copy this folder to your Obsidian vault's `.obsidian/plugins/` directory
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Enable the plugin in Obsidian's settings

## Development

- `npm run dev` - Build in development mode with watch
- `npm run build` - Build for production

## Usage

1. Select text or place your cursor where you want to add a margin note
2. Right-click and select "Add Margin Note"
3. Enter your note in the modal
4. The selected area will be highlighted
5. Hover over the highlight to see your note
6. Open the Marginalia sidebar (click the book icon in the ribbon) to see all notes
7. Click "Jump" to navigate to a note's location
8. Click "Edit" to modify a note
9. Click "Delete" to remove a note (with confirmation)

## Data Storage

Margin notes are stored in `.obsidian/plugins/marginalia/data.json` and are associated with file paths.
