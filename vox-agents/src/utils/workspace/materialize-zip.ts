/**
 * @module utils/workspace/materialize-zip
 *
 * A materialize sink that packs a seat store version into a zip stream, so the telemetry page can
 * offer it as a download. Modes and modification times are kept in the zip entries.
 */

import type { Readable } from 'node:stream';
import yazl from 'yazl';
import type { MaterializeSink } from './materialize.js';

/** Unix file type bits that yazl expects in an entry's mode. */
const regularFileType = 0o100000;
const directoryType = 0o040000;

/** A sink feeding a zip, with the stream to send and a call that finishes the archive. */
export interface ZipSink {
  sink: MaterializeSink;
  stream: Readable;
  /** Finish the archive after materialize returns. */
  end(): void;
}

/**
 * Create a sink that adds each file and directory to a zip. Call `end` once materialize returns,
 * or `stream.destroy()` to abandon the archive.
 */
export function zipSink(): ZipSink {
  const zip = new yazl.ZipFile();
  return {
    stream: zip.outputStream as Readable,
    end: () => zip.end(),
    sink: {
      file(storePath, bytes, mode, mtime) {
        zip.addBuffer(Buffer.from(bytes), storePath, { mode: regularFileType | (mode & 0o7777), mtime: new Date(mtime) });
      },
      directory(storePath, mode, mtime) {
        zip.addEmptyDirectory(storePath, { mode: directoryType | (mode & 0o7777), mtime: new Date(mtime) });
      },
    },
  };
}
