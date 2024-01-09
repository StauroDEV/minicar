import { CID } from 'multiformats/cid'
import { BytesReader, decodeVarint, readHeader } from './common.js'
import { Block, varint } from 'multiformats'
import * as Digest from 'multiformats/hashes/digest'

function bytesReader(bytes: Uint8Array): BytesReader {
  let pos = 0

  return {
    async upTo(length: number) {
      const out = bytes.subarray(pos, pos + Math.min(length, bytes.length - pos))
      return out
    },

    async exactly(length: number, seek = false) {
      if (length > bytes.length - pos) {
        throw new Error('Unexpected end of data')
      }
      const out = bytes.subarray(pos, pos + length)
      if (seek) {
        pos += length
      }
      return out
    },

    seek(length: number) {
      pos += length
    },

    get pos() {
      return pos
    },
  }
}

function limitReader(reader: BytesReader, byteLimit: number): BytesReader {
  let bytesRead = 0

  return {
    async upTo(length) {
      let bytes = await reader.upTo(length)
      if (bytes.length + bytesRead > byteLimit) {
        bytes = bytes.subarray(0, byteLimit - bytesRead)
      }
      return bytes
    },

    async exactly(length, seek = false) {
      const bytes = await reader.exactly(length, seek)
      if (bytes.length + bytesRead > byteLimit) {
        throw new Error('Unexpected end of data')
      }
      if (seek) {
        bytesRead += length
      }
      return bytes
    },

    seek(length) {
      bytesRead += length
      reader.seek(length)
    },

    get pos() {
      return reader.pos
    },
  }
}

async function readBlockIndex(reader: BytesReader) {
  const offset = reader.pos
  const { cid, length, blockLength } = await readBlockHead(reader)
  const index = { cid, length, blockLength, offset, blockOffset: reader.pos }
  reader.seek(index.blockLength)
  return index
}

const CIDV0_BYTES = {
  SHA2_256: 0x12,
  LENGTH: 0x20,
  DAG_PB: 0x70,
}

function getMultihashLength(bytes: Uint8Array) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, varintBytes] = varint.decode(bytes) // code
  const codeLength = varintBytes
  const length = varint.decode(bytes.subarray(varintBytes))[1]
  const lengthLength = varintBytes
  const mhLength = codeLength + lengthLength + length

  return mhLength
}

async function readCid(reader: BytesReader) {
  const first = await reader.exactly(2, false)
  if (first[0] === CIDV0_BYTES.SHA2_256 && first[1] === CIDV0_BYTES.LENGTH) {
    // cidv0 32-byte sha2-256
    const bytes = await reader.exactly(34, true)
    const multihash = Digest.decode(bytes)
    return CID.create(0, CIDV0_BYTES.DAG_PB, multihash)
  }

  const version = decodeVarint(await reader.upTo(8), reader)
  if (version !== 1) {
    throw new Error(`Unexpected CID version (${version})`)
  }
  const codec = decodeVarint(await reader.upTo(8), reader)
  const bytes = await reader.exactly(getMultihashLength(await reader.upTo(8)), true)
  const multihash = Digest.decode(bytes)
  return CID.create(version, codec, multihash)
}

async function readBlockHead(reader: BytesReader) {
  const start = reader.pos
  let length = decodeVarint(await reader.upTo(8), reader)
  if (length === 0) {
    throw new Error('Invalid CAR section (zero length)')
  }
  length += (reader.pos - start)
  const cid = await readCid(reader)
  const blockLength = length - Number(reader.pos - start)

  return { cid, length, blockLength }
}

async function readBlock(reader: BytesReader): Promise<Block<unknown, number, number, 0 | 1>> {
  const { cid, blockLength } = await readBlockHead(reader)
  const bytes = await reader.exactly(blockLength, true)
  return { bytes, cid }
}

function createDecoder(reader: BytesReader) {
  const headerPromise = (async () => {
    const header = await readHeader(reader)
    if (header.version === 2) {
      const v1length = reader.pos - header.dataOffset
      reader = limitReader(reader, header.dataSize - v1length)
    }
    return header
  })()

  return {
    header: () => headerPromise,

    async * blocks() {
      await headerPromise
      while ((await reader.upTo(8)).length > 0) {
        yield await readBlock(reader)
      }
    },

    async * blocksIndex() {
      await headerPromise
      while ((await reader.upTo(8)).length > 0) {
        yield await readBlockIndex(reader)
      }
    },
  }
}

async function decodeReaderComplete(reader: BytesReader) {
  const decoder = createDecoder(reader)
  const header = await decoder.header()
  const blocks: Block<unknown, number, number, 0 | 1>[] = []
  for await (const block of decoder.blocks()) {
    blocks.push(block)
  }

  return new CarReader(header, blocks)
}

export class CarReader {
  #blocks: Block<unknown, number, number, 0 | 1>[]
  constructor(_header: string, blocks: Block<unknown, number, number, 0 | 1>[]) {
    this.#blocks = blocks
  }

  static async fromBytes(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('fromBytes() requires a Uint8Array')
    }
    return decodeReaderComplete(bytesReader(bytes))
  }

  async * blocks() {
    for (const block of this.#blocks) {
      yield block
    }
  }
}
