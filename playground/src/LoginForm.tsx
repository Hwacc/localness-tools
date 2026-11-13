import { t } from './i18n'

export function LoginForm({ count }: { count: number }) {
  return (
    <form>
      {/* EXPECT: detected auth.login.title -- JSX text child */}
      <h1>{t('auth.login.title')}</h1>
      {/* EXPECT: detected auth.login.hint -- JSX attribute */}
      <input placeholder={t("auth.login.hint")} />
      {/* EXPECT: detected auth.login.submit -- inside a template literal expression */}
      <button title={`${t('auth.login.submit')}: ${count}`}>
        {/* EXPECT: detected ok -- two keys in one line */}
        {t('ok')} / {t('cancel')}
      </button>
      {/* EXPECT: not-detected trans.component.key -- i18nKey attribute is not supported */}
      <Trans i18nKey="trans.component.key" />
      {/* EXPECT: detected cart.items.count -- ICU plural */}
      <p>{t('cart.items.count', { count })}</p>
    </form>
  )
}

declare function Trans(props: { i18nKey: string }): null
