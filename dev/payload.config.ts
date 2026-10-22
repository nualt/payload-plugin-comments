import { commentsFeature, commentsPlugin } from '@nualt/payload-plugin-comments'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import {
  FixedToolbarFeature,
  InlineToolbarFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import { en } from '@payloadcms/translations/languages/en'
import { fr } from '@payloadcms/translations/languages/fr'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const adapter = process.env.DATABASE_ADAPTER ?? 'sqlite'
const db = (() => {
  if (adapter === 'sqlite') {
    return sqliteAdapter({
      client: {
        url:
          process.env.NODE_ENV === 'test'
            ? 'file::memory:'
            : `file:${path.resolve(dirname, 'dev.db')}`,
      },
    })
  }
  if (adapter !== 'postgres' && adapter !== 'mongodb') {
    throw new Error(`Unknown DATABASE_ADAPTER: ${adapter}`)
  }
  if (!process.env.DATABASE_URI) {
    throw new Error(`DATABASE_URI is required for ${adapter}`)
  }
  return adapter === 'postgres'
    ? postgresAdapter({ pool: { connectionString: process.env.DATABASE_URI } })
    : mongooseAdapter({ ensureIndexes: true, url: process.env.DATABASE_URI })
})()

export default buildConfig({
  admin: {
    importMap: {
      baseDir: dirname,
      importMapFile: path.resolve(dirname, 'app/(payload)/admin/importMap.js'),
    },
  },
  collections: [
    {
      slug: 'posts',
      admin: { useAsTitle: 'title' },
      fields: [
        { name: 'title', type: 'text', required: true },
        {
          name: 'content',
          type: 'richText',
          editor: lexicalEditor({
            features: ({ defaultFeatures }) => [
              ...defaultFeatures,
              FixedToolbarFeature(),
              InlineToolbarFeature(),
              commentsFeature(),
            ],
          }),
        },
      ],
    },
  ],
  db,
  editor: lexicalEditor(),
  email: testEmailAdapter,
  i18n: { fallbackLanguage: 'en', supportedLanguages: { en, fr } },
  onInit: seed,
  plugins: [
    commentsPlugin({
      canModerate:
        process.env.NODE_ENV === 'test'
          ? ({ req }) => req.user?.email === 'moderator@example.test'
          : undefined,
      collections: ['posts'],
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'local-development-only-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
