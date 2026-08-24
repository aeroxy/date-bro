import { useEffect, useState } from 'react'
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import { QWEN_MODELS, refreshQwenDeviceId } from '@/lib/qwen/qwen-service'
import { ensureActiveProfile, getSettings, saveAllSettings } from '@/lib/storage'
import { newLLMProfile, type LLMBackend, type LLMConfig, type LLMProfile } from '@/types/settings'
import { Button } from './ui/Button'
import { Eyebrow } from './ui/Card'
import { Field, Input, Textarea } from './ui/Field'
import { Modal } from './ui/Modal'
import { Select } from './ui/Select'
import { Spinner } from './ui/Spinner'

type Preset = { label: string; base_url: string; model: string }

const PRESETS: Record<'openai' | 'anthropic', Preset[]> = {
  openai: [
    { label: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-5.1' },
    { label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-5' },
    { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { label: 'Groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    { label: 'Ollama (local)', base_url: 'http://localhost:11434/v1', model: 'qwen3:14b' },
    { label: 'LM Studio (local)', base_url: 'http://localhost:1234/v1', model: 'local-model' },
  ],
  anthropic: [
    { label: 'Anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-opus-5' },
  ],
}

/** Mirrors what `withCustomHeaders` will accept, so the warning can't disagree. */
function headersProblem(raw?: string): string | null {
  if (!raw?.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'Not valid JSON — keys and values both need double quotes. Ignored as written.'
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Needs to be a JSON object of header names to values. Ignored as written.'
  }
  const bad = Object.entries(parsed).find(([, v]) => typeof v !== 'string')
  return bad ? `"${bad[0]}" must be a string. Ignored as written.` : null
}

/**
 * Mirrors what `withExtraBody` will accept. Looser than `headersProblem` on
 * purpose — a value here can be any JSON, since the whole point is sending a
 * shape we don't know about — so the only structural rule is that the top level
 * is an object. The three dropped fields get a warning rather than an error:
 * the merge strips them and the rest of the object still applies, so "ignored as
 * written" would be a lie about the other keys.
 */
function extraBodyProblem(raw?: string): string | null {
  if (!raw?.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'Not valid JSON — keys need double quotes. Ignored as written.'
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Needs to be a JSON object of fields to merge into the request. Ignored as written.'
  }
  const reserved = ['model', 'messages', 'stream'].filter((f) => f in parsed)
  return reserved.length
    ? `"${reserved.join('", "')}" can't be set here — that's the request itself. Dropped; the rest still applies.`
    : null
}

/** Blank, zero, or negative all mean the same thing here: leave it unset. */
function positiveOrDefault(raw: string): number | undefined {
  const n = Number(raw)
  return raw === '' || !Number.isFinite(n) || n <= 0 ? undefined : n
}

export function SettingsModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [profiles, setProfiles] = useState<LLMProfile[]>([])
  const [activeId, setActive] = useState<string>('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // A bare `'idle' | 'working' | string` collapses to `string`, which stops the
  // compiler from checking the sentinels the render below switches on.
  const [deviceStatus, setDeviceStatus] = useState<
    { state: 'idle' } | { state: 'working' } | { state: 'done'; message: string }
  >({ state: 'idle' })

  useEffect(() => {
    if (!open) return
    // StrictMode runs this twice on mount, and close-then-reopen leaves the first
    // load in flight — so the loser could land after the winner and overwrite it.
    let cancelled = false
    setLoadError(null)
    ;(async () => {
      try {
        const [{ profiles: p, activeId: id }, settings] = await Promise.all([
          ensureActiveProfile(),
          getSettings(),
        ])
        if (cancelled) return
        setProfiles(p)
        setActive(id)
        setCustomPrompt(settings.customPrompt)
      } catch (e) {
        // Without this the modal is just blank forever, with the reason only in
        // the console as an unhandled rejection.
        if (!cancelled) setLoadError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const current = profiles.find((p) => p.id === activeId)
  const isAnthropic = current?.config.backend === 'anthropic'
  const headersError = headersProblem(current?.config.custom_headers)
  const extraBodyError = extraBodyProblem(current?.config.extra_body)

  const patch = (change: Partial<LLMConfig>) =>
    setProfiles((prev) =>
      prev.map((p) => (p.id === activeId ? { ...p, config: { ...p.config, ...change } } : p)),
    )

  // A rejected write (quota, a blocked store) used to leave the modal open with
  // no explanation — it read as an unresponsive Save button. Close only on
  // success, so what's on screen is never a state that wasn't stored.
  const save = async () => {
    setSaveError(null)
    try {
      await saveAllSettings({ profiles, activeId, settings: { customPrompt } })
    } catch (e) {
      setSaveError((e as Error).message)
      return
    }
    onSaved()
    onClose()
  }

  const addProfile = () => {
    const p = newLLMProfile(`Profile ${profiles.length + 1}`)
    setProfiles((prev) => [...prev, p])
    setActive(p.id)
  }

  const removeProfile = () => {
    if (profiles.length <= 1) return
    // The other destructive controls all confirm, and this one throws away a
    // key and base URL that are tedious to reconstruct.
    if (!confirm(`Delete "${current?.name}"? Its key and settings go with it.`)) return
    const remaining = profiles.filter((p) => p.id !== activeId)
    setProfiles(remaining)
    setActive(remaining[0]!.id)
  }

  const refreshDevice = async () => {
    setDeviceStatus({ state: 'working' })
    try {
      const id = await refreshQwenDeviceId()
      setDeviceStatus({ state: 'done', message: `Device ID: ${id.slice(0, 12)}…` })
    } catch (e) {
      setDeviceStatus({ state: 'done', message: (e as Error).message })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      eyebrow="Settings"
      title="Model & coach"
      footer={
        <>
          {saveError ? (
            <p className="mr-auto min-w-0 break-words text-[11.5px] text-no">
              Couldn't save: {saveError}
            </p>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {/* Nothing loaded yet means `profiles` is still the empty initial
              state, and saving writes all three keys at once — one click would
              overwrite the stored profiles with nothing. */}
          <Button variant="accent" size="sm" onClick={save} disabled={!current}>
            Save
          </Button>
        </>
      }
    >
      {loadError ? (
        <div className="py-6 text-center">
          <p className="text-[13px] leading-relaxed text-fg-2">
            Couldn't read your settings, so there's nothing safe to edit here yet.
          </p>
          <p className="mt-2 break-words font-mono text-[11px] text-fg-3">{loadError}</p>
        </div>
      ) : !current ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <Eyebrow className="mb-1.5 block">Profiles</Eyebrow>
            <div className="flex flex-wrap items-center gap-1.5">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActive(p.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[12px] font-medium transition',
                    p.id === activeId
                      ? 'border-action-300 bg-action-soft text-action-700'
                      : 'border-border bg-surface text-fg-3 hover:text-fg',
                  )}
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={addProfile}
                className="rounded-full border border-dashed border-border-strong p-1.5 text-fg-3 transition hover:text-action"
                title="New profile"
              >
                <Plus size={13} />
              </button>
              {profiles.length > 1 ? (
                <button
                  onClick={removeProfile}
                  className="rounded-full border border-border p-1.5 text-fg-3 transition hover:border-no hover:text-no"
                  title="Delete this profile"
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Profile name">
              <Input
                value={current.name}
                onChange={(e) =>
                  setProfiles((prev) =>
                    prev.map((p) => (p.id === activeId ? { ...p, name: e.target.value } : p)),
                  )
                }
              />
            </Field>
            <Field label="Backend">
              <Select
                value={current.config.backend}
                onChange={(backend) => patch({ backend: backend as LLMBackend })}
                options={[
                  { value: 'qwen-chat', label: 'Qwen — free, uses your browser session' },
                  { value: 'openai', label: 'Bring your own key (OpenAI-compatible)' },
                  { value: 'anthropic', label: 'Bring your own key (Anthropic /v1/messages)' },
                ]}
              />
            </Field>
          </div>

          {current.config.backend === 'qwen-chat' ? (
            <div className="space-y-3 rounded-lg border border-border bg-surface-sunken p-4">
              <p className="text-[12.5px] leading-relaxed text-fg-2">
                Runs on your logged-in{' '}
                <a
                  href="https://chat.qwen.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-status-700 hover:underline"
                >
                  chat.qwen.ai <ExternalLink size={11} />
                </a>{' '}
                session — no API key, no cost. Log in there first, and keep a tab open the first
                time so the device ID can be read.
              </p>
              <div className="flex items-end gap-3">
                <Field label="Model" className="flex-1">
                  <Select
                    value={current.config.qwenModel ?? QWEN_MODELS[0]}
                    onChange={(qwenModel) => patch({ qwenModel: qwenModel as (typeof QWEN_MODELS)[number] })}
                    options={QWEN_MODELS.map((m) => ({ value: m, label: m }))}
                  />
                </Field>
                <Button variant="secondary" size="sm" onClick={refreshDevice}>
                  {deviceStatus.state === 'working' ? <Spinner /> : <RefreshCw size={13} />}
                  Refresh device ID
                </Button>
              </div>
              {deviceStatus.state === 'done' ? (
                <p className="font-mono text-[11px] text-fg-3">{deviceStatus.message}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-surface-sunken p-4">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS[isAnthropic ? 'anthropic' : 'openai'].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => patch({ base_url: preset.base_url, model: preset.model })}
                    className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11.5px] text-fg-3 transition hover:border-action-300 hover:text-action-700"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Base URL"
                  hint={isAnthropic ? 'requests go to {base URL}/messages' : undefined}
                >
                  <Input
                    value={current.config.base_url}
                    onChange={(e) => patch({ base_url: e.target.value })}
                    placeholder={
                      isAnthropic ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'
                    }
                  />
                </Field>
                <Field label="Model">
                  <Input
                    value={current.config.model}
                    onChange={(e) => patch({ model: e.target.value })}
                    placeholder={isAnthropic ? 'claude-opus-5' : 'gpt-5.1'}
                  />
                </Field>
              </div>
              <Field
                label="API key"
                hint={
                  isAnthropic
                    ? 'sent as x-api-key — stored locally, never leaves your browser'
                    : 'stored locally, never leaves your browser'
                }
              >
                <Input
                  type="password"
                  value={current.config.api_key ?? ''}
                  onChange={(e) => patch({ api_key: e.target.value })}
                  placeholder={isAnthropic ? 'sk-ant-…' : 'sk-…'}
                />
              </Field>
              {/* The client drops headers it can't parse rather than blocking
                  the call, so an unquoted key would otherwise show up as a
                  baffling auth failure and nothing else. Say it here instead. */}
              <Field label="Extra headers" hint="JSON, optional">
                <Input
                  value={current.config.custom_headers ?? ''}
                  onChange={(e) => patch({ custom_headers: e.target.value })}
                  placeholder='{"HTTP-Referer": "https://example.com"}'
                />
                {headersError ? (
                  <p className="mt-1 text-[11.5px] leading-snug text-no">{headersError}</p>
                ) : null}
              </Field>
              {/* How you turn thinking on is in no spec, so every provider spells
                  it differently and there is no list worth hard-coding — it would
                  be out of date within a month. This is the escape hatch: send the
                  field your provider actually wants. */}
              <Field label="Extra request body" hint="JSON, optional — merged in, yours wins">
                <Input
                  value={current.config.extra_body ?? ''}
                  onChange={(e) => patch({ extra_body: e.target.value })}
                  placeholder='{"reasoning": {"effort": "high"}}'
                />
                {extraBodyError ? (
                  <p className="mt-1 text-[11.5px] leading-snug text-no">{extraBodyError}</p>
                ) : (
                  <p className="mt-1 text-[11.5px] leading-snug text-fg-3">
                    Merged into every request from this profile. Mostly for turning thinking on, which
                    each provider does its own way:{' '}
                    <code>{'{"reasoning":{"effort":"high"}}'}</code> on OpenRouter,{' '}
                    <code>{'{"chat_template_kwargs":{"enable_thinking":true}}'}</code> on vLLM. Once
                    the provider returns reasoning, it shows in the waiting panel — after the answer
                    lands rather than during, since this path isn't streamed.
                  </p>
                )}
              </Field>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={current.config.tools_enabled ?? true}
                  onChange={(e) => patch({ tools_enabled: e.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-action)]"
                />
                <span className="text-[12.5px] leading-relaxed text-fg-2">
                  <span className="font-semibold text-fg">Web research</span> — lets "What do I
                  say?" search the web and read pages, and it will use them: date logistics (venues,
                  hours, etiquette), whatever they've told you about themselves followed outward
                  (their studio, their field, the race they're running — it's how you get a specific
                  plan instead of "grab a drink"), and whether those claims hold up, for your own
                  safety. That last one does use their name, and it's the normal thing to do before
                  meeting a stranger. What it won't do is start from their name and see what falls
                  out — no general look-up, no social media sweep, no address, no tracking where
                  they are. Turn off for local servers that don't support function-calling (small
                  models, llama.cpp, older Ollama).
                </span>
              </label>
              {isAnthropic ? null : (
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={current.config.stream ?? true}
                    onChange={(e) => patch({ stream: e.target.checked })}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-action)]"
                  />
                  <span className="text-[12.5px] leading-relaxed text-fg-2">
                    <span className="font-semibold text-fg">Stream responses</span> — asks for{' '}
                    <code>stream: true</code> and reads the reply as it arrives. The answer is still
                    assembled and checked whole, so this isn't about watching text appear: it makes the
                    timeout mean <em>two minutes of silence</em> rather than two minutes total, so a
                    model that thinks for five is fine, and it puts the model's reasoning in the
                    waiting panel while it's still thinking instead of after. Turn off for a server or
                    proxy that doesn't support streaming, or that breaks it alongside strict structured
                    output. The Anthropic backend always streams.
                  </span>
                </label>
              )}
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={current.config.structured_output ?? false}
                  onChange={(e) => patch({ structured_output: e.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-action)]"
                />
                <span className="text-[12.5px] leading-relaxed text-fg-2">
                  <span className="font-semibold text-fg">Strict structured output</span> — the
                  provider enforces the response shape server-side. Removes almost all retries, but
                  only some providers support it (OpenAI, Groq, Together, Fireworks, vLLM; on
                  Anthropic, Opus 5 / Sonnet 5 / Opus 4.8 / Haiku 4.5 and newer). Leave off if you
                  see schema errors.
                </span>
              </label>
              {isAnthropic ? (
                <>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={current.config.anthropic_thinking ?? false}
                      onChange={(e) => patch({ anthropic_thinking: e.target.checked })}
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-action)]"
                    />
                    <span className="text-[12.5px] leading-relaxed text-fg-2">
                      <span className="font-semibold text-fg">Show reasoning</span> — streams a
                      summary of the model's thinking while you wait, the same panel the Qwen backend
                      fills. Also turns thinking on for Opus 4.8 and 4.7, where it's off by default,
                      so it costs tokens. Leave off for Haiku 4.5 and for proxies that don't
                      understand the thinking field — they reject it.
                    </span>
                  </label>
                  <p className="text-[12px] leading-relaxed text-fg-3">
                    Recent Claude models reject an explicit temperature — leave it blank unless your
                    endpoint wants one. They also spend max tokens on thinking before answering, so
                    give it headroom if you see truncation. The timeout applies per silence, not to
                    the whole call, so a long think won't trip it.
                  </p>
                </>
              ) : null}
              <div className="grid grid-cols-3 gap-3">
                <Field label="Temperature">
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={current.config.temperature ?? ''}
                    onChange={(e) =>
                      patch({
                        temperature: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                {/* Blank means "use the default", and so does anything that
                    isn't a positive number: 0 here is not a value the provider
                    can honour — a 0s timeout fails every request before it
                    starts, and 0 max tokens truncates every answer. */}
                <Field label="Max tokens">
                  <Input
                    type="number"
                    min={1}
                    value={current.config.max_tokens ?? ''}
                    placeholder="8192"
                    onChange={(e) => patch({ max_tokens: positiveOrDefault(e.target.value) })}
                  />
                </Field>
                <Field label="Timeout (s)">
                  <Input
                    type="number"
                    min={1}
                    value={current.config.timeout ?? ''}
                    placeholder="120"
                    onChange={(e) => patch({ timeout: positiveOrDefault(e.target.value) })}
                  />
                </Field>
              </div>
            </div>
          )}

          <Field
            label="House rules"
            hint="appended to every prompt — applies to all profiles"
          >
            <Textarea
              rows={4}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={
                "Anything the coach should always know or always do. e.g. \"I'm in Singapore, keep the register casual\", \"I'm a woman dating women\", \"never suggest anything involving alcohol\", \"keep drafts under two sentences\"."
              }
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}
