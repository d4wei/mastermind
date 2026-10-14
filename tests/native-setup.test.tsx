// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createReactHost, removeReactHost, inputValue } from './helpers/dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../ui/settings/defaults'
import { NativeSetup, systemInterfaceLanguage, type SetupSnapshot } from '../ui/desktop/NativeSetup'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), load: vi.fn(), confirmed: vi.fn() }))
vi.mock('../ui/desktop/bridge', () => ({ nativeBridge: { invoke: mocks.invoke } }))
vi.mock('../ui/app/configStore', () => ({ useConfig: Object.assign(
  (selector: (state: unknown) => unknown) => selector({ config: DEFAULT_CONFIG }),
  { getState: () => ({ load: mocks.load }) },
) }))
const snapshot = (values: Partial<SetupSnapshot['values']> = {}, completed = false): SetupSnapshot => ({
  completed, revision: 0,
  values: { authorTag: 'Alex', uiLang: 'en', translationLanguage: null, ...values },
  saved: { authorTag: false, uiLang: false, translationLanguage: false },
  protected: { authorTag: false, uiLang: false, translationLanguage: false },
})
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.invoke.mockReset().mockResolvedValue(snapshot({}, true))
  mocks.load.mockReset().mockResolvedValue(undefined)
  mocks.confirmed.mockReset()
  ;({ host, root } = createReactHost())
})
afterEach(() => {
  removeReactHost(root, host)
  vi.unstubAllGlobals()
})
const mount = async (state = snapshot()) => {
  await act(async () => root.render(<NativeSetup snapshot={state} onConfirmed={mocks.confirmed} />))
}
function editName(value: string) {
  const input = host.querySelector<HTMLInputElement>('[name="authorTag"]')!
  inputValue(input, value)
}
const submit = () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

it.each([
  [['zh-Hans-CN'], 'zh-CN'], [['de-DE', 'en-US'], 'en'], [['fr'], 'en'], [[], 'en'],
] as const)('uses a supported system interface default for %s', (languages, expected) => {
  expect(systemInterfaceLanguage(languages)).toBe(expected)
})

it('previews language without persisting and confirms all choices before advancing', async () => {
  await mount()
  await act(async () => host.querySelector<HTMLButtonElement>('[name="uiLang"][value="zh-CN"]')!.click())
  expect(host.textContent).toContain('怎么称呼你？')
  expect(host.textContent).toContain('译文语言')
  expect(mocks.invoke).not.toHaveBeenCalledWith('confirm_setup', expect.anything())
  expect(mocks.invoke).not.toHaveBeenCalledWith('write_preferences', expect.anything())
  await act(async () => submit())
  expect(mocks.invoke).toHaveBeenCalledWith('confirm_setup', {
    values: { authorTag: 'Alex', uiLang: 'zh-CN', translationLanguage: null },
  })
  expect(mocks.load).toHaveBeenCalledOnce()
  expect(mocks.confirmed).toHaveBeenCalledOnce()
})

it('requires a usable Name and does not protect a field merely on focus', async () => {
  await mount(snapshot({ authorTag: '' }))
  act(() => host.querySelector<HTMLInputElement>('input')!.focus())
  expect(mocks.invoke).not.toHaveBeenCalled()
  expect(host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true)
  await act(async () => { editName(' @ '); submit() })
  expect(mocks.invoke).not.toHaveBeenCalledWith('confirm_setup', expect.anything())
})

it('retains local edits against suggestions while protection IPC is pending', async () => {
  let release!: () => void
  mocks.invoke.mockImplementation((command: string) => command === 'protect_setup_fields'
    ? new Promise<void>((resolve) => { release = resolve }) : Promise.resolve(snapshot({}, true)))
  await mount()
  act(() => editName('Local name'))
  await mount(snapshot({ authorTag: 'Later agent', uiLang: 'zh-CN', translationLanguage: 'fr' }))
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Local name')
  expect(host.textContent).toContain('怎么称呼你？')
  expect(mocks.invoke).toHaveBeenCalledWith('protect_setup_fields', { fields: ['authorTag'] })
  await act(async () => release())
  await mount(snapshot({ authorTag: 'Another agent', uiLang: 'en' }))
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Local name')
})

it('retains an explicit Original only edit when later suggestions arrive', async () => {
  await mount(snapshot({ translationLanguage: 'fr' }))
  await act(async () => host.querySelector<HTMLButtonElement>('.native-setup-original')!.click())
  await mount(snapshot({ translationLanguage: 'zh-CN' }))
  expect(host.querySelector('.native-setup-original')!.getAttribute('aria-pressed')).toBe('true')
  await act(async () => submit())
  expect(mocks.invoke).toHaveBeenCalledWith('confirm_setup', { values: {
    authorTag: 'Alex', uiLang: 'en', translationLanguage: null,
  } })
})

it('keeps the form and edited values after a failed save and supports retry', async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'confirm_setup') throw new Error('Permission denied')
    return snapshot()
  })
  await mount()
  await act(async () => { editName('Retained'); submit() })
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('Permission denied')
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Retained')
  expect(mocks.confirmed).not.toHaveBeenCalled()
  expect(mocks.load).not.toHaveBeenCalled()
  mocks.invoke.mockResolvedValue(snapshot({ authorTag: 'Retained' }, true))
  await act(async () => submit())
  expect(mocks.confirmed).toHaveBeenCalledOnce()
})

