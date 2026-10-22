'use client'

import type { ToolbarGroupItem } from '@payloadcms/richtext-lexical'
// Lexical comments feature (client). Replaces the mark-node-feature bridge:
// registers MarkNode on the client (nodes) and adds the actual UI:
// - "Comment" toolbar button: generates a threadId, wraps the selection
//   in a MarkNode, dispatches the `draft` event.
// - plugins: clicks / hover on marks, unwrap / rewrap, preview.
import type { LexicalEditor } from '@payloadcms/richtext-lexical/lexical'

import {
  createClientFeature,
  ToolbarButton,
  toolbarFeatureButtonsGroupWithItems,
  useEditorConfigContext,
} from '@payloadcms/richtext-lexical/client'
import {
  $createRangeSelection,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  TextNode,
} from '@payloadcms/richtext-lexical/lexical'
import {
  $getMarkIDs,
  $unwrapMarkNode,
  $wrapSelectionInMarkNode,
  MarkNode,
} from '@payloadcms/richtext-lexical/lexical/mark'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import { Button, useConfig, useTranslation } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { CommentsTranslationKeys, CommentsTranslations } from './translations/index.js'

import { COMMENTS_EVENTS, type CommentThreadPreview } from './events.js'
import './feature.client.scss'

const QUOTE_MAX_LENGTH = 120
const PREVIEW_MAX_LENGTH = 160

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max).trimEnd()}…`
}

function collectMarkThreadIds(editor: LexicalEditor): Set<string> {
  const ids = new Set<string>()
  editor.getEditorState().read(() => {
    for (const node of $nodesOfType(MarkNode)) {
      for (const id of node.getIDs()) {
        ids.add(id)
      }
    }
  })
  return ids
}

function syncMarkThreadIds(editor: LexicalEditor) {
  editor.getEditorState().read(() => {
    for (const node of $nodesOfType(MarkNode)) {
      const element = editor.getElementByKey(node.getKey())
      if (!element) {
        continue
      }
      const ids = node.getIDs()
      element.dataset.commentsThreadId = ids[0] ?? ''
      element.dataset.commentsThreadIds = ids.join(',')
    }
  })
}

// shortcut: restores the first matching text node; use persistent ranges for ambiguous quotes.
function rewrapQuoteInEditor(editor: LexicalEditor, threadId: string, quote: string) {
  if (!quote.trim()) {
    return
  }
  editor.update(() => {
    for (const node of $nodesOfType(TextNode)) {
      const text = node.getTextContent()
      const idx = text.indexOf(quote)
      if (idx < 0) {
        continue
      }
      const selection = $createRangeSelection()
      selection.anchor.set(node.getKey(), idx, 'text')
      selection.focus.set(node.getKey(), idx + quote.length, 'text')
      $setSelection(selection)
      $wrapSelectionInMarkNode(selection, false, threadId)
      return
    }
  })
  syncMarkThreadIds(editor)
}

function CommentIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 5.5C4 4.67157 4.67157 4 5.5 4H14.5C15.3284 4 16 4.67157 16 5.5V11.5C16 12.3284 15.3284 13 14.5 13H9.5L6.5 15.5V13H5.5C4.67157 13 4 12.3284 4 11.5V5.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CommentToolbarButton(props: { editor: LexicalEditor; item: ToolbarGroupItem }) {
  const { config } = useConfig()
  if (config.admin.custom?.['plugin-comments']?.disabled) {
    return null
  }
  return <ActiveCommentToolbarButton {...props} />
}

function ActiveCommentToolbarButton({
  editor,
  item,
}: {
  editor: LexicalEditor
  item: ToolbarGroupItem
}) {
  const { fieldProps } = useEditorConfigContext()
  const { t } = useTranslation<CommentsTranslations, CommentsTranslationKeys>()
  const [hasSelection, setHasSelection] = useState(false)

  useEffect(() => {
    const updateHasSelection = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        setHasSelection($isRangeSelection(selection) && !selection.isCollapsed())
      })
    }
    updateHasSelection()
    return mergeRegister(
      editor.registerUpdateListener(() => updateHasSelection()),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateHasSelection()
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor])

  const handleSelect = () => {
    let dispatchDetail: { fieldPath: string; quote: string; threadId: string } | null = null
    editor.update(
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || selection.isCollapsed()) {
          return
        }
        const threadId = crypto.randomUUID()
        const quote = selection.getTextContent().slice(0, QUOTE_MAX_LENGTH)
        $wrapSelectionInMarkNode(selection, selection.isBackward(), threadId)
        dispatchDetail = { fieldPath: fieldProps.path, quote, threadId }
      },
      {
        onUpdate: () => {
          if (dispatchDetail) {
            syncMarkThreadIds(editor)
            window.dispatchEvent(new CustomEvent(COMMENTS_EVENTS.draft, { detail: dispatchDetail }))
          }
        },
      },
    )
  }

  return (
    <ToolbarButton
      editor={editor}
      enabled={hasSelection}
      item={{ ...item, label: t('plugin-comments:addComment'), onSelect: handleSelect }}
    >
      <CommentIcon />
    </ToolbarButton>
  )
}

const toolbarGroups = [
  toolbarFeatureButtonsGroupWithItems([
    {
      Component: CommentToolbarButton,
      key: 'comments',
      label: ({ i18n }) => i18n.t('plugin-comments:addComment'),
      order: 60,
    },
  ]),
]

type MarkPreviewState = {
  left: number
  threadId: string
  top: number
}

function CommentMarkPreviewPlugin() {
  const { t } = useTranslation<CommentsTranslations, CommentsTranslationKeys>()
  const [editor] = useLexicalComposerContext()
  const threadsRef = useRef<Record<string, CommentThreadPreview>>({})
  const [preview, setPreview] = useState<MarkPreviewState | null>(null)
  const hideTimerRef = useRef<null | number>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<MarkPreviewState | null>(null)
  previewRef.current = preview

  const isOverMarkOrPopup = useCallback(
    (node: EventTarget | null): boolean => {
      if (!(node instanceof Node)) {
        return false
      }
      if (popupRef.current?.contains(node)) {
        return true
      }
      const root = editor.getRootElement()
      if (!root) {
        return false
      }
      if (node instanceof HTMLElement) {
        const mark = node.closest('mark[data-comments-thread-id]')
        return Boolean(mark && root.contains(mark))
      }
      return false
    },
    [editor],
  )

  useEffect(() => {
    const handleThreadsSync = (event: Event) => {
      threadsRef.current = (event as CustomEvent<Record<string, CommentThreadPreview>>).detail
    }
    window.addEventListener(COMMENTS_EVENTS.threadsSync, handleThreadsSync)
    return () => window.removeEventListener(COMMENTS_EVENTS.threadsSync, handleThreadsSync)
  }, [])

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => syncMarkThreadIds(editor))
    })
  }, [editor])

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) {
      return
    }

    const cancelHide = () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }

    const scheduleHide = () => {
      cancelHide()
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        setPreview(null)
      }, 200)
    }

    const showForMark = (mark: HTMLElement) => {
      const threadId = mark.dataset.commentsThreadId
      if (!threadId) {
        return
      }
      const thread = threadsRef.current[threadId]
      if (!thread) {
        return
      }
      const rect = mark.getBoundingClientRect()
      cancelHide()
      setPreview({
        left: Math.min(rect.left + window.scrollX, window.innerWidth - 300),
        threadId,
        top: rect.bottom + window.scrollY + 4,
      })
    }

    const onMouseOver = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const mark = target.closest<HTMLElement>('mark[data-comments-thread-id]')
      if (mark && root.contains(mark)) {
        showForMark(mark)
        return
      }
      if (popupRef.current?.contains(target)) {
        return
      }
      if (previewRef.current) {
        scheduleHide()
      }
    }

    root.addEventListener('mouseover', onMouseOver)

    return () => {
      root.removeEventListener('mouseover', onMouseOver)
      cancelHide()
    }
  }, [editor, isOverMarkOrPopup])

  // Closes the popup as soon as the pointer leaves mark + popup (without waiting for mouseleave).
  useEffect(() => {
    if (!preview) {
      return
    }

    const cancelHide = () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }

    const scheduleHide = () => {
      cancelHide()
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        setPreview(null)
      }, 120)
    }

    const onPointerMove = (event: PointerEvent) => {
      const under = document.elementFromPoint(event.clientX, event.clientY)
      if (isOverMarkOrPopup(under)) {
        cancelHide()
        return
      }
      scheduleHide()
    }

    document.addEventListener('pointermove', onPointerMove)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      cancelHide()
    }
  }, [preview, isOverMarkOrPopup])

  const thread = preview ? threadsRef.current[preview.threadId] : null

  const closePreview = () => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setPreview(null)
  }

  const handlePopupMouseLeave = (event: React.MouseEvent) => {
    if (isOverMarkOrPopup(event.relatedTarget)) {
      return
    }
    closePreview()
  }

  const handleOpenInPanel = () => {
    if (!preview) {
      return
    }
    window.dispatchEvent(
      new CustomEvent(COMMENTS_EVENTS.focus, { detail: { threadId: preview.threadId } }),
    )
    closePreview()
  }

  const handleReply = () => {
    if (!preview) {
      return
    }
    window.dispatchEvent(
      new CustomEvent(COMMENTS_EVENTS.focus, { detail: { threadId: preview.threadId } }),
    )
    window.dispatchEvent(
      new CustomEvent(COMMENTS_EVENTS.replyFocus, { detail: { threadId: preview.threadId } }),
    )
    closePreview()
  }

  if (!preview || !thread || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      aria-label={t('plugin-comments:comments')}
      className="comments-mark-preview"
      onMouseEnter={() => {
        if (hideTimerRef.current != null) {
          window.clearTimeout(hideTimerRef.current)
          hideTimerRef.current = null
        }
      }}
      onMouseLeave={handlePopupMouseLeave}
      ref={popupRef}
      role="dialog"
      style={{ left: preview.left, top: preview.top }}
    >
      {thread.quote ? (
        <p className="comments-mark-preview__quote">
          {t('plugin-comments:quote', { quote: truncate(thread.quote, 80) })}
        </p>
      ) : null}
      <div className="comments-mark-preview__head">
        <span className="comments-mark-preview__author">{thread.author}</span>
        {thread.replyCount > 0 ? (
          <span className="comments-mark-preview__badge">
            {t('plugin-comments:repliesShort', { count: thread.replyCount })}
          </span>
        ) : null}
      </div>
      <p className="comments-mark-preview__content">
        {truncate(thread.content, PREVIEW_MAX_LENGTH)}
      </p>
      <div className="comments-mark-preview__actions">
        <Button buttonStyle="secondary" onClick={handleOpenInPanel} size="small">
          {t('plugin-comments:viewThread')}
        </Button>
        {!thread.resolved ? (
          <Button buttonStyle="primary" onClick={handleReply} size="small">
            {t('plugin-comments:replyAction')}
          </Button>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

function CommentsPlugin() {
  const [editor] = useLexicalComposerContext()
  const { fieldProps } = useEditorConfigContext()
  const previousThreadIdsRef = useRef<Set<string>>(new Set())
  const skipCascadeRef = useRef<Set<string>>(new Set())
  const hasInitializedThreadIdsRef = useRef(false)

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        syncMarkThreadIds(editor)
        const current = collectMarkThreadIds(editor)

        if (!hasInitializedThreadIdsRef.current) {
          previousThreadIdsRef.current = current
          hasInitializedThreadIdsRef.current = true
          return
        }

        const previous = previousThreadIdsRef.current
        for (const threadId of previous) {
          if (current.has(threadId)) {
            continue
          }
          if (skipCascadeRef.current.delete(threadId)) {
            continue
          }
          window.dispatchEvent(
            new CustomEvent(COMMENTS_EVENTS.threadOrphaned, {
              detail: { fieldPath: fieldProps.path, threadId },
            }),
          )
        }
        previousThreadIdsRef.current = current
      })
    })
  }, [editor, fieldProps.path])

  useEffect(() => {
    return editor.registerCommand(
      CLICK_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false
        }
        const anchorNode = selection.anchor.getNode()
        if (!$isTextNode(anchorNode)) {
          return false
        }
        const ids = $getMarkIDs(anchorNode, selection.anchor.offset)
        if (ids && ids.length > 0) {
          window.dispatchEvent(
            new CustomEvent(COMMENTS_EVENTS.focus, { detail: { threadId: ids[0] } }),
          )
        }
        return false
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor])

  useEffect(() => {
    const handleUnwrap = (event: Event) => {
      const { skipCascade, threadId } = (
        event as CustomEvent<{ skipCascade?: boolean; threadId: string }>
      ).detail
      if (skipCascade) {
        skipCascadeRef.current.add(threadId)
      }
      editor.update(() => {
        for (const node of $nodesOfType(MarkNode)) {
          if (!node.hasID(threadId)) {
            continue
          }
          if (node.getIDs().length > 1) {
            node.deleteID(threadId)
          } else {
            $unwrapMarkNode(node)
          }
        }
      })
    }
    const handleRewrap = (event: Event) => {
      const { quote, threadId } = (event as CustomEvent<{ quote: string; threadId: string }>).detail
      rewrapQuoteInEditor(editor, threadId, quote)
    }
    window.addEventListener(COMMENTS_EVENTS.unwrap, handleUnwrap)
    window.addEventListener(COMMENTS_EVENTS.rewrap, handleRewrap)
    return () => {
      window.removeEventListener(COMMENTS_EVENTS.unwrap, handleUnwrap)
      window.removeEventListener(COMMENTS_EVENTS.rewrap, handleRewrap)
    }
  }, [editor])

  return null
}

function CommentsPlugins() {
  const { config } = useConfig()
  if (config.admin.custom?.['plugin-comments']?.disabled) {
    return null
  }
  return (
    <>
      <CommentsPlugin />
      <CommentMarkPreviewPlugin />
    </>
  )
}

export const commentsFeatureClient = createClientFeature(({ config }) => ({
  nodes: [MarkNode],
  plugins: [{ Component: CommentsPlugins, position: 'normal' }],
  toolbarFixed: { groups: config.admin.custom?.['plugin-comments']?.disabled ? [] : toolbarGroups },
  toolbarInline: { groups: config.admin.custom?.['plugin-comments']?.disabled ? [] : toolbarGroups },
}))
