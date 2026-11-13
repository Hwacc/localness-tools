import { t } from './i18n'

// ---- Keys that must get a warning ----------------------------------------

// EXPECT: detected missing.key.not-in-seed -- warning "Key not found in Localness", no hint
console.log(t('missing.key.not-in-seed'))
// Key "Hello world" (with a space) is detected too; not in seed, so warning
console.log(t('Hello world'))
// EXPECT: detected 欢迎.未知 -- CJK key; warning
console.log(t('欢迎.未知'))
// EXPECT: detected cart. -- SURPRISING: only the literal prefix of a concatenation is taken; warning
console.log(t('cart.' + 'total'))
// EXPECT: detected cart.demo.new-draft -- warning until the key is created on the platform (see README), then state draft
console.log(t('cart.demo.new-draft'))

// ---- Dynamic keys: must be ignored ---------------------------------------

// EXPECT: not-detected cart.${kind}.total -- template with interpolation
const kind = 'items'
console.log(t(`cart.${kind}.total`))
// EXPECT: not-detected ${prefix}.title
console.log(t(`${kind}.title`))
// EXPECT: not-detected variable.key -- argument is an identifier
const variableKey = 'variable.key'
console.log(t(variableKey))
// EXPECT: not-detected ternary.yes -- argument is an expression
console.log(t(kind === 'items' ? 'ternary.yes' : 'ternary.no'))

// ---- Not matched call shapes ---------------------------------------------

// EXPECT: not-detected escaped.quote -- backslash in the key body stops the match
console.log(t('escaped.quote\'s'))
// EXPECT: not-detected spaced.call -- space between t and (
console.log(t ('spaced.call'))
// EXPECT: not-detected generic.call -- type arguments
console.log(t<string>('generic.call'))
// EXPECT: not-detected plural.tc -- $tc is a different function
console.log(($tc as any)('plural.tc'))
// EXPECT: not-detected exists.te -- te is a different function
console.log(te('exists.te'))
// EXPECT: not-detected member.not.i18n -- arbitrary object.t
console.log(({ t } as any).t('member.not.i18n'))
// EXPECT: not-detected vm.dollar.t -- vm.$t is not accepted, only this.$t
console.log((vm as any).$t('vm.dollar.t'))
// EXPECT: not-detected optional.chain -- i18n?.t is not accepted
console.log((globalThis as any).i18n?.t('optional.chain'))
// EXPECT: not-detected endswith.t.call -- identifier merely ending in t
console.log(split('endswith.t.call'))
// EXPECT: not-detected empty.key.guard -- (nothing to capture) t('') yields no match
console.log(t(''))

// ---- Looks like a call but is not code: still detected (no comment/string awareness) ----

// t('comment.line.key')
/* t("comment.block.key") */
/**
 * @example t(`comment.jsdoc.key`)
 */
const text1 = "call t('string.inside.double') to translate"
const text2 = 'call t("string.inside.single") to translate'
// EXPECT: detected comment.line.key -- SURPRISING: line comment still matches
// EXPECT: detected comment.block.key -- SURPRISING: block comment still matches
// EXPECT: detected comment.jsdoc.key -- SURPRISING: JSDoc still matches
// EXPECT: detected string.inside.double -- SURPRISING: string content still matches
// EXPECT: detected string.inside.single -- SURPRISING: string content still matches
console.log(text1, text2)

// ---- Unicode around keys -------------------------------------------------

// EXPECT: detected auth.login.title -- CJK text around the call
const cjk = '登录按钮：' + t('auth.login.title') + '（ログイン）'
// EXPECT: detected settings.profile.bio -- CJK char directly before t( does not block (\w is ASCII only)
const glued = '说明t("settings.profile.bio")'
// EXPECT: detected settings.language.arabic -- RTL text on the same line: العربية
const rtl = `${t('settings.language.arabic')} ← العربية`
console.log(cjk, glued, rtl)

// ---- Long lines ----------------------------------------------------------

// EXPECT: detected cart.promo.banner -- keys at the start and end of a ~700 char line; hint is truncated to 40 chars
const long = t('cart.promo.banner') + '  lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua  lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua  lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua  lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua  lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua  ' + t('cart.note.long')
// EXPECT: detected cart.note.long -- same long line, last key
console.log(long)
// EXPECT: detected auth.session.expired -- long text, hint truncated with an ellipsis
console.log(t('auth.session.expired'))