it('waits for configuration reload and keeps a recoverable form if reload fails', async () => {
  mocks.load.mockRejectedValueOnce(new Error('Could not reload saved choices'))
  await mount()
  await act(async () => submit())
  expect(mocks.confirmed).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Could not reload saved choices')
  await act(async () => submit())
  expect(mocks.confirmed).toHaveBeenCalledOnce()
})

it.each(['active', 'native', 'legacy'] as const)('does not confirm on an IME candidate Enter: %s', async (kind) => {
  await mount()
  const input = host.querySelector('input')!
  await act(async () => {
    if (kind !== 'native') input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    if (kind === 'legacy') input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true,
      isComposing: kind === 'native', keyCode: kind === 'legacy' ? 229 : 13 })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    await Promise.resolve()
    submit()
  })
  expect(mocks.invoke).not.toHaveBeenCalledWith('confirm_setup', expect.anything())
  act(() => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    submit()
  })
  expect(mocks.confirmed).toHaveBeenCalledOnce()
})

it('allows an intentional pointer submission after IME Enter and cleans up its reset timer', async () => {
  vi.useFakeTimers()
  try {
    await mount()
    const input = host.querySelector('input')!
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true,
        bubbles: true }))
      await Promise.resolve()
      submit()
    })
    expect(mocks.confirmed).not.toHaveBeenCalled()
    await act(async () => {
      host.querySelector('[type="submit"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      submit()
    })
    expect(mocks.confirmed).toHaveBeenCalledOnce()
    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    root = createRoot(host)
  } finally { vi.useRealTimers() }
})

it('renders saved setup choices including explicit Original only without changing them', async () => {
  const saved = snapshot({ authorTag: 'Saved reader', uiLang: 'zh-CN', translationLanguage: null })
  saved.saved = { authorTag: true, uiLang: true, translationLanguage: true }
  await mount(saved)
  expect(host.querySelector<HTMLInputElement>('[name="authorTag"]')!.value).toBe('Saved reader')
  expect(host.querySelector('[name="uiLang"][value="zh-CN"]')!.getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('.native-setup-original')!.getAttribute('aria-pressed')).toBe('true')
  expect(mocks.invoke).not.toHaveBeenCalled()
  await act(async () => submit())
  expect(mocks.invoke).toHaveBeenCalledWith('confirm_setup', { values: saved.values })
})

it.each(['en', 'zh-CN'] as const)('explains an unusable Name in %s and clears feedback after correction', async (uiLang) => {
  await mount(snapshot({ authorTag: 'Alex: Admin', uiLang }))
  const input = host.querySelector<HTMLInputElement>('[name="authorTag"]')!
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(host.querySelector('.native-setup-name-error')!.textContent).toContain(
    uiLang === 'en' ? 'Use up to 64' : '不超过 64')
  await act(async () => submit())
  expect(mocks.invoke).not.toHaveBeenCalledWith('confirm_setup', expect.anything())
  await act(async () => editName(' @ 李 明 '))
  expect(host.querySelector('.native-setup-name-error')).toBeNull()
  expect(input.getAttribute('aria-invalid')).toBe('false')
  await act(async () => submit())
  expect(mocks.invoke).toHaveBeenCalledWith('confirm_setup', { values: {
    authorTag: '李 明', uiLang, translationLanguage: null,
  } })
})

it.each(['active', 'native', 'legacy'] as const)('keeps language search and setup unsubmitted on IME Enter: %s', async (kind) => {
  await mount()
  await act(async () => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const input = host.querySelector<HTMLInputElement>('.lang-search')!
  await act(async () => {
    if (kind !== 'native') input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    if (kind === 'legacy') input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true,
      isComposing: kind === 'native', keyCode: kind === 'legacy' ? 229 : 13 })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    await Promise.resolve()
    submit()
  })
  expect(host.querySelector('.lang-search')).toBe(input)
  expect(host.querySelector('.native-setup-original')!.getAttribute('aria-pressed')).toBe('true')
  expect(mocks.invoke).not.toHaveBeenCalledWith('confirm_setup', expect.anything())
  if (kind !== 'native') {
    expect(mocks.invoke).toHaveBeenCalledWith('protect_setup_fields', { fields: ['translationLanguage'] })
  }
  act(() => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
  expect(host.querySelector('.lang-search')).toBeNull()
})

it('protects translation on composition start before input or protection IPC completes', async () => {
  let release!: () => void
  mocks.invoke.mockImplementation((command: string) => command === 'protect_setup_fields'
    ? new Promise<void>((resolve) => { release = resolve }) : Promise.resolve(snapshot({}, true)))
  await mount()
  await act(async () => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const input = host.querySelector<HTMLInputElement>('.lang-search')!
  act(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  expect(mocks.invoke).toHaveBeenCalledWith('protect_setup_fields', { fields: ['translationLanguage'] })
  await mount(snapshot({ translationLanguage: 'fr' }))
  expect(host.querySelector('.native-setup-original')!.getAttribute('aria-pressed')).toBe('true')
  await act(async () => release())
})

it('does not leave the setup composition guard active after search detaches without blur', async () => {
  await mount()
  await act(async () => host.querySelector<HTMLButtonElement>('.lang-trigger')!.click())
  const input = host.querySelector<HTMLInputElement>('.lang-search')!
  act(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(host.querySelector('.lang-search')).toBeNull()
  await act(async () => {
    host.querySelector('[name="authorTag"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    submit()
  })
  expect(mocks.confirmed).toHaveBeenCalledOnce()
})
