import type { CollectionSlug, Config } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { initI18n } from '@payloadcms/translations'
import { en } from '@payloadcms/translations/languages/en'
import { buildConfig, createClientConfig } from 'payload'
import { describe, expect, test } from 'vitest'

import * as plugin from '../src/index.js'

describe('commentsPlugin configuration', () => {
  test('exports the reusable plugin', () => {
    expect(plugin).toHaveProperty('commentsPlugin', expect.any(Function))
  })

  test('preserves host config, fields, hooks and translation overrides', () => {
    const onInit = async () => {}
    const config: Config = {
      collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }],
      db: sqliteAdapter({ client: { url: 'file::memory:' } }),
      i18n: { translations: { en: { 'plugin-comments': { comments: 'Discussion' } } } },
      onInit,
      secret: 'test',
    }
    const result = plugin.commentsPlugin({ collections: ['posts'] })(config)
    expect(config.collections).toHaveLength(1)
    expect(config.collections?.[0].fields).toHaveLength(1)
    expect(result.onInit).toBe(onInit)
    expect(result.collections?.[0].fields).toHaveLength(2)
    expect(result.i18n?.translations?.en).toMatchObject({
      'plugin-comments': { comments: 'Discussion' },
    })
    expect(result.i18n?.translations?.fr).toMatchObject({
      'plugin-comments': { cancel: 'Annuler', send: 'Envoyer' },
    })
  })

  test('disabled retains the same persisted collection schema and removes sidebar UI', () => {
    const config: Config = {
      collections: [{ slug: 'posts', fields: [] }],
      db: sqliteAdapter({ client: { url: 'file::memory:' } }),
      secret: 'test',
    }
    const enabled = plugin.commentsPlugin({ collections: ['posts'] })(config)
    const disabled = plugin.commentsPlugin({ collections: ['posts'], disabled: true })(config)
    expect(disabled.collections?.find(({ slug }) => slug === 'comments')?.fields).toEqual(
      enabled.collections?.find(({ slug }) => slug === 'comments')?.fields,
    )
    expect(disabled.collections?.[0].fields).toEqual([])
    expect(disabled.admin?.custom?.['plugin-comments']).toMatchObject({ disabled: true })
  })

  test('supports custom collection and author slugs', () => {
    const result = plugin.commentsPlugin({
      slug: 'discussions',
      collections: [],
      usersCollection: 'editors' as CollectionSlug,
    })({ db: sqliteAdapter({ client: { url: 'file::memory:' } }), secret: 'test' })
    const collection = result.collections?.find(({ slug }) => slug === 'discussions')
    expect(collection?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'documentCollection', type: 'text', index: true }),
        expect.objectContaining({ name: 'parent', relationTo: 'discussions' }),
        expect.objectContaining({ name: 'author', relationTo: 'editors' }),
      ]),
    )
  })
  test('disabled reaches the sanitized browser config without overwriting host admin settings', async () => {
    const config = await buildConfig(
      plugin.commentsPlugin({ collections: [], disabled: true })({
        admin: { custom: { hostFlag: true } },
        db: sqliteAdapter({ client: { url: 'file::memory:' } }),
        secret: 'test',
      }),
    )
    const i18n = await initI18n({
      config: { supportedLanguages: { en } },
      context: 'client',
      language: 'en',
    })
    const clientConfig = createClientConfig({ config, i18n, importMap: {}, user: true })
    expect(clientConfig.admin.custom).toMatchObject({
      hostFlag: true,
      'plugin-comments': { disabled: true },
    })
  })
})
