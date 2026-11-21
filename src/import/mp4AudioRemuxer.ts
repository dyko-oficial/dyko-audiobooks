/**
 * Pure TypeScript streaming ISO-BMFF (ISO/IEC 14496-12) lossless audio-only remuxer.
 *
 * Strips all video tracks ('vide') from an MP4 container while keeping the original
 * audio track ('soun') bit-for-bit untouched (zero re-encoding, zero MP3 conversion).
 * Produces a fast-start audio-only MP4/M4A container (ftyp + moov + mdat) using
 * coalesced slice reads so multi-hour MP4 files (500 MB - 2 GB+) remux cleanly on
 * Android mobile devices without loading the entire file into RAM.
 */

export class Mp4RemuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp4RemuxError';
  }
}

interface BoxSlice {
  type: string;
  start: number;
  size: number;
  headerSize: number;
  payloadStart: number;
  end: number;
}

interface StscEntry {
  firstChunk: number;
  samplesPerChunk: number;
}

export type RemuxOutcome =
  | {
      status: 'already_audio_only';
      durationSeconds: number;
    }
  | {
      status: 'remuxed';
      outputBytes: number;
      durationSeconds: number;
    };

const MAX_MOOV_BYTES = 128 * 1024 * 1024; // 128 MB safety cap for metadata index
const READ_WINDOW_BYTES = 4 * 1024 * 1024; // 4 MB coalesced source read window
const WRITE_BUFFER_BYTES = 2 * 1024 * 1024; // 2 MB coalesced OPFS write buffer
const MAX_UINT32 = 0xffffffff;

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function writeFourCC(target: Uint8Array, offset: number, fourcc: string): void {
  target[offset] = fourcc.charCodeAt(0) & 0xff;
  target[offset + 1] = fourcc.charCodeAt(1) & 0xff;
  target[offset + 2] = fourcc.charCodeAt(2) & 0xff;
  target[offset + 3] = fourcc.charCodeAt(3) & 0xff;
}

function readUint64(view: DataView, offset: number): number {
  const high = view.getUint32(offset, false);
  const low = view.getUint32(offset + 4, false);
  const value = high * 4294967296 + low;
  if (!Number.isSafeInteger(value)) {
    throw new Mp4RemuxError('Offset de 64 bits excede o limite seguro.');
  }
  return value;
}

function writeUint64(view: DataView, offset: number, value: number): void {
  const high = Math.floor(value / 4294967296);
  const low = value >>> 0;
  view.setUint32(offset, high, false);
  view.setUint32(offset + 4, low, false);
}

/**
 * Parses child boxes inside an in-memory Uint8Array slice [start, end).
 */
function parseChildBoxes(bytes: Uint8Array, start: number, end: number): BoxSlice[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: BoxSlice[] = [];
  let cursor = start;

  while (cursor + 8 <= end) {
    const rawSize = view.getUint32(cursor, false);
    const type = readFourCC(view, cursor + 4);
    let headerSize = 8;
    let size = rawSize;

    if (rawSize === 1) {
      if (cursor + 16 > end) {
        throw new Mp4RemuxError(`Cabeçalho 64-bit truncado no box "${type}".`);
      }
      size = readUint64(view, cursor + 8);
      headerSize = 16;
    } else if (rawSize === 0) {
      size = end - cursor;
    }

    if (size < headerSize || cursor + size > end) {
      throw new Mp4RemuxError(`Estrutura inválida no box "${type}".`);
    }

    boxes.push({
      type,
      start: cursor,
      size,
      headerSize,
      payloadStart: cursor + headerSize,
      end: cursor + size,
    });

    cursor += size;
  }

  return boxes;
}

function findBox(boxes: BoxSlice[], type: string): BoxSlice | undefined {
  return boxes.find((b) => b.type === type);
}

/**
 * Scans top-level MP4 boxes via 16-byte slices to locate the 'moov' box without
 * reading 'mdat' media data into memory.
 */
