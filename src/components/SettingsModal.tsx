import { useEffect, useState } from 'react'
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import { QWEN_MODELS, refreshQwenDeviceId } from '@/lib/qwen/qwen-service'
import {
  ensureActiveProfile,
  getSettings,
  saveLLMProfiles,
  saveSettings,
  setActiveProfileId,
} from '@/lib/storage'
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
    ;(async () => {
      const [{ profiles: p, activeId: id }, settings] = await Promise.all([
        ensureActiveProfile(),
        getSettings(),
      ])
      if (cancelled) return
      setProfiles(p)
      setActive(id)
      setCustomPrompt(settings.customPrompt)
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const current = profiles.find((p) => p.id === activeId)
  const isAnthropic = current?.config.backend === 'anthropic'

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
      await Promise.all([
        saveLLMProfiles(profiles),
        setActiveProfileId(activeId),
        saveSettings({ customPrompt }),
      ])
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
          <Button variant="accent" size="sm" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {!current ? null : (
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
              <Field label="Extra headers" hint="JSON, optional">
                <Input
                  value={current.config.custom_headers ?? ''}
                  onChange={(e) => patch({ custom_headers: e.target.value })}
                  placeholder='{"HTTP-Referer": "https://example.com"}'
                />
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
                  say?" search the web and read pages. Two lanes only: date logistics (venues,
                  hours, etiquette), and checking one specific thing they've told you, for your own
                  safety — whether their stated job checks out, whether their photos turn up
                  elsewhere. That kind of check does use their name. What it won't do is look them
                  up in general, go through their social media, or track where they are. Turn off
                  for local servers that don't support function-calling (small models, llama.cpp,
                  older Ollama).
                </span>
              </label>
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
                    value={current.config.temperature ?? ''}
                    onChange={(e) =>
                      patch({
                        temperature: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                {/* Blank means "use the default" — storing 0 would be taken
                    literally and sent to the provider. */}
                <Field label="Max tokens">
                  <Input
                    type="number"
                    value={current.config.max_tokens ?? ''}
                    placeholder="8192"
                    onChange={(e) =>
                      patch({
                        max_tokens: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Timeout (s)">
                  <Input
                    type="number"
                    value={current.config.timeout ?? ''}
                    placeholder="120"
                    onChange={(e) =>
                      patch({ timeout: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
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
