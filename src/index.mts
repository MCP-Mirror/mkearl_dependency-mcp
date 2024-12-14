#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { minimatch } from 'minimatch';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const MAX_LINES_TO_READ = process.env.MAX_LINES_TO_READ ? parseInt(process.env.MAX_LINES_TO_READ) : 1000;
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), '.dependency-cache');
const CACHE_TTL = process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL) : 3600000; // 1 hour in milliseconds

// Tool input schema type
const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// GitIgnore handling
class GitIgnoreService {
  private patterns: string[] = [];
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async loadGitIgnore() {
    try {
      const gitignorePath = path.join(this.rootDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      this.patterns = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(pattern => {
          pattern = pattern.replace(/^\//, '');
          if (pattern.endsWith('/')) {
            pattern = pattern + '**';
          }
          if (pattern.startsWith('!')) {
            return '!' + pattern.slice(1);
          }
          return pattern;
        });
    } catch (error) {
      console.error('No .gitignore found or error reading it:', error);
      this.patterns = [
        'node_modules/**',
        'dist/**',
        '.git/**',
        'build/**',
        'coverage/**',
        '*.log'
      ];
    }
  }

  isIgnored(filePath: string): boolean {
    const relativePath = path.relative(this.rootDir, filePath);
    return this.patterns.some(pattern => {
      if (pattern.startsWith('!')) {
        return !minimatch(relativePath, pattern.slice(1), { dot: true });
      }
      return minimatch(relativePath, pattern, { dot: true });
    });
  }
}

// Schema definitions for dependency analysis
const AnalyzeDependenciesArgsSchema = z.object({
  path: z.string().describe('Root directory path to analyze'),
  excludePatterns: z.array(z.string()).optional().default(['node_modules', 'dist', '.git']),
  maxDepth: z.number().optional().default(10),
  fileTypes: z.array(z.string()).optional().default(['.ts', '.js', '.cs', '.py', '.jsx', '.tsx']),
  useCache: z.boolean().optional().default(true),
});

const GetDependencyGraphArgsSchema = z.object({
  path: z.string().describe('Root directory path to get dependency graph for'),
  format: z.enum(['json', 'dot']).optional().default('json'),
});

const GetFileMetadataArgsSchema = z.object({
  path: z.string().describe('Path to file to analyze'),
});

const GetArchitecturalScoreArgsSchema = z.object({
  path: z.string().describe('Root directory path to score'),
  rules: z.array(z.object({
    pattern: z.string(),
    allowed: z.array(z.string()),
    forbidden: z.array(z.string()),
  })).optional(),
});

// Types for dependency analysis
interface FileMetadata {
  path: string;
  imports: string[];
  exports: string[];
  namespaces: string[];
  architecturalLayer?: string;
}

interface DependencyNode {
  path: string;
  metadata: FileMetadata;
  dependencies: Set<string>;
  dependents: Set<string>;
}

class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();

  addNode(path: string, metadata: FileMetadata) {
    if (!this.nodes.has(path)) {
      this.nodes.set(path, {
        path,
        metadata,
        dependencies: new Set(),
        dependents: new Set(),
      });
    }
  }

  addDependency(from: string, to: string) {
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    
    if (fromNode && toNode) {
      fromNode.dependencies.add(to);
      toNode.dependents.add(from);
    }
  }

  toJSON() {
    const result: Record<string, any> = {};
    for (const [path, node] of this.nodes) {
      result[path] = {
        ...node.metadata,
        dependencies: Array.from(node.dependencies),
        dependents: Array.from(node.dependents),
      };
    }
    return result;
  }

  toDOT() {
    let dot = 'digraph Dependencies {\n';
    for (const [path, node] of this.nodes) {
      const nodeId = path.replace(/[^a-zA-Z0-9]/g, '_');
      dot += `  ${nodeId} [label="${path}"];\n`;
      for (const dep of node.dependencies) {
        const depId = dep.replace(/[^a-zA-Z0-9]/g, '_');
        dot += `  ${nodeId} -> ${depId};\n`;
      }
    }
    dot += '}\n';
    return dot;
  }
}

// Cache management
interface CacheEntry {
  timestamp: number;
  data: any;
  gitHash?: string;
}

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create cache directory:', error);
  }
}

async function getCacheKey(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  const key = `${filePath}:${stats.mtime.getTime()}`;
  return createHash('md5').update(key).digest('hex');
}

