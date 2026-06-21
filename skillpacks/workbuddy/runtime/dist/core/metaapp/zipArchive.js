"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeMetaAppZipArchive = writeMetaAppZipArchive;
exports.extractMetaAppZipArchive = extractMetaAppZipArchive;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const node_zlib_1 = require("node:zlib");
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const STORE_COMPRESSION_METHOD = 0;
const DEFLATE_COMPRESSION_METHOD = 8;
const DEFAULT_MAX_EXTRACTED_ENTRIES = 2_000;
const DEFAULT_MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const SKIP_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '.runtime']);
const inflateRawAsync = (0, node_util_1.promisify)(node_zlib_1.inflateRaw);
function normalizeEntryName(entryName) {
    return entryName.replace(/\\/g, '/');
}
function assertSafeEntryName(entryName) {
    if (!entryName || node_path_1.default.posix.isAbsolute(entryName) || entryName.split('/').includes('..')) {
        throw new Error(`Invalid ZIP entry name: ${entryName}`);
    }
}
function buildCrcTable() {
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
function crc32WithTable(buffer) {
    let crc = 0xffffffff;
    for (let index = 0; index < buffer.length; index += 1) {
        const tableIndex = (crc ^ buffer[index]) & 0xff;
        crc = (crc >>> 8) ^ CRC_TABLE[tableIndex];
    }
    return (crc ^ 0xffffffff) >>> 0;
}
async function collectEntries(sourceDir, exclude) {
    const excludeSet = new Set(exclude.map((value) => normalizeEntryName(value).replace(/^\.\/+/, '').replace(/^\/+/, '')));
    const collected = [];
    async function visit(currentDir) {
        const dirents = await node_fs_1.promises.readdir(currentDir, { withFileTypes: true });
        dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
        for (const dirent of dirents) {
            if (SKIP_NAMES.has(dirent.name)) {
                continue;
            }
            const filePath = node_path_1.default.join(currentDir, dirent.name);
            const relativePath = normalizeEntryName(node_path_1.default.relative(sourceDir, filePath));
            const normalizedRelativePath = relativePath.replace(/^\.\/+/, '');
            if (!normalizedRelativePath || node_path_1.default.posix.isAbsolute(normalizedRelativePath) || normalizedRelativePath.split('/').includes('..')) {
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
                data: await node_fs_1.promises.readFile(filePath),
            });
        }
    }
    await visit(sourceDir);
    collected.sort((left, right) => (left.entryName < right.entryName ? -1 : left.entryName > right.entryName ? 1 : 0));
    return collected;
}
function writeUInt16LE(target, value, offset) {
    target.writeUInt16LE(value & 0xffff, offset);
    return offset + 2;
}
function writeUInt32LE(target, value, offset) {
    target.writeUInt32LE(value >>> 0, offset);
    return offset + 4;
}
function createLocalHeader(entryName, data, crc) {
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
function createCentralDirectoryHeader(entryName, data, crc, localHeaderOffset) {
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
function createEndOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
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
async function writeMetaAppZipArchive(input) {
    const sourceDir = node_path_1.default.resolve(input.sourceDir);
    const outFile = node_path_1.default.resolve(input.outFile);
    const entries = await collectEntries(sourceDir, input.exclude ?? []);
    const fileParts = [];
    const centralDirectoryParts = [];
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
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(outFile), { recursive: true });
    await node_fs_1.promises.writeFile(outFile, archive);
    return {
        filePath: outFile,
        bytes: archive.byteLength,
        sha256: (0, node_crypto_1.createHash)('sha256').update(archive).digest('hex'),
        entries: entries.map((entry) => entry.entryName),
    };
}
function findEndOfCentralDirectory(archive) {
    for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
        if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            return offset;
        }
    }
    throw new Error('ZIP end-of-central-directory record was not found.');
}
function assertInsideDirectory(rootDir, filePath) {
    const relative = node_path_1.default.relative(rootDir, filePath);
    if (!relative || relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
        throw new Error(`ZIP entry escapes target directory: ${filePath}`);
    }
}
async function decompressZipEntry(input) {
    if (input.compressionMethod === STORE_COMPRESSION_METHOD) {
        if (input.compressedData.byteLength !== input.uncompressedSize) {
            throw new Error(`ZIP entry size mismatch: ${input.entryName}`);
        }
        return input.compressedData;
    }
    if (input.compressionMethod === DEFLATE_COMPRESSION_METHOD) {
        const inflated = await inflateRawAsync(input.compressedData);
        if (inflated.byteLength !== input.uncompressedSize) {
            throw new Error(`ZIP entry size mismatch: ${input.entryName}`);
        }
        return inflated;
    }
    throw new Error(`Unsupported ZIP compression method ${input.compressionMethod} for ${input.entryName}.`);
}
async function extractMetaAppZipArchive(input) {
    const archive = Buffer.from(input.archive);
    const outDir = node_path_1.default.resolve(input.outDir);
    const maxEntries = input.maxEntries ?? DEFAULT_MAX_EXTRACTED_ENTRIES;
    const maxUncompressedBytes = input.maxUncompressedBytes ?? DEFAULT_MAX_EXTRACTED_BYTES;
    const eocdOffset = findEndOfCentralDirectory(archive);
    const entryCount = archive.readUInt16LE(eocdOffset + 10);
    if (entryCount > maxEntries) {
        throw new Error(`ZIP archive has too many entries: ${entryCount}.`);
    }
    let centralOffset = archive.readUInt32LE(eocdOffset + 16);
    let totalUncompressedBytes = 0;
    const extractedEntries = [];
    await node_fs_1.promises.mkdir(outDir, { recursive: true });
    for (let index = 0; index < entryCount; index += 1) {
        if (centralOffset + 46 > archive.length || archive.readUInt32LE(centralOffset) !== ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
            throw new Error('Invalid ZIP central directory.');
        }
        const compressionMethod = archive.readUInt16LE(centralOffset + 10);
        const compressedSize = archive.readUInt32LE(centralOffset + 20);
        const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
        const nameLength = archive.readUInt16LE(centralOffset + 28);
        const extraLength = archive.readUInt16LE(centralOffset + 30);
        const commentLength = archive.readUInt16LE(centralOffset + 32);
        const localHeaderOffset = archive.readUInt32LE(centralOffset + 42);
        const nameStart = centralOffset + 46;
        const nameEnd = nameStart + nameLength;
        if (nameEnd > archive.length) {
            throw new Error('Invalid ZIP entry name bounds.');
        }
        const entryName = normalizeEntryName(archive.subarray(nameStart, nameEnd).toString('utf8'));
        centralOffset = nameEnd + extraLength + commentLength;
        if (!entryName || entryName.endsWith('/')) {
            continue;
        }
        assertSafeEntryName(entryName);
        totalUncompressedBytes += uncompressedSize;
        if (totalUncompressedBytes > maxUncompressedBytes) {
            throw new Error('ZIP archive exceeds the maximum extracted size.');
        }
        if (localHeaderOffset + 30 > archive.length || archive.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
            throw new Error(`Invalid ZIP local header for ${entryName}.`);
        }
        const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataStart > archive.length || dataEnd > archive.length) {
            throw new Error(`Invalid ZIP data bounds for ${entryName}.`);
        }
        const body = await decompressZipEntry({
            entryName,
            compressionMethod,
            compressedData: archive.subarray(dataStart, dataEnd),
            uncompressedSize,
        });
        const targetPath = node_path_1.default.resolve(outDir, entryName);
        assertInsideDirectory(outDir, targetPath);
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(targetPath), { recursive: true });
        await node_fs_1.promises.writeFile(targetPath, body);
        extractedEntries.push(entryName);
    }
    return { outDir, entries: extractedEntries };
}
