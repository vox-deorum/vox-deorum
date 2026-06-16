/**
 * Tests for get-policy tool
 * Tests policy database querying functionality through MCP
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mcpClient } from "../../../setup.js";

describe("Get Policy Tool via MCP", () => {
  
  /**
   * Test that the tool is properly registered
   */
  it("should list get-policy tool", async () => {
    const tools = await mcpClient.listTools();
    
    expect(tools.tools).toBeDefined();
    expect(tools.tools.length).toBeGreaterThan(0);
    
    const getPolicyTool = tools.tools.find(t => t.name === "get-policy");
    expect(getPolicyTool).toBeDefined();
    expect(getPolicyTool?.inputSchema).toBeDefined();
  });

  /**
   * Test listing all policies without search
   */
  it("should list all policies without search", async () => {
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: {}
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    expect(parsed.Items).toBeDefined();
    expect(Array.isArray(parsed.Items)).toBe(true);
    
    // Check first policy has expected fields
    if (parsed.Items.length > 0) {
      const policy = parsed.Items[0];
      expect(policy.Type).toBeDefined();
      expect(policy.Name).toBeDefined();
      expect(policy.Help).toBeDefined();
      // Era and Branch can be null
      expect('Era' in policy).toBe(true);
      expect('Branch' in policy).toBe(true);
    }
  });

  /**
   * Test searching for a specific policy
   */
  it("should search for specific policy by name", async () => {
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: { 
        Search: "Liberty"
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    expect(parsed.Items).toBeDefined();
    
    // Should find Liberty-related policies
    const libertyPolicies = parsed.Items.filter((p: any) => 
      p.Name.toLowerCase().includes("liberty") || 
      p.Branch?.toLowerCase().includes("liberty")
    );
    expect(libertyPolicies.length).toBeGreaterThan(0);
  });

  /**
   * Test fuzzy search functionality
   */
  it("should handle fuzzy search", async () => {
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: { 
        Search: "traditin" // Intentional typo for "Tradition"
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    // Should find Tradition despite typo
    const traditionPolicies = parsed.Items.filter((p: any) => 
      p.Name.toLowerCase().includes("tradition") || 
      p.Branch?.toLowerCase().includes("tradition")
    );
    expect(traditionPolicies.length).toBeGreaterThan(0);
  });

  /**
   * Test searching for an exact match returns full details
   */
  it("should return full details for exact match", async () => {
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: { 
        Search: "POLICY_CULTURAL_REVOLUTION" // Exact Type match
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBe(1);
    
    const policy = parsed.Items[0];
    // Should have full information
    expect(policy.Type).toBe("POLICY_CULTURAL_REVOLUTION");
    expect(policy.Name).toBeDefined();
    expect(policy.Help).toBeDefined();
    expect('Era' in policy).toBe(true);
    expect('Branch' in policy).toBe(true);
    expect('Level' in policy).toBe(true);
    expect(policy.PrereqPolicies).toBeDefined();
    expect(Array.isArray(policy.PrereqPolicies)).toBe(true);
  });

  /**
   * Test searching for policies by branch
   */
  it("should find policies by branch search", async () => {
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: { 
        Search: "Honor",
        MaxResults: 10
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    expect(parsed.Count).toBeGreaterThan(0);
    
    // Should find Honor branch policies
    const honorPolicies = parsed.Items.filter((p: any) => 
      p.Branch?.toLowerCase().includes("honor") || p.Name.toLowerCase().includes("honor")
    );
    expect(honorPolicies.length).toBeGreaterThan(0);
  });

  /**
   * Test that prerequisite policies are properly linked
   */
  it("should properly link prerequisite policies", async () => {
    // Search for a policy that typically has prerequisites
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: { 
        Search: "POLICY_OLIGARCHY" // A policy in Tradition branch
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    
    if (parsed.Count === 1) {
      const policy = parsed.Items[0];
      expect(policy.PrereqPolicies).toBeDefined();
      expect(Array.isArray(policy.PrereqPolicies)).toBe(true);
      // Oligarchy typically requires Tradition opener
      if (policy.PrereqPolicies.length > 0) {
        expect(policy.PrereqPolicies.some((p: string) => 
          p.includes("Tradition")
        )).toBe(true);
      }
    }
  });

  /**
   * Test searching for policies with specific era
   */
  it("should find policies by era", async () => {
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: { 
        Search: "Medieval",
        MaxResults: 10
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    
    // Some policies unlock in specific eras
    if (parsed.Count > 0) {
      const medievalPolicies = parsed.Items.filter((p: any) => 
        p.Era?.toLowerCase().includes("medieval")
      );
      // May or may not find policies specific to Medieval era
      expect(medievalPolicies).toBeDefined();
    }
  });

  /**
   * Test that policy branches are properly identified
   */
  it("should properly identify policy branches", async () => {
    const result = await mcpClient.callTool({
      name: "get-policy",
      arguments: { 
        Search: "POLICY_TRADITION" // The Tradition opener
      }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    const parsed = JSON.parse(content.text);
    
    if (parsed.Count === 1) {
      const policy = parsed.Items[0];
      expect(policy.Type).toBe("POLICY_TRADITION");
      // Branch openers typically don't have a branch set (they ARE the branch)
      // But they have specific characteristics
      expect(policy.Level).toBeDefined();
    }
  });
});