async function getGitHash(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: directory });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function getCachedData(filePath: string): Promise<any | null> {
  try {
    const cacheKey = await getCacheKey(filePath);
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    const cacheContent = await fs.readFile(cachePath, 'utf-8');
    const cache: CacheEntry = JSON.parse(cacheContent);

    // Check if cache is still valid
    if (Date.now() - cache.timestamp > CACHE_TTL) {
      return null;
    }

    // If file is in git, check if commit hash changed
    const currentGitHash = await getGitHash(path.dirname(filePath));
    if (currentGitHash && cache.gitHash && currentGitHash !== cache.gitHash) {
      return null;
    }

    return cache.data;
  } catch {
    return null;
  }
}

async function setCachedData(filePath: string, data: any) {
  try {
    const cacheKey = await getCacheKey(filePath);
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    const gitHash = await getGitHash(path.dirname(filePath));
    
    const cacheEntry: CacheEntry = {
      timestamp: Date.now(),
      data,
      gitHash,
    };

    await fs.writeFile(cachePath, JSON.stringify(cacheEntry), 'utf-8');
  } catch (error) {
    console.error('Failed to cache data:', error);
  }
}

// File parsing utilities with line limit
async function readFileWithLimit(filePath: string): Promise<string> {
  const fileHandle = await fs.open(filePath, 'r');
  const stream = fileHandle.createReadStream();
  
  return new Promise((resolve, reject) => {
    let content = '';
    let lineCount = 0;
    let remainder = '';

    stream.on('data', (chunk: Buffer) => {
      const text = remainder + chunk.toString();
      const lines = text.split('\n');
      remainder = lines.pop() || '';

      for (const line of lines) {
        if (lineCount >= MAX_LINES_TO_READ) {
          stream.destroy();
          break;
        }
        content += line + '\n';
        lineCount++;
      }
    });

    stream.on('end', () => {
      if (lineCount < MAX_LINES_TO_READ && remainder) {
        content += remainder;
      }
      fileHandle.close();
      resolve(content);
    });

    stream.on('error', (error) => {
      fileHandle.close();
      reject(error);
    });
  });
}

