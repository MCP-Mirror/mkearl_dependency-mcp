# DependencyMCP Server

[Previous sections unchanged...]

## Configuration

Add to your MCP settings file (usually located at ~/config/cline/mcp_settings.json\\ or equivalent):

\\\
\\json {
  mcpServers: { \\DependencyMCP: { \\command: \\node, \\args: [\\path/to/dependency-mcp/dist/index.js], \\env: {
    \\MAX_LINES_TO_READ: \\1000,
    \\CACHE_DIR: \\path/to/dependency-mcp/.dependency-cache,
    \\CACHE_TTL: \\3600000
  }
} } } \\
\\\

Environment Variables:
- \\MAX_LINES_TO_READ: Maximum number of lines to read from each file (default: 1000)
- \\CACHE_DIR: Directory to store dependency cache files (default: .dependency-cache)
- \\CACHE_TTL: Cache time-to-live in milliseconds (default: 1 hour = 3600000)

[Rest of the file unchanged...]
