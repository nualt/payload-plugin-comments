import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export default async function setup() {
  if (process.env.DATABASE_ADAPTER !== 'mongodb') {
    return
  }

  const cache = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url))
  await mkdir(cache, { recursive: true })
  const dbPath = await mkdtemp(path.join(cache, 'comments-mongodb-'))
  const previousURI = process.env.DATABASE_URI
  const replSet = new MongoMemoryReplSet({
    binary: { downloadDir: path.join(cache, 'mongodb-binaries') },
    instanceOpts: [{ args: ['--nounixsocket'], dbPath }],
    replSet: { count: 1, dbName: 'payloadmemory', ip: '127.0.0.1' },
  })
  const teardown = async () => {
    try {
      // stop() turns a failed shutdown into `false`: surface it to the runner.
      if (!(await replSet.stop())) {
        throw new Error('MongoDB replica set did not stop cleanly')
      }
    } finally {
      await rm(dbPath, { force: true, recursive: true })
      if (previousURI === undefined) {
        delete process.env.DATABASE_URI
      } else {
        process.env.DATABASE_URI = previousURI
      }
    }
  }
  try {
    await replSet.start()
    process.env.DATABASE_URI = replSet.getUri()
    return teardown
  } catch (error) {
    await teardown()
    throw error
  }
}
