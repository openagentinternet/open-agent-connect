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
.oac-bot-foot { display: flex; justify-content: space-between; gap: 2px; padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-bot-foot-left, .oac-bot-foot-right { display: flex; align-items: center; gap: 2px; }
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

/* A2A conversation panel: the sidebar-foot trigger row above Settings and a
   floating two-column dialog. Geometry and tokens follow the Settings shell
   (mask + centered 24px panel) and the conversation row/bubble vocabulary. */
.oac-a2a-trigger { flex: none; display: flex; align-items: center; gap: 8px; width: calc(100% + 8px); height: 34px; margin: 4px -4px 4px; padding: 6px 2px 6px 10px; box-sizing: border-box; border: none; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer; overflow: hidden; }
.oac-a2a-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.oac-a2a-trigger-rail { width: 36px; height: 36px; margin: 8px 0 10px; justify-content: center; gap: 0; padding: 0; border-radius: 50%; }
.oac-a2a-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; }
.oac-a2a-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); backdrop-filter: var(--dsw-mask-blur); }
.oac-a2a-panel { position: relative; z-index: 1; display: flex; flex-direction: column; width: min(980px, calc(100vw - 48px)); height: min(720px, calc(100vh - 48px)); border-radius: 24px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-shadow-lv3); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.oac-a2a-header { flex: none; display: flex; align-items: center; justify-content: space-between; height: 54px; padding: 10px 14px 8px 24px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-header h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.oac-a2a-close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 28px; background: transparent; cursor: pointer; color: var(--dsw-alias-label-primary); }
.oac-a2a-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.oac-a2a-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 272px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.oac-a2a-list { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); }
.oac-a2a-list-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-bot-avatar { flex: none; width: 32px; height: 32px; }
.oac-a2a-list-head .oac-input { flex: 1; min-width: 0; height: 32px; }
.oac-a2a-list-rows { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.oac-a2a-row { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 8px; box-sizing: border-box; border: none; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.oac-a2a-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.oac-a2a-row.active { background: var(--dsw-alias-interactive-bg-active); }
.oac-a2a-row-avatar { flex: none; width: 28px; height: 28px; }
.oac-a2a-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oac-a2a-row-name { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-row-text { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-row-time { flex: none; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.oac-a2a-thread { min-width: 0; display: flex; flex-direction: column; }
.oac-a2a-thread-head { flex: none; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 10px 16px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-thread-avatar { flex: none; width: 32px; height: 32px; }
.oac-a2a-thread-peer { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.oac-a2a-thread-peer strong { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-thread-peer span { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-id { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
.oac-a2a-id:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.oac-a2a-id code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.oac-a2a-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.oac-a2a-msg { display: flex; gap: 10px; max-width: min(560px, 86%); }
.oac-a2a-msg-peer { align-self: flex-start; }
.oac-a2a-msg-local { align-self: flex-end; flex-direction: row-reverse; }
.oac-a2a-msg-avatar { flex: none; width: 28px; height: 28px; }
.oac-a2a-msg-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.oac-a2a-msg-local .oac-a2a-msg-body { align-items: flex-end; }
.oac-a2a-msg-head { display: flex; align-items: baseline; gap: 10px; }
.oac-a2a-msg-local .oac-a2a-msg-head { flex-direction: row-reverse; }
.oac-a2a-msg-name { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.oac-a2a-msg-meta { display: inline-flex; align-items: baseline; gap: 8px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.oac-a2a-msg-txid { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; }
.oac-a2a-msg-txid-text { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-copy { padding: 0 2px; border: none; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
.oac-a2a-copy:hover { color: var(--dsw-alias-label-primary); }
.oac-a2a-bubble { min-width: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.oac-a2a-bubble-local { background: var(--dsw-specific-bubble); border-radius: 16px 16px 4px 16px; padding: 8px 12px; }
.oac-a2a-bubble-peer { background: var(--dsw-alias-bg-layer-3); border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px 16px 16px 4px; padding: 8px 12px; }
.oac-a2a-msg-text { white-space: pre-wrap; }
.oac-a2a-msg-image { display: block; max-width: 100%; max-height: 320px; border-radius: 10px; object-fit: contain; }
.oac-a2a-composer { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-composer-row { display: flex; align-items: center; gap: 8px; }
.oac-a2a-composer-row .oac-input { flex: 1; min-width: 0; }
.oac-a2a-guidance { display: flex; flex-direction: column; gap: 8px; }
.oac-a2a-guidance-toggle { align-self: flex-start; padding: 0; border: none; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.oac-a2a-guidance-toggle:hover { color: var(--dsw-alias-label-primary); }
.oac-a2a-guidance-form { display: flex; flex-direction: column; gap: 8px; }
.oac-a2a-guidance-actions { display: flex; justify-content: flex-end; gap: 8px; }
`

export const APPS_CSS = `
/* Apps tiles: the same 2-up card vocabulary as Bots (border-l2 hairline,
   layer-3 fill, 12px radius), plus a cover/icon well, state pill, pin line,
   and a compact icon-action foot. */
.oac-apps-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 12px; }
.oac-apps-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); display: flex; flex-direction: column; overflow: hidden; cursor: pointer; text-align: left; transition: border-color .16s, background .16s; }
.oac-apps-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.oac-apps-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.oac-apps-card-cover { position: relative; display: flex; align-items: center; justify-content: center; height: 96px; background: linear-gradient(135deg, var(--dsw-alias-bg-layer-1), var(--dsw-alias-bg-layer-2)); border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-apps-cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.oac-apps-card-icon { position: relative; flex: none; width: 40px; height: 40px; border-radius: 10px; object-fit: cover; box-shadow: var(--dsw-shadow-lv1); }
.oac-apps-icon-fallback { display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font-size: 14px; font-weight: 600; }
.oac-apps-state-pill { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 10px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 20px; }
.oac-apps-state-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.oac-apps-state-pill.disabled::before { background: var(--dsw-alias-state-warn-label); }
.oac-apps-card-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px 8px; min-width: 0; }
.oac-apps-card-title { min-width: 0; }
.oac-apps-card-title h3 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-apps-card-title p { margin: 2px 0 0; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-apps-pin-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.oac-apps-pin-line code { flex: 1; min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-apps-card-intro { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.oac-apps-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.oac-apps-tag { height: 18px; padding: 0 8px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 18px; }
.oac-apps-card-foot { display: flex; justify-content: flex-end; gap: 2px; padding: 4px 8px 6px; border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-apps-empty { display: flex; flex-direction: column; gap: 2px; padding: 28px 16px; text-align: center; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; }
.oac-apps-empty strong { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.oac-apps-empty p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-apps-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.oac-apps-pager-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

/* Apps dialogs: wider than the standard .oac-dialog so the publish/edit forms
   keep the reference page's basic/assets/technical columns. */
.oac-apps-dialog { width: min(760px, 100%); }
.oac-apps-dialog-sm { width: min(560px, 100%); }
.oac-apps-modal-scroll { max-height: min(58vh, 560px); overflow-y: auto; }
.oac-apps-form { display: flex; flex-direction: column; gap: 16px; }
.oac-apps-form-section { display: flex; flex-direction: column; gap: 12px; }
.oac-apps-form-section > h3 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.oac-apps-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.oac-apps-form-grid .span-2 { grid-column: span 2; }
.oac-apps-required-mark { color: var(--dsw-alias-state-error-primary); margin-left: 2px; }
.oac-apps-optional-mark { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-dimmed); font-weight: 400; margin-left: 6px; }
.oac-apps-field-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.oac-apps-runtime { display: flex; flex-wrap: wrap; gap: 6px; }
.oac-apps-runtime-option { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 24px; cursor: pointer; }
.oac-apps-runtime-option input { margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.oac-apps-runtime-option:has(input:checked) { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
.oac-apps-asset { display: flex; flex-direction: column; gap: 8px; }
.oac-apps-asset-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.oac-apps-upload-btn { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 12px; line-height: 24px; cursor: pointer; }
.oac-apps-upload-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.oac-apps-upload-btn:disabled { opacity: .6; cursor: default; }
.oac-apps-asset-status { font-size: 12px; line-height: 18px; }
.oac-apps-asset-status.success { color: var(--dsw-alias-state-success-primary); }
.oac-apps-asset-status.error { color: var(--dsw-alias-state-error-primary); }
.oac-apps-version-note { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-dimmed); }

/* Chain status + detail/share bodies inside the dialogs. */
.oac-apps-chain { display: flex; flex-direction: column; gap: 12px; }
.oac-apps-chain-head { display: flex; align-items: center; gap: 12px; }
.oac-apps-chain-badge { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; }
.oac-apps-chain-badge.pending { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.oac-apps-chain-badge.success { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); color: var(--dsw-alias-state-success-primary); }
.oac-apps-chain-badge.error { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); color: var(--dsw-alias-state-error-primary); }
.oac-apps-chain-badge svg { animation: oac-apps-spin 1s linear infinite; }
.oac-apps-chain-badge:not(.pending) svg { animation: none; }
@keyframes oac-apps-spin { to { transform: rotate(360deg); } }
.oac-apps-chain-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.oac-apps-chain-copy strong { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.oac-apps-chain-copy p { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.oac-apps-chain-section { display: flex; flex-direction: column; gap: 8px; }
.oac-apps-chain-section h3 { margin: 0; font-size: 12px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
.oac-apps-txid-row { display: flex; align-items: center; gap: 10px; }
.oac-apps-txid-row code { flex: 1; min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-apps-chain-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-apps-chain-error { color: var(--dsw-alias-state-error-primary) !important; }

.oac-apps-detail-top { display: flex; align-items: flex-start; gap: 12px; }
.oac-apps-detail-icon { flex: none; width: 44px; height: 44px; border-radius: 10px; object-fit: cover; }
.oac-apps-detail-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oac-apps-detail-title h3 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.oac-apps-detail-title p { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.oac-apps-detail-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.oac-apps-detail-shots { display: flex; gap: 8px; flex-wrap: wrap; }
.oac-apps-detail-shot { width: 96px; height: 64px; border-radius: 8px; object-fit: cover; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.oac-apps-detail-field { display: grid; grid-template-columns: 148px minmax(0, 1fr); gap: 10px; align-items: baseline; }
.oac-apps-detail-field > span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-apps-detail-field > code { margin: 0; font: inherit; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.oac-apps-share-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.oac-apps-share-row > span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-apps-share-row > code { margin: 0; font: inherit; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

export const MEMORY_CSS = `
/* Memory section: reuses the Bots card/form/tab vocabulary; the few additions
   are the badge pill, the diary accordion, and the contact rows. All colors
   resolve through --dsw-alias-* tokens. */
.oac-memory-bot-select { width: auto; min-width: 180px; }
.oac-memory-kind-select { width: auto; min-width: 140px; }
.oac-memory-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 20px; white-space: nowrap; }
.oac-memory-badge-twin { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }
.oac-memory-identity { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }
.oac-memory-contact { text-align: left; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); transition: border-color .16s; }
.oac-memory-contact:hover { border-color: var(--dsw-alias-label-dimmed); }
.oac-memory-diary-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.oac-memory-diary-head strong { font-size: 13px; color: var(--dsw-alias-label-primary); }
.oac-memory-diary-text { margin: 0; font-size: 13px; line-height: 21px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }
.oac-memory-diary-sections { display: flex; flex-direction: column; gap: 4px; }
.oac-memory-dream-date { flex: none; }
`

export const USER_CSS = `
/* User section: identity rows + the Bot owner-binding list, same vocabulary. */
.oac-user-binding-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-user-binding-row:last-child { border-bottom: 0; }
.oac-user-binding-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.oac-user-binding-owner { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--dsw-font-mono, ui-monospace, Menlo, monospace); }
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

export const BROWSER_CSS = `
/* Right-sidebar Bot Browser (hosted in a body portal, like dsh-better-sidebar).
   While open it OCCUPIES the layout: #root gives up the panel width, so the
   conversation column lifts instead of the Browser floating over it. */
#root { margin-right: var(--oac-browser-width, 0px); transition: margin-right .18s cubic-bezier(.4, 0, .2, 1); }
body[data-oac-browser-dragging] #root { transition: none; }
body[data-oac-browser-dragging] { cursor: col-resize; user-select: none; }
body[data-oac-browser-dragging] .oac-browser-frame { pointer-events: none; }
.oac-browser-shell { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1080; width: var(--oac-browser-width, 0px); display: flex; pointer-events: none; }
/* Sidebar-style divider: a 12px grab strip (half overlapping the conversation
   column) carrying a hairline knob that lights up on hover/drag, matching the
   left sidebar's resize affordance. */
.oac-browser-resize { flex: none; width: 12px; margin-left: -6px; align-self: stretch; display: flex; justify-content: center; cursor: col-resize; touch-action: none; pointer-events: auto; }
.oac-browser-resize-knob { width: 2px; height: 100%; background: transparent; transition: background .12s ease; }
.oac-browser-resize:hover .oac-browser-resize-knob, .oac-browser-resize[data-active='true'] .oac-browser-resize-knob { background: var(--dsw-alias-brand-primary); }
.oac-browser-panel { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-2); border-left: 1px solid var(--dsw-alias-border-l2); overflow: hidden; pointer-events: auto; }
.oac-browser-header { flex: none; display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 12px 0 16px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-browser-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.oac-browser-uri { flex: 1; min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-browser-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 18px; line-height: 1; cursor: pointer; }
.oac-browser-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.oac-browser-body { flex: 1; min-height: 0; background: var(--dsw-alias-bg-layer-1); }
.oac-browser-frame { display: block; width: 100%; height: 100%; border: 0; background: var(--dsw-alias-bg-layer-0, #fff); }
.oac-browser-landing { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; box-sizing: border-box; text-align: center; }
.oac-browser-empty, .oac-browser-error { margin: 0; max-width: 380px; font-size: 13px; line-height: 20px; }
.oac-browser-empty { color: var(--dsw-alias-label-secondary); }
.oac-browser-error { color: var(--dsw-alias-state-error-primary); }
.oac-browser-home { padding: 7px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
.oac-browser-home:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-label-dimmed); }
.oac-browser-reopen { position: fixed; top: 64px; right: 0; z-index: 1075; display: none; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-right: 0; border-radius: 10px 0 0 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 16px; cursor: pointer; pointer-events: auto; }
.oac-browser-reopen:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.oac-browser-shell[data-open='false'] .oac-browser-resize, .oac-browser-shell[data-open='false'] .oac-browser-panel { display: none; }
.oac-browser-shell[data-open='true'] .oac-browser-reopen { display: none; }
.oac-browser-shell[data-open='false']:focus-within .oac-browser-reopen { outline: 2px solid var(--dsw-alias-brand-primary); }
`
