import { createNode, createServerFeature } from '@payloadcms/richtext-lexical'
import { MarkNode } from '@payloadcms/richtext-lexical/lexical/mark'

/**
 * Adds inline comment controls and MarkNode support to a Lexical editor.
 * Register it on each annotated rich text field, including when the plugin is disabled,
 * so existing comment marks remain readable. Requires an inline or fixed toolbar.
 */
export const commentsFeature = createServerFeature({
  feature: {
    ClientFeature: '@nualt/payload-plugin-comments/client#commentsFeatureClient',
    nodes: [createNode({ node: MarkNode })],
  },
  key: 'comments',
})
