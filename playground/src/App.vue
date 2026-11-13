<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
// EXPECT: detected auth.login.title -- t in script
const title = t('auth.login.title')
// EXPECT: detected cart.checkout.done -- backticks in script
const done = t(`cart.checkout.done`)
</script>

<template>
  <!-- EXPECT: detected welcome -- mustache with $t -->
  <h1>{{ $t('welcome') }} / {{ t("app-title") }}</h1>
  <!-- EXPECT: detected settings.theme.dark -- binding -->
  <button :title="$t('settings.theme.dark')">{{ title }} {{ done }}</button>
  <!-- EXPECT: detected cart.total -- keypath, double quotes -->
  <i18n-t keypath="cart.total" tag="p" />
  <!-- EXPECT: detected auth.login.hint -- keypath, single quotes -->
  <i18n-t keypath='auth.login.hint'>{{ t(`auth.login.submit`) }}</i18n-t>
  <!-- EXPECT: detected cart_empty_html -- keypath after other attributes, split over lines -->
  <i18n-t
    tag="span"
    scope="global"
    keypath="cart_empty_html"
  >
    <template #default>x</template>
  </i18n-t>
  <!-- EXPECT: not-detected bound.keypath.key -- :keypath binding is not supported -->
  <i18n-t :keypath="'bound.keypath.key'" />
  <!-- EXPECT: not-detected legacy.path.key -- v8 path attribute is not supported -->
  <i18n path="legacy.path.key" />
  <!-- EXPECT: not-detected directive.vt.key -- v-t directive is not supported -->
  <p v-t="'directive.vt.key'" />
  <!-- EXPECT: detected settings.demo.outdated -- try the outdated state -->
  <p>{{ $t('settings.demo.outdated') }}</p>
  <!-- EXPECT: detected comment.vue.key -- SURPRISING: HTML comment still matches: t('comment.vue.key') -->
</template>
