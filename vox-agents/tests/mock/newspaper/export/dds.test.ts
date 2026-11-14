/** Verify the DDS guard that runs before a newspaper bundle can publish textures. */
import { describe, expect, it } from "vitest";

import { validateDds } from "../../../../src/newspaper/export/dds.js";

/** Build one legacy DDS header and exact BC1 payload for the requested dimensions. */
function createDds(width: number, height: number, fourCc = 0x31545844): Buffer {
  const payloadBytes = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
  const buffer = Buffer.alloc(128 + payloadBytes);
  buffer.writeUInt32LE(0x20534444, 0);
  buffer.writeUInt32LE(124, 4);
  buffer.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8);
  buffer.writeUInt32LE(height, 12);
  buffer.writeUInt32LE(width, 16);
  buffer.writeUInt32LE(payloadBytes, 20);
  buffer.writeUInt32LE(0, 24);
  buffer.writeUInt32LE(1, 28);
  buffer.writeUInt32LE(32, 76);
  buffer.writeUInt32LE(0x4, 80);
  buffer.writeUInt32LE(fourCc, 84);
  buffer.writeUInt32LE(0x1000, 108);
  buffer.writeUInt32LE(0, 112);
  return buffer;
}

describe("newspaper DDS validation", () => {
  it("should accept a legacy BC1 texture with the expected dimensions", () => {
    const info = validateDds(createDds(8, 4), 8, 4);
    expect(info).toEqual({ width: 8, height: 4, format: "BC1_UNORM", payloadBytes: 16 });
  });

  it("should reject truncated headers and payloads", () => {
    expect(() => validateDds(Buffer.alloc(100))).toThrow();

    const truncatedPayload = createDds(8, 8).subarray(0, 140);
    expect(() => validateDds(truncatedPayload)).toThrow();
  });

  it("should reject DX10 headers", () => {
    expect(() => validateDds(createDds(8, 8, 0x30315844))).toThrow(/DX10/);
  });

  it("should reject dimensions that differ from the bundle contract", () => {
    expect(() => validateDds(createDds(8, 4), 8, 5)).toThrow();
    expect(() => validateDds(createDds(8, 4), 9, 4)).toThrow();
  });

  it("should reject extra or missing payload bytes", () => {
    const valid = createDds(8, 4);
    expect(() => validateDds(Buffer.concat([valid, Buffer.alloc(1)]))).toThrow();
    expect(() => validateDds(valid.subarray(0, valid.length - 1))).toThrow();
  });
});
