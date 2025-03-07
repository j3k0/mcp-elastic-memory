#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { KnowledgeGraphClient } from './kg-client.js';
import { importFromJsonFile, exportToJsonFile } from './json-to-es.js';

// Environment configuration for Elasticsearch
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const ES_USERNAME = process.env.ES_USERNAME;
const ES_PASSWORD = process.env.ES_PASSWORD;

// Configure ES client with authentication if provided
const esOptions: { node: string; auth?: { username: string; password: string } } = {
  node: ES_NODE
};

if (ES_USERNAME && ES_PASSWORD) {
  esOptions.auth = { username: ES_USERNAME, password: ES_PASSWORD };
}

// Create KG client
const kgClient = new KnowledgeGraphClient(esOptions);

/**
 * Display help information
 */
function showHelp() {
  console.log('Knowledge Graph Admin CLI');
  console.log('========================');
  console.log('');
  console.log('Commands:');
  console.log('  init                 Initialize the Elasticsearch index');
  console.log('  import <file>        Import data from a JSON file');
  console.log('  export <file>        Export data to a JSON file');
  console.log('  stats                Display statistics about the knowledge graph');
  console.log('  search <query>       Search the knowledge graph');
  console.log('  reset                Reset the knowledge graph (delete all data)');
  console.log('  entity <name>        Display information about a specific entity');
  console.log('  help                 Show this help information');
  console.log('');
  console.log('Environment variables:');
  console.log('  ES_NODE              Elasticsearch node URL (default: http://localhost:9200)');
  console.log('  ES_USERNAME          Elasticsearch username (if authentication is required)');
  console.log('  ES_PASSWORD          Elasticsearch password (if authentication is required)');
}

/**
 * Initialize the Elasticsearch index
 */
async function initializeIndex() {
  try {
    await kgClient.initialize();
    console.log('Elasticsearch index initialized successfully');
  } catch (error) {
    console.error('Error initializing index:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Display statistics about the knowledge graph
 */
async function showStats() {
  try {
    // Initialize client
    await kgClient.initialize();
    
    // Export all data for counting
    const data = await kgClient.exportData();
    
    // Count entities and relations
    const entities = data.filter(item => item.type === 'entity');
    const relations = data.filter(item => item.type === 'relation');
    
    // Count entity types
    const entityTypes = new Map<string, number>();
    entities.forEach(entity => {
      const type = (entity as any).entityType;
      entityTypes.set(type, (entityTypes.get(type) || 0) + 1);
    });
    
    // Count relation types
    const relationTypes = new Map<string, number>();
    relations.forEach(relation => {
      const type = (relation as any).relationType;
      relationTypes.set(type, (relationTypes.get(type) || 0) + 1);
    });
    
    // Display statistics
    console.log('Knowledge Graph Statistics');
    console.log('=========================');
    console.log(`Total entities: ${entities.length}`);
    console.log(`Total relations: ${relations.length}`);
    console.log('');
    
    console.log('Entity types:');
    entityTypes.forEach((count, type) => {
      console.log(`  ${type}: ${count}`);
    });
    console.log('');
    
    console.log('Relation types:');
    relationTypes.forEach((count, type) => {
      console.log(`  ${type}: ${count}`);
    });
  } catch (error) {
    console.error('Error getting statistics:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Search the knowledge graph
 * @param query The search query
 */
async function searchGraph(query: string) {
  try {
    // Initialize client
    await kgClient.initialize();
    
    // Search for entities
    const results = await kgClient.search({
      query,
      limit: 10,
      sortBy: 'relevance'
    });
    
    // Display results
    console.log(`Search Results for "${query}"`);
    console.log('====================================');
    console.log(`Found ${results.hits.total.value} matches`);
    console.log('');
    
    // Display each entity
    const hits = results.hits.hits;
    hits.forEach((hit, index) => {
      const score = hit._score.toFixed(2);
      const source = hit._source;
      
      if (source.type === 'entity') {
        console.log(`${index + 1}. ${source.name} (${source.entityType}) [Score: ${score}]`);
        console.log(`   Observations: ${source.observations.length}`);
        
        // Show highlights if available
        if (hit.highlight) {
          console.log('   Matches:');
          Object.entries(hit.highlight).forEach(([field, highlights]) => {
            highlights.forEach(highlight => {
              console.log(`   - ${field}: ${highlight}`);
            });
          });
        }
        console.log('');
      }
    });
    
  } catch (error) {
    console.error('Error searching knowledge graph:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Reset the knowledge graph (delete all data)
 */
async function resetIndex() {
  try {
    // Ask for confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    readline.question('Are you sure you want to delete all data? This cannot be undone. (y/N) ', async (answer: string) => {
      if (answer.toLowerCase() === 'y') {
        // Get the client
        const client = kgClient['client']; // Access the private client property
        
        // Delete and recreate the index
        await client.indices.delete({ index: 'knowledge-graph' });
        await kgClient.initialize();
        
        console.log('Knowledge graph has been reset');
      } else {
        console.log('Operation cancelled');
      }
      
      readline.close();
    });
  } catch (error) {
    console.error('Error resetting index:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Display information about a specific entity
 * @param name Entity name
 */
async function showEntity(name: string) {
  try {
    // Initialize client
    await kgClient.initialize();
    
    // Get entity
    const entity = await kgClient.getEntity(name);
    if (!entity) {
      console.error(`Entity "${name}" not found`);
      process.exit(1);
    }
    
    // Get related entities
    const related = await kgClient.getRelatedEntities(name, 1);
    
    // Display entity information
    console.log(`Entity: ${entity.name}`);
    console.log(`Type: ${entity.entityType}`);
    console.log(`Important: ${entity.isImportant ? 'Yes' : 'No'}`);
    console.log(`Last read: ${entity.lastRead}`);
    console.log(`Last write: ${entity.lastWrite}`);
    console.log(`Read count: ${entity.readCount}`);
    console.log('');
    
    console.log('Observations:');
    entity.observations.forEach((obs: string, i: number) => {
      console.log(`  ${i+1}. ${obs}`);
    });
    console.log('');
    
    console.log('Relations:');
    for (const relation of related.relations) {
      if (relation.from === name) {
        console.log(`  → ${relation.relationType} → ${relation.to}`);
      } else {
        console.log(`  ← ${relation.relationType} ← ${relation.from}`);
      }
    }
  } catch (error) {
    console.error('Error getting entity:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Main function to parse and execute commands
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === 'help') {
    showHelp();
    return;
  }
  
  switch (command) {
    case 'init':
      await initializeIndex();
      break;
    
    case 'import':
      if (!args[1]) {
        console.error('Error: File path is required for import');
        process.exit(1);
      }
      await importFromJsonFile(args[1], esOptions);
      break;
    
    case 'export':
      if (!args[1]) {
        console.error('Error: File path is required for export');
        process.exit(1);
      }
      await exportToJsonFile(args[1], esOptions);
      break;
    
    case 'stats':
      await showStats();
      break;
      
    case 'search':
      if (!args[1]) {
        console.error('Error: Search query is required');
        process.exit(1);
      }
      await searchGraph(args[1]);
      break;
    
    case 'reset':
      await resetIndex();
      break;
    
    case 'entity':
      if (!args[1]) {
        console.error('Error: Entity name is required');
        process.exit(1);
      }
      await showEntity(args[1]);
      break;
    
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// Run the CLI
main().catch(error => {
  console.error('Error:', (error as Error).message);
  process.exit(1);
}); 