async function locateTopLevelMoov(
  file: Blob
): Promise<{ offset: number; size: number; hasFtyp: boolean }> {
  let cursor = 0;
  let hasFtyp = false;
  let moovInfo: { offset: number; size: number } | null = null;
  let boxCount = 0;

  while (cursor + 8 <= file.size) {
    boxCount += 1;
    if (boxCount > 4096) {
      throw new Mp4RemuxError('Número excessivo de boxes no contêiner MP4.');
    }

    const headerEnd = Math.min(cursor + 16, file.size);
    const headerBuf = await file.slice(cursor, headerEnd).arrayBuffer();
    if (headerBuf.byteLength < 8) break;

    const view = new DataView(headerBuf);
    const rawSize = view.getUint32(0, false);
    const type = readFourCC(view, 4);

    let headerSize = 8;
    let boxSize = rawSize;

    if (rawSize === 1) {
      if (headerBuf.byteLength < 16) {
        throw new Mp4RemuxError('Cabeçalho 64-bit incompleto no arquivo MP4.');
      }
      boxSize = readUint64(view, 8);
      headerSize = 16;
    } else if (rawSize === 0) {
      boxSize = file.size - cursor;
    }

    if (boxSize < headerSize || cursor + boxSize > file.size) {
      throw new Mp4RemuxError(`Contêiner MP4 inválido próximo ao box "${type}".`);
    }

    if (type === 'ftyp') {
      hasFtyp = true;
    } else if (type === 'moov') {
      moovInfo = { offset: cursor, size: boxSize };
    }

    cursor += boxSize;
  }

  if (!moovInfo) {
    throw new Mp4RemuxError('Índice de metadados (moov) não encontrado no arquivo MP4.');
  }

  if (moovInfo.size > MAX_MOOV_BYTES) {
    throw new Mp4RemuxError('Índice de metadados do MP4 excede o limite de memória segura.');
  }

  return { offset: moovInfo.offset, size: moovInfo.size, hasFtyp };
}

function getTrackHandlerType(bytes: Uint8Array, trakBox: BoxSlice): string | null {
  const trakChildren = parseChildBoxes(bytes, trakBox.payloadStart, trakBox.end);
  const mdia = findBox(trakChildren, 'mdia');
  if (!mdia) return null;

  const mdiaChildren = parseChildBoxes(bytes, mdia.payloadStart, mdia.end);
  const hdlr = findBox(mdiaChildren, 'hdlr');
  if (!hdlr || hdlr.end - hdlr.payloadStart < 12) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // hdlr payload: version(1) + flags(3) + pre_defined(4) + handler_type(4)
  return readFourCC(view, hdlr.payloadStart + 8);
}

function parseMediaDurationSeconds(bytes: Uint8Array, mdiaBox: BoxSlice): number {
  const mdiaChildren = parseChildBoxes(bytes, mdiaBox.payloadStart, mdiaBox.end);
  const mdhd = findBox(mdiaChildren, 'mdhd');
  if (!mdhd) return 0;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(mdhd.payloadStart);

  if (version === 0 && mdhd.end - mdhd.payloadStart >= 20) {
    const timescale = view.getUint32(mdhd.payloadStart + 12, false);
    const duration = view.getUint32(mdhd.payloadStart + 16, false);
    return timescale > 0 ? duration / timescale : 0;
  }
  if (version === 1 && mdhd.end - mdhd.payloadStart >= 32) {
    const timescale = view.getUint32(mdhd.payloadStart + 20, false);
    const duration = readUint64(view, mdhd.payloadStart + 24);
    return timescale > 0 ? duration / timescale : 0;
  }
  return 0;
}

