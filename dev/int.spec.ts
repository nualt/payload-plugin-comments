import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload
let author: { id: number }
let other: { id: number }
let moderator: { id: number }
const data = {
  author: 0,
  content: 'A comment',
  documentCollection: 'posts',
  documentId: '1',
  fieldPath: 'content',
  threadId: 'thread-1',
}

beforeAll(async () => {
  payload = await getPayload({ config })
  author = await payload.create({
    collection: 'users',
    data: { email: 'author@example.test', password: 'test' },
  })
  other = await payload.create({
    collection: 'users',
    data: { email: 'other@example.test', password: 'test' },
  })
  moderator = await payload.create({
    collection: 'users',
    data: { email: 'moderator@example.test', password: 'test' },
  })
})

afterAll(async () => {
  await payload?.destroy()
})

const asUser = (user: { id: number }) => ({ ...user, collection: 'users' as const })

describe('comment threads with real Payload access checks', () => {
  test('forces the logged-in author, preserves author on update, resolves and cascades replies', async () => {
    const root = await payload.create({
      collection: 'comments',
      data: { ...data, author: other.id },
      depth: 0,
      overrideAccess: false,
      user: asUser(author),
    })
    expect(root.author).toBe(author.id)
    const reply = await payload.create({
      collection: 'comments',
      data: { ...data, parent: root.id },
      overrideAccess: false,
      user: asUser(author),
    })
    const updated = await payload.update({
      id: root.id,
      collection: 'comments',
      data: { author: other.id, resolved: true },
      depth: 0,
      overrideAccess: false,
      user: asUser(author),
    })
    expect(updated.author).toBe(author.id)
    expect(updated.resolved).toBe(true)
    await payload.delete({
      id: root.id,
      collection: 'comments',
      overrideAccess: false,
      user: asUser(author),
    })
    const remaining = await payload.find({
      collection: 'comments',
      where: { id: { equals: reply.id } },
    })
    expect(remaining.totalDocs).toBe(0)
  })

  test('rejects unauthenticated access and another author update/delete', async () => {
    await expect(
      payload.create({ collection: 'comments', data, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(payload.find({ collection: 'comments', overrideAccess: false })).rejects.toThrow()
    const root = await payload.create({
      collection: 'comments',
      data,
      overrideAccess: false,
      user: asUser(author),
    })
    await expect(
      payload.update({
        id: root.id,
        collection: 'comments',
        data: { content: 'Forged' },
        overrideAccess: false,
        user: asUser(other),
      }),
    ).rejects.toThrow()
    await expect(
      payload.delete({
        id: root.id,
        collection: 'comments',
        overrideAccess: false,
        user: asUser(other),
      }),
    ).rejects.toThrow()
  })

  test('canModerate allows editing and deleting other authors messages', async () => {
    const root = await payload.create({
      collection: 'comments',
      data,
      overrideAccess: false,
      user: asUser(author),
    })
    const reply = await payload.create({
      collection: 'comments',
      data: { ...data, parent: root.id },
      overrideAccess: false,
      user: asUser(other),
    })
    const edited = await payload.update({
      id: root.id,
      collection: 'comments',
      data: { content: 'Moderated' },
      overrideAccess: false,
      user: { ...asUser(moderator), email: 'moderator@example.test' },
    })
    expect(edited.content).toBe('Moderated')
    await payload.delete({
      id: root.id,
      collection: 'comments',
      overrideAccess: false,
      user: { ...asUser(moderator), email: 'moderator@example.test' },
    })
    expect(
      (await payload.find({ collection: 'comments', where: { id: { in: [root.id, reply.id] } } }))
        .totalDocs,
    ).toBe(0)
  })
  test('does not confuse identities from different auth collections with the same ID', async () => {
    const root = await payload.create({
      collection: 'comments',
      data,
      overrideAccess: false,
      user: asUser(author),
    })
    const unrelatedUser = { id: author.id, collection: 'customers' }
    await expect(
      payload.create({ collection: 'comments', data, overrideAccess: false, user: unrelatedUser }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        id: root.id,
        collection: 'comments',
        data: { content: 'Impersonated' },
        overrideAccess: false,
        user: unrelatedUser,
      }),
    ).rejects.toThrow()
    await expect(
      payload.delete({
        id: root.id,
        collection: 'comments',
        overrideAccess: false,
        user: unrelatedUser,
      }),
    ).rejects.toThrow()
  })

  test('refuses the entire cascade when one of two replies belongs to another author', async () => {
    const root = await payload.create({
      collection: 'comments',
      data,
      overrideAccess: false,
      user: asUser(author),
    })
    const ownReply = await payload.create({
      collection: 'comments',
      data: { ...data, parent: root.id },
      overrideAccess: false,
      user: asUser(author),
    })
    const otherReply = await payload.create({
      collection: 'comments',
      data: { ...data, parent: root.id },
      overrideAccess: false,
      user: asUser(other),
    })
    await expect(
      payload.delete({
        id: root.id,
        collection: 'comments',
        overrideAccess: false,
        user: asUser(author),
      }),
    ).rejects.toMatchObject({ status: 403 })
    const remaining = await payload.find({
      collection: 'comments',
      depth: 0,
      sort: 'id',
      where: { id: { in: [root.id, ownReply.id, otherReply.id] } },
    })
    expect(remaining.docs.map(({ id, parent }) => ({ id, parent }))).toEqual([
      { id: root.id, parent: null },
      { id: ownReply.id, parent: root.id },
      { id: otherReply.id, parent: root.id },
    ])
  })

  test('a failed reply deletion prevents deletion of the root', async () => {
    const root = await payload.create({
      collection: 'comments',
      data,
      overrideAccess: false,
      user: asUser(author),
    })
    const reply = await payload.create({
      collection: 'comments',
      data: { ...data, parent: root.id },
      overrideAccess: false,
      user: asUser(author),
    })
    const hooks = payload.collections.comments.config.hooks
    const previous = hooks.beforeDelete
    hooks.beforeDelete = [
      ...(previous ?? []),
      ({ id }) => {
        if (id === reply.id) {
          throw new Error('Reply deletion rejected')
        }
      },
    ]
    try {
      await expect(
        payload.delete({
          id: root.id,
          collection: 'comments',
          overrideAccess: false,
          user: asUser(author),
        }),
      ).rejects.toThrow('Reply deletion rejected')
      expect((await payload.findByID({ id: root.id, collection: 'comments' })).id).toBe(root.id)
      expect(
        (await payload.findByID({ id: reply.id, collection: 'comments', depth: 0 })).parent,
      ).toBe(root.id)
    } finally {
      hooks.beforeDelete = previous
    }
  })
})
