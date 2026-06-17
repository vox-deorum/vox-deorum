/**
 * Tests for get-technology tool
 * Tests technology database querying functionality through MCP
 */

import { describe, it, expect } from "vitest";
import { mcpClient } from "../../../setup.js";

describe("Get Technology Tool via MCP", () => {

  /**
   * Test listing all technologies without search
   */
  it("should list all technologies without search", async () => {
    const result = await mcpClient.callTool({
      name: "get-technology",
      arguments: {}
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    expect(parsed.Items).toBeDefined();
    expect(Array.isArray(parsed.Items)).toBe(true);
    
    // Check first technology has expected fields
    if (parsed.Items.length > 0) {
      const tech = parsed.Items[0];
      expect(tech.Type).toBeDefined();
      expect(tech.Name).toBeDefined();
      expect(tech.Help).toBeDefined();
      expect(tech.Cost).toBeDefined();
      expect(tech.Era).toBeDefined();
    }
  });

  /**
   * Test searching for a specific technology
   */
  it("should search for specific technology by name", async () => {
    const result = await mcpClient.callTool({
      name: "get-technology",
      arguments: { 
        Search: "Agriculture"
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    expect(parsed.Items).toBeDefined();
    
    // Should find Agriculture
    const agriculture = parsed.Items.find((t: any) => t.Name === "Agriculture");
    expect(agriculture).toBeDefined();
    
    // When only one result, should return full info
    if (parsed.Count === 1) {
      const tech = parsed.Items[0];
      expect(tech.PrereqTechs).toBeDefined();
      expect(tech.UnitsUnlocked).toBeDefined();
      expect(tech.BuildingsUnlocked).toBeDefined();
      expect(tech.ImprovementsUnlocked).toBeDefined();
      expect(tech.WorldWondersUnlocked).toBeDefined();
      expect(tech.NationalWondersUnlocked).toBeDefined();
    }
  });

  /**
   * Test fuzzy search functionality
   */
  it("should handle fuzzy search", async () => {
    const result = await mcpClient.callTool({
      name: "get-technology",
      arguments: { 
        Search: "writng" // Intentional typo
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      // Should find Writing despite typo
      const writing = parsed.Items.find((t: any) => t.Name === "Writing");
      expect(writing).toBeDefined();
    }
  });

  /**
   * Test searching for an exact match returns full details
   */
  it("should return full details for exact match", async () => {
    const result = await mcpClient.callTool({
      name: "get-technology",
      arguments: { 
        Search: "TECH_AGRICULTURE" // Exact Type match
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBe(1);
      
      const tech = parsed.Items[0];
      // Should have full information
      expect(tech.Type).toBe("TECH_AGRICULTURE");
      expect(tech.PrereqTechs).toBeDefined();
      expect(Array.isArray(tech.PrereqTechs)).toBe(true);
      expect(tech.UnitsUnlocked).toBeDefined();
      expect(Array.isArray(tech.UnitsUnlocked)).toBe(true);
      expect(tech.ImprovementsUnlocked).toBeDefined();
      expect(Array.isArray(tech.ImprovementsUnlocked)).toBe(true);
      expect(Array.isArray(tech.BuildingsUnlocked)).toBe(true);
      expect(Array.isArray(tech.NationalWondersUnlocked)).toBe(true);
      expect(Array.isArray(tech.WorldWondersUnlocked)).toBe(true);
    }
  });

  /**
   * Test searching for technologies by era
   */
  it("should find technologies by era search", async () => {
    const result = await mcpClient.callTool({
      name: "get-technology",
      arguments: { 
        Search: "Ancient",
        MaxResults: 10
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBeGreaterThan(0);
      
      // Should find ancient era technologies
      const ancientTechs = parsed.Items.filter((t: any) => 
        t.Era && t.Era.toLowerCase().includes("ancient")
      );
      expect(ancientTechs.length).toBeGreaterThan(0);
    }
  });

  /**
   * Test that prerequisite technologies are properly linked
   */
  it("should properly link prerequisite technologies", async () => {
    const result = await mcpClient.callTool({
      name: "get-technology",
      arguments: { 
        Search: "TECH_BRONZE_WORKING" // A technology with prerequisites
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBe(1);
      
      const tech = parsed.Items[0];
      expect(tech.PrereqTechs).toBeDefined();
      expect(Array.isArray(tech.PrereqTechs)).toBe(true);
      // Bronze Working typically requires Mining
      if (tech.PrereqTechs.length > 0) {
        expect(tech.PrereqTechs[0]).toContain("Mining");
      }
    }
  });
});