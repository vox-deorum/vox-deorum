/**
 * @module newspaper/renderer/dds
 *
 * Converts rendered newspaper images into the legacy DDS textures the game viewer loads.
 * The converter binary is vendored, so source runs and installed builds resolve the same path.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('NewspaperDds');

/** Legacy DDS formats produced for the newspaper viewer. */
export type DdsFormat = 'BC1_UNORM' | 'B8G8R8A8_UNORM';

/** Parsed properties of a validated legacy DDS texture. */
export interface DdsInfo {
  width: number;
  height: number;
  format: DdsFormat;
  payloadBytes: number;
}

/** Result of converting one image into a DDS texture. */
export interface DdsConversion {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Default converter location. The module sits three levels below the package root in both source
 * (`src/newspaper/renderer`) and compiled (`dist/newspaper/renderer`) layouts, so the vendor path is identical.
 */
export const texconvExecutablePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../vendor/texconv/texconv.exe',
);

/** Upper bound for one texconv run, so a stuck converter cannot block a render batch. */
const texconvTimeoutMs = 60_000;

/** Header and payload constants from the legacy DDS layout. */
const ddsMagic = 0x20534444;
const ddsHeaderBytes = 128;
const ddsHeaderSize = 124;
const ddsPixelFormatSize = 32;
const ddsFlagCaps = 0x1;
const ddsFlagHeight = 0x2;
const ddsFlagWidth = 0x4;
const ddsFlagPitch = 0x8;
const ddsFlagPixelFormat = 0x1000;
const ddsFlagMipMapCount = 0x20000;
const ddsFlagLinearSize = 0x80000;
const ddsCapsTexture = 0x1000;
const ddsCaps2CubeMap = 0x200;
const ddsCaps2Volume = 0x200000;
const ddpfAlphaPixels = 0x1;
const ddpfFourCc = 0x4;
const ddpfRgb = 0x40;
const fourCcDxt1 = 0x31545844;
const fourCcDx10 = 0x30315844;

/** Reads a two-letter pixel-format tag from a DDS header for error messages. */
function fourCcText(value: number): string {
  return Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff])
    .toString('ascii')
    .replace(/[^ -~]/g, '?');
}

/** Returns the byte length of one top-level BC1 block texture. */
function bc1PayloadBytes(width: number, height: number): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
}

/** Describes why a buffer is not a supported legacy DDS texture. */
function invalidDds(message: string): Error {
  return new Error(`Invalid DDS texture: ${message}`);
}

/**
 * Validates a legacy DDS header and payload before a render bundle publishes the file.
 * Rejects DX10 headers, mipmaps, volumes, cube maps, and formats the viewer does not use.
 */
