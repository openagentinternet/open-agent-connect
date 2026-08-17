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
.oac-form { display: flex; flex-direction: column; gap: 10px; }
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
.oac-bot-avatar-fallback { display: inline-flex; align-items: center; justify-content: center; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); font-size: 14px; font-weight: 600; }
.oac-bot-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.oac-bot-name { font-size: 15px; line-height: 1.4; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-id { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-dimmed); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-model { margin: 0 16px 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oac-bot-foot { display: flex; justify-content: flex-end; gap: 2px; padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
.oac-icon-btn { position: relative; appearance: none; border: 0; border-radius: 7px; padding: 6px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; display: inline-flex; align-items: center; }
.oac-icon-btn:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.oac-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.oac-icon-btn::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); padding: 3px 8px; border-radius: 6px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); font-size: 11px; line-height: 17px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .12s; }
.oac-icon-btn:hover::after, .oac-icon-btn:focus-visible::after { opacity: 1; }
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
