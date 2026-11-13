// Legacy CommonJS style
const i18n = require('./i18n').i18n

// EXPECT: detected app-title -- i18n.t in plain JS
document.title = i18n.t('app-title')
// EXPECT: detected auth.session.expired -- i18n.global.t
alert(i18n.global.t('auth.session.expired'))
// EXPECT: detected cart.total -- backticks
console.log(i18n.t(`cart.total`))
// EXPECT: detected settings.demo.draft -- try the draft state with this key
console.log(i18n.t('settings.demo.draft'))
// EXPECT: detected settings.demo.outdated -- try the outdated state with this key
console.log(i18n.t('settings.demo.outdated'))
// EXPECT: detected cart.demo.unpublished -- exists only in en; state unpublished in zh-CN
console.log(i18n.t('cart.demo.unpublished'))
