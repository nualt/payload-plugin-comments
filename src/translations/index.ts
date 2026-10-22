import type { NestedKeysStripped } from '@payloadcms/translations'

import { en } from './en.js'
import { fr } from './fr.js'

export const translations = {
  en: { 'plugin-comments': en },
  fr: { 'plugin-comments': fr },
}

export type CommentsTranslations = typeof translations.en
export type CommentsTranslationKeys = NestedKeysStripped<CommentsTranslations>
