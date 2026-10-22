'use client'

/* eslint-disable jsx-a11y/no-autofocus -- Preserve focus on the newly selected passage's draft. */

// Comments panel (always-on sidebar, UI field). Talks to the Lexical
// feature through the `./events` event bus.
import {
  Button,
  toast,
  useAuth,
  useConfig,
  useDocumentInfo,
  useFormProcessing,
  useTranslation,
} from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CommentsTranslationKeys, CommentsTranslations } from './translations/index.js'

import { COMMENTS_EVENTS, type CommentThreadPreview } from './events.js'
import './panel.scss'

const baseClass = 'comments-panel'

type CommentID = number | string

type CommentUser = { email?: null | string; id: CommentID; name?: null | string }

type CommentDoc = {
  author: CommentID | CommentUser | null
  content: string
  createdAt: string
  fieldPath: string
  id: CommentID
  parent?: CommentDoc | CommentID | null
  quote?: null | string
  resolved?: boolean | null
  threadId: string
}

type Thread = {
  replies: CommentDoc[]
  root: CommentDoc
  threadId: string
}

type DraftDetail = { fieldPath: string; quote: string; threadId: string }

type FetchStatus = 'error' | 'loading' | 'ready'

function formatDate(iso: string, language: string): string {
  const relativeFormatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const absoluteFormatter = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const date = new Date(iso)
  const diffMs = date.getTime() - Date.now()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (Math.abs(diffDays) > 7) {
    return absoluteFormatter.format(date)
  }

  const diffSeconds = Math.round(diffMs / 1000)
  const diffMinutes = Math.round(diffSeconds / 60)
  const diffHours = Math.round(diffSeconds / 3600)

  if (Math.abs(diffSeconds) < 60) {
    return relativeFormatter.format(diffSeconds, 'second')
  }
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, 'minute')
  }
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, 'hour')
  }
  return relativeFormatter.format(diffDays, 'day')
}

function authorName(author: CommentID | CommentUser | null, fallback: string): string {
  if (!author || typeof author !== 'object') {
    return fallback
  }
  return author.name || author.email || fallback
}

function groupThreads(docs: CommentDoc[]): Thread[] {
  const byThreadId = new Map<string, { replies: CommentDoc[]; root?: CommentDoc }>()

  for (const doc of docs) {
    const entry = byThreadId.get(doc.threadId) ?? { replies: [] }
    if (doc.parent == null) {
      entry.root = doc
    } else {
      entry.replies.push(doc)
    }
    byThreadId.set(doc.threadId, entry)
  }

  const threads: Thread[] = []
  byThreadId.forEach((entry, threadId) => {
    if (!entry.root) {
      return
    }
    entry.replies.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    threads.push({ replies: entry.replies, root: entry.root, threadId })
  })

  threads.sort(
    (a, b) => new Date(a.root.createdAt).getTime() - new Date(b.root.createdAt).getTime(),
  )
  return threads
}

function dispatch(name: (typeof COMMENTS_EVENTS)[keyof typeof COMMENTS_EVENTS], detail: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

function buildThreadsPreviewMap(
  threads: Thread[],
  fallbackAuthor: string,
): Record<string, CommentThreadPreview> {
  const map: Record<string, CommentThreadPreview> = {}
  for (const thread of threads) {
    if (thread.root.resolved) {
      continue
    }
    map[thread.threadId] = {
      author: authorName(thread.root.author, fallbackAuthor),
      content: thread.root.content,
      quote: thread.root.quote ?? null,
      replyCount: thread.replies.length,
      resolved: Boolean(thread.root.resolved),
    }
  }
  return map
}

type PendingDraft = { content: string; draft: DraftDetail }

function commentDraftsStorageKey(collectionSlug: string, documentId: number | string) {
  return `payload-plugin-comments:drafts:${collectionSlug}:${documentId}`
}

function readPersistedPendingDrafts(key: string): Record<string, PendingDraft> {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as PendingDraft | Record<string, PendingDraft>
    if (parsed && 'draft' in parsed && 'content' in parsed) {
      const legacy = parsed as PendingDraft
      return { [legacy.draft.threadId]: legacy }
    }
    return parsed
  } catch {
    return {}
  }
}

