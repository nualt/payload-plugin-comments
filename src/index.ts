import type { CollectionSlug, Config, PayloadRequest } from 'payload'

import { deepMergeSimple } from 'payload/shared'

import { createCommentsCollection } from './collection.js'
import { translations } from './translations/index.js'

export { commentsFeature } from './feature.server.js'
export type { CommentsTranslationKeys, CommentsTranslations } from './translations/index.js'

export type CommentsPluginConfig = {
  canModerate?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
  /** Collections receiving the sidebar. Add commentsFeature() to each rich text editor yourself. */
  collections: CollectionSlug[]
  /** Keeps stored fields and MarkNode support, hides commenting UI. */
  disabled?: boolean
  slug?: string
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
