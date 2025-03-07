#!/usr/bin/env node

// @ts-ignore
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// @ts-ignore
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { KnowledgeGraphClient } from './kg-client.js';
import { ESEntity, ESRelation, ESSearchParams } from './es-types.js';

// Environment configuration for Elasticsearch
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const ES_USERNAME = process.env.ES_USERNAME;
const ES_PASSWORD = process.env.ES_PASSWORD;
const DEBUG = process.env.DEBUG === 'true';

// Configure ES client with authentication if provided
const esOptions: { node: string; auth?: { username: string; password: string } } = {
  node: ES_NODE
};

if (ES_USERNAME && ES_PASSWORD) {
  esOptions.auth = { username: ES_USERNAME, password: ES_PASSWORD };
}

// Create KG client
const kgClient = new KnowledgeGraphClient(esOptions);

// Helper function to format dates in YYYY-MM-DD format
function formatDate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

// Start the MCP server
async function startServer() {
  try {
    // Initialize the knowledge graph
    await kgClient.initialize();
    // Use stderr for logging, not stdout
    console.error('Elasticsearch Knowledge Graph initialized');
  } catch (error) {
    console.error('Warning: Failed to connect to Elasticsearch:', error.message);
    console.error('The memory server will still start, but operations requiring Elasticsearch will fail');
  }
  
  // Create the MCP server
  const server = new Server({
    name: "memory",
    version: "1.0.0",
  }, {
    capabilities: {
      tools: {},
      // Add empty resource and prompt capabilities to support list requests
      resources: {},
      prompts: {}
    },
  });
  
  console.error('Starting MCP server...');

  // Handle resources/list requests (return empty list)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (DEBUG) {
      console.error('ListResourcesRequestSchema');
    }
    return {
      resources: []
    };
  });

  // Handle prompts/list requests (return empty list)
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    if (DEBUG) {
      console.error('ListPromptsRequestSchema');
    }
    return {
      prompts: []
    };
  });

  // Register the tools handler to list all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "create_entities",
          description: "Create entities in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: {type: "string", description: "Entity name"},
                    entityType: {type: "string", description: "Entity type"},
                    observations: {
                      type: "array", 
                      items: {type: "string"},
                      description: "Observations about this entity"
                    },
                    isImportant: {type: "boolean", description: "Is entity important"}
                  },
                  required: ["name", "entityType"]
                }
              }
            },
            required: ["entities"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "update_entities",
          description: "Update entities in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: {type: "string"},
                    entityType: {type: "string"},
                    observations: {
                      type: "array",
                      items: {type: "string"}
                    },
                    isImportant: {type: "boolean"}
                  },
                  required: ["name"]
                }
              }
            },
            required: ["entities"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "delete_entities",
          description: "Delete entities from knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: {type: "string"},
                description: "Names of entities to delete"
              }
            },
            required: ["names"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "create_relations",
          description: "Create relationships between entities in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              relations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    from: {type: "string", description: "Source entity name"},
                    to: {type: "string", description: "Target entity name"},
                    type: {type: "string", description: "Relationship type"},
                    metadata: {
                      type: "object", 
                      additionalProperties: true,
                      description: "Additional relationship metadata"
                    }
                  },
                  required: ["from", "to", "type"]
                }
              }
            },
            required: ["relations"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "delete_relations",
          description: "Delete relationships from knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              relations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    from: {type: "string"},
                    to: {type: "string"},
                    type: {type: "string"}
                  },
                  required: ["from", "to", "type"]
                }
              }
            },
            required: ["relations"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "search_nodes",
          description: "Search for entities in knowledge graph (memory) using Elasticsearch query capabilities. Returns matching entities and their relations.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Elasticsearch query (supports boolean operators, wildcards, fuzzy matching)"
              },
              entityTypes: {
                type: "array",
                items: {type: "string"},
                description: "Filter by entity types"
              },
              limit: {
                type: "integer",
                description: "Max results (default: 10)"
              },
              sortBy: {
                type: "string",
                enum: ["relevance", "recency", "importance"],
                description: "Sort by relevance, recency, or importance"
              }
            },
            required: ["query"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "open_nodes",
          description: "Get details about specific entities in knowledge graph (memory) and their relations",
          inputSchema: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: {type: "string"},
                description: "Names of entities to retrieve"
              }
            },
            required: ["names"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "add_observations",
          description: "Add observations to an existing entity in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Entity name"
              },
              observations: {
                type: "array",
                items: {type: "string"},
                description: "New observations to add"
              }
            },
            required: ["name", "observations"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "mark_important",
          description: "Mark entity as important in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Entity name"
              },
              important: {
                type: "boolean",
                description: "Set as important (true) or not (false)"
              }
            },
            required: ["name", "important"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "get_recent",
          description: "Get recently accessed entities from knowledge graph (memory) and their relations",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "integer",
                description: "Max results (default: 10)"
              }
            },
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        }
      ]
    };
  });
  
  // Register the call tool handler to handle tool executions
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (DEBUG) {
      console.error('Tool request received:', request.params.name);
      console.error('Tool request params:', JSON.stringify(request.params));
    }
    
    const toolName = request.params.name;
    // When using inputSchema, client sends parameters in 'arguments' not 'parameters'
    const params = request.params.arguments as any; // Type assertion to handle the unknown parameters
    
    if (DEBUG) {
      console.error('Parsed parameters:', JSON.stringify(params));
    }
    
    // Helper function to format response for Claude
    const formatResponse = (data: any) => {
      // Convert result to string for text field
      const stringifiedData = JSON.stringify(data, null, 2);
      return {
        content: [
          {
            type: "text",
            text: stringifiedData,
          },
        ],
      };
    };
    
    if (toolName === "create_entities") {
      const entities = params.entities;
      const createdEntities = [];
      
      for (const entity of entities) {
        const savedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations,
          isImportant: entity.isImportant
        });
        
        createdEntities.push(savedEntity);
      }
      
      return formatResponse({
        entities: createdEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        }))
      });
    }
    else if (toolName === "update_entities") {
      const entities = params.entities;
      const updatedEntities = [];
      
      for (const entity of entities) {
        // Get the existing entity first, then update with new values
        const existingEntity = await kgClient.getEntity(entity.name);
        if (!existingEntity) {
          throw new Error(`Entity "${entity.name}" not found`);
        }
        
        // Update with new values, preserving existing values for missing fields
        const updatedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType || existingEntity.entityType,
          observations: entity.observations || existingEntity.observations,
          isImportant: entity.isImportant !== undefined ? entity.isImportant : existingEntity.isImportant
        });
        
        updatedEntities.push(updatedEntity);
      }
      
      return formatResponse({
        entities: updatedEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        }))
      });
    }
    else if (toolName === "delete_entities") {
      const names = params.names;
      const results = [];
      
      // Delete each entity individually
      for (const name of names) {
        const success = await kgClient.deleteEntity(name);
        results.push({ name, deleted: success });
      }
      
      return formatResponse({
        success: true,
        results
      });
    }
    else if (toolName === "create_relations") {
      const relations = params.relations;
      const savedRelations = [];
      
      for (const relation of relations) {
        const savedRelation = await kgClient.saveRelation({
          from: relation.from,
          to: relation.to,
          relationType: relation.type // Map "type" from API to "relationType" in internal model
        });
        
        savedRelations.push(savedRelation);
      }
      
      return formatResponse({
        relations: savedRelations.map(r => ({
          from: r.from,
          to: r.to,
          type: r.relationType // Map "relationType" from internal model to "type" in API
        }))
      });
    }
    else if (toolName === "delete_relations") {
      const relations = params.relations;
      const results = [];
      
      // Delete each relation individually
      for (const relation of relations) {
        const success = await kgClient.deleteRelation(
          relation.from, 
          relation.to, 
          relation.type // Map "type" from API to "relationType" in internal call
        );
        results.push({ 
          from: relation.from, 
          to: relation.to, 
          type: relation.type,
          deleted: success 
        });
      }
      
      return formatResponse({
        success: true,
        results
      });
    }
    else if (toolName === "search_nodes") {
      const searchParams: ESSearchParams = {
        query: params.query,
        entityTypes: params.entityTypes,
        limit: params.limit || 10,
        sortBy: params.sortBy
      };
      
      const results = await kgClient.search(searchParams);
      
      // Transform the results to the expected format, removing unnecessary fields
      const entities = results.hits.hits
        .filter((hit: any) => hit._source.type === 'entity')
        .map((hit: any) => ({
          name: hit._source.name,
          entityType: hit._source.entityType,
          observations: (hit._source as ESEntity).observations
        }));
      
      // Get relations between these entities
      const entityNames = entities.map(e => e.name);
      const { relations } = await kgClient.getRelationsForEntities(entityNames);
      
      // Map relations to the expected format
      const formattedRelations = relations.map(r => ({
        from: r.from,
        to: r.to,
        type: r.relationType
      }));
      
      return formatResponse({ entities, relations: formattedRelations });
    }
    else if (toolName === "open_nodes") {
      const names = params.names;
      const entities = [];
      
      // Get each entity by name
      for (const name of names) {
        const entity = await kgClient.getEntity(name);
        if (entity) {
          entities.push(entity);
        }
      }
      
      // Format entities
      const formattedEntities = entities.map(e => ({
        name: e.name,
        entityType: e.entityType,
        observations: e.observations
      }));
      
      // Get relations between these entities
      const entityNames = formattedEntities.map(e => e.name);
      const { relations } = await kgClient.getRelationsForEntities(entityNames);
      
      // Map relations to the expected format
      const formattedRelations = relations.map(r => ({
        from: r.from,
        to: r.to,
        type: r.relationType
      }));
      
      return formatResponse({ entities: formattedEntities, relations: formattedRelations });
    }
    else if (toolName === "add_observations") {
      const name = params.name;
      const observations = params.observations;
      
      // Get existing entity
      const entity = await kgClient.getEntity(name);
      if (!entity) {
        throw new Error(`Entity "${name}" not found`);
      }
      
      // Add new observations to the existing ones
      const updatedObservations = [
        ...entity.observations,
        ...observations
      ];
      
      // Update the entity
      const updatedEntity = await kgClient.saveEntity({
        name: entity.name,
        entityType: entity.entityType,
        observations: updatedObservations,
        isImportant: entity.isImportant
      });
      
      return formatResponse({
        entity: {
          name: updatedEntity.name,
          entityType: updatedEntity.entityType,
          observations: updatedEntity.observations
        }
      });
    }
    else if (toolName === "mark_important") {
      const name = params.name;
      const important = params.important;
      
      // Get existing entity
      const entity = await kgClient.getEntity(name);
      if (!entity) {
        throw new Error(`Entity "${name}" not found`);
      }
      
      // Update importance flag
      const updatedEntity = await kgClient.saveEntity({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
        isImportant: important
      });
      
      return formatResponse({
        entity: {
          name: updatedEntity.name,
          entityType: updatedEntity.entityType,
          observations: updatedEntity.observations
        }
      });
    }
    else if (toolName === "get_recent") {
      const limit = params.limit || 10;
      
      // Search with empty query but sort by recency
      const searchParams: ESSearchParams = {
        query: "", // Empty query matches everything
        limit: limit,
        sortBy: 'recent' // Explicitly cast to the correct type
      };
      
      const results = await kgClient.search(searchParams);
      
      // Transform the results to the expected format, removing unnecessary fields
      const entities = results.hits.hits
        .filter((hit: any) => hit._source.type === 'entity')
        .map((hit: any) => ({
          name: hit._source.name,
          entityType: hit._source.entityType,
          observations: (hit._source as ESEntity).observations
        }));
      
      // Get relations between these entities
      const entityNames = entities.map(e => e.name);
      const { relations } = await kgClient.getRelationsForEntities(entityNames);
      
      // Map relations to the expected format
      const formattedRelations = relations.map(r => ({
        from: r.from,
        to: r.to,
        type: r.relationType
      }));
      
      return formatResponse({ entities, relations: formattedRelations });
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

// Startup error handling
startServer().catch(error => {
  console.error('Error starting server:', error);
  process.exit(1);
}); 