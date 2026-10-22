# @nualt/payload-plugin-comments

Inline comment threads for Payload 3.90 and Lexical. Select a passage, comment in the admin sidebar, reply, resolve, reopen or delete a thread. Includes English and French; the panel follows the admin language. The plugin does not change your public frontend.

Tested with SQLite, PostgreSQL and MongoDB (replica set).

## Installation

```sh
pnpm add @nualt/payload-plugin-comments
```

The host must provide compatible versions of `payload`, `@payloadcms/richtext-lexical`, `@payloadcms/ui` (`^3.90.0`), `react` and `react-dom` (`^19`). Translation types also require `@payloadcms/translations` (`^3.90.0`).

```ts
import { commentsFeature, commentsPlugin } from '@nualt/payload-plugin-comments'
import { lexicalEditor, InlineToolbarFeature } from '@payloadcms/richtext-lexical'
import { en } from '@payloadcms/translations/languages/en'
import { fr } from '@payloadcms/translations/languages/fr'
import { buildConfig } from 'payload'

export default buildConfig({
  // Keep your database, secret, auth collection and other existing configuration.
  i18n: { supportedLanguages: { en, fr }, fallbackLanguage: 'en' },
  collections: [{
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      {
        name: 'content',
        type: 'richText',
        editor: lexicalEditor({
          features: ({ defaultFeatures }) => [
            ...defaultFeatures,
            InlineToolbarFeature(),
            commentsFeature(),
          ],
        }),
      },
    ],
  }],
  plugins: [commentsPlugin({
    collections: ['posts'],
    usersCollection: 'users',
    slug: 'comments',
  })],
})
```

Regenerate the host import map and types after installing. `commentsFeature()` must be added to each rich text editor you want to annotate. The plugin adds only the sidebar UI field to the listed collections. Enable an inline or fixed Lexical toolbar so that the comment button is available.

Save a new document before commenting. Saving a comment stores its message separately; save the document to persist its text anchors. Draft messages are kept in browser session storage under `payload-plugin-comments:drafts:`.

## Options and permissions

| Option | Default | Purpose |
| --- | --- | --- |
| `collections` | Required | `CollectionSlug[]` receiving the sidebar. |
| `usersCollection` | `users` | Auth collection referenced by `author`. |
| `slug` | `comments` | Hidden collection storing messages. |
| `canModerate` | Nobody | `({ req }) => boolean \| Promise<boolean>` grants updates/deletes on other authors' messages. |
| `disabled` | `false` | Hides the sidebar and editor commenting UI; retains the comments collection, stored fields and MarkNode support. |

By default, any authenticated user can read comments. Only users authenticated through the configured `usersCollection` can create comments. Only the author can update/delete their messages, including resolving their own threads. The author is always forced to the authenticated user on create and cannot be changed on update. Deleting a root deletes all its replies only if the requesting user can delete each one; otherwise, the entire operation is refused before deleting any message. `canModerate` is evaluated on the server; the UI gets its result from the collection's `/moderation` endpoint. No role or user name field is required; display names fall back to email and then “User” / “Utilisateur”.

Permission refusals leave the entire thread intact on all three adapters. With the default transactions on PostgreSQL and MongoDB (replica set), integration tests also verify that an unexpected failure after two reply deletions rolls back the whole cascade, preserving all messages and parent links. MongoDB requires a replica set for these transactions. Without database transactions, an unexpected failure during a cascade (other than a permission refusal caught by the pre-check) can still leave a partial deletion. SQLite transactions remain disabled in the example and default test suite; enable them with `sqliteAdapter({ client: { url: '...' }, transactionOptions: {} })` when rollback is required.

These permissions are independent of the host document's access rules: this plugin does not provide tenant or per-document isolation. If your application requires those, adapt collection access before exposing comments to its users. Local API calls follow Payload's usual `overrideAccess` behavior; use `overrideAccess: false` and `user` when enforcing user permissions. The cascade pre-check always enforces the requesting user's delete permissions on replies, including when the root is deleted with `overrideAccess: true`. Creation also requires a user from `usersCollection` for author attribution. Ownership checks compare both the auth collection and ID; an explicit `canModerate` callback may grant moderation to other authenticated identities.

`documentCollection` and `documentId` are indexed text fields. The parent relation points to the configured comments slug. Changing slugs after storing comments requires your own data migration. The plugin supports string and numeric document/user IDs. The admin uses `serverURL` and `routes.api`, including a customized API route.

## Translations

All plugin UI strings use the `plugin-comments` namespace. Host overrides take precedence:

```ts
i18n: {
  supportedLanguages: { en, fr },
  translations: {
    en: { 'plugin-comments': { comments: 'Discussion' } },
    fr: { 'plugin-comments': { comments: 'Discussion' } },
  },
}
```

`CommentsTranslations` and `CommentsTranslationKeys` are exported for typed custom components. Collection and field labels provide English/French objects. Relative dates use the current admin language.

## Public rich text rendering

Keep `commentsFeature()` registered even when commenting is disabled so stored `mark` nodes remain readable. Public rendering should unwrap each mark and render only its children. For Payload's React renderer:

```tsx
import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import { RichText } from '@payloadcms/richtext-lexical/react'

const converters: JSXConvertersFunction = ({ defaultConverters }) => ({
  ...defaultConverters,
  mark: ({ node, nodesToJSX }) => nodesToJSX({ nodes: node.children }),
})

// <RichText data={document.content} converters={converters} />
```

Do not fetch comment messages on the public site. Other renderers need the same transparent treatment of `mark` nodes. This plugin supplies no frontend component or migration from existing comment collections.

## Local development

```sh
pnpm generate:importmap
pnpm generate:types
pnpm dev
pnpm build
pnpm lint
pnpm test:int
pnpm test:int:mongodb
pnpm test:e2e
```

The example at `http://localhost:3000/admin` defaults to SQLite (`dev/dev.db`) and seeds `dev@payloadcms.com` / `test`. Use these credentials only for local development. Set `DATABASE_ADAPTER=sqlite|postgres|mongodb` to choose an adapter; PostgreSQL and MongoDB outside tests require `DATABASE_URI`. Both admin languages are enabled.

`pnpm test:int` always uses in-memory SQLite with no database daemon. `pnpm test:int:mongodb` starts and stops a single-member `MongoMemoryReplSet`, using an isolated database and a binary cache under `node_modules/.cache/`; the first run downloads MongoDB. PostgreSQL tests require a fresh disposable database. For example:

```sh
docker run -d --rm --name ppc-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 postgres:16-alpine
DATABASE_URI=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm test:int:postgres
docker stop ppc-pg
```

The suite exercises ownership, moderation, replies, cascading deletion, disabled configuration and Lexical mark serialization. The mid-cascade rollback test runs on PostgreSQL and MongoDB and is skipped on the default SQLite configuration, which has no transactions.

Source exports are used during development; publishing uses `dist/`. Build before packing or publishing. No publication is performed by these scripts.

## Inherited limits

The panel loads up to 200 messages per document. Reopening a resolved thread restores its highlight at the first matching text node, using the stored quote (up to 120 characters). Repeated passages or formatting split across nodes may need manual correction. These behaviors are retained from the original feature; pagination and more precise anchors are outside this port.
