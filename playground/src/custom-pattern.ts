import { t } from './i18n'

// Custom patterns: not active by default. Enable them with the keyPatterns snippet in playground/README.md.

// EXPECT: custom-detected welcome -- translate('x') needs the custom pattern
console.log(translate('welcome'))
// EXPECT: custom-detected cart -- L("x") needs the custom pattern
console.log(L("cart"))
// EXPECT: custom-detected missing.custom.key -- warning once the custom pattern is on
console.log(translate('missing.custom.key'))
// EXPECT: detected ok -- default patterns keep working next to custom ones
console.log(t('ok'))
