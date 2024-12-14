
## MCP Server Design Document

### Overview

The MCP (Metadata & Code Parsing) Server is a tool designed to analyze a codebase and produce a structured dependency graph and metadata. This output aids Large Language Models (LLMs) and other development tools in understanding the existing code structure, namespaces, and dependencies, thereby reducing guesswork and improving alignment with established architectures (e.g., Clean Architecture in .NET). Although initially focused on .NET projects, the MCP server is designed to be extensible to other languages and frameworks such as Node.js, Python, and React.js.

---

### Goals

#### Provide a Dependency Graph

Generate a dependency graph that captures how files and modules relate to each other. This graph will guide LLMs and developers in understanding and extending the codebase without creating unnecessary directories or violating architectural boundaries.

#### Metadata Extraction

For each relevant file, extract key metadata, including:

- Namespaces
- Imports/usings
- File path
- Inferred architectural layers (Domain, Application, Infrastructure, etc.).

#### Performance and Caching

- Leverage `git status` to detect changed files and only re-parse these. Additionally, ensure the caching strategy can handle edge cases, such as branch switching or rebased commits, by recalculating affected dependencies or invalidating relevant cache entries when discrepancies are detected.
- Use a caching strategy to speed up repeated analyses.
- Limit file reads to the first **N** lines to quickly extract necessary information.

#### Adherence to `.gitignore`

Respect `.gitignore` to avoid parsing irrelevant files like `node_modules` or build artifacts.

#### Extensibility

Support additional languages and frameworks by designing a pluggable parser interface. Start with .NET, then extend to Node.js, Python, and React.js.

#### Scoring (Optional)

Provide an optional scoring system that checks files against architectural and quality criteria, such as adherence to naming conventions, appropriate use of layering (e.g., Domain not depending on Infrastructure), and code complexity. This system will produce a `scoring-report.json` for developers or CI/CD pipelines, offering actionable insights into potential improvements.

#### Integration with LLMs

Offer outputs in formats (e.g., JSON) that can be easily integrated into LLM prompts or other tooling.

---

### High-Level Architecture

```
MCP.Server
├── Parsers
│   ├── DotNetParser.ts        (Parses C#/.NET files)
│   ├── NodeParser.ts          (Parses Node.js/React files)
│   ├── PythonParser.ts        (Parses Python files)
│   └── ReactParser.ts         (If separate from NodeParser)
├── Core
│   ├── Models
│   │   ├── FileMetadata.ts    (Holds extracted file info)
│   │   ├── DependencyGraph.ts (Represents the dependency graph)
│   │   └── Node.ts            (Represents a node in the graph)
│   ├── Services
│   │   ├── DirectoryScanner.ts     (Scans directories for files)
│   │   ├── GitIntegrationService.ts (Uses git to identify changed files)
│   │   ├── IgnoreService.ts        (Respects .gitignore patterns)
│   │   ├── ParserManager.ts        (Routes files to correct parser)
│   │   ├── GraphBuilder.ts         (Builds/updates the dependency graph)
│   │   ├── CachingService.ts       (Caches parsed results)
│   │   └── ScoringService.ts       (Optional scoring logic)
│   └── Interfaces
│       └── IParser.ts (Interface for language-specific parsers)
└── Output
    ├── dependency-graph.json
    ├── scoring-report.json (if scoring)
    └── cache/
        └── (Cached metadata for unchanged files)
```

---

### Workflow Example with TypeScript Pseudocode

#### Initialization

```typescript
import { loadConfig, parseGitignore, validatePath } from './utils';
import { DirectoryScanner } from './services/DirectoryScanner';
import { GitIntegrationService } from './services/GitIntegrationService';
import { IgnoreService } from './services/IgnoreService';
import { ParserManager } from './services/ParserManager';
import { GraphBuilder } from './services/GraphBuilder';
import { CachingService } from './services/CachingService';
import { ScoringService } from './services/ScoringService';

const config = loadConfig("./config.json");
const gitService = new GitIntegrationService();
const ignoreService = new IgnoreService(config.rootDirectory);
const directoryScanner = new DirectoryScanner(config.rootDirectory);
const parserManager = new ParserManager(config.languages);
const graphBuilder = new GraphBuilder();
const cachingService = new CachingService(config.cacheDirectory);
const scoringService = new ScoringService(config.scoringRules);

ignoreService.loadIgnorePatterns();
```

#### Detect Changes

```typescript
const changedFiles = gitService.getChangedFiles();
const filteredFiles = ignoreService.filterFiles(changedFiles);
```

#### Scan & Parse Files

```typescript
for (const file of filteredFiles) {
  let metadata;
  if (cachingService.isCached(file)) {
    metadata = cachingService.getMetadata(file);
  } else {
    metadata = parserManager.parse(file);
    cachingService.updateCache(file, metadata);
  }
  graphBuilder.updateGraph(metadata);
}
```

#### Scoring and Output

```typescript
if (config.scoringRules) {
  const scoreReport = scoringService.generateScores(graphBuilder.getGraph());
  writeToFile("./output/scoring-report.json", scoreReport);
}

const dependencyGraph = graphBuilder.getGraph();
writeToFile("./output/dependency-graph.json", dependencyGraph);
```

---

### Example of Scoring Rules in `config.json`

```json
{
  "scoringRules": {
    "namingConventions": {
      "classes": "PascalCase",
      "interfaces": "I*"
    },
    "layeringRules": {
      "Domain": ["NoDependencyOn:Infrastructure"]
    }
  }
}
```

---

### Example Filesystem MCP Implementation

Below is a full example of a Filesystem MCP implementation in TypeScript. This implementation demonstrates file and directory operations, validation against allowed directories, and schema validation using Zod.

#### Full Source Code

[Refer to document for full details of the TypeScript MCP filesystem implementation.]

```
# Filesystem MCP TypeScript Implementation (condensed here for brevity)
[This section of the source code will contain complete MCP code detailed in the live documentation.]
```
