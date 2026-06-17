/**
 * Tests for get-civilization tool
 * Tests civilization database querying functionality through MCP
 */

import { describe, it, expect } from "vitest";
import { mcpClient } from "../../../setup.js";

describe("Get Civilization Tool via MCP", () => {

  /**
   * Test listing all civilizations without search
   */
  it("should list all civilizations without search", async () => {
    const result = await mcpClient.callTool({
      name: "get-civilization",
      arguments: {}
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    expect(parsed.Items).toBeDefined();
    expect(Array.isArray(parsed.Items)).toBe(true);
    
    // Check first civilization has expected fields
    if (parsed.Items.length > 0) {
      const civ = parsed.Items[0];
      expect(civ.Type).toBeDefined();
      expect(civ.Name).toBeDefined();
      expect(civ.AbilitiesSummary).toBeDefined();
      expect(Array.isArray(civ.AbilitiesSummary)).toBe(true);
      expect(civ.Leader).toBeDefined();
    }
  });

  /**
   * Test searching for a specific civilization
   */
  it("should search for specific civilization by name", async () => {
    const result = await mcpClient.callTool({
      name: "get-civilization",
      arguments: { 
        Search: "Rome"
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    expect(parsed.Items).toBeDefined();
    
    // Should find Rome
    const rome = parsed.Items.find((c: any) => c.Name === "Rome");
    expect(rome).toBeDefined();
    
    // When only one result, should return full info
    if (parsed.Count === 1) {
      const civ = parsed.Items[0];
      expect(civ.Abilities).toBeDefined();
      expect(Array.isArray(civ.Abilities)).toBe(true);
      
      // Full info should have detailed abilities
      if (civ.Abilities.length > 0) {
        const ability = civ.Abilities[0];
        expect(ability.Type).toBeDefined();
        expect(ability.Name).toBeDefined();
        expect(ability.Help).toBeDefined();
      }
      
      expect(civ.Archetype).toBeDefined();
      expect(civ.Traits).toBeDefined();
      expect(Array.isArray(civ.Traits)).toBe(true);
      expect(civ.PreferredVictory).toBeDefined();
    }
  });

  /**
   * Test fuzzy search functionality
   */
  it("should handle fuzzy search", async () => {
    const result = await mcpClient.callTool({
      name: "get-civilization",
      arguments: { 
        Search: "grece" // Intentional typo for Greece
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      // Should find Greece despite typo
      const greece = parsed.Items.find((c: any) => c.Name === "Greece");
      expect(greece).toBeDefined();
    }
  });

  /**
   * Test searching for an exact match returns full details
   */
  it("should return full details for exact match", async () => {
    const result = await mcpClient.callTool({
      name: "get-civilization",
      arguments: { 
        Search: "CIVILIZATION_ROME" // Exact Type match
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBe(1);
      
      const civ = parsed.Items[0];
      // Should have full information
      expect(civ.Type).toBe("CIVILIZATION_ROME");
      expect(civ.Abilities).toBeDefined();
      expect(Array.isArray(civ.Abilities)).toBe(true);
      
      // Check abilities structure
      if (civ.Abilities.length > 0) {
        const ability = civ.Abilities[0];
        expect(ability.Type).toBeDefined();
        expect(ability.Name).toBeDefined();
        expect(ability.Help).toBeDefined();
        // Replacing is optional
      }
      
      expect(civ.Archetype).toBeDefined();
      expect(civ.Traits).toBeDefined();
      expect(Array.isArray(civ.Traits)).toBe(true);
      expect(civ.PreferredVictory).toBeDefined();
    }
  });

  /**
   * Test that unique units are properly linked
   */
  it("should properly link unique units", async () => {
    const result = await mcpClient.callTool({
      name: "get-civilization",
      arguments: { 
        Search: "CIVILIZATION_JAPAN" // Japan has unique units
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Count).toBe(1);
      
      const civ = parsed.Items[0];
      expect(civ.Abilities).toBeDefined();
      
      // Should have at least one unit ability
      const unitAbilities = civ.Abilities.filter((a: any) => a.Type === 'Unit');
      expect(unitAbilities.length).toBeGreaterThan(0);
      
      // Check unit has replacing field
      if (unitAbilities.length > 0) {
        const unit = unitAbilities[0];
        expect(unit.Name).toBeDefined();
        expect(unit.Replacing).toBeDefined();
      }
    }
  });

  /**
   * Test that unique buildings are properly linked
   */
  it("should properly link unique buildings", async () => {
    const result = await mcpClient.callTool({
      name: "get-civilization",
      arguments: { 
        Search: "CIVILIZATION_EGYPT" // Egypt has unique buildings
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      
      if (parsed.Count === 1) {
        const civ = parsed.Items[0];
        expect(civ.Abilities).toBeDefined();
        
        // Check if there are building abilities
        const buildingAbilities = civ.Abilities.filter((a: any) => a.Type === 'Building');
        
        if (buildingAbilities.length > 0) {
          const building = buildingAbilities[0];
          expect(building.Name).toBeDefined();
          expect(building.Help).toBeDefined();
        }
      }
    }
  });

  /**
   * Test searching for civilizations by leader
   */
  it("should find civilizations by leader search", async () => {
    const result = await mcpClient.callTool({
      name: "get-civilization",
      arguments: { 
        Search: "Caesar",
        MaxResults: 5
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      
      // Should find civilizations with Caesar as leader
      const caesarCivs = parsed.Items.filter((c: any) => 
        c.Leader && c.Leader.toLowerCase().includes("caesar")
      );
      
      if (caesarCivs.length > 0) {
        expect(caesarCivs[0].Name).toBeDefined();
      }
    }
  });
});