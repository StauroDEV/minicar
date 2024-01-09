import { CID } from 'multiformats/cid'
import { FileHandle } from 'node:fs/promises'
import { read, write } from 'node:fs'
import { promisify } from 'node:util'
import { cborEncode } from './dag-cbor.js'
import { BytesReader, readHeader } from './common.js'
import { varint } from 'multiformats'

const fsread = promisify(read)
const fswrite = promisify(write)

function chunkReader(readChunk: () => Promise<Uint8Array>): BytesReader {
  let pos = 0
  let have = 0
  let offset = 0
  let currentChunk = new Uint8Array(0)

  const read = async (length: number) => {
    have = currentChunk.length - offset
    const bufa = [currentChunk.subarray(offset)]
    while (have < length) {
      const chunk = await readChunk()
      if (chunk == null) {
        break
      }
      if (have < 0) {
        if (chunk.length > have) {
          bufa.push(chunk.subarray(-have))
        }
      }
      else {
        bufa.push(chunk)
      }
      have += chunk.length
    }
    currentChunk = new Uint8Array(bufa.reduce((p, c) => p + c.length, 0))
    let off = 0
    for (const b of bufa) {
      currentChunk.set(b, off)
      off += b.length
    }
    offset = 0
  }

  return {
    async upTo(length: number) {
      if (currentChunk.length - offset < length) {
        await read(length)
      }
      return currentChunk.subarray(offset, offset + Math.min(currentChunk.length - offset, length))
    },

    async exactly(length: number, seek = false) {
      if (currentChunk.length - offset < length) {
        await read(length)
      }
      if (currentChunk.length - offset < length) {
        throw new Error('Unexpected end of data')
      }
      const out = currentChunk.subarray(offset, offset + length)
      if (seek) {
        pos += length
        offset += length
      }
      return out
    },

    seek(length: number) {
      pos += length
      offset += length
    },

    get pos() {
      return pos
    },
  }
}

function createHeader(roots: CID[]) {
  const headerBytes = cborEncode({ version: 1, roots })
  const varintBytes = varint.encodeTo(headerBytes.length, headerBytes)
  const header = new Uint8Array(varintBytes.length + headerBytes.length)
  header.set(varintBytes, 0)
  header.set(headerBytes, varintBytes.length)
  return header
}

export async function updateRootsInFile(fd: FileHandle, roots: CID[]) {
  const chunkSize = 256
  let bytes: Uint8Array
  let offset = 0

  let readChunk: () => Promise<number>

  if (typeof fd === 'number') {
    readChunk = async () => (await fsread(fd, bytes, 0, chunkSize, offset)).bytesRead
  }
  else if (typeof fd === 'object' && typeof fd.read === 'function') {
    readChunk = async () => (await fd.read(bytes, 0, chunkSize, offset)).bytesRead
  }
  else {
    throw new TypeError('Bad fd')
  }

  const fdReader = chunkReader(async () => {
    bytes = new Uint8Array(chunkSize)
    const read = await readChunk()
    offset += read
    return read < chunkSize ? bytes.subarray(0, read) : bytes
  })

  await readHeader(fdReader)
  const newHeader = createHeader(roots)
  if (fdReader.pos !== newHeader.length) {
    throw new Error(`old header is ${fdReader.pos} bytes, new header is ${newHeader.length} bytes`)
  }
  if (typeof fd === 'number') {
    await fswrite(fd, newHeader, 0, newHeader.length, 0)
  }
  else if (typeof fd === 'object' && typeof fd.read === 'function') {
    await fd.write(newHeader, 0, newHeader.length, 0)
  }
}