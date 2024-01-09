import { varint } from 'multiformats'
import { cborDecode } from './dag-cbor.js'

interface Seekable {
  seek(length: number): void
}

export interface BytesReader extends Seekable {
  upTo(length: number): Promise<Uint8Array>

  exactly(length: number, seek?: boolean): Promise<Uint8Array>

  pos: number
}

export function decodeVarint(bytes: Uint8Array, seeker: Seekable) {
  if (!bytes.length) {
    throw new Error('Unexpected end of data')
  }
  const [i, len] = varint.decode(bytes)
  seeker.seek(len)
  return i
}

export async function readHeader(reader: BytesReader) {
  const length = decodeVarint(await reader.upTo(8), reader)
  if (length === 0) {
    throw new Error('Invalid CAR header (zero length)')
  }
  const header = await reader.exactly(length, true)
  const block = cborDecode(header)

  if (!Array.isArray(block.roots)) {
    throw new Error('Invalid CAR header format')
  }
  return block
}
