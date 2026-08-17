export const BOTS_CSS = `
.oac-panel { display: flex; flex-direction: column; gap: 16px; padding: 8px 0; max-width: 720px; }
.oac-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.oac-row h2 { margin: 0; font-size: 18px; line-height: 1.4; font-weight: 600; color: var(--dsw-alias-label-primary); }
.oac-muted { opacity: 0.72; font-size: 12px; }
.oac-bot-intro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.oac-error { color: var(--dsh-color-danger, #c44); }
.oac-card { border: 1px solid var(--dsh-border, rgba(127,127,127,.3)); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.oac-card-list { display: flex; flex-direction: column; gap: 8px; }
.oac-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.oac-tabs button[data-active="true"] { font-weight: 600; }
.oac-form { display: flex; flex-direction: column; gap: 12px; }
.oac-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.oac-actions { display: flex; gap: 8px; justify-content: flex-end; }
.oac-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
.oac-split { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(220px, 2fr); gap: 12px; }
.oac-messages { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; }
.oac-msg-in, .oac-msg-out { padding: 6px 8px; border-radius: 8px; font-size: 13px; white-space: pre-wrap; }
.oac-msg-in { background: var(--dsh-border, rgba(127,127,127,.18)); }
.oac-msg-out { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.28)); align-self: flex-end; }
.oac-card[data-active='true'] { outline: 1px solid var(--dsw-alias-label-primary, currentColor); }

/* Bot tiles: the AgentPresetSection card vocabulary (border-l2 hairline,
   layer-3 fill, 12px radius, 2-up minmax(268px, 1fr) grid, icon-action foot).
   Every color resolves through a --dsw-alias-* token so the tiles follow the
   active theme (the bare --dsh-border fallbacks above stay light-mode gray). */
.oac-bot-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); grid-auto-rows: 1fr; gap: 12px; }
.oac-bot-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); display: flex; flex-direction: column; transition: border-color .16s, background .16s; }
.oac-bot-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.oac-bot-main { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 14px 16px 12px; }
.oac-bot-avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
.oac-bot-avatar-sm { width: 28px; height: 28px; }
.oac-bot-avatar-fallback { display: inline-flex; align-items: center; justify-content: center; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); font-size: 14px; font-weight: 600; }
.oac-bot-name { flex: 1; min-width: 0; font-size: 15px; line-height: 1.4; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-bio { margin: 0 16px 12px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.oac-bot-model { margin: 0 16px 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-foot { display: flex; justify-content: flex-end; gap: 2px; padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-icon-btn { position: relative; appearance: none; border: 0; border-radius: 7px; padding: 6px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; display: inline-flex; align-items: center; }
.oac-icon-btn:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.oac-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.oac-icon-btn::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); padding: 3px 8px; border-radius: 6px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); font-size: 11px; line-height: 17px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .12s; }
.oac-icon-btn:hover::after, .oac-icon-btn:focus-visible::after { opacity: 1; }

/* Form vocabulary from the DSH settings panels: field label above the
   control, input/select tokens from the Models section, dialog footer
   actions from the preset copy dialog. */
.oac-field { display: flex; flex-direction: column; gap: 6px; }
.oac-field-label { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.oac-input { box-sizing: border-box; width: 100%; padding: 9px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; font: inherit; font-size: 13px; line-height: 20px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.oac-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.oac-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.oac-input:disabled { opacity: 0.6; cursor: default; }
textarea.oac-input { resize: vertical; min-height: 76px; }
.oac-input-select { appearance: none; padding-right: 32px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; background-size: 12px 12px; }
.oac-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.oac-info { display: flex; flex-direction: column; gap: 8px; }
.oac-info-row { display: flex; align-items: baseline; gap: 10px; font-size: 12px; line-height: 18px; }
.oac-info-label { flex: none; color: var(--dsw-alias-label-tertiary); }
.oac-info-value { margin: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; user-select: all; }
.oac-danger-outline { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.oac-danger-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
.oac-dialog { width: min(560px, 100%); }
.oac-dialog-delete { width: min(480px, 100%); }
.oac-dialog-body { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.oac-editor-title { display: flex; align-items: center; gap: 10px; min-width: 0; }

/* Underline tabs from the Plugins settings section: hairline track, 13px
   labels, a 2px primary underline on the active tab, roving tabindex. */
.oac-tablist { display: flex; align-items: flex-end; gap: 22px; border-bottom: 1px solid var(--dsw-alias-border-l2); margin-top: 2px; }
.oac-tab { position: relative; border: 0; padding: 7px 1px 9px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
.oac-tab:hover, .oac-tab[data-active='true'] { color: var(--dsw-alias-label-primary); }
.oac-tab[data-active='true']::after, .oac-tab:focus-visible::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; border-radius: 2px 2px 0 0; background: var(--dsw-alias-label-primary); content: ''; }
.oac-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; border-radius: 2px; color: var(--dsw-alias-label-primary); }
.oac-tab-panel { min-width: 0; padding-top: 2px; }

/* Chat Settings cards: bordered sections in the Models-section rowCard
   vocabulary, the auto-reply switch, and the skill chip picker. */
.oac-section-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.oac-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.oac-section-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.oac-section-title { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.oac-section-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-param-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.oac-switch { display: inline-flex; align-items: center; gap: 8px; flex: none; padding: 0; border: none; background: none; cursor: pointer; font: inherit; color: var(--dsw-alias-label-secondary); }
.oac-switch:disabled { opacity: 0.6; cursor: default; }
.oac-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 999px; }
.oac-switch-track { position: relative; width: 36px; height: 20px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); transition: background .16s, border-color .16s; }
.oac-switch-thumb { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-label-dimmed); transition: transform .16s, background .16s; }
.oac-switch.on .oac-switch-track { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.oac-switch.on .oac-switch-thumb { transform: translateX(18px); background: var(--dsw-alias-bg-layer-3); }
.oac-switch-text { font-size: 13px; line-height: 20px; }
.oac-chip-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.oac-chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 10px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.oac-chip code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.oac-chip-remove { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; border-radius: 8px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.oac-chip-remove:hover { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.oac-chip-remove:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.oac-skill-picker { display: flex; align-items: center; gap: 8px; }
.oac-skill-picker .oac-input { flex: 1; min-width: 0; }
.oac-note { margin: 0; font-size: 12px; line-height: 18px; }
.oac-note.saving { color: var(--dsw-alias-label-tertiary); }
.oac-note.success { color: var(--dsw-alias-state-success-primary); }
.oac-note.warn { color: var(--dsw-alias-state-warn-label); }
.oac-note.error { color: var(--dsw-alias-state-error-primary); }
`

export const PRESETS_CSS = `
.oac-preset-seat { display: inline-flex; align-items: center; gap: 4px; max-width: min(100%, 240px); min-height: 28px; padding: 0 8px; border: none; border-radius: 16px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.oac-preset-seat:not(:disabled):hover, .oac-preset-seat[aria-expanded='true'] { background: var(--dsw-alias-interactive-bg-hover); }
.oac-preset-seat:disabled { cursor: default; color: var(--dsw-alias-label-quaternary); }
.oac-preset-seat-icon { flex: none; color: var(--dsw-alias-label-primary); }
.oac-preset-seat-chevron { flex: none; color: var(--dsw-alias-label-caption); }
.oac-preset-seat-item { display: flex; flex-direction: column; gap: 2px; max-width: 280px; }
.oac-preset-seat-item-name { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.oac-preset-seat-item-desc { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-caption); white-space: normal; }
.oac-preset-seat-item-icon { flex: none; }
.oac-preset-avatar.oac-preset-seat-icon, .oac-preset-avatar.oac-preset-seat-item-icon { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
`
