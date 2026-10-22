import type { CollectionSlug, Config, PayloadRequest } from 'payload'

import { deepMergeSimple } from 'payload/shared'

import { createCommentsCollection } from './collection.js'
import { translations } from './translations/index.js'

export { commentsFeature } from './feature.server.js'
export type { CommentsTranslationKeys, CommentsTranslations } from './translations/index.js'

export type CommentsPluginConfig = {
  /** Server-side permission to edit or delete other authors' comments. Defaults to no moderation. */
  canModerate?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
  /** Collections receiving the sidebar. Add commentsFeature() to each rich text editor yourself. */
  collections: CollectionSlug[]
  /** Hides commenting UI while retaining stored fields and MarkNode support. Defaults to false. */
  disabled?: boolean
  /** Slug of the collection storing comments. Defaults to 'comments'. */
  slug?: string
  /** Auth collection used for comment authors and ownership checks. Defaults to 'users'. */
  usersCollection?: CollectionSlug
}

export const commentsPlugin =
  (options: CommentsPluginConfig) =>
  (config: Config): Config => {
    const slug = options.slug ?? 'comments'
    const targetCollections = new Set<string>(options.collections)
    return {
      ...config,
      admin: {
        ...config.admin,
        custom: {
          ...config.admin?.custom,
          'plugin-comments': { disabled: Boolean(options.disabled) },
        },
      },
      collections: [
        ...(config.collections ?? []).map((collection) =>
          targetCollections.has(collection.slug) && !options.disabled
            ? {
                ...collection,
                fields: [
                  ...collection.fields,
                  {
                    name: 'commentsPanel',
                    type: 'ui' as const,
                    admin: {
                      components: {
                        Field: {
                          clientProps: {
                            commentsSlug: slug,
                            usersCollection: options.usersCollection ?? 'users',
                          },
                          path: '@nualt/payload-plugin-comments/client#CommentsPanel',
                        },
                      },
                      position: 'sidebar' as const,
                    },
                    label: { en: 'Comments', fr: 'Commentaires' },
                  },
                ],
              }
            : collection,
        ),
        createCommentsCollection({ ...options, slug }),
      ],
      i18n: {
        ...config.i18n,
        translations: deepMergeSimple(translations, config.i18n?.translations ?? {}),
      },
    }
  }