function isEncryptedAudioStsd(bytes: Uint8Array, stsdBox: BoxSlice): boolean {
  if (stsdBox.end - stsdBox.payloadStart < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint32(stsdBox.payloadStart + 4, false);
  if (entryCount === 0) return false;

  const entries = parseChildBoxes(bytes, stsdBox.payloadStart + 8, stsdBox.end);
  return entries.some((entry) => entry.type === 'enca' || entry.type === 'drmi');
}

function parseStsc(bytes: Uint8Array, stscBox: BoxSlice): StscEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payload = stscBox.payloadStart;
  if (stscBox.end - payload < 8) {
    throw new Mp4RemuxError('Tabela stsc incompleta.');
  }

  const entryCount = view.getUint32(payload + 4, false);
  const entries: StscEntry[] = new Array(entryCount);
  let pos = payload + 8;

  if (pos + entryCount * 12 > stscBox.end) {
    throw new Mp4RemuxError('Tabela stsc truncada.');
  }

  for (let i = 0; i < entryCount; i++) {
    const firstChunk = view.getUint32(pos, false);
    const samplesPerChunk = view.getUint32(pos + 4, false);
    entries[i] = { firstChunk, samplesPerChunk };
    pos += 12;
  }

  return entries;
}

interface SampleSizeTable {
  sampleCount: number;
  getSize: (sampleIndex: number) => number;
}

function parseSampleSizes(bytes: Uint8Array, stblChildren: BoxSlice[]): SampleSizeTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const stsz = findBox(stblChildren, 'stsz');
  if (stsz) {
    const payload = stsz.payloadStart;
    if (stsz.end - payload < 12) {
      throw new Mp4RemuxError('Tabela stsz incompleta.');
    }
    const fixedSize = view.getUint32(payload + 4, false);
    const sampleCount = view.getUint32(payload + 8, false);

    if (fixedSize > 0) {
      return { sampleCount, getSize: () => fixedSize };
    }

    const tableStart = payload + 12;
    if (tableStart + sampleCount * 4 > stsz.end) {
      throw new Mp4RemuxError('Tabela de tamanhos stsz truncada.');
    }

    return {
      sampleCount,
      getSize: (idx: number) => view.getUint32(tableStart + idx * 4, false),
    };
  }

  const stz2 = findBox(stblChildren, 'stz2');
  if (stz2) {
    const payload = stz2.payloadStart;
    if (stz2.end - payload < 12) {
      throw new Mp4RemuxError('Tabela stz2 incompleta.');
    }
    const fieldSize = view.getUint8(payload + 7);
    const sampleCount = view.getUint32(payload + 8, false);
    const tableStart = payload + 12;

    if (fieldSize === 16) {
      return {
        sampleCount,
        getSize: (idx: number) => view.getUint16(tableStart + idx * 2, false),
      };
    }
    if (fieldSize === 8) {
      return {
        sampleCount,
        getSize: (idx: number) => view.getUint8(tableStart + idx),
      };
    }
    if (fieldSize === 4) {
      return {
        sampleCount,
        getSize: (idx: number) => {
          const byte = view.getUint8(tableStart + (idx >> 1));
          return idx % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
        },
      };
    }
    throw new Mp4RemuxError(`field_size inválido em stz2: ${fieldSize}.`);
  }

  throw new Mp4RemuxError('Tabela de tamanho de amostras (stsz/stz2) ausente.');
}

function parseChunkOffsets(bytes: Uint8Array, stblChildren: BoxSlice[]): Float64Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const stco = findBox(stblChildren, 'stco');
  if (stco) {
    const payload = stco.payloadStart;
    if (stco.end - payload < 8) {
      throw new Mp4RemuxError('Tabela stco incompleta.');
    }
    const count = view.getUint32(payload + 4, false);
    const tableStart = payload + 8;
    if (tableStart + count * 4 > stco.end) {
      throw new Mp4RemuxError('Tabela stco truncada.');
    }
    const offsets = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      offsets[i] = view.getUint32(tableStart + i * 4, false);
    }
    return offsets;
  }

  const co64 = findBox(stblChildren, 'co64');
  if (co64) {
    const payload = co64.payloadStart;
    if (co64.end - payload < 8) {
      throw new Mp4RemuxError('Tabela co64 incompleta.');
    }
    const count = view.getUint32(payload + 4, false);
    const tableStart = payload + 8;
    if (tableStart + count * 8 > co64.end) {
      throw new Mp4RemuxError('Tabela co64 truncada.');
    }
    const offsets = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      offsets[i] = readUint64(view, tableStart + i * 8);
    }
    return offsets;
  }

  throw new Mp4RemuxError('Tabela de offsets de chunks (stco/co64) ausente.');
}

