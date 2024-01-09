# minicar

Compact module for working with CAR files. CAR v0 and Node.js + Bun only. For now developed for personal purposes later there's a possibility of a rewrite for full functionality. Based on [ipfs-car](https://github.com/web3-storage/ipfs-car), [@ipld/dag-cbor](https://github.com/ipld/js-dag-cbor) and [@ipld/car](https://github.com/ipld/js-car).

## Install

```sh
bun i @stauro/minicar
```

## Examples

### Creating a car file from other files

```ts
import { tmpdir } from 'node:os'
import { readFile, open } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { CID } from 'multiformats/cid'
import { TransformStream } from 'node:stream/web'
import { Block } from '@ipld/unixfs'
import { Writable } from 'node:stream'
import { createDirectoryEncoderStream, CAREncoderStream, updateRootsInFile } from '@stauro/minicar'

const output = `${dir}/${name}.car`

const files = 

const placeholderCID = CID.parse(
'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
)
let rootCID = placeholderCID

await createDirectoryEncoderStream(files)
.pipeThrough(
    new TransformStream<Block>({
    transform(block, controller) {
        rootCID = block.cid as CID
        controller.enqueue(block)
    },
    }),
)
.pipeThrough(new CAREncoderStream([placeholderCID]))
.pipeTo(Writable.toWeb(createWriteStream(output)))

const fd = await open(output, 'r+')
await updateRootsInFile(fd, [rootCID!])
await fd.close()

const file = await readFile(output)
const blob = new Blob([file], { type: 'application/vnd.ipld.car' })
```

### Parsing a UCAN proof

```ts
import { CarReader } from '@stauro/minicar'

async function parseProof(data: string) {
  const blocks = []
  const reader = await CarReader.fromBytes(Buffer.from(data, 'base64'))
  for await (const block of reader.blocks()) {
    blocks.push(block)
  }
  return importDAG(blocks)
}
```