export function validateDds(buffer: Buffer, expectedWidth?: number, expectedHeight?: number): DdsInfo {
  if (buffer.length < ddsHeaderBytes) {
    throw invalidDds(`file is ${buffer.length} bytes, shorter than the 128-byte header.`);
  }
  if (buffer.readUInt32LE(0) !== ddsMagic) {
    throw invalidDds('missing the DDS magic value.');
  }
  if (buffer.readUInt32LE(4) !== ddsHeaderSize) {
    throw invalidDds(`header size is ${buffer.readUInt32LE(4)}, expected ${ddsHeaderSize}.`);
  }

  const flags = buffer.readUInt32LE(8);
  requireFlag(flags, ddsFlagCaps, 'caps');
  requireFlag(flags, ddsFlagHeight, 'height');
  requireFlag(flags, ddsFlagWidth, 'width');
  requireFlag(flags, ddsFlagPixelFormat, 'pixel format');

  const height = buffer.readUInt32LE(12);
  const width = buffer.readUInt32LE(16);
  const pitchOrLinearSize = buffer.readUInt32LE(20);
  const depth = buffer.readUInt32LE(24);
  const mipMapCount = buffer.readUInt32LE(28);

  if (width === 0 || height === 0) {
    throw invalidDds(`dimensions ${width}x${height} must be positive.`);
  }
  if (expectedWidth !== undefined && width !== expectedWidth) {
    throw invalidDds(`width is ${width}, expected ${expectedWidth}.`);
  }
  if (expectedHeight !== undefined && height !== expectedHeight) {
    throw invalidDds(`height is ${height}, expected ${expectedHeight}.`);
  }
  if (depth > 1) {
    throw invalidDds(`depth is ${depth}, expected a single 2D slice.`);
  }
  if ((flags & ddsFlagMipMapCount) !== 0 && mipMapCount !== 1) {
    throw invalidDds(`mip chain has ${mipMapCount} levels, expected one.`);
  }
  if (mipMapCount > 1) {
    throw invalidDds(`mip chain has ${mipMapCount} levels, expected one.`);
  }

  const caps = buffer.readUInt32LE(108);
  const caps2 = buffer.readUInt32LE(112);
  if ((caps & ddsCapsTexture) === 0) {
    throw invalidDds('caps do not identify a texture.');
  }
  if ((caps2 & (ddsCaps2CubeMap | ddsCaps2Volume)) !== 0) {
    throw invalidDds('cube maps and volume textures are not supported.');
  }

  const pixelFormatSize = buffer.readUInt32LE(76);
  if (pixelFormatSize !== ddsPixelFormatSize) {
    throw invalidDds(`pixel format size is ${pixelFormatSize}, expected ${ddsPixelFormatSize}.`);
  }

  const pixelFormatFlags = buffer.readUInt32LE(80);
  const fourCc = buffer.readUInt32LE(84);
  const rgbBitCount = buffer.readUInt32LE(88);
  const redMask = buffer.readUInt32LE(92);
  const greenMask = buffer.readUInt32LE(96);
  const blueMask = buffer.readUInt32LE(100);
  const alphaMask = buffer.readUInt32LE(104);

  let format: DdsFormat;
  let payloadBytes: number;
  if ((pixelFormatFlags & ddpfFourCc) !== 0) {
    if (fourCc === fourCcDx10) {
      throw invalidDds('DX10 headers are not supported; use a legacy header format.');
    }
    if (fourCc !== fourCcDxt1) {
      throw invalidDds(`fourCC "${fourCcText(fourCc)}" is not supported; expected DXT1.`);
    }
    format = 'BC1_UNORM';
    payloadBytes = bc1PayloadBytes(width, height);
  } else if ((pixelFormatFlags & ddpfRgb) !== 0) {
    if ((pixelFormatFlags & ddpfAlphaPixels) === 0
      || rgbBitCount !== 32
      || redMask !== 0x00ff0000
      || greenMask !== 0x0000ff00
      || blueMask !== 0x000000ff
      || alphaMask !== 0xff000000) {
      throw invalidDds('pixel format is not B8G8R8A8_UNORM.');
    }
    format = 'B8G8R8A8_UNORM';
    payloadBytes = width * height * 4;
  } else {
    throw invalidDds('pixel format is neither DXT1 nor uncompressed 32-bit BGRA.');
  }

  const payloadLength = buffer.length - ddsHeaderBytes;
  if (payloadLength !== payloadBytes) {
    throw invalidDds(`payload is ${payloadLength} bytes, expected ${payloadBytes} for ${format}.`);
  }

  if ((flags & ddsFlagLinearSize) !== 0 && pitchOrLinearSize !== payloadBytes) {
    throw invalidDds(`linear size is ${pitchOrLinearSize}, expected ${payloadBytes}.`);
  }
  if ((flags & ddsFlagPitch) !== 0 && format === 'B8G8R8A8_UNORM' && pitchOrLinearSize !== width * 4) {
    throw invalidDds(`pitch is ${pitchOrLinearSize}, expected ${width * 4}.`);
  }
  if ((flags & (ddsFlagLinearSize | ddsFlagPitch)) === 0) {
    throw invalidDds('header names neither a linear size nor a pitch.');
  }

  return { width, height, format, payloadBytes };
}

/** Throws when a required DDS header flag is missing. */
function requireFlag(flags: number, flag: number, name: string): void {
  if ((flags & flag) === 0) {
    throw invalidDds(`header flag "${name}" is missing.`);
  }
}

/** Runs texconv without a shell and with bounded time and output buffers. */
function runTexconv(executablePath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executablePath, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      shell: false,
      timeout: texconvTimeoutMs,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }

      const detail = stderr.trim() || stdout.trim();
      const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
      const reason = timedOut ? `timed out after ${texconvTimeoutMs} ms` : error.message;
      reject(new Error(`texconv failed: ${reason}${detail ? `\n${detail}` : ''}`));
    });
  });
}

/**
 * Converts one image into a single-mip legacy DDS texture in `outputDir`.
 * `executablePath` overrides the vendored converter for diagnostics and tests.
 */
export async function convertDds(
  inputPng: string,
  outputDir: string,
  format: DdsFormat,
  executablePath: string = texconvExecutablePath,
): Promise<DdsConversion> {
  const absoluteInput = path.resolve(inputPng);
  const absoluteOutputDir = path.resolve(outputDir);
  const outputPath = path.join(
    absoluteOutputDir,
    `${path.basename(absoluteInput, path.extname(absoluteInput))}.dds`,
  );

  await mkdir(absoluteOutputDir, { recursive: true });
  await rm(outputPath, { force: true });

  logger.debug(`Converting ${absoluteInput} to ${format}`, { outputPath });
  await runTexconv(executablePath, ['-nologo', '-y', '-dx9', '-m', '1', '-f', format, '-o', absoluteOutputDir, absoluteInput]);

  const buffer = await readFile(outputPath);
  const info = validateDds(buffer);
  if (info.format !== format) {
    throw new Error(`texconv produced ${info.format}, expected ${format}.`);
  }

  logger.debug(`Converted ${outputPath}`, { width: info.width, height: info.height, bytes: buffer.length });
  return { path: outputPath, width: info.width, height: info.height, bytes: buffer.length };
}