function buildAudioFtypBox(): Uint8Array {
  // 32 bytes: size(4) + 'ftyp'(4) + major('M4A ') + minor(0) + ['isom','iso2','mp42','M4A ']
  const buf = new Uint8Array(32);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 32, false);
  writeFourCC(buf, 4, 'ftyp');
  writeFourCC(buf, 8, 'M4A ');
  view.setUint32(12, 0, false);
  writeFourCC(buf, 16, 'isom');
  writeFourCC(buf, 20, 'iso2');
  writeFourCC(buf, 24, 'mp42');
  writeFourCC(buf, 28, 'M4A ');
  return buf;
}

function buildContainerBox(type: string, children: Uint8Array[]): Uint8Array {
  let payloadLength = 0;
  for (const child of children) {
    payloadLength += child.byteLength;
  }
  const totalSize = 8 + payloadLength;
  if (totalSize > MAX_UINT32) {
    throw new Mp4RemuxError(`Box "${type}" excede o tamanho máximo suportado.`);
  }
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, totalSize, false);
  writeFourCC(out, 4, type);
  let offset = 8;
  for (const child of children) {
    out.set(child, offset);
    offset += child.byteLength;
  }
  return out;
}

function buildChunkOffsetBox(offsets: Float64Array, use64Bit: boolean): Uint8Array {
  const count = offsets.length;
  const entrySize = use64Bit ? 8 : 4;
  const totalSize = 16 + count * entrySize;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, totalSize, false);
  writeFourCC(out, 4, use64Bit ? 'co64' : 'stco');
  view.setUint32(8, 0, false); // version(0) + flags(0)
  view.setUint32(12, count, false);

  let pos = 16;
  if (use64Bit) {
    for (let i = 0; i < count; i++) {
      writeUint64(view, pos, offsets[i]);
      pos += 8;
    }
  } else {
    for (let i = 0; i < count; i++) {
      view.setUint32(pos, offsets[i], false);
      pos += 4;
    }
  }
  return out;
}

function buildMdatHeader(payloadBytes: number): Uint8Array {
  if (payloadBytes + 8 <= MAX_UINT32) {
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, payloadBytes + 8, false);
    writeFourCC(header, 4, 'mdat');
    return header;
  }
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1, false);
  writeFourCC(header, 4, 'mdat');
  writeUint64(view, 8, payloadBytes + 16);
  return header;
}

/**
 * Remuxes an MP4 File/Blob to an audio-only fast-start M4A/MP4 stream without
 * decoding or re-encoding any audio frames.
 */
