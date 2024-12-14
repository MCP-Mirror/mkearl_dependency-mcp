# DependencyMCP Server

A Model Context Protocol (MCP) server that analyzes codebases to generate dependency graphs and architectural insights. This server helps understand code structure, dependencies, and architectural patterns across multiple programming languages.

## Features

- **Multi-Language Support**: Analyzes dependencies in TypeScript, JavaScript, C#, Python, and more
- **Dependency Graph Generation**: Creates detailed dependency graphs in JSON or DOT format
- **Architectural Analysis**: Infers architectural layers and validates against rules
- **File Metadata**: Extracts imports, exports, and other metadata from source files
- **Scoring System**: Evaluates codebase against architectural rules and patterns

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```
3. Build the project:
```bash
npm run build
```

## Configuration

Add to your MCP settings file (usually located at ~/.config/cline/mcp_settings.json or equivalent):

```
json { mcpServers: { \DependencyMCP: { \command: \node, \args: [\path/to/dependency-mcp/dist/index.js], \env: { \MAX_LINES_TO_READ: \1000, \CACHE_DIR: \path/to/dependency-mcp/.dependency-cache, \CACHE_TTL: \3600000 } } }
```

Environment Variables:
- MAX_LINES_TO_READ: Maximum number of lines to read from each file (default: 1000)
- CACHE_DIR: Directory to store dependency cache files (default: .dependency-cache)
- CACHE_TTL: Cache time-to-live in milliseconds (default: 1 hour = 3600000)

## Available Tools

### analyze_dependencies

Analyzes dependencies in a codebase and generates a dependency graph.

```typescript
const result = await client.callTool("DependencyMCP", "analyze_dependencies", {
  path: "/path/to/project",
  excludePatterns: ["node_modules", "dist"], // optional
  maxDepth: 10, // optional
  fileTypes: [".ts", ".js", ".cs"] // optional
});
```

### get_dependency_graph

Gets the dependency graph for a codebase in JSON or DOT format.

```typescript
const result = await client.callTool("DependencyMCP", "get_dependency_graph", {
  path: "/path/to/project",
  format: "dot" // or "json" (default)
});
```

### get_file_metadata

Gets detailed metadata about a specific file.

```typescript
const result = await client.callTool("DependencyMCP", "get_file_metadata", {
  path: "/path/to/file.ts"
});
```

### get_architectural_score

Scores the codebase against architectural rules and patterns.

```typescript
const result = await client.callTool("DependencyMCP", "get_architectural_score", {
  path: "/path/to/project",
  rules: [
    {
      pattern: "src/domain/**/*",
      allowed: ["src/domain/**/*"],
      forbidden: ["src/infrastructure/**/*"]
    }
  ]
});
```

## Example Output

### Dependency Graph (JSON)

```json
{
  "src/index.ts": {
    "path": "src/index.ts",
    "imports": ["./utils", "./services/parser"],
    "exports": ["analyze", "generateGraph"],
    "namespaces": [],
    "architecturalLayer": "Infrastructure",
    "dependencies": ["src/utils.ts", "src/services/parser.ts"],
    "dependents": []
  }
}
```

### Architectural Score

```json
{
  "score": 85,
  "violations": [
    "src/domain/user.ts -> src/infrastructure/database.ts violates architectural rules"
  ],
  "details": "Score starts at 100 and deducts 5 points per violation"
}
```

## Development

The server is built with TypeScript and uses:
- Zod for schema validation
- diff for file comparison
- minimatch for glob pattern matching

### Project Structure

```
dependency-mcp/
├── src/
│   └── index.mts    # Main server implementation
├── package.json
├── tsconfig.json
└── README.md
```

### Adding Support for New Languages

To add support for a new programming language:

1. Add file extensions to the default `fileTypes` array
2. Implement language-specific regex patterns in `parseFileImports` and `parseFileExports`
3. Add any language-specific architectural patterns to `inferArchitecturalLayer`

## License

MIT
