import type { Payload, PayloadRequest } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { Comment, User } from './payload-types.js'

let payload: Payload
let author: User
let other: User
let moderator: User
let data: Omit<Comment, 'createdAt' | 'id' | 'updatedAt'>

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
  const post = await payload.create({ collection: 'posts', data: { title: 'Commented post' } })
  data = {
    author: author.id,
    content: 'A comment',
    documentCollection: 'posts',
    documentId: String(post.id),
    fieldPath: 'content',
    threadId: 'thread-1',
  }
})

afterAll(async () => {
  await payload?.destroy()
})

const asUser = (user: User) => ({ ...user, collection: 'users' as const })

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
    expect(remaining.totalDocs).toBe(3)
    expect(remaining.docs.map(({ id, parent }) => ({ id, parent: parent ?? null }))).toEqual(
      expect.arrayContaining([
        { id: root.id, parent: null },
        { id: ownReply.id, parent: root.id },
        { id: otherReply.id, parent: root.id },
      ]),
    )
  })

  test.skipIf((process.env.DATABASE_ADAPTER ?? 'sqlite') === 'sqlite')(
    'rolls back two actual reply deletions when the cascade fails unexpectedly',
    async () => {
      const root = await payload.create({
        collection: 'comments',
        data,
        overrideAccess: false,
        user: asUser(author),
      })
      const first = await payload.create({
        collection: 'comments',
        data: { ...data, parent: root.id },
        overrideAccess: false,
        user: asUser(author),
      })
      const second = await payload.create({
        collection: 'comments',
        data: { ...data, parent: root.id },
        overrideAccess: false,
        user: asUser(author),
      })
      const req: Partial<PayloadRequest> = {}
      const transactionIDs = new Set<unknown>()
      const deletedIDs: Array<Comment['id']> = []
      const hooks = payload.collections.comments.config.hooks
      const previous = hooks.afterDelete
      hooks.afterDelete = [
        ...(previous ?? []),
        async ({ doc, req: hookReq }) => {
          expect(hookReq).toBe(req)
          const transactionID = await hookReq.transactionID
          expect(transactionID).toBeTruthy()
          transactionIDs.add(transactionID)
          deletedIDs.push(doc.id)
          const remaining = await payload.find({
            collection: 'comments',
            req: hookReq,
            where: { id: { in: deletedIDs } },
          })
          expect(remaining.totalDocs).toBe(0)
          if (deletedIDs.length === 2) {
            throw new Error('Unexpected failure after two deletions')
          }
        },
      ]
      try {
        await expect(
          payload.delete({
            id: root.id,
            collection: 'comments',
            overrideAccess: false,
            req,
            user: asUser(author),
          }),
        ).rejects.toThrow('Unexpected failure after two deletions')
        expect(deletedIDs).toEqual(expect.arrayContaining([first.id, second.id]))
        expect(deletedIDs).toHaveLength(2)
        expect(transactionIDs.size).toBe(1)
        const remaining = await payload.find({
          collection: 'comments',
          depth: 0,
          where: { id: { in: [root.id, first.id, second.id] } },
        })
        expect(remaining.totalDocs).toBe(3)
        expect(remaining.docs.map(({ id, parent }) => ({ id, parent: parent ?? null }))).toEqual(
          expect.arrayContaining([
            { id: root.id, parent: null },
            { id: first.id, parent: root.id },
            { id: second.id, parent: root.id },
          ]),
        )
      } finally {
        hooks.afterDelete = previous
      }
    },
  )

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
