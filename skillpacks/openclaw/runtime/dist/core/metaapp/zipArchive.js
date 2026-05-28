"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeMetaAppZipArchive = writeMetaAppZipArchive;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const STORE_COMPRESSION_METHOD = 0;
const SKIP_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '.runtime']);
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
