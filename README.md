# ReaderMate

A VS Code extension for reading novels with Reader3 server integration.

## Features

- **Bookshelf Management**: Browse and manage your novel collection
- **Reading Interface**: Clean, distraction-free reading experience within VS Code
- **Chapter Navigation**: Easy navigation between chapters with keyboard shortcuts
- **Progress Tracking**: Automatic reading progress synchronization
- **Chapter Preloading**: Smart preloading for seamless reading experience
- **Server Integration**: Works with Reader3 server for content management

## Installation

1. Install the extension from VS Code Marketplace
2. Configure your Reader3 server settings
3. Start reading your favorite novels!

## Configuration

Open VS Code settings and configure the following:

- **Server URL**: Your Reader3 server base URL (e.g., `https://reader.me`)
- **Username**: Your account username
- **Access Token**: Your authentication token
- **Preload Settings**: Customize chapter preloading behavior

## Usage

### Opening Bookshelf

- Use `Ctrl+Shift+L` to open your bookshelf
- Or click the book icon in the activity bar
- Or use Command Palette: "ReaderMate: Open Bookshelf"

### Reading

- Click on any book in your bookshelf to start reading
- Use `Ctrl+Left` for previous chapter
- Use `Ctrl+Right` for next chapter
- Reading progress is automatically saved

### Preloading

The extension intelligently preloads upcoming chapters based on your reading progress:

- **Enabled**: Toggle chapter preloading on/off
- **Chapter Count**: Number of chapters to preload (1-5)
- **Trigger Progress**: When to start preloading (30%-95% of current chapter)
- **Cache Size**: Maximum chapters to keep in cache (5-20)

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Open Bookshelf | `Ctrl+Shift+L` | Open your book collection |
| Previous Chapter | `Ctrl+Left` | Navigate to previous chapter |
| Next Chapter | `Ctrl+Right` | Navigate to next chapter |
| Refresh Bookshelf | - | Refresh book list |

## Requirements

- VS Code 1.60.0 or higher
- Access to a Reader3 server
- Valid authentication credentials

## Known Issues

- Large books may take longer to load initially
- Network connectivity required for content synchronization

## Release Notes

### 1.0.0

Initial release with core reading functionality:
- Bookshelf management
- Chapter navigation
- Progress tracking
- Chapter preloading
- Reader3 server integration

## Support

For issues and feature requests, please visit our [GitHub repository](https://github.com/user/readermate-vscode).

## License

This extension is licensed under the MIT License.
