import { t } from '@payloadcms/translations'
import { expect, test } from 'vitest'

import { translations } from '../src/translations/index.js'

test.each([
  { expected: '“A < B & "C"”', language: 'en' as const },
  { expected: '«\u00a0A < B & "C"\u00a0»', language: 'fr' as const },
])('quotes passages in $language without HTML-escaping the text', ({ expected, language }) => {
  expect(
    t({
      key: 'plugin-comments:quote',
      translations: translations[language],
      vars: { quote: 'A < B & "C"' },
    }),
  ).toBe(expected)
})
