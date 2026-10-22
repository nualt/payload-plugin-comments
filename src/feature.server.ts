import { createNode, createServerFeature } from '@payloadcms/richtext-lexical'
import { MarkNode } from '@payloadcms/richtext-lexical/lexical/mark'

export const commentsFeature = createServerFeature({
  feature: {
    ClientFeature: '@nualt/payload-plugin-comments/client#commentsFeatureClient',
    nodes: [createNode({ node: MarkNode })],
  },
  key: 'comments',
})
