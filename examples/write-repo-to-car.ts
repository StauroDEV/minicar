import { createCARFromFiles } from '../src/index'

const te = new TextEncoder()

async function main() {
  const car = await createCARFromFiles([
    {
      path: '/hello.txt',
      content: te.encode('Hello World'),
    },
    {
      path: '/two.txt',
      content: te.encode('test'),
    },
  ])

  await Bun.write('example.car', car.content)
  console.log(car.cid)
}

main()
