import type { ChangeEvent, ReactNode } from 'react';
import type { ChatMessage, Conversation } from '@skypier/protocol';
import { reachabilityLabel } from '@skypier/network';

export interface ConversationListProps {
  conversations: Conversation[];
  selectedConversationId: string;
  onSelectConversation: (conversationId: string) => void;
}

export function ConversationList(props: ConversationListProps) {
  const { conversations, selectedConversationId, onSelectConversation } = props;

  return (
    <aside className="panel panel--sidebar">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Chats</p>
          <h1>Skypier Chat</h1>
        </div>
        <button className="secondary-button" type="button">
          New chat
        </button>
      </div>
      <div className="conversation-list">
        {conversations.map((conversation) => {
          const selected = conversation.id === selectedConversationId;
          return (
            <button
              key={conversation.id}
              className={`conversation-card${selected ? ' conversation-card--active' : ''}`}
              type="button"
              onClick={() => onSelectConversation(conversation.id)}
            >
              <div className="conversation-card__topline">
                <strong>{conversation.title}</strong>
                <span>{new Date(conversation.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="conversation-card__preview">{conversation.lastMessagePreview}</div>
              <div className="conversation-card__meta">
                <span>{reachabilityLabel(conversation.reachability)}</span>
                {conversation.unreadCount > 0 ? <span className="unread-pill">{conversation.unreadCount}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export interface ThreadPaneProps {
  conversation: Conversation;
  messages: ChatMessage[];
  composerValue: string;
  replyTarget?: ChatMessage;
  onComposerChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onReplySelect: (message: ChatMessage) => void;
  onReplyClear: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSendMessage: () => void;
}

export function ThreadPane(props: ThreadPaneProps) {
  const {
    conversation,
    messages,
    composerValue,
    replyTarget,
    onComposerChange,
    onReplySelect,
    onReplyClear,
    onToggleReaction,
    onSendMessage,
  } = props;

  return (
    <section className="panel panel--thread">
      <header className="thread-header">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2>{conversation.title}</h2>
        </div>
        <div className="thread-status">{reachabilityLabel(conversation.reachability)}</div>
      </header>

      <div className="message-list">
        {messages.map((message) => (
          <article key={message.id} className={`message-bubble${message.senderDisplayName === 'You' ? ' message-bubble--self' : ''}`}>
            <div className="message-bubble__meta">
              <span>{message.senderDisplayName}</span>
              <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {message.replyTo ? (
              <div className="reply-preview">
                <strong>{message.replyTo.authorDisplayName}</strong>
                <span>{message.replyTo.excerpt}</span>
              </div>
            ) : null}
            <p>{message.previewText}</p>
            <footer className="message-bubble__footer">
              <span>{message.delivery}</span>
              <div className="reaction-row">
                {message.reactions.map((reaction) => (
                  <button
                    key={`${message.id}-${reaction.emoji}`}
                    className="reaction-chip"
                    type="button"
                    onClick={() => onToggleReaction(message.id, reaction.emoji)}
                  >
                    {reaction.emoji} {reaction.authors.length}
                  </button>
                ))}
                <button className="message-action" type="button" onClick={() => onToggleReaction(message.id, '👍')}>
                  + React
                </button>
                <button className="message-action" type="button" onClick={() => onReplySelect(message)}>
                  Reply
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>

      <footer className="composer">
        {replyTarget ? (
          <div className="reply-draft">
            <div className="reply-draft__topline">
              <strong>Replying to {replyTarget.senderDisplayName}</strong>
              <button className="message-action" type="button" onClick={onReplyClear}>Dismiss</button>
            </div>
            <span>{replyTarget.previewText}</span>
          </div>
        ) : null}
        <textarea
          value={composerValue}
          onChange={onComposerChange}
          rows={4}
          placeholder="Encrypted message draft. Delivery transport comes next."
        />
        <div className="composer__actions">
          <button className="secondary-button" type="button" onClick={() => onToggleReaction(messages[messages.length - 1]?.id ?? '', '🔥')} disabled={messages.length === 0}>
            Quick react
          </button>
          <button className="primary-button" type="button" onClick={onSendMessage} disabled={!composerValue.trim()}>
            Send
          </button>
        </div>
      </footer>
    </section>
  );
}

export interface StatusCardProps {
  title: string;
  body: string;
  children?: ReactNode;
}

export function StatusCard(props: StatusCardProps) {
  return (
    <section className="status-card">
      <p className="eyebrow">Security</p>
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      {props.children}
    </section>
  );
}
