/**
 * Kysely plugin to automatically serialize arrays and objects to JSON strings
 * before inserting/updating to database
 */

import {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow,
  RootOperationNode,
  ValueNode,
  PrimitiveValueListNode,
} from 'kysely';

/**
 * Plugin that automatically serializes arrays and objects to JSON strings
 */
export class JsonSerializePlugin implements KyselyPlugin {
  /**
   * Transform query to serialize arrays/objects before execution
   */
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.transformNode(args.node) as RootOperationNode;
  }

  /**
   * No transformation needed for results
   */
  async transformResult(
    args: PluginTransformResultArgs
  ): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }

  /**
   * Recursively transform nodes in the query tree
   */
  private transformNode(node: any): any {
    if (!node || typeof node !== 'object') {
      return node;
    }

    // Handle value nodes that might contain arrays/objects
    if (node.kind === 'ValueNode') {
      return this.transformValueNode(node);
    }

    // Handle primitive value list nodes (used in inserts/updates)
    if (node.kind === 'PrimitiveValueListNode') {
      return this.transformPrimitiveValueListNode(node);
    }

    // Recursively transform child nodes
    const transformed: any = {};
    for (const key in node) {
      const value = node[key];
      if (Array.isArray(value)) {
        transformed[key] = value.map(item => this.transformNode(item));
      } else if (value && typeof value === 'object') {
        transformed[key] = this.transformNode(value);
      } else {
        transformed[key] = value;
      }
    }

    return transformed;
  }

  /**
   * Transform a value node, serializing arrays/objects to JSON
   */
  private transformValueNode(node: ValueNode): ValueNode {
    const value = node.value;
    
    // Serialize arrays and objects (but not null/undefined)
    if (value !== null && value !== undefined) {
      if (Array.isArray(value) || (typeof value === 'object' && !(value instanceof Date))) {
        return {
          ...node,
          value: JSON.stringify(value)
        };
      }
    }
    
    return node;
  }

  /**
   * Transform a primitive value list node
   */
  private transformPrimitiveValueListNode(node: PrimitiveValueListNode): PrimitiveValueListNode {
    const values = node.values.map(value => {
      // Serialize arrays and objects (but not null/undefined/dates)
      if (value !== null && value !== undefined) {
        if (Array.isArray(value) || (typeof value === 'object' && !(value instanceof Date))) {
          return JSON.stringify(value);
        }
      }
      return value;
    });

    return {
      ...node,
      values
    };
  }
}