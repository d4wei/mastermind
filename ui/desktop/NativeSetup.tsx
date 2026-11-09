import { useEffect, useRef, useState } from 'react'
import { usableAuthorName } from '../../document/author'
import { useConfig } from '../app/configStore'
import { UI_LANGUAGE_CODES, UI_LANGUAGES, useT, type UiLang } from '../i18n'
import { useCompositionGuard } from '../util/composition'
import { nativeBridge } from './bridge'

interface SetupValues {
  authorTag: string
  uiLang: UiLang
}
type SetupField = keyof SetupValues
export interface SetupSnapshot {
  completed: boolean
  revision: number
  values: SetupValues
  saved: Record<SetupField, boolean>
  protected: Record<SetupField, boolean>
}

/** Every Chinese variant reads the bundled Simplified Chinese; other languages match by prefix. */
const SYSTEM_LANGUAGE_PREFIXES: ReadonlyArray<readonly [RegExp, UiLang]> = [
  [/^zh(?:-|$)/i, 'zh-CN'], [/^ja(?:-|$)/i, 'ja'], [/^fr(?:-|$)/i, 'fr'], [/^en(?:-|$)/i, 'en'],
]

/** The first system language the interface speaks, else English. */
export function systemInterfaceLanguage(languages: readonly string[]): UiLang {
  for (const language of languages) {
    const match = SYSTEM_LANGUAGE_PREFIXES.find(([prefix]) => prefix.test(language))
    if (match) return match[1]
  }
  return 'en'
}

export function NativeSetup({ snapshot, onConfirmed, onLanguagePreview, onConfirmationStarted }: {
  snapshot: SetupSnapshot
  onConfirmed(snapshot: SetupSnapshot): void
  onLanguagePreview?(language: SetupValues['uiLang']): void
  onConfirmationStarted?(completion: Promise<boolean>): void
}) {
  const [values, setValues] = useState(snapshot.values)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const edited = useRef(new Set<SetupField>())
  const composition = useCompositionGuard()
  const composingInput = useRef<Node | null>(null)
  const compositionSubmit = useRef(false)
  const compositionReset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const confirming = useRef(false)
  const name = usableAuthorName(values.authorTag)
  const t = useT(values.uiLang)
  useEffect(() => { onLanguagePreview?.(values.uiLang) }, [values.uiLang, onLanguagePreview])
  useEffect(() => () => { clearTimeout(compositionReset.current) }, [])
  useEffect(() => {
    setValues((current) => ({
      authorTag: edited.current.has('authorTag') ? current.authorTag : snapshot.values.authorTag,
      uiLang: edited.current.has('uiLang') ? current.uiLang : snapshot.values.uiLang,
    }))
  }, [snapshot])
  const protect = (field: SetupField): void => {
    if (edited.current.has(field)) return
    edited.current.add(field)
    void nativeBridge.invoke('protect_setup_fields', { fields: [field] })
      .catch((error) => setError(String(error)))
  }
  const confirm = (): void => {
    if (!name || confirming.current) return
    confirming.current = true
    setSaving(true)
    setError('')
    const completion = (async (): Promise<boolean> => {
      try {
        const confirmed = await nativeBridge.invoke<SetupSnapshot>('confirm_setup', {
          values: { ...values, authorTag: name },
        })
        if (!confirmed.completed) throw new Error(t('setupNotSaved'))
        await useConfig.getState().load()
        onConfirmed(confirmed)
        return true
      } catch (error) { setError(String(error)); return false }
      finally { confirming.current = false; setSaving(false) }
    })()
    onConfirmationStarted?.(completion)
  }
  return <main className="native-setup">
    <h1>mastermind</h1>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!compositionSubmit.current) void confirm()
    }} onCompositionStartCapture={(event) => {
      composition.inputProps.onCompositionStart()
      composingInput.current = event.target as Node
      if (event.target instanceof HTMLInputElement && event.target.name === 'authorTag') protect('authorTag')
    }} onCompositionEndCapture={() => {
      composingInput.current = null
      composition.inputProps.onCompositionEnd()
    }} onBlurCapture={() => {
      composingInput.current = null
      composition.inputProps.onBlur()
    }} onPointerDown={() => { compositionSubmit.current = false }} onKeyDownCapture={(event) => {
      // Unmounting a composing input can skip both compositionend and blur.
      if (composingInput.current && !composingInput.current.isConnected) {
        composingInput.current = null
        composition.inputProps.onBlur()
      }
      clearTimeout(compositionReset.current)
      compositionSubmit.current = false
      if (event.key === 'Enter' && composition.isComposing(event.nativeEvent)) {
        // Preserve the IME's Enter default while refusing its implicit form submission.
        compositionSubmit.current = true
        compositionReset.current = setTimeout(() => { compositionSubmit.current = false }, 0)
        event.stopPropagation()
      }
    }}>
      <fieldset disabled={saving}>
        <label className="native-setup-field">
          <span>{t('setupNamePrompt')}</span>
          <input className="settings-input native-setup-name" name="authorTag" value={values.authorTag} required autoComplete="nickname"
            aria-invalid={!name} aria-describedby={!name ? 'setup-name-error' : undefined}
            onChange={(event) => {
              protect('authorTag')
              setValues((current) => ({ ...current, authorTag: event.target.value }))
            }} />
          <small>{t('authorTagHint')}</small>
          {!name && <small id="setup-name-error" className="native-setup-name-error" role="alert">
            {t('authorTagInvalid')}
          </small>}
        </label>
        <div className="native-setup-field" role="group" aria-label={t('uiLanguage')}>
          <span>{t('uiLanguage')}</span>
          <div className="native-setup-options">
            {UI_LANGUAGE_CODES.map((uiLang) => <button key={uiLang} type="button"
              className="btn-ghost" name="uiLang" value={uiLang} aria-pressed={values.uiLang === uiLang}
              onClick={() => {
                protect('uiLang')
                setValues((current) => ({ ...current, uiLang }))
              }}>{UI_LANGUAGES[uiLang]}</button>)}
          </div>
        </div>
        <button className="btn-primary" type="submit" disabled={!name}>
          {t(saving ? 'setupSaving' : 'startReviewing')}
        </button>
      </fieldset>
      {error && <p role="alert">{t('setupFailed')} {error}</p>}
    </form>
  </main>
}
