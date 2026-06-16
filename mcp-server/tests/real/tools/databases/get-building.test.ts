/**
 * Tests for get-building tool
 * Tests building database querying functionality through MCP
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mcpClient } from "../../../setup.js";

describe("Get Building Tool via MCP", () => {
  
  /**
   * Test that the tool is properly registered
   */
  it("should list get-building tool", async () => {
    const tools = await mcpClient.listTools();
    
    expect(tools.tools).toBeDefined();
    expect(tools.tools.length).toBeGreaterThan(0);
    
    const getBuildingTool = tools.tools.find(t => t.name === "get-building");
    expect(getBuildingTool).toBeDefined();
    expect(getBuildingTool?.inputSchema).toBeDefined();
  });

  /**
   * Test listing all buildings without search
   */
  it("should list all buildings without search", async () => {
    const result = await mcpClient.callTool({
      name: "get-building",
      arguments: {}
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    expect(parsed.Items).toBeDefined();
    expect(Array.isArray(parsed.Items)).toBe(true);
    
    // Check first building has expected fields
    if (parsed.Items.length > 0) {
      const building = parsed.Items[0];
      expect(building.Type).toBeDefined();
      expect(building.Name).toBeDefined();
      expect(building.Help).toBeDefined();
      expect(building.Cost).toBeDefined();
      // PrereqTech can be null
    }
  });

  /**
   * Test fuzzy search functionality
   */
  it("should handle fuzzy search", async () => {
    const result = await mcpClient.callTool({
      name: "get-building",
      arguments: { 
        Search: "baracks" // Intentional typo
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      // Should find Barracks despite typo
      const barracks = parsed.Items.find((b: any) => b.Name === "Barracks");
      expect(barracks).toBeDefined();
    }
  });

  /**
   * Test searching for an exact match returns full details
   */
  it("should return full details for exact match", async () => {
    const result = await mcpClient.callTool({
      name: "get-building",
      arguments: { 
        Search: "BUILDING_LIBRARY" // Exact Type match
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBe(1);
      
      const building = parsed.Items[0];
      // Should have full information
      expect(building.Type).toBe("BUILDING_LIBRARY");
      expect(building.Class).toBeDefined();
      expect(building.PrereqBuildings).toBeDefined();
      expect(Array.isArray(building.PrereqBuildings)).toBe(true);
      expect(typeof building.IsNationalWonder).toBe("boolean");
      expect(typeof building.IsWorldWonder).toBe("boolean");
      expect(typeof building.Happiness).toBe("number");
      expect(typeof building.Defense).toBe("number");
      expect(typeof building.HP).toBe("number");
      expect(typeof building.Maintenance).toBe("number");
      expect(building.UniqueOf).toBeDefined();
      expect(Array.isArray(building.UniqueOf)).toBe(true);
    }
  });

  /**
   * Test that prerequisite buildings are properly linked
   */
  it("should properly link prerequisite buildings", async () => {
    const result = await mcpClient.callTool({
      name: "get-building",
      arguments: { 
        Search: "BUILDING_UNIVERSITY" // A building with prerequisites
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBe(1);
      
      const building = parsed.Items[0];
      expect(building.PrereqBuildings).toBeDefined();
      expect(Array.isArray(building.PrereqBuildings)).toBe(true);
      // University typically requires Library
      if (building.PrereqBuildings.length > 0) {
        expect(building.PrereqBuildings[0]).toContain("Library");
      }
    }
  });

  /**
   * Test that UniqueOf field shows civilizations with unique versions
   */
  it("should include UniqueOf field for buildings with unique versions", async () => {
    const result = await mcpClient.callTool({
      name: "get-building",
      arguments: { 
        Search: "BUILDING_LIBRARY" // Test with Library which may have unique versions
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBe(1);
      
      const building = parsed.Items[0];
      // Check that UniqueOf field exists and is an array
      expect(building.UniqueOf).toBeDefined();
      expect(Array.isArray(building.UniqueOf)).toBe(true);
    }
  });

  /**
   * Test a known unique building
   */
  it("should properly show UniqueOf for unique buildings", async () => {
    const result = await mcpClient.callTool({
      name: "get-building",
      arguments: { 
        Search: "BUILDING_PAPER_MAKER" // Chinese unique Library
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      
      // If Paper Maker exists in the database
      if (parsed.Count > 0) {
        const building = parsed.Items[0];
        expect(building.UniqueOf).toBeDefined();
        expect(Array.isArray(building.UniqueOf)).toBe(true);
        // Paper Maker is Chinese unique
        if (building.UniqueOf.length > 0) {
          expect(building.UniqueOf).toContain("Chinese");
        }
      }
    }
  });
});