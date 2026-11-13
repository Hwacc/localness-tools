import { t } from './i18n'

// Namespaces declared in the project: auth, cart, settings.
// Boundary characters: _ . - : /   (longest namespace followed by a boundary wins)

// EXPECT: detected auth.login.title -- namespace auth, separator .
console.log(t('auth.login.title'))
// EXPECT: detected auth_logout -- namespace auth, separator _
console.log(t('auth_logout'))
// EXPECT: detected auth-forgot-password -- namespace auth, separator -
console.log(t('auth-forgot-password'))
// EXPECT: detected auth:two-factor -- namespace auth, separator :
console.log(t('auth:two-factor'))
// EXPECT: detected auth/terms -- namespace auth, separator /; HTML text in hover
console.log(t('auth/terms'))

// EXPECT: detected cart -- equals the namespace name, so it is NOT inside cart; ungrouped in the tree
console.log(t('cart'))
// EXPECT: detected authorize -- starts with auth but no boundary follows; ungrouped
console.log(t('authorize'))
// EXPECT: detected app-title -- app is not declared; ungrouped
console.log(t('app-title'))
// EXPECT: detected welcome -- no separator at all; ungrouped
console.log(t('welcome'))
// EXPECT: detected greeting.name -- greeting is not declared; ungrouped
console.log(t('greeting.name'))

// EXPECT: detected cart.items.count -- ICU plural in hover; zh-CN has no "one" branch
console.log(t('cart.items.count', { count: 3 }))
// EXPECT: detected cart_empty_html -- HTML snippet, source only shown escaped in hover
console.log(t('cart_empty_html'))
// EXPECT: detected cart.checkout.done -- emoji in hint
console.log(t('cart.checkout.done'))
// EXPECT: detected auth.login.error -- {name} and {{count}} placeholders
console.log(t('auth.login.error', { name: 'Ada', count: 2 }))
// EXPECT: detected settings.profile.nickname -- empty in zh-CN and ja: hint "(no translation)", state unpublished
console.log(t('settings.profile.nickname'))
// EXPECT: detected auth.login.hint -- missing in ja and de; switch display locale to see "(no translation)"
console.log(t('auth.login.hint'))
// EXPECT: detected settings.danger.delete -- only the source exists; hint "(no translation)" in zh-CN
console.log(t('settings.danger.delete'))
