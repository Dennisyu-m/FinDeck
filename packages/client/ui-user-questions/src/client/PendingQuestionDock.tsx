/**
 * Continued-question dock: the answer surface for a timed `ask_user_question`
 * whose foreground window closed while the agent kept working. It reads the
 * `userQuestions` projection (the Host is the only computation site) and
 * submits each batch through the Remote `answer` method, which steers the
 * reply into the agent as a `user-question-reply` user message.
 */
import { useState } from 'react'
import clsx from 'clsx'
import { Button, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { AskUserQuestionAnswer, PendingUserQuestion } from '@deepseek-ai/dsh-user-questions/types'
import css from './PendingQuestionDock.module.css'

/** Business face injected into the dock: the one write path back to the Host. */
export interface PendingQuestionDockInjected {
  /**
   * Queue one complete answer batch for a continued question.
   * @param callId - Continued question identity.
   * @param answer - One answer item per question of that call.
   * @returns after the Host accepted the reply into the agent's inbox.
   */
  reply: (callId: ToolCallId, answer: AskUserQuestionAnswer) => Promise<void>
}

/** One in-progress answer, keyed by call and question. */
interface Draft {
  selected: string[]
  custom: string
}

const EMPTY_DRAFT: Draft = { selected: [], custom: '' }

/** Error code the Host raises when a reply is already waiting for admission. */
const REPLY_QUEUED = 'REPLY_QUEUED'

function isQueuedReplyError(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && (reason as { code?: unknown }).code === REPLY_QUEUED
}

function draftKey(callId: string, questionId: string): string {
  return `${callId}\u0000${questionId}`
}

/**
 * One continued question and the fields its batch needs.
 *
 * A question left untouched submits as an explicit skip (`selected: []`, no
 * custom), which is the only honest reading: the agent already went on, and an
 * empty item says the user passed rather than answered.
 * @param props - the answered call, its drafts, and the write path.
 * @returns The card for one continued call.
 */
function ContinuedCall({
  pending,
  drafts,
  queued,
  disabled,
  edit,
  submit,
  t,
}: {
  pending: PendingUserQuestion
  drafts: Readonly<Record<string, Draft>>
  queued: boolean
  disabled: boolean
  edit: (callId: string, questionId: string, next: Draft) => void
  submit: (pending: PendingUserQuestion) => void
  t: PropsLocale<'question'>['t']
}) {
  return (
    <section className={css.card} aria-label={t('pending.title')}>
      <div className={css.note}>{t('pending.note')}</div>
      {pending.questions.map((question) => {
        const key = draftKey(pending.callId, question.id)
        const draft = drafts[key] ?? EMPTY_DRAFT
        const multi = question.multiSelect === true
        return (
          <div className={css.question} key={question.id}>
            {question.header !== undefined && <div className={css.eyebrow}>{question.header}</div>}
            <div className={css.prompt}>{question.question}</div>
            {(question.options ?? []).map((option) => {
              const selected = draft.selected.includes(option.label)
              return (
                <button
                  type="button"
                  key={option.label}
                  className={clsx(css.option, selected && css.optionSelected)}
                  role={multi ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  disabled={disabled || queued}
                  onClick={() => {
                    const selectedNext = multi
                      ? selected
                        ? draft.selected.filter(label => label !== option.label)
                        : [...draft.selected, option.label]
                      : [option.label]
                    edit(pending.callId, question.id, {
                      selected: selectedNext,
                      custom: multi ? draft.custom : '',
                    })
                  }}
                >
                  <span className={clsx(css.checkbox, selected && css.checkboxChecked)} aria-hidden="true">
                    {selected && <IconCheckOutlineRegular size={12} />}
                  </span>
                  <span className={css.optionCopy}>
                    <span className={css.optionLabel}>{option.label}</span>
                    {option.description !== undefined && (
                      <span className={css.description}>{option.description}</span>
                    )}
                  </span>
                </button>
              )
            })}
            <input
              className={css.field}
              value={draft.custom}
              placeholder={t('custom.placeholder')}
              disabled={disabled || queued}
              onChange={(event) => {
                edit(pending.callId, question.id, {
                  selected: multi ? draft.selected : [],
                  custom: event.target.value,
                })
              }}
            />
          </div>
        )
      })}
      <footer className={css.footer}>
        <span className={css.hint}>{t('pending.skipHint')}</span>
        {queued
          ? <span className={css.queued}>{t('pending.queued')}</span>
          : (
            <Button variant="primary" disabled={disabled} onClick={() => { submit(pending) }}>
              {t('pending.submit')}
            </Button>
          )}
      </footer>
    </section>
  )
}

/**
 * Render every continued timed question for the current Session.
 *
 * The list is the Host projection, so a reply leaves the dock only when the
 * agent admits the steered user message; a per-call local flag covers the
 * queueing gap in between, and a failed reply clears it to re-enable submit.
 * @param props - the projection read seat plus the injected reply path.
 * @returns The dock, or nothing while no question is continued.
 */
export function PendingQuestionDock({
  useProjection, reply, t,
}: PropsRuntime<'conversation.composer.dock'> & InjectFace<PendingQuestionDockInjected> & PropsLocale<'question'>) {
  const view = useProjection('userQuestions')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [queued, setQueued] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<readonly string[]>([])
  const [failure, setFailure] = useState<{ callId: string; text: string } | null>(null)

  const continued = (view?.active ?? []).filter(question => question.state === 'continued')
  if (continued.length === 0) return null

  const edit = (callId: string, questionId: string, next: Draft): void => {
    setDrafts(current => ({ ...current, [draftKey(callId, questionId)]: next }))
  }

  const submit = (pending: PendingUserQuestion): void => {
    const answer: AskUserQuestionAnswer = {
      answers: pending.questions.map((question) => {
        const draft = drafts[draftKey(pending.callId, question.id)] ?? EMPTY_DRAFT
        const custom = draft.custom.trim()
        return {
          id: question.id,
          selected: custom === '' || question.multiSelect === true ? draft.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    setBusy(current => [...current, pending.callId])
    setFailure(null)
    void reply(pending.callId, answer)
      .then(() => { markQueued(pending.callId) })
      .catch((cause: unknown) => {
        // A reply already waiting for admission is the queue, not a failure:
        // another tab, or this one before a reload, submitted it first.
        if (isQueuedReplyError(cause)) {
          markQueued(pending.callId)
          return
        }
        setFailure({
          callId: pending.callId,
          text: cause instanceof Error ? cause.message : String(cause),
        })
      })
      .finally(() => { setBusy(current => current.filter(id => id !== pending.callId)) })
  }

  const markQueued = (callId: string): void => {
    setQueued(current => current.includes(callId) ? current : [...current, callId])
  }

  return (
    <div className={css.dock}>
      {continued.map(pending => (
        <ContinuedCall
          key={pending.callId}
          pending={pending}
          drafts={drafts}
          queued={queued.includes(pending.callId)}
          disabled={busy.includes(pending.callId)}
          edit={edit}
          submit={submit}
          t={t}
        />
      ))}
      {failure !== null && <div className={css.error} role="status">{failure.text}</div>}
    </div>
  )
}
