import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $setSelection,
} from '@payloadcms/richtext-lexical/lexical'
import { createHeadlessEditor } from '@payloadcms/richtext-lexical/lexical/headless'
import {
  $getMarkIDs,
  $isMarkNode,
  $unwrapMarkNode,
  $wrapSelectionInMarkNode,
  MarkNode,
} from '@payloadcms/richtext-lexical/lexical/mark'
import assert from 'node:assert/strict'
import { test } from 'vitest'

import { commentsFeature } from '../src/feature.server.js'

const storedComment = {
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'mark',
            children: [
              {
                type: 'text',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'passage commenté',
                version: 1,
              },
            ],
            direction: null,
            format: '' as const,
            ids: ['thread-existing', 'thread-overlap'],
            indent: 0,
            version: 1,
          },
        ],
        direction: null,
        format: '' as const,
        indent: 0,
        textFormat: 0,
        textStyle: '',
        version: 1,
      },
    ],
    direction: null,
    format: '' as const,
    indent: 0,
    version: 1,
  },
}

test('la feature commentaires conserve les IDs stockés et supporte wrap/getIDs/unwrap avec Payload 3.90', () => {
  assert.equal(typeof commentsFeature, 'function')

  const editor = createHeadlessEditor({ nodes: [MarkNode] })
  editor.setEditorState(editor.parseEditorState(storedComment))

  editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChild()
    assert.ok($isElementNode(paragraph))
    const storedMark = paragraph.getFirstChild()
    assert.ok($isMarkNode(storedMark))
    assert.deepEqual(storedMark.exportJSON().ids, ['thread-existing', 'thread-overlap'])
  })

  editor.update(
    () => {
      const storedParagraph = $getRoot().getFirstChild()
      assert.ok($isElementNode(storedParagraph))
      const mark = storedParagraph.getFirstChild()
      assert.ok($isMarkNode(mark))
      $unwrapMarkNode(mark)
      assert.equal(storedParagraph.getFirstChild()?.getType(), 'text')

      const paragraph = $createParagraphNode()
      const text = $createTextNode('nouveau commentaire')
      paragraph.append(text)
      $getRoot().clear().append(paragraph)

      const selection = $createRangeSelection()
      selection.anchor.set(text.getKey(), 0, 'text')
      selection.focus.set(text.getKey(), text.getTextContentSize(), 'text')
      $setSelection(selection)
      $wrapSelectionInMarkNode(selection, false, 'thread-new')

      assert.deepEqual($getMarkIDs(text, 1), ['thread-new'])
    },
    { discrete: true },
  )

  editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChild()
    assert.ok($isElementNode(paragraph))
    const wrapped = paragraph.getFirstChild()
    assert.ok($isMarkNode(wrapped))
    assert.deepEqual(wrapped.exportJSON().ids, ['thread-new'])
  })
})

test('registers the generic package client and keeps MarkNode available', () => {
  const provider = commentsFeature()
  assert.equal(provider.key, 'comments')
  assert.ok(typeof provider.feature !== 'function')
  assert.equal(
    provider.feature.ClientFeature,
    '@nualt/payload-plugin-comments/client#commentsFeatureClient',
  )
  assert.equal(provider.feature.nodes?.[0].node, MarkNode)
})
