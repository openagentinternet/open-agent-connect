import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const STORE_COMPRESSION_METHOD = 0;

const SKIP_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '.runtime']);

function normalizeEntryName(entryName: string): string {
  return entryName.replace(/\\/g, '/');
}

function assertSafeEntryName(entryName: string): void {
  if (!entryName || path.posix.isAbsolute(entryName) || entryName.split('/').includes('..')) {
    throw new Error(`Invalid ZIP entry name: ${entryName}`);
  }
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32WithTable(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    const tableIndex = (crc ^ buffer[index]) & 0xff;
    crc = (crc >>> 8) ^ CRC_TABLE[tableIndex];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function collectEntries(
  sourceDir: string,
  exclude: string[],
): Promise<Array<{ entryName: string; filePath: string; data: Buffer }>> {
  const excludeSet = new Set(exclude.map((value) => normalizeEntryName(value).replace(/^\.\/+/, '').replace(/^\/+/, '')));
  const collected: Array<{ entryName: string; filePath: string; data: Buffer }> = [];

  async function visit(currentDir: string): Promise<void> {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

    for (const dirent of dirents) {
      if (SKIP_NAMES.has(dirent.name)) {
        continue;
      }

      const filePath = path.join(currentDir, dirent.name);
      const relativePath = normalizeEntryName(path.relative(sourceDir, filePath));
      const normalizedRelativePath = relativePath.replace(/^\.\/+/, '');
      if (!normalizedRelativePath || path.posix.isAbsolute(normalizedRelativePath) || normalizedRelativePath.split('/').includes('..')) {
        throw new Error(`Invalid ZIP entry path: ${relativePath}`);
      }
      if (excludeSet.has(normalizedRelativePath)) {
        continue;
      }

      if (dirent.isDirectory()) {
        await visit(filePath);
        continue;
      }

      if (dirent.name === '.DS_Store' || normalizedRelativePath.endsWith('/.DS_Store')) {
        continue;
      }

      assertSafeEntryName(normalizedRelativePath);
      collected.push({
        entryName: normalizedRelativePath,
        filePath,
        data: await fs.readFile(filePath),
      });
    }
  }

  await visit(sourceDir);
  collected.sort((left, right) => (left.entryName < right.entryName ? -1 : left.entryName > right.entryName ? 1 : 0));
  return collected;
}

function writeUInt16LE(target: Buffer, value: number, offset: number): number {
  target.writeUInt16LE(value & 0xffff, offset);
  return offset + 2;
}

function writeUInt32LE(target: Buffer, value: number, offset: number): number {
  target.writeUInt32LE(value >>> 0, offset);
  return offset + 4;
}

function createLocalHeader(entryName: string, data: Buffer, crc: number): Buffer {
  const nameBuffer = Buffer.from(entryName, 'utf8');
  const header = Buffer.alloc(30 + nameBuffer.length);
  let offset = 0;
  offset = writeUInt32LE(header, ZIP_LOCAL_FILE_HEADER_SIGNATURE, offset);
  offset = writeUInt16LE(header, 20, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, STORE_COMPRESSION_METHOD, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt32LE(header, crc, offset);
  offset = writeUInt32LE(header, data.byteLength, offset);
  offset = writeUInt32LE(header, data.byteLength, offset);
  offset = writeUInt16LE(header, nameBuffer.length, offset);
  offset = writeUInt16LE(header, 0, offset);
  nameBuffer.copy(header, offset);
  return header;
}

function createCentralDirectoryHeader(entryName: string, data: Buffer, crc: number, localHeaderOffset: number): Buffer {
  const nameBuffer = Buffer.from(entryName, 'utf8');
  const header = Buffer.alloc(46 + nameBuffer.length);
  let offset = 0;
  offset = writeUInt32LE(header, ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE, offset);
  offset = writeUInt16LE(header, 20, offset);
  offset = writeUInt16LE(header, 20, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, STORE_COMPRESSION_METHOD, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt32LE(header, crc, offset);
  offset = writeUInt32LE(header, data.byteLength, offset);
  offset = writeUInt32LE(header, data.byteLength, offset);
  offset = writeUInt16LE(header, nameBuffer.length, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt32LE(header, 0, offset);
  offset = writeUInt32LE(header, localHeaderOffset, offset);
  nameBuffer.copy(header, offset);
  return header;
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Buffer {
  const header = Buffer.alloc(22);
  let offset = 0;
  offset = writeUInt32LE(header, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, 0, offset);
  offset = writeUInt16LE(header, entryCount, offset);
  offset = writeUInt16LE(header, entryCount, offset);
  offset = writeUInt32LE(header, centralDirectorySize, offset);
  offset = writeUInt32LE(header, centralDirectoryOffset, offset);
  offset = writeUInt16LE(header, 0, offset);
  return header;
}

export async function writeMetaAppZipArchive(input: {
  sourceDir: string;
  outFile: string;
  exclude?: string[];
}): Promise<{ filePath: string; bytes: number; sha256: string; entries: string[] }> {
  const sourceDir = path.resolve(input.sourceDir);
  const outFile = path.resolve(input.outFile);
  const entries = await collectEntries(sourceDir, input.exclude ?? []);
  const fileParts: Buffer[] = [];
  const centralDirectoryParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    assertSafeEntryName(entry.entryName);
    const crc = crc32WithTable(entry.data);
    const localHeader = createLocalHeader(entry.entryName, entry.data, crc);
    const centralHeader = createCentralDirectoryHeader(entry.entryName, entry.data, crc, localOffset);
    fileParts.push(localHeader, entry.data);
    centralDirectoryParts.push(centralHeader);
    localOffset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralDirectoryParts);
  const endOfCentralDirectory = createEndOfCentralDirectory(entries.length, centralDirectory.byteLength, localOffset);
  const archive = Buffer.concat([...fileParts, centralDirectory, endOfCentralDirectory]);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, archive);

  return {
    filePath: outFile,
    bytes: archive.byteLength,
    sha256: createHash('sha256').update(archive).digest('hex'),
    entries: entries.map((entry) => entry.entryName),
  };
}