async function parseFileImports(filePath: string): Promise<string[]> {
  const content = await readFileWithLimit(filePath);
  const imports: string[] = [];
  
  // TypeScript/JavaScript import parsing
  const importRegex = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([@\w\-/.]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // C# using statements
  const usingRegex = /using\s+([\w.]+);/g;
  while ((match = usingRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Python imports
  const pythonImportRegex = /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g;
  while ((match = pythonImportRegex.exec(content)) !== null) {
    imports.push(match[1] || match[2]);
  }

  return imports;
}

async function parseFileExports(filePath: string): Promise<string[]> {
  const content = await readFileWithLimit(filePath);
  const exports: string[] = [];

  // TypeScript/JavaScript export parsing
  const exportRegex = /export\s+(?:default\s+)?(?:class|interface|function|const|let|var)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // C# public class/interface parsing
  const csRegex = /public\s+(?:class|interface)\s+(\w+)/g;
  while ((match = csRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  return exports;
}

async function inferArchitecturalLayer(filePath: string): Promise<string | undefined> {
  const normalizedPath = filePath.toLowerCase();
  
  if (normalizedPath.includes('domain')) return 'Domain';
  if (normalizedPath.includes('application')) return 'Application';
  if (normalizedPath.includes('infrastructure')) return 'Infrastructure';
  if (normalizedPath.includes('presentation') || normalizedPath.includes('ui')) return 'Presentation';
  if (normalizedPath.includes('test')) return 'Test';
  
  return undefined;
}

// Core analysis functions
async function analyzeDependencies(rootPath: string, options: {
  excludePatterns?: string[],
  maxDepth?: number,
  fileTypes?: string[],
  useCache?: boolean,
}) {
  const graph = new DependencyGraph();
  const {
    excludePatterns = ['node_modules', 'dist', '.git'],
    maxDepth = 10,
    fileTypes = ['.ts', '.js', '.cs', '.py', '.jsx', '.tsx'],
    useCache = true,
  } = options;

  await ensureCacheDir();

  // Initialize GitIgnore service
  const gitIgnore = new GitIgnoreService(rootPath);
  await gitIgnore.loadGitIgnore();

  async function scanDirectory(currentPath: string, depth: number) {
    if (depth > maxDepth) return;

    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, fullPath);

      // Check gitignore patterns first
      if (gitIgnore.isIgnored(fullPath)) {
        continue;
      }

      // Then check explicit exclude patterns
      if (excludePatterns.some(pattern => minimatch(relativePath, pattern))) {
        continue;
      }

      if (entry.isDirectory()) {
        await scanDirectory(fullPath, depth + 1);
      } else if (entry.isFile() && fileTypes.some(ext => fullPath.endsWith(ext))) {
        let metadata: FileMetadata;

        if (useCache) {
          const cachedData = await getCachedData(fullPath);
          if (cachedData) {
            metadata = cachedData;
          } else {
            metadata = await analyzeFile(fullPath, relativePath);
            await setCachedData(fullPath, metadata);
          }
        } else {
          metadata = await analyzeFile(fullPath, relativePath);
        }

        graph.addNode(relativePath, metadata);

        // Add dependencies
        for (const imp of metadata.imports) {
          graph.addDependency(relativePath, imp);
        }
      }
    }
  }

  await scanDirectory(rootPath, 0);
  return graph;
}

async function analyzeFile(fullPath: string, relativePath: string): Promise<FileMetadata> {
  const imports = await parseFileImports(fullPath);
  const exports = await parseFileExports(fullPath);
  const layer = await inferArchitecturalLayer(fullPath);

  return {
    path: relativePath,
    imports,
    exports,
    namespaces: [], // TODO: Implement namespace detection
    architecturalLayer: layer,
  };
}

// Server setup
const server = new Server(
  {
    name: "dependency-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "analyze_dependencies",
      description: "Analyze dependencies in a codebase and generate a dependency graph",
      inputSchema: zodToJsonSchema(AnalyzeDependenciesArgsSchema) as ToolInput,
    },
    {
      name: "get_dependency_graph",
      description: "Get the dependency graph for a codebase in JSON or DOT format",
      inputSchema: zodToJsonSchema(GetDependencyGraphArgsSchema) as ToolInput,
    },
    {
      name: "get_file_metadata",
      description: "Get detailed metadata about a specific file including imports, exports, and architectural layer",
      inputSchema: zodToJsonSchema(GetFileMetadataArgsSchema) as ToolInput,
    },
    {
      name: "get_architectural_score",
      description: "Score the codebase against architectural rules and patterns",
      inputSchema: zodToJsonSchema(GetArchitecturalScoreArgsSchema) as ToolInput,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "analyze_dependencies": {
        const parsed = AnalyzeDependenciesArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error}`);
        }

        const graph = await analyzeDependencies(parsed.data.path, {
          excludePatterns: parsed.data.excludePatterns,
          maxDepth: parsed.data.maxDepth,
          fileTypes: parsed.data.fileTypes,
          useCache: parsed.data.useCache,
        });

        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify(graph.toJSON(), null, 2) 
          }],
        };
      }

      case "get_dependency_graph": {
        const parsed = GetDependencyGraphArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error}`);
        }

        const graph = await analyzeDependencies(parsed.data.path, {});
        
        return {
          content: [{
            type: "text",
            text: parsed.data.format === 'dot' ? graph.toDOT() : JSON.stringify(graph.toJSON(), null, 2),
          }],
        };
      }

      case "get_file_metadata": {
        const parsed = GetFileMetadataArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error}`);
        }

        const metadata = await analyzeFile(parsed.data.path, path.relative(process.cwd(), parsed.data.path));

        return {
          content: [{
            type: "text",
            text: JSON.stringify(metadata, null, 2),
          }],
        };
      }

      case "get_architectural_score": {
        const parsed = GetArchitecturalScoreArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error}`);
        }

        const graph = await analyzeDependencies(parsed.data.path, {});
        const data = graph.toJSON();
        const violations: string[] = [];
        let score = 100;

        // Apply architectural rules
        if (parsed.data.rules) {
          for (const [filePath, fileData] of Object.entries<any>(data)) {
            for (const rule of parsed.data.rules) {
              if (minimatch(filePath, rule.pattern)) {
                for (const dep of fileData.dependencies) {
                  if (
                    (rule.allowed.length > 0 && !rule.allowed.some(pattern => minimatch(dep, pattern))) ||
                    rule.forbidden.some(pattern => minimatch(dep, pattern))
                  ) {
                    violations.push(`${filePath} -> ${dep} violates architectural rules`);
                    score -= 5; // Deduct points for each violation
                  }
                }
              }
            }
          }
        }

        // Ensure score doesn't go below 0
        score = Math.max(0, score);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              score,
              violations,
              details: "Score starts at 100 and deducts 5 points per violation",
            }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DependencyMCP Server running on stdio");
  console.error(`Max lines to read: ${MAX_LINES_TO_READ}`);
  console.error(`Cache directory: ${CACHE_DIR}`);
  console.error(`Cache TTL: ${CACHE_TTL}ms`);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
