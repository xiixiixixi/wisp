import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy } from 'lucide-react';

/** 本人靠右、助手靠左；正文内容和流式消息共用同一边界。 */
const PiChatMessage = ({
  role,
  text,
  streaming = false,
  index,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  index?: number;
}) => {
  const { t } = useTranslation();
  return (
    <article
      className={`pi-message-row pi-message-row--${role}`}
      data-testid={`pi-message-${role}`}
      data-message-role={role}
    >
      <div className={`pi-message pi-message--${role}`}>
        <div className="pi-message-heading">
          <span>{t(role === 'user' ? 'piChat.you' : 'piChat.assistant')}</span>
          {role === 'assistant' && text && !streaming && (
            <button
              type="button"
              aria-label={t('piChat.copyMessage')}
              title={t('piChat.copyMessage')}
              data-testid={`pi-copy-msg-${index}`}
              onClick={() => {
                void navigator.clipboard?.writeText(text);
              }}
            >
              <Copy size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        {role === 'user' ? (
          <div className="whitespace-pre-wrap break-words text-sm text-xp-text">{text}</div>
        ) : (
          <div className="pi-chat-md text-sm text-xp-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            {streaming && (
              <span
                className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-xp-text-muted align-middle"
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
};
export default PiChatMessage;
