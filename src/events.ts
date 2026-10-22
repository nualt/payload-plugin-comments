// Editor <-> panel event bus (same page, so window is enough).

export type CommentThreadPreview = {
  author: string
  content: string
  quote: null | string
  replyCount: number
  resolved: boolean
}

export const COMMENTS_EVENTS = {
  /** editor -> panel: the user wants to comment on the selection */
  draft: 'payload-plugin-comments:draft', // detail: { threadId, quote, fieldPath }
  /** editor -> panel: click on a highlighted passage */
  focus: 'payload-plugin-comments:focus', // detail: { threadId }
  /** panel -> editor: thread deleted or resolved, remove the highlight */
  unwrap: 'payload-plugin-comments:unwrap', // detail: { threadId, skipCascade?: boolean }
  /** panel -> editor: thread reopened, restore the highlight on the quote */
  rewrap: 'payload-plugin-comments:rewrap', // detail: { threadId, quote }
  /** editor -> panel: commented passage removed from the text (delete the thread) */
  threadOrphaned: 'payload-plugin-comments:thread-orphaned', // detail: { threadId, fieldPath }
  /** panel -> editor: thread metadata for the hover preview */
  threadsSync: 'payload-plugin-comments:threads-sync', // detail: Record<string, CommentThreadPreview>
  /** editor -> panel: focus a thread's reply field */
  replyFocus: 'payload-plugin-comments:reply-focus', // detail: { threadId }
} as const
