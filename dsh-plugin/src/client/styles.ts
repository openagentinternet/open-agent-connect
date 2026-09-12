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
.oac-bot-avatar-sm { width: 28px; height: 28px; font-size: 11px; }
.oac-bot-avatar-lg { width: 64px; height: 64px; font-size: 18px; }
/* Avatar editor in the Basic tab (OAC /ui/bot layout): preview left,
   Upload/Replace + Remove actions right, note line underneath. */
.oac-avatar-section { display: flex; align-items: center; gap: 14px; }
.oac-avatar-actions { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.oac-avatar-buttons { display: flex; gap: 8px; }
/* Initials fallback (the name's first two chars): one notch below the old
   14px so two CJK glyphs never wrap/overflow the circle; the nowrap +
   overflow guard keeps odd glyphs clipped instead of growing the row. Size
   variants scale the font with the circle (40px→12px base, 32px→12px,
   28px→11px, 24px→10px, 64px→18px). */
.oac-bot-avatar-fallback { display: inline-flex; align-items: center; justify-content: center; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1; font-weight: 600; white-space: nowrap; overflow: hidden; }
/* Clickable avatar (opens the Bot's page in the right-sidebar Bot Browser). */
.oac-avatar-btn { flex: none; display: inline-flex; padding: 0; border: none; border-radius: 50%; background: none; cursor: pointer; }
.oac-avatar-btn:hover { filter: brightness(1.08); }
.oac-bot-identity { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.oac-bot-role { font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-global-id { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0 16px 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.oac-bot-global-id code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-name { flex: 1; min-width: 0; font-size: 15px; line-height: 1.4; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-bio { margin: 0 16px 12px; min-height: 39px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.oac-bot-model { margin: 0 16px 12px; min-height: 18px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-foot { display: flex; justify-content: space-between; gap: 2px; margin-top: auto; padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
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
.oac-input-select { appearance: none; width: auto; max-width: 100%; padding-right: 32px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; background-size: 12px 12px; }
.oac-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
/* LLM picker (the DSH composer ModelSelect port): a full-width trigger chip
   plus a two-level menu — Model / Effort root cells drilling into the
   provider-grouped model list and the reasoning-effort levels. */
.oac-llm-picker { position: relative; min-width: 0; }
.oac-llm-trigger { box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: 100%; min-height: 38px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.oac-llm-trigger:hover:not(:disabled) { border-color: var(--dsw-alias-label-dimmed); }
.oac-llm-trigger:disabled { opacity: 0.6; cursor: default; }
.oac-llm-trigger-invalid { border-color: var(--dsw-alias-state-error-primary); }
.oac-llm-trigger-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-llm-trigger-effort { flex: none; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); }
.oac-llm-chevron { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform .12s ease; }
.oac-llm-chevron-open { transform: rotate(180deg); }
.oac-llm-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; display: flex; flex-direction: column; width: max-content; min-width: 100%; max-width: min(420px, calc(100vw - 32px)); max-height: 320px; overflow-y: auto; padding: 4px; border-radius: 12px; background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2)); box-shadow: var(--dsw-elevation-prominent, var(--dsw-shadow-lv3)); color: var(--dsw-alias-label-primary); }
.oac-llm-status { padding: 10px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.oac-llm-group + .oac-llm-group { margin-top: 4px; }
.oac-llm-group-title { position: sticky; top: 0; z-index: 1; padding: 5px 8px 3px; background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; font-weight: 500; }
.oac-llm-cell { box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; height: 40px; padding: 0 10px; border: none; border-radius: 10px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.oac-llm-cell:hover { background: var(--dsw-alias-interactive-bg-hover); }
.oac-llm-cell-label { flex: none; }
.oac-llm-cell-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; color: var(--dsw-alias-label-tertiary); }
.oac-llm-cell-chevron { flex: none; color: var(--dsw-alias-label-tertiary); }
.oac-llm-option { box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 6px 8px; border: none; border-radius: 10px; background: transparent; color: inherit; font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.oac-llm-option:hover, .oac-llm-option:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
.oac-llm-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.oac-llm-check { flex: none; display: grid; place-items: center; width: 18px; color: var(--dsw-alias-label-primary); }
.oac-llm-fallback-row { display: flex; align-items: center; gap: 8px; }
.oac-llm-fallback-row .oac-llm-picker { flex: 1; min-width: 0; }
.oac-llm-clear { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 14px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.oac-llm-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/* "?" help button with hover/focus tooltip (the IDBots LLM-brain hint port). */
.oac-help { position: relative; display: inline-flex; margin-left: 4px; vertical-align: middle; }
.oac-help-button { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; background: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1; cursor: help; }
.oac-help:hover .oac-help-button, .oac-help:focus-within .oac-help-button { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.oac-help-tooltip { position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 50; width: 224px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2)); box-shadow: var(--dsw-elevation-prominent, var(--dsw-shadow-lv3)); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 400; white-space: normal; opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.oac-help:hover .oac-help-tooltip, .oac-help:focus-within .oac-help-tooltip { opacity: 1; }
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

/* Advanced tab (IDBots edit > 高级 parity): homepage source editor with the
   protocol-prefix inputs, the Chain & Wallet + Danger Zone cards, wallet
   chain rows, the MetaApp picker list, and the mnemonic grid/box. */
.oac-adv-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.oac-adv-card-head { font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.oac-adv-card-divider { height: 1px; background: var(--dsw-alias-border-l2); }
.oac-adv-card-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.oac-adv-danger { border-color: rgba(239, 68, 68, .4); background: rgba(239, 68, 68, .05); }
.oac-adv-danger .oac-adv-card-head { color: var(--dsw-alias-state-error-primary); }
.oac-adv-danger .oac-adv-card-divider { background: rgba(239, 68, 68, .3); }
.oac-adv-danger-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.oac-adv-danger-row .oac-hint { flex: 1; min-width: 200px; }
.oac-homepage-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.oac-protocol-input { display: flex; align-items: stretch; flex: 1; min-width: 220px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.oac-protocol-input:focus-within { border-color: var(--dsw-alias-brand-primary); }
.oac-protocol-prefix { flex: none; display: inline-flex; align-items: center; padding: 0 8px; border-right: 1px solid var(--dsw-alias-border-l2); font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; color: var(--dsw-alias-label-tertiary); user-select: none; }
.oac-protocol-field { flex: 1; min-width: 0; border: none; background: transparent; padding: 8px; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.oac-protocol-field:focus { outline: none; }
.oac-protocol-field::placeholder { color: var(--dsw-alias-label-dimmed); }
.oac-homepage-picker-error { display: flex; flex-direction: column; gap: 8px; }
.oac-homepage-picker-empty { display: flex; flex-direction: column; gap: 6px; }
.oac-homepage-app-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 288px; overflow: auto; }
.oac-homepage-app-item { box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font: inherit; text-align: left; cursor: pointer; }
.oac-homepage-app-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.oac-homepage-app-name { font-size: 13px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-homepage-app-pin { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.oac-wallet-rows { display: flex; flex-direction: column; gap: 8px; }
.oac-wallet-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; line-height: 18px; }
.oac-wallet-chain { flex: none; width: 44px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.oac-wallet-address { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--dsw-alias-label-secondary); }
.oac-wallet-balance { flex: none; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.oac-backup-warn { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; padding: 10px 12px; border: 1px solid rgba(245, 158, 11, .35); border-radius: 10px; background: rgba(245, 158, 11, .08); color: var(--dsw-alias-state-warn-label); font-size: 12px; line-height: 18px; }
.oac-backup-warn svg { flex: none; margin-top: 1px; }
.oac-backup-warn p { margin: 0; }
.oac-mnemonic-box { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.oac-mnemonic-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
.oac-mnemonic-grid li { display: flex; gap: 6px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.oac-mnemonic-index { flex: none; color: var(--dsw-alias-label-tertiary); }
.oac-mnemonic-paragraph { margin: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); }
.oac-delete-mnemonic { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.oac-link-button { align-self: flex-start; padding: 0; border: none; background: none; font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-brand-primary); cursor: pointer; }
.oac-link-button:hover { text-decoration: underline; }
.oac-link-button:disabled { opacity: .6; cursor: default; text-decoration: none; }

/* A2A Chat overlay: a shell.overlay entry (id oac-a2a) covering the center
   column only, driven by the apply-scope panel store (the panellist row's
   intercepted click toggles it). The three-column grid mirrors the frame's
   inline grid-template-columns, so the opaque center cell tracks column
   resizes, sidebar collapse, and right-Sidebar open/close; the side cells
   stay transparent and click-through. */
.oac-a2a-overlay[class] { position: absolute; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr); pointer-events: none; transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
[data-dragging] .oac-a2a-overlay,
[data-rightbar-instant] .oac-a2a-overlay,
[data-rightbar-fullscreen] .oac-a2a-overlay { transition: none; }
[data-rightbar-fullscreen] .oac-a2a-overlay { display: none; }
@media (prefers-reduced-motion: reduce) { .oac-a2a-overlay { transition: none; } }
.oac-a2a-overlay-center { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; pointer-events: auto; background: var(--dsw-alias-bg-layer-2); }

/* A2A conversation panel: fills the overlay's center cell; geometry follows
   the conversation row/bubble vocabulary. The panellist glyph draws its own
   open state (the row's kernel active highlight never fires for an overlay). */
.oac-unread-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-error-primary, #ef4444); box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-3); }
.oac-a2a-glyph { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.oac-a2a-glyph[data-open='true'] { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); border-radius: 8px; outline: 4px solid var(--dsw-alias-interactive-bg-active); }
.oac-a2a-glyph .oac-unread-dot { position: absolute; top: -3px; right: -4px; box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-2); }
.oac-a2a-panel { display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; background: var(--dsw-alias-bg-layer-2); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.oac-a2a-header { flex: none; display: flex; align-items: center; justify-content: space-between; height: 54px; padding: 10px 14px 8px 24px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-header h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.oac-a2a-body { flex: 1; min-width: 0; min-height: 0; display: grid; grid-template-columns: 320px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
/* Row wrapper below the header: the private-chat / group-task body. */
.oac-a2a-main { flex: 1; min-height: 0; display: flex; }
.oac-a2a-list { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); }
.oac-a2a-list-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-bot-avatar { flex: none; width: 32px; height: 32px; font-size: 12px; }
.oac-a2a-list-head .oac-input { flex: 0 1 auto; min-width: 0; height: auto; padding-top: 5px; padding-bottom: 5px; }
.oac-a2a-list-rows { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.oac-a2a-row { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 8px; box-sizing: border-box; border: none; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.oac-a2a-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.oac-a2a-row.active { background: var(--dsw-alias-interactive-bg-active); }
.oac-a2a-row-avatar { flex: none; width: 28px; height: 28px; font-size: 11px; }
.oac-a2a-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oac-a2a-row-name { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-row-text { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-row-time { flex: none; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
/* Trailing hover menu (DSH home session-list pattern): the relative time
   swaps for the "..." button on row hover / while the menu is open; pinned
   rows keep the slot as a pin marker (star crossfades to "..." on hover). */
.oac-row-trail { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: flex-end; }
.oac-a2a-row:hover .oac-row-trail .oac-a2a-row-time,
.oac-row-trail[data-menu-open='true'] .oac-a2a-row-time,
.oac-row-trail[data-pinned='true'] .oac-a2a-row-time { display: none; }
.oac-row-actions { display: none; align-items: center; position: relative; }
.oac-a2a-row:hover .oac-row-actions,
.oac-row-trail[data-menu-open='true'] .oac-row-actions,
.oac-row-trail[data-pinned='true'] .oac-row-actions { display: inline-flex; }
.oac-row-menu-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.oac-row-menu-btn:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.oac-row-menu-btn .oac-row-pin-icon { display: none; font-size: 12px; line-height: 1; color: var(--dsw-alias-state-warn-label); }
.oac-row-trail[data-pinned='true'] .oac-row-menu-btn .oac-row-pin-icon { display: inline-flex; }
.oac-row-trail[data-pinned='true'] .oac-row-menu-btn svg,
.oac-row-trail[data-pinned='true'] .oac-row-menu-btn .oac-row-ellipsis { display: none; }
.oac-a2a-row:hover .oac-row-menu-btn .oac-row-pin-icon,
.oac-row-trail[data-menu-open='true'] .oac-row-menu-btn .oac-row-pin-icon { display: none; }
.oac-a2a-row:hover .oac-row-trail[data-pinned='true'] .oac-row-menu-btn svg,
.oac-row-trail[data-menu-open='true'] .oac-row-trail[data-pinned='true'] .oac-row-menu-btn svg { display: inline-flex; }
.oac-row-menu-copied { position: absolute; top: calc(100% + 4px); right: 0; padding: 2px 6px; border-radius: 4px; background: rgba(16, 24, 40, .94); color: #fff; font-size: 10px; line-height: 14px; white-space: nowrap; pointer-events: none; z-index: 20; }
.oac-menu-star { display: inline-flex; width: 16px; justify-content: center; font-size: 12px; line-height: 1; color: var(--dsw-alias-state-warn-label); }
.oac-a2a-thread { position: relative; min-width: 0; display: flex; flex-direction: column; }
.oac-a2a-thread-head { flex: none; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 10px 16px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-thread-avatar { flex: none; width: 32px; height: 32px; font-size: 12px; }
.oac-a2a-participants { flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; }
.oac-a2a-participant { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.oac-a2a-participant-local { align-items: flex-end; text-align: right; }
.oac-a2a-participant-name { max-width: 100%; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-gmid { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; font-size: 11px; line-height: 14px; color: var(--dsw-alias-label-tertiary); }
.oac-a2a-gmid code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-a2a-id { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.oac-a2a-id code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.oac-a2a-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.oac-a2a-msg { display: flex; gap: 10px; max-width: min(560px, 86%); }
.oac-a2a-msg-peer { align-self: flex-start; }
.oac-a2a-msg-local { align-self: flex-end; flex-direction: row-reverse; }
.oac-a2a-msg-avatar { flex: none; width: 28px; height: 28px; font-size: 11px; }
.oac-a2a-msg-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.oac-a2a-msg-local .oac-a2a-msg-body { align-items: flex-end; }
.oac-a2a-msg-head { display: flex; align-items: baseline; gap: 10px; }
.oac-a2a-msg-local .oac-a2a-msg-head { flex-direction: row-reverse; }
.oac-a2a-msg-name { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.oac-a2a-msg-meta { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.oac-a2a-msg-txid { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.oac-a2a-msg-txid-text { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Icon-only copy action with a transient "copied" pill (OAC copy-action port). */
.oac-copy-wrap { position: relative; flex: none; display: inline-flex; align-items: center; }
.oac-copy-action { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; border-radius: 3px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.oac-copy-action:hover { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-hover); }
.oac-copy-copied { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); padding: 2px 6px; border-radius: 4px; background: rgba(16, 24, 40, .94); color: #fff; font-size: 10px; line-height: 14px; white-space: nowrap; pointer-events: none; z-index: 20; }
.oac-a2a-bubble { min-width: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.oac-a2a-bubble-local { background: var(--dsw-alias-button-primary-fill, #2e6fed); color: var(--dsw-alias-label-primary-foreground, #fff); border-radius: 16px 16px 4px 16px; padding: 8px 12px; }
.oac-a2a-bubble-local a { color: inherit; text-decoration: underline; }
.oac-a2a-bubble-peer { background: var(--dsw-alias-bg-layer-3); border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px 16px 16px 4px; padding: 8px 12px; }
.oac-a2a-msg-text { white-space: pre-wrap; }
.oac-a2a-msg-image { display: block; max-width: 100%; max-height: 320px; border-radius: 10px; object-fit: contain; }
.oac-a2a-composer { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-a2a-composer-row { display: flex; align-items: center; gap: 8px; }
.oac-a2a-composer-row .oac-input { flex: 1; min-width: 0; }
.oac-a2a-guidance { display: flex; flex-direction: column; gap: 8px; }
.oac-a2a-guidance-toggle { align-self: flex-start; padding: 0; border: none; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.oac-a2a-guidance-toggle:hover { color: var(--dsw-alias-label-primary); }
.oac-a2a-guidance-form { display: flex; align-items: center; gap: 8px; }
.oac-a2a-guidance-input { flex: 1; min-width: 0; }
.oac-a2a-guidance-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 14px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.oac-a2a-guidance-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

/* Create-Bot chain phases (the AppsPanel publish overlay pattern): a pending
   spinner block, a centered success result, and the amber setup-pending
   panel with the Bot's MVC address + copy affordance. */
.oac-create-result { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 0; text-align: center; }
.oac-create-result-icon { font-size: 36px; line-height: 1; }
.oac-create-result-name { font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.oac-create-result-sub { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.oac-create-setup { display: flex; flex-direction: column; gap: 12px; }
.oac-create-badge-warn { background: color-mix(in srgb, var(--dsw-alias-state-warn-label) 16%, transparent); color: var(--dsw-alias-state-warn-label); }
.oac-create-address { display: flex; flex-direction: column; gap: 6px; }
.oac-create-address-row { display: flex; align-items: center; gap: 6px; }
.oac-create-address-row code { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }

/* Amber setup-pending badge on Bot cards whose on-chain setup is incomplete. */
.oac-setup-badge { background: color-mix(in srgb, var(--dsw-alias-state-warn-label) 16%, transparent); color: var(--dsw-alias-state-warn-label); }
.oac-spin { animation: oac-spin 1s linear infinite; }
@keyframes oac-spin { to { transform: rotate(360deg); } }
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
.oac-memory-badge-twin { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-layer-3); font-weight: 600; }
.oac-memory-badge.oac-llm-unset-badge { background: color-mix(in srgb, var(--dsw-alias-state-warn-label) 16%, transparent); color: var(--dsw-alias-state-warn-label); }
.oac-memory-run-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.oac-memory-run-row > span { min-width: 0; overflow-wrap: anywhere; }
.oac-memory-identity { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }
.oac-memory-contact { text-align: left; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); transition: border-color .16s; }
.oac-memory-contact:hover { border-color: var(--dsw-alias-label-dimmed); }
.oac-contact-name { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-contact-id { display: block; font-family: var(--dsw-font-mono, monospace); font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-memory-add-btn { flex-shrink: 0; white-space: nowrap; }
.oac-memory-diary-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.oac-memory-diary-head strong { font-size: 13px; color: var(--dsw-alias-label-primary); }
.oac-memory-diary-text { margin: 0; font-size: 13px; line-height: 21px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }
.oac-memory-diary-sections { display: flex; flex-direction: column; gap: 4px; }
.oac-memory-dream-date { flex: none; }
`

export const GROUPTASK_CSS = `
/* Group Task tab inside the A2A panel: header mode tabs, badge pills, the
   detail column (info / members / deliverables / checkpoint / transcript),
   and the create/close dialogs. Reuses the a2a list/thread frame and the
   underline-tab vocabulary; all colors resolve through --dsw-alias-* tokens. */
.oac-gt-header-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.oac-gt-header-right { display: flex; align-items: center; gap: 10px; }
.oac-gt-mode-tabs { border-bottom: none; margin-top: 0; align-self: stretch; align-items: center; }
.oac-gt-mode-tabs .oac-tab { font-size: 14px; }
.oac-gt-badge { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 7px; border-radius: 9px; font-size: 11px; line-height: 18px; white-space: nowrap; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); }
/* Status badges mirror the IDBots group-task palette (Tailwind colors, light
   + body[data-ds-dark-theme] variants); the DSH --dsw-alias-state-*-secondary
   tokens are saturated mid-tones that made badge text unreadable. */
.oac-gt-status-planning { background: #dbeafe; color: #1d4ed8; }
.oac-gt-status-executing { background: linear-gradient(135deg, #dbeafe 0%, #93c5fd 55%, #3b82f6 100%); color: #1e3a8a; animation: oac-gt-badge-breathe 2.4s ease-in-out infinite; }
.oac-gt-status-review { background: #fef3c7; color: #b45309; }
.oac-gt-status-done { background: #d1fae5; color: #047857; }
.oac-gt-status-cancelled { background: #e5e7eb; color: #4b5563; }
.oac-gt-stall { background: #fef3c7; color: #b45309; }
.oac-gt-deliverable-accepted { background: #d1fae5; color: #047857; }
.oac-gt-deliverable-rejected { background: #fee2e2; color: #b91c1c; }
@keyframes oac-gt-badge-breathe { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.09); } }
@media (prefers-reduced-motion: reduce) { .oac-gt-status-executing { animation: none; } }
body[data-ds-dark-theme] .oac-gt-status-planning { background: rgba(30, 58, 138, .4); color: #93c5fd; }
body[data-ds-dark-theme] .oac-gt-status-executing { background: linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #60a5fa 100%); color: #dbeafe; }
body[data-ds-dark-theme] .oac-gt-status-review, body[data-ds-dark-theme] .oac-gt-stall { background: rgba(120, 53, 15, .4); color: #fcd34d; }
body[data-ds-dark-theme] .oac-gt-status-done { background: rgba(6, 78, 59, .4); color: #6ee7b7; }
body[data-ds-dark-theme] .oac-gt-status-cancelled { background: rgba(55, 65, 81, .5); color: #d1d5db; }
body[data-ds-dark-theme] .oac-gt-deliverable-accepted { background: rgba(6, 78, 59, .4); color: #6ee7b7; }
body[data-ds-dark-theme] .oac-gt-deliverable-rejected { background: rgba(127, 29, 29, .4); color: #fca5a5; }
.oac-gt-openteam { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-layer-3); font-weight: 600; }
.oac-gt-chair { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.oac-gt-row { align-items: flex-start; }
.oac-gt-row-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.oac-gt-row-title .oac-a2a-row-name { flex: 0 1 auto; }
.oac-gt-pin-mark { flex: none; color: var(--dsw-alias-state-warn-label); font-size: 11px; }
.oac-gt-row-meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oac-gt-collabs { display: flex; flex-direction: column; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-gt-staffing { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-fill-floating-secondary, transparent); }
.oac-gt-staffing-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; }
.oac-gt-staffing-seat { display: flex; align-items: center; gap: 6px; font-size: 12px; padding-left: 4px; }
.oac-gt-staffing-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.oac-gt-collabs-title { padding: 4px 12px 6px; font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; }
.oac-gt-guest-invite { cursor: default; opacity: .75; }
.oac-gt-invite-toggle { margin-left: 10px; text-transform: none; letter-spacing: normal; }
.oac-gt-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; }
.oac-gt-head { justify-content: space-between; gap: 12px; }
.oac-gt-head-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.oac-gt-head-main strong { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-gt-head-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.oac-gt-head-actions { flex: none; display: flex; align-items: center; gap: 8px; }
.oac-gt-detail { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.oac-gt-section { display: flex; flex-direction: column; gap: 8px; }
.oac-gt-field { display: flex; flex-direction: column; gap: 3px; }
.oac-gt-field-label { font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; }
.oac-gt-field-value { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; overflow-wrap: anywhere; }
.oac-gt-local-actions { display: flex; align-items: center; gap: 14px; }
.oac-gt-members { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.oac-gt-member { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }
.oac-gt-member-avatar { flex: none; width: 24px; height: 24px; font-size: 10px; }
.oac-gt-member-main { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.oac-gt-member-name { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.oac-gt-member-work { flex: none; font-size: 11px; line-height: 16px; }
.oac-gt-work-working { color: var(--dsw-alias-state-success-primary); }
.oac-gt-work-idle { color: var(--dsw-alias-label-tertiary); }
.oac-gt-work-timeout, .oac-gt-work-error { color: var(--dsw-alias-state-error-primary); }
.oac-gt-work-unknown { color: var(--dsw-alias-label-dimmed); }
.oac-gt-member-kick { flex: none; padding: 0 4px; border: none; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; cursor: pointer; }
.oac-gt-member-kick:hover { color: var(--dsw-alias-state-error-primary); }
.oac-gt-deliverables { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.oac-gt-deliverable { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.oac-gt-deliverable-kind { flex: none; }
.oac-gt-deliverable-uri { flex: 1; min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-gt-checkpoint { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--dsw-alias-state-warn-label); border-radius: 12px; background: var(--dsw-alias-state-warn-secondary, var(--dsw-alias-bg-layer-1)); }
.oac-gt-checkpoint-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-state-warn-label); }
.oac-gt-checkpoint-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-gt-transcript { gap: 12px; }
.oac-gt-msg { max-width: 100%; }
.oac-gt-suspect { color: var(--dsw-alias-state-error-primary); }
.oac-gt-sender-select { flex: none; width: auto; min-width: 120px; }
.oac-gt-stars { display: inline-flex; gap: 2px; }
.oac-gt-star { padding: 0; border: none; background: none; font-size: 15px; line-height: 18px; color: var(--dsw-alias-label-dimmed); cursor: pointer; }
.oac-gt-star:disabled { cursor: default; }
.oac-gt-star.on { color: var(--dsw-alias-state-warn-label); }
.oac-gt-form { display: flex; flex-direction: column; gap: 12px; }
.oac-gt-form-field { display: flex; flex-direction: column; gap: 5px; }
.oac-gt-textarea { resize: vertical; min-height: 56px; font: inherit; font-size: 13px; line-height: 20px; padding: 8px 10px; }
.oac-gt-worker-picks { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; }
.oac-gt-worker-pick { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 8px; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.oac-gt-worker-pick:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* Create modal guide (IDBots NewGroupTaskModal parity): the chat-first
   explanation shows first; "Fill the form manually" expands the manual form,
   "Back to guide" returns. */
.oac-gt-guide { display: flex; flex-direction: column; gap: 14px; }
.oac-gt-guide-title { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.oac-gt-guide-example { margin: 0; padding: 10px 12px; border-left: 2px solid var(--dsw-alias-brand-primary); border-radius: 8px; background: var(--dsw-alias-fill-floating-secondary, transparent); }
.oac-gt-guide-example p { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.oac-gt-guide-when { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.oac-gt-guide-when-title { margin: 0 0 4px; font-weight: 600; }
.oac-gt-guide-when-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.oac-gt-guide-manual { font-size: 13px; font-weight: 600; }
/* Task drawer: the IDBots group-task right rail (members / status history /
   transitions / integrity events / deliverables) ported as a floating drawer —
   absolutely positioned over the thread's right edge, never taking layout
   space. Toggled from the thread head; closed by its own header button. */
.oac-gt-drawer { position: absolute; top: 0; right: 0; bottom: 0; z-index: 5; width: min(300px, 88%); display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-2); border-left: 1px solid var(--dsw-alias-border-l2); box-shadow: var(--dsw-shadow-lv3); animation: oac-gt-drawer-in .18s cubic-bezier(.4, 0, .2, 1); }
@keyframes oac-gt-drawer-in { from { transform: translateX(100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { .oac-gt-drawer { animation: none; } }
.oac-gt-drawer-head { flex: none; display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 8px 0 14px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-gt-drawer-title { flex: 1; min-width: 0; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-gt-drawer-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.oac-gt-drawer-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.oac-gt-drawer-body { flex: 1; min-height: 0; overflow-y: auto; }
.oac-gt-drawer-section { padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.oac-gt-drawer-heading { margin: 0 0 8px; font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
summary.oac-gt-drawer-heading { cursor: pointer; }
.oac-gt-drawer-empty { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-dimmed); }
.oac-gt-drawer-members { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.oac-gt-drawer-member { display: flex; align-items: flex-start; gap: 8px; }
.oac-gt-drawer-member-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.oac-gt-drawer-member-badges { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.oac-gt-drawer-member-meta { font-size: 11px; line-height: 14px; color: var(--dsw-alias-label-dimmed); }
.oac-gt-drawer-events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.oac-gt-drawer-event-sub { color: var(--dsw-alias-label-dimmed); }
.oac-gt-integrity { display: block; width: 100%; padding: 4px 6px; border: none; border-radius: 6px; background: none; font: inherit; text-align: left; color: inherit; }
button.oac-gt-integrity:not(:disabled) { cursor: pointer; }
button.oac-gt-integrity:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
.oac-gt-integrity-detail { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--dsw-alias-label-tertiary); }
.oac-gt-integrity-correction { font-weight: 600; color: #b45309; }
.oac-gt-integrity-honest { font-weight: 600; color: #047857; }
body[data-ds-dark-theme] .oac-gt-integrity-correction { color: #fcd34d; }
body[data-ds-dark-theme] .oac-gt-integrity-honest { color: #6ee7b7; }
/* workStatus + member state-machine pills: the IDBots rail palette. */
.oac-gt-workbadge-working { background: #fef3c7; color: #b45309; }
.oac-gt-workbadge-error { background: #fee2e2; color: #b91c1c; }
.oac-gt-workbadge-timeout { background: #ffedd5; color: #c2410c; }
.oac-gt-workbadge-idle { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); }
body[data-ds-dark-theme] .oac-gt-workbadge-working { background: rgba(120, 53, 15, .4); color: #fcd34d; }
body[data-ds-dark-theme] .oac-gt-workbadge-error { background: rgba(127, 29, 29, .4); color: #fca5a5; }
body[data-ds-dark-theme] .oac-gt-workbadge-timeout { background: rgba(124, 45, 18, .4); color: #fdba74; }
.oac-gt-mstatus-working { background: #dbeafe; color: #1d4ed8; }
.oac-gt-mstatus-standby { background: #e2e8f0; color: #475569; }
.oac-gt-mstatus-done { background: #d1fae5; color: #047857; }
.oac-gt-mstatus-unreachable { background: #fee2e2; color: #b91c1c; }
.oac-gt-mstatus-delivered { background: #cffafe; color: #0e7490; }
.oac-gt-mstatus-assigned { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); }
body[data-ds-dark-theme] .oac-gt-mstatus-working { background: rgba(30, 58, 138, .4); color: #93c5fd; }
body[data-ds-dark-theme] .oac-gt-mstatus-standby { background: rgba(51, 65, 85, .5); color: #cbd5e1; }
body[data-ds-dark-theme] .oac-gt-mstatus-done { background: rgba(6, 78, 59, .4); color: #6ee7b7; }
body[data-ds-dark-theme] .oac-gt-mstatus-unreachable { background: rgba(127, 29, 29, .4); color: #fca5a5; }
body[data-ds-dark-theme] .oac-gt-mstatus-delivered { background: rgba(21, 94, 117, .4); color: #67e8f9; }
/* Deliverable cards: kind pill + acceptance status + on-chain confirmation /
   verification pill, full copyable URI (clickable when openable), author. */
.oac-gt-dcards { display: flex; flex-direction: column; gap: 8px; }
.oac-gt-dcard { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }
.oac-gt-dcard-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.oac-gt-dstatus { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.oac-gt-dkind-metafile { background: #e0f2fe; color: #0369a1; }
.oac-gt-dkind-metaapp { background: #ede9fe; color: #6d28d9; }
.oac-gt-dkind-url { background: #dbeafe; color: #1d4ed8; }
.oac-gt-dkind-pinid { background: #cffafe; color: #0e7490; }
.oac-gt-dkind-text { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); }
body[data-ds-dark-theme] .oac-gt-dkind-metafile { background: rgba(12, 74, 110, .4); color: #7dd3fc; }
body[data-ds-dark-theme] .oac-gt-dkind-metaapp { background: rgba(76, 29, 149, .4); color: #c4b5fd; }
body[data-ds-dark-theme] .oac-gt-dkind-url { background: rgba(30, 58, 138, .4); color: #93c5fd; }
body[data-ds-dark-theme] .oac-gt-dkind-pinid { background: rgba(21, 94, 117, .4); color: #67e8f9; }
.oac-gt-dconfirm, .oac-gt-dverify-verified { background: #d1fae5; color: #047857; }
.oac-gt-dverify-pending { background: #fef3c7; color: #b45309; }
.oac-gt-dverify-unverified { background: #fee2e2; color: #b91c1c; }
body[data-ds-dark-theme] .oac-gt-dconfirm, body[data-ds-dark-theme] .oac-gt-dverify-verified { background: rgba(6, 78, 59, .4); color: #6ee7b7; }
body[data-ds-dark-theme] .oac-gt-dverify-pending { background: rgba(120, 53, 15, .4); color: #fcd34d; }
body[data-ds-dark-theme] .oac-gt-dverify-unverified { background: rgba(127, 29, 29, .4); color: #fca5a5; }
.oac-gt-duri { display: flex; align-items: flex-start; gap: 4px; min-width: 0; }
.oac-gt-duri code, .oac-gt-duri-link { flex: 1; min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; word-break: break-all; }
.oac-gt-duri-link { padding: 0; border: none; background: none; color: var(--dsw-alias-brand-primary); text-align: left; cursor: pointer; }
.oac-gt-duri-link:hover { text-decoration: underline; }
.oac-gt-dsource summary { cursor: pointer; font-size: 11px; line-height: 16px; color: var(--dsw-alias-brand-primary); }
.oac-gt-dsource-body { margin-top: 4px; max-height: 160px; overflow-y: auto; padding: 6px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-3); font-size: 11px; line-height: 16px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
.oac-gt-dmeta { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-dimmed); }
`

export const USER_CSS = `
/* User section: the human owner identity (create/import/backup/profile). */
.oac-user-empty { align-items: flex-start; }
.oac-mnemonic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
.oac-mnemonic-word { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; color: var(--dsw-alias-label-primary); }
.oac-mnemonic-index { flex: none; min-width: 18px; color: var(--dsw-alias-label-tertiary); font-size: 11px; text-align: right; }
`

export const PRESETS_CSS = `
.oac-session-id-header { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.oac-session-id-header code { font-family: inherit; }
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

export const HERO_CSS = `
/* Hero Bot identity (hero-identity.ts): the selected Bot's big avatar + name
   centered DIRECTLY ABOVE the blank-session hero headline (whale logo +
   slogan), before the workspace/preset chip row. The hero stack already
   supplies 12px gaps; the block adds a little breathing room above the
   headline and a one-shot entrance that reduced motion disables. */
.oac-hero-identity { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 0 0 4px; animation: oac-hero-identity-in .24s ease-out; }
.oac-bot-avatar.oac-hero-identity-avatar { width: 100px; height: 100px; font-size: 28px; box-shadow: 0 0 0 1px var(--dsw-alias-border-l4); }
.oac-hero-identity-name { max-width: 100%; font-size: 20px; line-height: 28px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes oac-hero-identity-in { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .oac-hero-identity { animation: none; } }
`

export const BROWSER_CSS = `
/* Right-Sidebar bot-browser tab body: the local OAC Browser (/browser/*
   localUiUrl) in an iframe inside the official right Sidebar. Pane geometry,
   resize, and tab chrome belong to the Sidebar; these rules cover only the
   tab content: the frame, the landing/error state, and the agent links the
   conversation link interceptor rewrites. */
.oac-browser-tab { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1); }
.oac-browser-frame { display: block; width: 100%; height: 100%; border: 0; background: var(--dsw-alias-bg-layer-0, #fff); }
.oac-browser-landing { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; box-sizing: border-box; text-align: center; }
.oac-browser-empty, .oac-browser-error { margin: 0; max-width: 380px; font-size: 13px; line-height: 20px; }
.oac-browser-empty { color: var(--dsw-alias-label-secondary); }
.oac-browser-error { color: var(--dsw-alias-state-error-primary); }
.oac-browser-home { padding: 7px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
.oac-browser-home:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-label-dimmed); }
a.oac-agent-link, a[data-oac-agent-link] { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
`

export const TRAFFIC_CSS = `
/* Traffic (流量) section: the IDBots TrafficSettings layout on the shared
   oac-section-card/oac-field vocabulary. All colors resolve through
   --dsw-alias-* tokens so the panel follows the active theme. */
.oac-traffic-section { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.oac-traffic-accent { color: var(--dsw-alias-brand-primary); }
.oac-traffic-identity-empty { flex-direction: row; align-items: flex-start; gap: 12px; }
.oac-traffic-identity-icon { flex: none; margin-top: 2px; color: var(--dsw-alias-label-tertiary); }

/* Billing-mode segmented toggle (IDBots inline-flex border pill). */
.oac-traffic-seg { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }
.oac-traffic-seg-btn { appearance: none; border: 0; border-radius: 8px; padding: 4px 10px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 18px; font-weight: 500; cursor: pointer; transition: color .12s, background .12s; }
.oac-traffic-seg-btn:hover:not(:disabled):not([data-active='true']) { color: var(--dsw-alias-label-primary); }
.oac-traffic-seg-btn[data-active='true'] { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-layer-3); }
.oac-traffic-seg-btn:disabled { opacity: .5; cursor: default; }

/* Balance card: label + tariff "?" on the left, big adaptive number under it,
   action buttons stacked on the right. */
.oac-traffic-balance-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.oac-traffic-balance-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.oac-traffic-balance-label { display: inline-flex; align-items: center; gap: 4px; }
.oac-traffic-tariff-btn { padding: 2px; }
.oac-traffic-balance-row { display: flex; align-items: baseline; gap: 8px; }
.oac-traffic-balance-value { font-size: 24px; line-height: 32px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.oac-traffic-spin { color: var(--dsw-alias-label-tertiary); animation: oac-traffic-spin 1s linear infinite; }
@keyframes oac-traffic-spin { to { transform: rotate(360deg); } }
.oac-traffic-balance-actions { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.oac-traffic-btn-row { display: flex; gap: 8px; }

/* Free-grant banner (emerald) and the low-balance warning (amber). */
.oac-traffic-grant { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.oac-traffic-grant p { flex: 1; margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
.oac-traffic-low { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-label) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-label) 10%, transparent); color: var(--dsw-alias-state-warn-label); }
.oac-traffic-low p { margin: 0; font-size: 12px; line-height: 18px; }
.oac-traffic-error-row { display: flex; align-items: center; gap: 8px; }
.oac-traffic-error-row p { flex: 1; }

/* Usage: today/7d/30d summary cards + the per-day per-bot table. */
.oac-traffic-summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; align-self: stretch; }
.oac-traffic-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); }
.oac-traffic-stat-value { font-size: 14px; line-height: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.oac-traffic-stat-label { font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary); }
.oac-traffic-table-wrap { align-self: stretch; overflow-x: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); padding: 8px 12px; }
.oac-traffic-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 18px; }
.oac-traffic-table th { padding: 4px 12px 4px 0; text-align: left; font-weight: 500; color: var(--dsw-alias-label-tertiary); }
.oac-traffic-table td { padding: 4px 12px 4px 0; color: var(--dsw-alias-label-primary); }
.oac-traffic-table th:last-child, .oac-traffic-table td:last-child { padding-right: 0; }
.oac-traffic-table .num { text-align: right; font-variant-numeric: tabular-nums; }

/* Ledger rows: time, direction, source, optional txid badge, signed amount. */
.oac-traffic-ledger-title { margin-top: 8px; }
.oac-traffic-ledger { gap: 6px; }
.oac-traffic-ledger-row { display: flex; align-items: center; gap: 12px; font-size: 12px; line-height: 18px; }
.oac-traffic-ledger-time { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.oac-traffic-ledger-dir { flex: none; color: var(--dsw-alias-label-primary); }
.oac-traffic-ledger-src { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); }
.oac-traffic-ledger-amount { flex: none; font-variant-numeric: tabular-nums; font-weight: 500; color: var(--dsw-alias-label-primary); }
.oac-traffic-txid { flex: none; display: inline-flex; align-items: center; gap: 2px; }
.oac-traffic-txid code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 10px; color: var(--dsw-alias-label-dimmed); }
.oac-traffic-txid-btn { padding: 2px; }
.oac-traffic-check { color: var(--dsw-alias-state-success-primary); }
.oac-traffic-ledger-more { display: flex; justify-content: center; }

/* Advanced: assist-service base-URL override. */
.oac-traffic-disclosure { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.oac-traffic-advanced { display: flex; flex-direction: column; gap: 6px; }
.oac-traffic-apibase-row { display: flex; align-items: center; gap: 8px; }
.oac-traffic-apibase-row .oac-input { flex: 1; min-width: 0; }

/* Redeem dialog: uppercase mono code input + success line. */
.oac-traffic-redeem { display: flex; flex-direction: column; gap: 10px; }
.oac-traffic-redeem-row { display: flex; align-items: center; gap: 8px; }
.oac-traffic-redeem-input { flex: 1; min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); text-transform: uppercase; }
.oac-traffic-redeem-success { display: flex; align-items: flex-start; gap: 8px; }
.oac-traffic-redeem-success .oac-traffic-check { flex: none; margin-top: 2px; }

/* Tariff overlay table (wider than the standard dialog). */
.oac-traffic-tariff-dialog { width: min(520px, 100%); }
.oac-traffic-tariff-table td { padding-top: 8px; padding-bottom: 8px; }
.oac-traffic-tariff-table tbody tr { border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-traffic-tariff-type { font-weight: 500; }
.oac-traffic-tariff-capacity { font-weight: 600; color: var(--dsw-alias-state-warn-label); }

/* Knowledge tab (IDBots KnowledgeBasePanel parity): cards, badges, toggle. */
.oac-kb-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.oac-kb-row-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.oac-kb-name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oac-kb-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-kb-badge { flex-shrink: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 0 8px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.oac-kb-desc { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.oac-kb-path { margin: 0; font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-kb-stats { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.oac-kb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.oac-kb-toggle { width: 32px; height: 18px; border-radius: 999px; background: var(--dsw-alias-label-dimmed); position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s ease; border: none; padding: 0; }
.oac-kb-toggle[data-on='true'] { background: var(--dsw-alias-state-business-primary); }
.oac-kb-toggle-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); transition: left .15s ease; }
.oac-kb-toggle[data-on='true'] .oac-kb-toggle-knob { left: 16px; }
.oac-kb-notice { font-size: 12px; border-radius: 8px; padding: 6px 10px; }
.oac-kb-notice[data-kind='success'] { color: var(--dsw-alias-state-success-primary); background: rgba(34, 197, 94, .1); }
.oac-kb-notice[data-kind='error'] { color: var(--dsw-alias-state-error-primary); background: rgba(239, 68, 68, .1); }
.oac-kb-danger-btn { color: var(--dsw-alias-state-error-primary); }
.oac-kb-advanced { border: 1px solid rgba(239, 68, 68, .3); background: rgba(239, 68, 68, .05); border-radius: 8px; padding: 8px 10px; }
.oac-kb-advanced summary { cursor: pointer; user-select: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.oac-kb-adv-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.oac-kb-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.oac-kb-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); background: rgba(239, 68, 68, .1); border-radius: 8px; padding: 6px 10px; }
.oac-kb-sep { border: none; border-top: 1px solid var(--dsw-alias-border-l2); margin: 12px 0 0; }
.oac-kb-study-badge { flex-shrink: 0; display: inline-flex; align-items: center; padding: 0 8px; font-size: 11px; border-radius: 999px; border: 1px solid transparent; }
.oac-kb-study-badge[data-status='pending'] { color: #b45309; background: rgba(245, 158, 11, .1); border-color: rgba(245, 158, 11, .3); }
.oac-kb-study-badge[data-status='running'] { color: #1d4ed8; background: rgba(59, 130, 246, .1); border-color: rgba(59, 130, 246, .3); }
.oac-kb-study-badge[data-status='done'] { color: #047857; background: rgba(16, 185, 129, .1); border-color: rgba(16, 185, 129, .3); }
.oac-kb-study-badge[data-status='failed'] { color: #b91c1c; background: rgba(239, 68, 68, .1); border-color: rgba(239, 68, 68, .3); }
`
