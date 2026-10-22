import type {
  CollectionBeforeDeleteHook,
  CollectionBeforeValidateHook,
  CollectionSlug,
} from 'payload'

import { Forbidden } from 'payload'

// beforeValidate runs before required author validation; never trust a client author ID.
export const forceAuthor =
  (usersCollection: CollectionSlug): CollectionBeforeValidateHook =>
  ({ data, operation, originalDoc, req }) => ({
    ...data,
    author:
      operation === 'create'
        ? req.user?.collection === usersCollection
          ? req.user.id
          : undefined
        : originalDoc?.author,
  })

export const cascadeDeleteReplies =
  (slug: CollectionSlug): CollectionBeforeDeleteHook =>
  async ({ id, collection, req }) => {
    // SQL adapters clear parent links on deletion, so cascade while those links still exist.
    const doc = await req.payload.findByID({ id, collection: slug, depth: 0, req })
    if ('parent' in doc && doc.parent) {
      return
    }
    const replies = await req.payload.find({
      collection: slug,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      where: { parent: { equals: doc.id } },
    })
    // Check every reply before any deletion, including on adapters without transactions.
    for (const reply of replies.docs) {
      const access = await collection.access.delete({ id: reply.id, req })
      if (
        access !== true &&
        (!access ||
          (await req.payload.count({
            collection: slug,
            overrideAccess: true,
            req,
            where: { and: [{ id: { equals: reply.id } }, access] },
          })).totalDocs !== 1)
      ) {
        throw new Forbidden(req.t)
      }
    }
    // Sequential deletes propagate failures and share the root operation's transaction.
    for (const reply of replies.docs) {
      await req.payload.delete({
        id: reply.id,
        collection: slug,
        overrideAccess: false,
        req,
      })
    }
  }
