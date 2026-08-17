/** Locale namespace for the Conversations settings section. */
export const CONV_NS = 'settings.oac.conversations'

export const convEn = {
  nav: 'Conversations',
  title: 'Conversations',
  loading: 'Loading conversations…',
  error: 'Could not load conversations.',
  refresh: 'Refresh',
  empty: 'No conversations yet. Send a private message to start one.',
  pickBot: 'Choose a Bot',
  fieldBot: 'Local Bot',
  fieldPeer: 'Peer GlobalMetaID',
  fieldMessage: 'Message',
  send: 'Send',
  sending: 'Sending…',
  newChat: 'New message',
  noMessages: 'No messages in this conversation.',
  selectConversation: 'Select a conversation',
  peerPlaceholder: 'id… of the remote Bot',
  messagePlaceholder: 'Write a private message',
}

export const convZh = {
  nav: '对话',
  title: '对话',
  loading: '正在读取对话…',
  error: '暂时无法读取对话。',
  refresh: '刷新',
  empty: '还没有对话。发送一条私信即可开始。',
  pickBot: '选择 Bot',
  fieldBot: '本机 Bot',
  fieldPeer: '对方 GlobalMetaID',
  fieldMessage: '消息',
  send: '发送',
  sending: '发送中…',
  newChat: '新消息',
  noMessages: '此对话还没有消息。',
  selectConversation: '选择一个对话',
  peerPlaceholder: '对方 Bot 的 id…',
  messagePlaceholder: '输入私信内容',
}

export type ConversationsLocaleKey = keyof typeof convEn
