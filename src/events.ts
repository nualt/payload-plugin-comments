// Bus d'evenements editeur <-> panneau (meme page, window suffit).

export type CommentThreadPreview = {
  author: string
  content: string
  quote: null | string
  replyCount: number
  resolved: boolean
}

export const COMMENTS_EVENTS = {
  /** editeur -> panneau : l'utilisateur veut commenter la selection */
  draft: 'payload-plugin-comments:draft', // detail: { threadId, quote, fieldPath }
  /** editeur -> panneau : clic sur un passage surligne */
  focus: 'payload-plugin-comments:focus', // detail: { threadId }
  /** panneau -> editeur : fil supprime ou resolu, retirer le surlignage */
  unwrap: 'payload-plugin-comments:unwrap', // detail: { threadId, skipCascade?: boolean }
  /** panneau -> editeur : fil rouvert, retablir le surlignage sur la citation */
  rewrap: 'payload-plugin-comments:rewrap', // detail: { threadId, quote }
  /** editeur -> panneau : passage commente retire du texte (supprimer le fil) */
  threadOrphaned: 'payload-plugin-comments:thread-orphaned', // detail: { threadId, fieldPath }
  /** panneau -> editeur : metadonnees des fils pour l'apercu au survol */
  threadsSync: 'payload-plugin-comments:threads-sync', // detail: Record<string, CommentThreadPreview>
  /** editeur -> panneau : focus le champ reponse d'un fil */
  replyFocus: 'payload-plugin-comments:reply-focus', // detail: { threadId }
} as const
