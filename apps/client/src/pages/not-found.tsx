import { useTranslation } from 'react-i18next';

const NotFound = () => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-xp-bg">
      <div className="mx-4 w-full max-w-md rounded-[2px] border border-xp-border bg-xp-surface p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl" role="img" aria-label="error">
            !
          </span>
          <h1 className="text-2xl font-medium text-xp-text">{t('pages.notFound.title')}</h1>
        </div>

        <p className="mt-4 text-sm text-xp-text-secondary">{t('pages.notFound.hint')}</p>
      </div>
    </div>
  );
};

export default NotFound;
