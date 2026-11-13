import { i18n, t } from './i18n'

// EXPECT: detected welcome -- found, published
console.log(t('welcome'))
// EXPECT: detected app-title -- double quotes
console.log(t("app-title"))
// EXPECT: detected cart.total -- backticks without ${}
console.log(t(`cart.total`, { amount: 12 }))

const page = {
  $t: t,
  t,
  title() {
    // EXPECT: detected auth.login.title -- this.$t
    return this.$t('auth.login.title')
  },
  label() {
    // EXPECT: detected auth.login.submit -- this.t is also accepted
    return this.t('auth.login.submit')
  },
}
console.log(page)

// EXPECT: detected settings.theme.dark -- i18n.t
console.log(i18n.t('settings.theme.dark'))
// EXPECT: detected settings.language.arabic -- i18n.global.t
console.log(i18n.global.t('settings.language.arabic'))
// EXPECT: detected settings.language.hebrew -- window.i18n.t
console.log((window as any).i18n.t('settings.language.hebrew'))

// EXPECT: detected ok -- argument on its own line
console.log(
  t(
    'ok',
  ),
)

// EXPECT: detected cancel -- several keys on one line, hint after each key
const row = [t('cancel'), t('ok'), $t('welcome'), t("cart"), t(`app-title`)]
// EXPECT: detected greeting.name -- placeholder {name}
console.log(row, t('greeting.name', { name: 'Ada' }))
