import type { Access, CollectionConfig, CollectionSlug } from 'payload'

import type { CommentsPluginConfig } from './index.js'

import { cascadeDeleteReplies, forceAuthor } from './hooks.js'

export const createCommentsCollection = (
  options: { slug: string } & CommentsPluginConfig,
): CollectionConfig => {
  // The configured slug is added by this plugin, outside the host's generated types.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const slug = options.slug as CollectionSlug
  const usersCollection = options.usersCollection ?? 'users'
  const ownOrModerate: Access = async ({ req }) => {
    if (!req.user) {
      return false
    }
    if (await options.canModerate?.({ req })) {
      return true
    }
    if (req.user.collection !== usersCollection) {
      return false
    }
    return { author: { equals: req.user.id } }
  }

  return {
    slug: options.slug,
    access: {
      create: ({ req }) => req.user?.collection === usersCollection,
      delete: ownOrModerate,
      read: ({ req }) => Boolean(req.user),
      update: ownOrModerate,
    },
    admin: { hidden: true, useAsTitle: 'content' },
    endpoints: [
      {
        handler: async (req) =>
          Response.json({
            canModerate: Boolean(req.user && (await options.canModerate?.({ req }))),
          }),
        method: 'get',
        path: '/moderation',
      },
    ],
    fields: [
      {
        name: 'documentCollection',
        type: 'text',
        index: true,
        label: { en: 'Collection', fr: 'Collection' },
        required: true,
      },
      {
        name: 'documentId',
        type: 'text',
        index: true,
        label: { en: 'Document', fr: 'Document' },
        required: true,
      },
      { name: 'fieldPath', type: 'text', label: { en: 'Field', fr: 'Champ' }, required: true },
      {
        name: 'threadId',
        type: 'text',
        index: true,
        label: { en: 'Thread', fr: 'Fil' },
        required: true,
      },
      {
        name: 'parent',
        type: 'relationship',
        label: { en: 'Reply to', fr: 'Réponse à' },
        relationTo: slug,
      },
      { name: 'quote', type: 'text', label: { en: 'Quoted passage', fr: 'Passage cité' } },
      {
        name: 'content',
        type: 'textarea',
        label: { en: 'Comment', fr: 'Commentaire' },
        required: true,
      },
      {
        name: 'author',
        type: 'relationship',
        admin: { readOnly: true },
        label: { en: 'Author', fr: 'Auteur·ice' },
        relationTo: usersCollection,
        required: true,
      },
      {
        name: 'resolved',
        type: 'checkbox',
        defaultValue: false,
        label: { en: 'Resolved', fr: 'Résolu' },
      },
    ],
    hooks: {
      beforeDelete: [cascadeDeleteReplies(slug)],
      beforeValidate: [forceAuthor(usersCollection)],
    },
    labels: {
      plural: { en: 'Comments', fr: 'Commentaires' },
      singular: { en: 'Comment', fr: 'Commentaire' },
    },
  }
}
