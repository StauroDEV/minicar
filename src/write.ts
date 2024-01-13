import { BlockWriter, CarWriter } from '@ipld/car/writer'
import { MemoryBlockstore } from 'blockstore-core/memory'
import {
  ImportCandidate,
  importer,
  ImporterOptions,
} from 'ipfs-unixfs-importer'
import { CID } from 'multiformats'

function mergeUint8Arrays(arrays: Uint8Array[]) {
  const totalLength = arrays.reduce((length, array) => length + array.length, 0)

  const mergedArray = new Uint8Array(totalLength)

  let offset = 0
  for (const array of arrays) {
    mergedArray.set(array, offset)
    offset += array.length
  }

  return mergedArray
}

async function asyncIterableToArray<T>(
  iterable: AsyncIterable<T>,
): Promise<T[]> {
  const chunks = []

  for await (const chunk of iterable) {
    chunks.push(chunk)
  }

  return chunks
}

export type CarFile = { cid: CID, content: Uint8Array }

export const createCARFromFiles = async (
  files: ImportCandidate[],
  options: ImporterOptions = {},
  blockStore = new MemoryBlockstore(),
): Promise<CarFile> => {
  const entries = await asyncIterableToArray(
    importer(files, blockStore, options),
  )

  const cid = entries[entries.length - 1].cid

  const { writer, out } = CarWriter.create(cid) as { writer: BlockWriter, out: AsyncIterable<Uint8Array> }

  for await (const { cid, block } of blockStore.getAll()) {
    writer.put({ cid: cid, bytes: block })
  }

  writer.close()

  return { cid, content: mergeUint8Arrays(await asyncIterableToArray(out)) }
}