function writePersistedPendingDrafts(key: string, data: Record<string, PendingDraft>) {
  try {
    if (Object.keys(data).length === 0) {
      sessionStorage.removeItem(key)
    } else {
      sessionStorage.setItem(key, JSON.stringify(data))
    }
  } catch {
    /* quota exceeded or storage unavailable */
  }
}

function CategoryHeaderContent({
  collapsible = false,
  count,
  expanded = false,
  title,
}: {
  collapsible?: boolean
  count: number
  expanded?: boolean
  title: string
}) {
  return (
    <>
      <div className={`${baseClass}__category-leading`}>
        {collapsible ? (
          <span
            aria-hidden
            className={[
              `${baseClass}__category-chevron`,
              expanded ? `${baseClass}__category-chevron--expanded` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ) : (
          <span aria-hidden className={`${baseClass}__category-chevron-spacer`} />
        )}
        <h4 className={`${baseClass}__category-title`}>{title}</h4>
      </div>
      <span className={`${baseClass}__category-count`}>{count}</span>
    </>
  )
}

export function CommentsPanel({
  commentsSlug = 'comments',
  usersCollection = 'users',
}: {
  commentsSlug?: string
  usersCollection?: string
}) {
  const { config } = useConfig()
  const { i18n, t } = useTranslation<CommentsTranslations, CommentsTranslationKeys>()
  const collectionURL = `${config.serverURL ?? ''}${config.routes.api}/${encodeURIComponent(commentsSlug)}`
  const [canModerate, setCanModerate] = useState(false)
  const { id: documentId, collectionSlug } = useDocumentInfo()
  const { user } = useAuth()
  const isFormProcessing = useFormProcessing()

  const [status, setStatus] = useState<FetchStatus>('loading')
  const [threads, setThreads] = useState<Thread[]>([])
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, PendingDraft>>({})
  const [replyContent, setReplyContent] = useState<Record<string, string>>({})
  const [flashedThreadId, setFlashedThreadId] = useState<null | string>(null)
  const [resolvedSectionOpen, setResolvedSectionOpen] = useState(false)
  const [isMutating, setIsMutating] = useState(false)
  const mutatingRef = useRef(false)

  const threadRefs = useRef(new Map<string, HTMLElement>())
  const replyInputRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const hasSyncedResolvedRef = useRef(false)
  const pendingDraftsRef = useRef<Record<string, PendingDraft>>({})
  const hasRestoredPendingDraftsRef = useRef(false)
  const flashTimeoutRef = useRef<null | number>(null)
  const threadsRef = useRef<Thread[]>([])

  useEffect(() => {
    threadsRef.current = threads
  }, [threads])

  const updatePendingDrafts = useCallback(
    (updater: (prev: Record<string, PendingDraft>) => Record<string, PendingDraft>) => {
      setPendingDrafts((prev) => {
        const next = updater(prev)
        pendingDraftsRef.current = next
        return next
      })
    },
    [],
  )

  useEffect(() => {
    hasRestoredPendingDraftsRef.current = false
    if (documentId == null || !collectionSlug) {
      return
    }
    const stored = readPersistedPendingDrafts(commentDraftsStorageKey(collectionSlug, documentId))
    pendingDraftsRef.current = stored
    setPendingDrafts(stored)
    hasRestoredPendingDraftsRef.current = true
  }, [collectionSlug, documentId])

  useEffect(() => {
    if (documentId == null || !collectionSlug || !hasRestoredPendingDraftsRef.current) {
      return
    }
    writePersistedPendingDrafts(commentDraftsStorageKey(collectionSlug, documentId), pendingDrafts)
  }, [collectionSlug, documentId, pendingDrafts])

  const beginMutation = (): boolean => {
    if (mutatingRef.current) {
      return false
    }
    mutatingRef.current = true
    setIsMutating(true)
    return true
  }

  const endMutation = () => {
    mutatingRef.current = false
    setIsMutating(false)
  }

  useEffect(() => {
    let active = true
    setCanModerate(false)
    void fetch(`${collectionURL}/moderation`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          return false
        }
        const result = (await res.json()) as { canModerate?: boolean }
        return result.canModerate === true
      })
      .then((allowed) => {
        if (active) {
          setCanModerate(allowed)
        }
      })
      .catch(() => {
        if (active) {
          setCanModerate(false)
        }
      })
    return () => {
      active = false
    }
  }, [collectionURL, user])

  const canDelete = useCallback(
    (doc: CommentDoc) => {
      if (!user) {
        return false
      }
      if (canModerate) {
        return true
      }
      if (user.collection !== usersCollection) {
        return false
      }
      const authorId = typeof doc.author === 'object' ? doc.author?.id : doc.author
      return authorId === user.id
    },
    [user, canModerate, usersCollection],
  )

  const fetchThreads = useCallback(async () => {
    if (documentId == null || !collectionSlug) {
      return
    }
    setStatus((current) => (current === 'ready' ? current : 'loading'))
    try {
      const qs = new URLSearchParams({
        depth: '1',
        // shortcut: loads the first 200 messages; add pagination for larger discussions.
        limit: '200',
        sort: 'createdAt',
        'where[documentCollection][equals]': collectionSlug,
        'where[documentId][equals]': String(documentId),
      })
      const res = await fetch(`${collectionURL}?${qs.toString()}`, { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`Statut ${res.status}`)
      }
      const data = (await res.json()) as { docs: CommentDoc[] }
      setThreads(groupThreads(data.docs ?? []))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [documentId, collectionSlug, collectionURL])

  useEffect(() => {
    void fetchThreads()
  }, [fetchThreads])

  // Thread metadata -> hover preview of highlights in the editor.
  useEffect(() => {
    if (status !== 'ready') {
      return
    }
    dispatch(
      COMMENTS_EVENTS.threadsSync,
      buildThreadsPreviewMap(threads, t('plugin-comments:user')),
    )
  }, [status, threads, t])

  useEffect(() => {
    if (status !== 'ready' || hasSyncedResolvedRef.current) {
      return
    }
    hasSyncedResolvedRef.current = true
    for (const thread of threads) {
      if (thread.root.resolved) {
        dispatch(COMMENTS_EVENTS.unwrap, { skipCascade: true, threadId: thread.threadId })
      }
    }
  }, [status, threads])

  useEffect(() => {
    const handleDraft = (event: Event) => {
      const detail = (event as CustomEvent<DraftDetail>).detail
      updatePendingDrafts((prev) => ({
        ...prev,
        [detail.threadId]: { content: prev[detail.threadId]?.content ?? '', draft: detail },
      }))
    }
    window.addEventListener(COMMENTS_EVENTS.draft, handleDraft)
    return () => window.removeEventListener(COMMENTS_EVENTS.draft, handleDraft)
  }, [updatePendingDrafts])

  useEffect(() => {
    const handleFocus = (event: Event) => {
      const { threadId } = (event as CustomEvent<{ threadId: string }>).detail
      if (
        threadsRef.current.some((thread) => thread.threadId === threadId && thread.root.resolved)
      ) {
        setResolvedSectionOpen(true)
      }
      requestAnimationFrame(() => {
        threadRefs.current.get(threadId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      setFlashedThreadId(threadId)
      if (flashTimeoutRef.current != null) {
        window.clearTimeout(flashTimeoutRef.current)
      }
      flashTimeoutRef.current = window.setTimeout(() => {
        flashTimeoutRef.current = null
        setFlashedThreadId((current) => (current === threadId ? null : current))
      }, 1500)
    }
    window.addEventListener(COMMENTS_EVENTS.focus, handleFocus)
    return () => {
      window.removeEventListener(COMMENTS_EVENTS.focus, handleFocus)
      if (flashTimeoutRef.current != null) {
        window.clearTimeout(flashTimeoutRef.current)
        flashTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleReplyFocus = (event: Event) => {
      const { threadId } = (event as CustomEvent<{ threadId: string }>).detail
      requestAnimationFrame(() => {
        const input = replyInputRefs.current.get(threadId)
        input?.focus()
      })
    }
    window.addEventListener(COMMENTS_EVENTS.replyFocus, handleReplyFocus)
    return () => window.removeEventListener(COMMENTS_EVENTS.replyFocus, handleReplyFocus)
  }, [])

  const removePendingDraft = useCallback(
    (threadId: string) => {
      updatePendingDrafts((prev) => {
        const { [threadId]: _, ...rest } = prev
        return rest
      })
    },
    [updatePendingDrafts],
  )

  const deleteOrphanedThread = useCallback(
    async (threadId: string, fieldPath: string) => {
      if (documentId == null || !collectionSlug) {
        return
      }

      removePendingDraft(threadId)

      const known = threadsRef.current.find((t) => t.threadId === threadId)
      if (known && known.root.fieldPath !== fieldPath) {
        return
      }

      let rootId: CommentID | null = known?.root.id ?? null

      if (rootId == null) {
        const qs = new URLSearchParams({
          depth: '0',
          limit: '50',
          'where[documentCollection][equals]': collectionSlug,
          'where[documentId][equals]': String(documentId),
          'where[fieldPath][equals]': fieldPath,
          'where[threadId][equals]': threadId,
        })
        try {
          const res = await fetch(`${collectionURL}?${qs.toString()}`, { credentials: 'include' })
          if (!res.ok) {
            return
          }
          const data = (await res.json()) as { docs: CommentDoc[] }
          const root = (data.docs ?? []).find((doc) => doc.parent == null)
          if (!root) {
            return
          }
          rootId = root.id
        } catch {
          return
        }
      }

      if (!beginMutation()) {
        return
      }
      try {
        const res = await fetch(`${collectionURL}/${encodeURIComponent(rootId)}`, {
          credentials: 'include',
          method: 'DELETE',
        })
        if (!res.ok) {
          return
        }
        await fetchThreads()
      } finally {
        endMutation()
      }
    },
    [collectionSlug, documentId, fetchThreads, removePendingDraft, collectionURL],
  )

  useEffect(() => {
    const handleThreadOrphaned = (event: Event) => {
      const { fieldPath, threadId } = (
        event as CustomEvent<{ fieldPath: string; threadId: string }>
      ).detail
      void deleteOrphanedThread(threadId, fieldPath)
    }
    window.addEventListener(COMMENTS_EVENTS.threadOrphaned, handleThreadOrphaned)
    return () => window.removeEventListener(COMMENTS_EVENTS.threadOrphaned, handleThreadOrphaned)
  }, [deleteOrphanedThread])

  const cancelPendingDraft = (threadId: string) => {
    dispatch(COMMENTS_EVENTS.unwrap, { skipCascade: true, threadId })
    removePendingDraft(threadId)
  }

  const setPendingDraftContent = (threadId: string, content: string) => {
    updatePendingDrafts((prev) => {
      const entry = prev[threadId]
      if (!entry) {
        return prev
      }
      return { ...prev, [threadId]: { ...entry, content } }
    })
  }

  const submitPendingDraft = async (threadId: string) => {
    const pending = pendingDraftsRef.current[threadId]
    if (!pending || documentId == null || !collectionSlug) {
      return
    }
    const content = pending.content.trim()
    if (!content) {
      return
    }
    if (!beginMutation()) {
      return
    }
    const { draft } = pending
    try {
      const res = await fetch(collectionURL, {
        body: JSON.stringify({
          content,
          documentCollection: collectionSlug,
          documentId: String(documentId),
          fieldPath: draft.fieldPath,
          quote: draft.quote,
          threadId: draft.threadId,
        }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      if (!res.ok) {
        throw new Error(`Statut ${res.status}`)
      }
      removePendingDraft(threadId)
      await fetchThreads()
    } catch {
      toast.error(t('plugin-comments:sendCommentError'))
    } finally {
      endMutation()
    }
  }

  const submitReply = async (thread: Thread) => {
    if (documentId == null || !collectionSlug) {
      return
    }
    const content = (replyContent[thread.threadId] ?? '').trim()
    if (!content) {
      return
    }
    if (!beginMutation()) {
      return
    }
    try {
      const res = await fetch(collectionURL, {
        body: JSON.stringify({
          content,
          documentCollection: collectionSlug,
          documentId: String(documentId),
          fieldPath: thread.root.fieldPath,
          parent: thread.root.id,
          threadId: thread.threadId,
        }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      if (!res.ok) {
        throw new Error(`Statut ${res.status}`)
      }
      setReplyContent((current) => ({ ...current, [thread.threadId]: '' }))
      await fetchThreads()
    } catch {
      toast.error(t('plugin-comments:sendReplyError'))
    } finally {
      endMutation()
    }
  }

  const toggleResolved = async (thread: Thread) => {
    if (!beginMutation()) {
      return
    }
    const nextResolved = !thread.root.resolved
    try {
      const res = await fetch(`${collectionURL}/${encodeURIComponent(thread.root.id)}`, {
        body: JSON.stringify({ resolved: nextResolved }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
      if (!res.ok) {
        throw new Error(`Statut ${res.status}`)
      }
      if (nextResolved) {
        dispatch(COMMENTS_EVENTS.unwrap, { skipCascade: true, threadId: thread.threadId })
      } else if (thread.root.quote) {
        dispatch(COMMENTS_EVENTS.rewrap, {
          quote: thread.root.quote,
          threadId: thread.threadId,
        })
      }
      await fetchThreads()
    } catch {
      toast.error(t('plugin-comments:resolveError'))
    } finally {
      endMutation()
    }
  }

  const deleteMessage = async (thread: Thread, doc: CommentDoc) => {
    const isRoot = doc.id === thread.root.id
    const confirmed = window.confirm(
      isRoot ? t('plugin-comments:deleteThreadConfirm') : t('plugin-comments:deleteCommentConfirm'),
    )
    if (!confirmed) {
      return
    }
    if (!beginMutation()) {
      return
    }
    try {
      const res = await fetch(`${collectionURL}/${encodeURIComponent(doc.id)}`, {
        credentials: 'include',
        method: 'DELETE',
      })
      if (!res.ok) {
        throw new Error(`Statut ${res.status}`)
      }
      if (isRoot) {
        dispatch(COMMENTS_EVENTS.unwrap, { skipCascade: true, threadId: thread.threadId })
      }
      await fetchThreads()
    } catch {
      toast.error(t('plugin-comments:deleteError'))
    } finally {
      endMutation()
    }
  }

  const unresolvedThreads = useMemo(() => threads.filter((t) => !t.root.resolved), [threads])
  const resolvedThreads = useMemo(() => threads.filter((t) => t.root.resolved), [threads])
  const pendingDraftList = useMemo(() => Object.values(pendingDrafts), [pendingDrafts])
  const hasPendingDrafts = pendingDraftList.length > 0

  if (documentId == null) {
    return (
      <div className={baseClass}>
        <p className={`${baseClass}__empty`}>{t('plugin-comments:saveFirst')}</p>
      </div>
    )
  }

  const renderMessage = (thread: Thread, doc: CommentDoc, variant: 'reply' | 'root') => (
    <div className={`${baseClass}__message ${baseClass}__message--${variant}`} key={doc.id}>
      <div className={`${baseClass}__message-head`}>
        {variant === 'root' ? (
          <span className={`${baseClass}__message-role`}>{t('plugin-comments:comment')}</span>
        ) : (
          <span className={`${baseClass}__message-role`}>{t('plugin-comments:reply')}</span>
        )}
        <span className={`${baseClass}__message-author`}>
          {authorName(doc.author, t('plugin-comments:user'))}
        </span>
        <span className={`${baseClass}__message-date`}>
          {formatDate(doc.createdAt, i18n.language)}
        </span>
      </div>
      <p className={`${baseClass}__message-content`}>{doc.content}</p>
      {canDelete(doc) ? (
        <Button
          buttonStyle="error"
          className={`${baseClass}__message-delete`}
          disabled={isMutating || isFormProcessing}
          onClick={() => deleteMessage(thread, doc)}
          size="small"
        >
          {t('plugin-comments:delete')}
        </Button>
      ) : null}
    </div>
  )

  const renderThread = (thread: Thread, inCategory: 'open' | 'resolved') => {
    const isFlashed = flashedThreadId === thread.threadId
    const threadClassNames = [
      `${baseClass}__thread`,
      isFlashed ? `${baseClass}__thread--flash` : '',
      inCategory === 'resolved' ? `${baseClass}__thread--in-resolved` : '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div
        className={threadClassNames}
        key={thread.threadId}
        ref={(el) => {
          if (el) {
            threadRefs.current.set(thread.threadId, el)
          } else {
            threadRefs.current.delete(thread.threadId)
          }
        }}
      >
        {thread.root.quote ? (
          <blockquote className={`${baseClass}__quote`}>
            {t('plugin-comments:quote', { quote: thread.root.quote })}
          </blockquote>
        ) : null}

        {renderMessage(thread, thread.root, 'root')}

        {thread.replies.length > 0 ? (
          <div className={`${baseClass}__replies`}>
            <p className={`${baseClass}__replies-label`}>
              {t('plugin-comments:replies', { count: thread.replies.length })}
            </p>
            {thread.replies.map((reply) => renderMessage(thread, reply, 'reply'))}
          </div>
        ) : null}

        {!thread.root.resolved ? (
          <div className={`${baseClass}__reply-form`}>
            <textarea
              aria-label={t('plugin-comments:replyPlaceholder')}
              className={`${baseClass}__reply-input`}
              onChange={(event) =>
                setReplyContent((current) => ({
                  ...current,
                  [thread.threadId]: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void submitReply(thread)
                }
              }}
              placeholder={t('plugin-comments:replyPlaceholder')}
              ref={(el) => {
                if (el) {
                  replyInputRefs.current.set(thread.threadId, el)
                } else {
                  replyInputRefs.current.delete(thread.threadId)
                }
              }}
              rows={2}
              value={replyContent[thread.threadId] ?? ''}
            />
            <div className={`${baseClass}__reply-actions`}>
              <Button
                buttonStyle="primary"
                disabled={isMutating || isFormProcessing}
                onClick={() => void submitReply(thread)}
                size="small"
                type="button"
              >
                {t('plugin-comments:replyAction')}
              </Button>
            </div>
          </div>
        ) : null}

        {canDelete(thread.root) ? (
          <div className={`${baseClass}__thread-actions`}>
            <Button
              buttonStyle={thread.root.resolved ? 'secondary' : 'primary'}
              disabled={isMutating || isFormProcessing}
              onClick={() => toggleResolved(thread)}
              round
              size="small"
            >
              {thread.root.resolved ? t('plugin-comments:reopen') : t('plugin-comments:resolve')}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={baseClass}>
      <div className={`${baseClass}__header`}>
        <h3 className={`${baseClass}__title`}>{t('plugin-comments:comments')}</h3>
        {unresolvedThreads.length > 0 ? (
          <span className={`${baseClass}__count`}>{unresolvedThreads.length}</span>
        ) : null}
      </div>

      {hasPendingDrafts ? (
        <section className={`${baseClass}__section`}>
          <h4 className={`${baseClass}__section-title`}>
            {t('plugin-comments:drafts', { count: pendingDraftList.length })}
          </h4>
          {pendingDraftList.map(({ content, draft: pendingDraft }) => (
            <div
              className={`${baseClass}__thread ${baseClass}__thread--draft`}
              key={pendingDraft.threadId}
            >
              {pendingDraft.quote ? (
                <blockquote className={`${baseClass}__quote`}>
                  {t('plugin-comments:quote', { quote: pendingDraft.quote })}
                </blockquote>
              ) : null}
              <div className={`${baseClass}__reply-form`}>
                {}
                <textarea
                  aria-label={t('plugin-comments:commentPlaceholder')}
                  autoFocus={pendingDraftList.length === 1}
                  className={`${baseClass}__reply-input`}
                  onChange={(event) =>
                    setPendingDraftContent(pendingDraft.threadId, event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void submitPendingDraft(pendingDraft.threadId)
                    }
                  }}
                  placeholder={t('plugin-comments:commentPlaceholder')}
                  rows={3}
                  value={content}
                />
                { }
                <div className={`${baseClass}__draft-actions`}>
                  <Button
                    buttonStyle="secondary"
                    disabled={isMutating || isFormProcessing}
                    onClick={() => cancelPendingDraft(pendingDraft.threadId)}
                    size="small"
                  >
                    {t('plugin-comments:cancel')}
                  </Button>
                  <Button
                    buttonStyle="primary"
                    disabled={isMutating || isFormProcessing}
                    onClick={() => void submitPendingDraft(pendingDraft.threadId)}
                    size="small"
                    type="button"
                  >
                    {t('plugin-comments:send')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {status === 'error' ? (
        <div className={`${baseClass}__error`}>
          <p>{t('plugin-comments:loadError')}</p>
          <Button buttonStyle="secondary" onClick={() => fetchThreads()} size="small">
            {t('plugin-comments:retry')}
          </Button>
        </div>
      ) : null}

      {status === 'loading' ? (
        <p className={`${baseClass}__empty`}>{t('plugin-comments:loading')}</p>
      ) : null}

      {status === 'ready' ? (
        <>
          {threads.length === 0 && !hasPendingDrafts ? (
            <p className={`${baseClass}__empty`}>{t('plugin-comments:empty')}</p>
          ) : null}

          <section className={`${baseClass}__category ${baseClass}__category--open`}>
            <header className={`${baseClass}__category-header`}>
              <CategoryHeaderContent
                count={unresolvedThreads.length}
                title={t('plugin-comments:open')}
              />
            </header>
            <div className={`${baseClass}__category-body`}>
              {unresolvedThreads.length === 0 ? (
                <p className={`${baseClass}__category-empty`}>{t('plugin-comments:noPending')}</p>
              ) : (
                unresolvedThreads.map((thread) => renderThread(thread, 'open'))
              )}
            </div>
          </section>

          {resolvedThreads.length > 0 ? (
            <details
              className={`${baseClass}__category ${baseClass}__category--resolved ${baseClass}__category--collapsible`}
              onToggle={(event) => setResolvedSectionOpen(event.currentTarget.open)}
              open={resolvedSectionOpen}
            >
              <summary
                className={`${baseClass}__category-header ${baseClass}__category-header--toggle`}
              >
                <CategoryHeaderContent
                  collapsible
                  count={resolvedThreads.length}
                  expanded={resolvedSectionOpen}
                  title={t('plugin-comments:resolved')}
                />
              </summary>
              <div className={`${baseClass}__category-body`}>
                {resolvedThreads.map((thread) => renderThread(thread, 'resolved'))}
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