export async function remuxMp4ToAudioOnly(
  sourceFile: Blob,
  writeChunk: (chunk: Uint8Array) => Promise<void>,
  onProgress?: (percent: number) => void
): Promise<RemuxOutcome> {
  onProgress?.(2);

  // 1. Locate 'moov' without loading 'mdat' into RAM
  const moovLoc = await locateTopLevelMoov(sourceFile);
  const moovBuf = await sourceFile.slice(moovLoc.offset, moovLoc.offset + moovLoc.size).arrayBuffer();
  const moovBytes = new Uint8Array(moovBuf);

  const moovTop = parseChildBoxes(moovBytes, 0, moovBytes.byteLength);
  if (moovTop.length !== 1 || moovTop[0].type !== 'moov') {
    throw new Mp4RemuxError('Falha ao interpretar o box moov.');
  }

  const moovChildren = parseChildBoxes(moovBytes, moovTop[0].payloadStart, moovTop[0].end);
  const mvhdBox = findBox(moovChildren, 'mvhd');
  if (!mvhdBox) {
    throw new Mp4RemuxError('Cabeçalho mvhd ausente no arquivo MP4.');
  }

  const hasMvex = Boolean(findBox(moovChildren, 'mvex'));
  const trakBoxes = moovChildren.filter((b) => b.type === 'trak');

  let hasVideoTrack = false;
  let audioTrakBox: BoxSlice | null = null;
  let audioDurationSeconds = 0;

  for (const trak of trakBoxes) {
    const handler = getTrackHandlerType(moovBytes, trak);
    if (handler === 'vide') {
      hasVideoTrack = true;
    } else if (handler === 'soun' && !audioTrakBox) {
      audioTrakBox = trak;
    }
  }

  if (!audioTrakBox) {
    throw new Mp4RemuxError('Nenhuma faixa de áudio compatível encontrada no arquivo MP4.');
  }

  // Locate mdia -> minf -> stbl inside the selected audio track
  const trakChildren = parseChildBoxes(moovBytes, audioTrakBox.payloadStart, audioTrakBox.end);
  const mdiaBox = findBox(trakChildren, 'mdia');
  if (!mdiaBox) {
    throw new Mp4RemuxError('Box mdia ausente na faixa de áudio.');
  }

  audioDurationSeconds = parseMediaDurationSeconds(moovBytes, mdiaBox);

  // If there is no video track at all, the MP4 is already audio-only!
  if (!hasVideoTrack) {
    onProgress?.(100);
    return {
      status: 'already_audio_only',
      durationSeconds: audioDurationSeconds,
    };
  }

  const mdiaChildren = parseChildBoxes(moovBytes, mdiaBox.payloadStart, mdiaBox.end);
  const minfBox = findBox(mdiaChildren, 'minf');
  if (!minfBox) {
    throw new Mp4RemuxError('Box minf ausente na faixa de áudio.');
  }

  const minfChildren = parseChildBoxes(moovBytes, minfBox.payloadStart, minfBox.end);
  const stblBox = findBox(minfChildren, 'stbl');
  if (!stblBox) {
    throw new Mp4RemuxError('Tabela stbl ausente na faixa de áudio.');
  }

  const stblChildren = parseChildBoxes(moovBytes, stblBox.payloadStart, stblBox.end);
  const stsdBox = findBox(stblChildren, 'stsd');
  if (!stsdBox) {
    throw new Mp4RemuxError('Descrição de codec (stsd) ausente na faixa de áudio.');
  }

  if (isEncryptedAudioStsd(moovBytes, stsdBox)) {
    throw new Mp4RemuxError('Faixa de áudio criptografada (DRM) não pode ser remuxada.');
  }

  const stscBox = findBox(stblChildren, 'stsc');
  if (!stscBox) {
    throw new Mp4RemuxError('Tabela stsc ausente na faixa de áudio.');
  }

  const stscEntries = parseStsc(moovBytes, stscBox);
  const sampleSizes = parseSampleSizes(moovBytes, stblChildren);
  const srcChunkOffsets = parseChunkOffsets(moovBytes, stblChildren);
  const chunkCount = srcChunkOffsets.length;

  if (chunkCount === 0 || sampleSizes.sampleCount === 0) {
    if (hasMvex) {
      throw new Mp4RemuxError('MP4 fragmentado (fMP4) não suporta extração estática por stco.');
    }
    throw new Mp4RemuxError('Faixa de áudio sem amostras válidas.');
  }

  onProgress?.(8);

  // 2. Map every audio chunk to its exact byte length in the original MP4
  const chunkSizes = new Uint32Array(chunkCount);
  let sampleIdx = 0;
  let totalAudioBytes = 0;

  for (let e = 0; e < stscEntries.length; e++) {
    const entry = stscEntries[e];
    const startChunk = entry.firstChunk; // 1-indexed
    const nextFirstChunk = e + 1 < stscEntries.length ? stscEntries[e + 1].firstChunk : chunkCount + 1;
    const endChunk = Math.min(nextFirstChunk - 1, chunkCount);

    for (let chunkNum = startChunk; chunkNum <= endChunk; chunkNum++) {
      let chunkLen = 0;
      for (let s = 0; s < entry.samplesPerChunk; s++) {
        if (sampleIdx >= sampleSizes.sampleCount) break;
        chunkLen += sampleSizes.getSize(sampleIdx);
        sampleIdx += 1;
      }

      const cIdx = chunkNum - 1;
      const srcOff = srcChunkOffsets[cIdx];
      if (srcOff < 0 || srcOff + chunkLen > sourceFile.size) {
        throw new Mp4RemuxError('Offset de chunk de áudio fora dos limites do arquivo.');
      }

      chunkSizes[cIdx] = chunkLen;
      totalAudioBytes += chunkLen;
    }
  }

  if (totalAudioBytes === 0) {
    throw new Mp4RemuxError('Nenhum dado de áudio válido encontrado no arquivo MP4.');
  }

  // 3. Rebuild fast-start ftyp + audio-only moov with exact sequential offsets
  const ftypBytes = buildAudioFtypBox();
  const mdatHeaderBytes = buildMdatHeader(totalAudioBytes);

  const otherStblSlices = stblChildren
    .filter((b) => b.type !== 'stco' && b.type !== 'co64')
    .map((b) => moovBytes.subarray(b.start, b.end));
  const otherMinfSlices = minfChildren
    .filter((b) => b.type !== 'stbl')
    .map((b) => moovBytes.subarray(b.start, b.end));
  const otherMdiaSlices = mdiaChildren
    .filter((b) => b.type !== 'minf')
    .map((b) => moovBytes.subarray(b.start, b.end));
  const otherTrakSlices = trakChildren
    .filter((b) => b.type !== 'mdia')
    .map((b) => moovBytes.subarray(b.start, b.end));
  const mvhdSlice = moovBytes.subarray(mvhdBox.start, mvhdBox.end);

  const assembleMoov = (offsets: Float64Array, use64Bit: boolean): Uint8Array => {
    const offsetBox = buildChunkOffsetBox(offsets, use64Bit);
    const newStbl = buildContainerBox('stbl', [...otherStblSlices, offsetBox]);
    const newMinf = buildContainerBox('minf', [...otherMinfSlices, newStbl]);
    const newMdia = buildContainerBox('mdia', [...otherMdiaSlices, newMinf]);
    const newTrak = buildContainerBox('trak', [...otherTrakSlices, newMdia]);
    return buildContainerBox('moov', [mvhdSlice, newTrak]);
  };

  // Compute moov size first with 32-bit stco; switch to co64 if any offset > 4 GB
  const dummyOffsets = new Float64Array(chunkCount);
  const probeMoov32 = assembleMoov(dummyOffsets, false);
  const dataStart32 = ftypBytes.byteLength + probeMoov32.byteLength + mdatHeaderBytes.byteLength;
  const use64BitOffsets = dataStart32 + totalAudioBytes > MAX_UINT32;

  const finalOffsets = new Float64Array(chunkCount);
  const moovSize = use64BitOffsets
    ? assembleMoov(dummyOffsets, true).byteLength
    : probeMoov32.byteLength;

  let outputCursor = ftypBytes.byteLength + moovSize + mdatHeaderBytes.byteLength;
  for (let i = 0; i < chunkCount; i++) {
    finalOffsets[i] = outputCursor;
    outputCursor += chunkSizes[i];
  }

  const finalMoov = assembleMoov(finalOffsets, use64BitOffsets);
  const totalOutputBytes = ftypBytes.byteLength + finalMoov.byteLength + mdatHeaderBytes.byteLength + totalAudioBytes;

  // 4. Write fast-start headers (ftyp + moov + mdat header)
  await writeChunk(ftypBytes);
  await writeChunk(finalMoov);
  await writeChunk(mdatHeaderBytes);

  onProgress?.(12);

  // 5. Stream audio chunks with coalesced source reads & coalesced output writes
  const writeBuffer = new Uint8Array(WRITE_BUFFER_BYTES);
  let writePos = 0;
  let bytesCopied = 0;
  let lastReportedPct = 12;

  const flushWriteBuffer = async () => {
    if (writePos > 0) {
      // Pass an exact view/copy so IndexedDB Blob collector and OPFS receive clean slices
      await writeChunk(writeBuffer.slice(0, writePos));
      writePos = 0;
    }
  };

  const appendToOutput = async (data: Uint8Array) => {
    let srcOffset = 0;
    while (srcOffset < data.byteLength) {
      const space = WRITE_BUFFER_BYTES - writePos;
      const toCopy = Math.min(space, data.byteLength - srcOffset);
      writeBuffer.set(data.subarray(srcOffset, srcOffset + toCopy), writePos);
      writePos += toCopy;
      srcOffset += toCopy;
      if (writePos === WRITE_BUFFER_BYTES) {
        await flushWriteBuffer();
      }
    }
  };

  let chunkIdx = 0;
  while (chunkIdx < chunkCount) {
    // Skip zero-length chunks safely
    if (chunkSizes[chunkIdx] === 0) {
      chunkIdx += 1;
      continue;
    }

    const windowStart = srcChunkOffsets[chunkIdx];
    const firstEnd = windowStart + chunkSizes[chunkIdx];

    // If a single audio chunk is larger than READ_WINDOW_BYTES, read it directly
    if (chunkSizes[chunkIdx] >= READ_WINDOW_BYTES) {
      const buf = await sourceFile.slice(windowStart, firstEnd).arrayBuffer();
      await appendToOutput(new Uint8Array(buf));
      bytesCopied += chunkSizes[chunkIdx];
      chunkIdx += 1;
    } else {
      // Coalesce subsequent monotonically increasing chunks that fit within READ_WINDOW_BYTES
      let windowEnd = firstEnd;
      let batchEndIdx = chunkIdx + 1;

      while (batchEndIdx < chunkCount) {
        const nextLen = chunkSizes[batchEndIdx];
        if (nextLen === 0) {
          batchEndIdx += 1;
          continue;
        }
        const nextOff = srcChunkOffsets[batchEndIdx];
        const nextEnd = nextOff + nextLen;
        if (nextOff >= windowStart && nextEnd - windowStart <= READ_WINDOW_BYTES) {
          if (nextEnd > windowEnd) windowEnd = nextEnd;
          batchEndIdx += 1;
        } else {
          break;
        }
      }

      const windowBuf = await sourceFile.slice(windowStart, windowEnd).arrayBuffer();
      const windowBytes = new Uint8Array(windowBuf);

      for (let j = chunkIdx; j < batchEndIdx; j++) {
        const len = chunkSizes[j];
        if (len === 0) continue;
        const relStart = srcChunkOffsets[j] - windowStart;
        await appendToOutput(windowBytes.subarray(relStart, relStart + len));
        bytesCopied += len;
      }

      chunkIdx = batchEndIdx;
    }

    const pct = 12 + Math.round((bytesCopied / totalAudioBytes) * 86);
    if (pct > lastReportedPct) {
      lastReportedPct = Math.min(98, pct);
      onProgress?.(lastReportedPct);
    }
  }

  await flushWriteBuffer();
  onProgress?.(100);

  return {
    status: 'remuxed',
    outputBytes: totalOutputBytes,
    durationSeconds: audioDurationSeconds,
  };
}
