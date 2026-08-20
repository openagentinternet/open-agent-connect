/** Locale namespace for the User settings section. */
export const USER_NS = 'settings.oac.user'

export const userEn = {
  nav: 'User',
  title: 'User',
  loading: 'Loading identity…',
  refresh: 'Refresh',
  error: 'Could not load the owner identity.',
  copy: 'Copy',
  copied: 'Copied',
  // Empty state: no owner identity yet.
  emptyTitle: 'No owner identity yet',
  emptyHint: 'The owner is you — the person who talks to the Bots. Create a new identity or import one from a mnemonic. Bots recognize this identity as their master.',
  emptyCreate: 'Create new identity',
  emptyImport: 'Import mnemonic',
  // Create view.
  createTitle: 'Create identity',
  createHint: 'A fresh MetaID wallet will be generated for you. Back up the mnemonic right after.',
  nameField: 'Name',
  namePlaceholder: 'Your display name',
  createSubmit: 'Create',
  working: 'Working…',
  // Import view.
  importTitle: 'Import mnemonic',
  importHint: 'Restore your owner identity from an existing BIP39 mnemonic phrase.',
  mnemonicField: 'Mnemonic',
  mnemonicPlaceholder: '12 or 24 words, separated by spaces',
  pathField: 'Derivation path (optional)',
  pathHint: 'Defaults to m/44\'/10001\'/0\'/0/0',
  importSubmit: 'Import',
  invalidMnemonic: 'That mnemonic is not a valid BIP39 phrase.',
  // Backup view (shown right after create/import).
  backupTitle: 'Back up your mnemonic',
  backupWarning: 'This mnemonic is the only way to recover your owner identity. Write it down and keep it safe. It will only be shown in full here.',
  backupConfirm: "I've backed it up",
  // Profile view.
  profileTitle: 'Owner identity',
  profileHint: 'The local human owner. Bots bind to this identity as their master.',
  saveName: 'Save',
  savingName: 'Saving…',
  nameSaved: 'Name updated.',
  backupBtn: 'Backup mnemonic',
  logoutBtn: 'Log out',
  fieldGlobalMetaId: 'GlobalMetaID',
  fieldMvcAddress: 'MVC address',
  fieldMetaId: 'MetaID',
  fieldCreatedAt: 'Created',
  // Reveal mnemonic modal.
  revealTitle: 'Your mnemonic',
  revealWarning: 'Anyone with this phrase can control your owner identity. Never share it.',
  // Logout confirm.
  logoutTitle: 'Log out',
  logoutWarning: 'This deletes the local owner identity, including its mnemonic. Make sure you have a backup before continuing.',
  logoutConfirm: 'Delete identity',
  cancel: 'Cancel',
}

export const userZh = {
  nav: '用户',
  title: '用户',
  loading: '正在加载身份…',
  refresh: '刷新',
  error: '无法加载主人身份。',
  copy: '复制',
  copied: '已复制',
  // 空态：还没有主人身份。
  emptyTitle: '还没有主人身份',
  emptyHint: '主人就是你——和 Bot 们聊天的那个人。创建一个新身份，或用助记词导入。Bot 会把这个身份认作主人。',
  emptyCreate: '创建新身份',
  emptyImport: '导入助记词',
  // 创建视图。
  createTitle: '创建身份',
  createHint: '将为你生成一个全新的 MetaID 钱包。创建后请立即备份助记词。',
  nameField: '名称',
  namePlaceholder: '你的显示名称',
  createSubmit: '创建',
  working: '处理中…',
  // 导入视图。
  importTitle: '导入助记词',
  importHint: '用已有的 BIP39 助记词恢复你的主人身份。',
  mnemonicField: '助记词',
  mnemonicPlaceholder: '12 或 24 个单词，用空格分隔',
  pathField: '派生路径（可选）',
  pathHint: '默认 m/44\'/10001\'/0\'/0/0',
  importSubmit: '导入',
  invalidMnemonic: '这不是一个有效的 BIP39 助记词。',
  // 备份视图（创建/导入后立即显示）。
  backupTitle: '备份你的助记词',
  backupWarning: '助记词是找回主人身份的唯一凭证。请抄录并妥善保管。它只会在这里完整显示。',
  backupConfirm: '我已备份',
  // 资料视图。
  profileTitle: '主人身份',
  profileHint: '本地人类主人。Bot 会绑定这个身份作为它们的主人。',
  saveName: '保存',
  savingName: '保存中…',
  nameSaved: '名称已更新。',
  backupBtn: '备份助记词',
  logoutBtn: '退出登录',
  fieldGlobalMetaId: 'GlobalMetaID',
  fieldMvcAddress: 'MVC 地址',
  fieldMetaId: 'MetaID',
  fieldCreatedAt: '创建时间',
  // 显示助记词弹窗。
  revealTitle: '你的助记词',
  revealWarning: '拥有这串词的人可以控制你的主人身份。切勿泄露。',
  // 退出确认。
  logoutTitle: '退出登录',
  logoutWarning: '这将删除本地主人身份及其助记词。继续前请确认你已经备份。',
  logoutConfirm: '删除身份',
  cancel: '取消',
}

export type UserLocaleKey = keyof typeof userEn
