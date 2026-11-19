<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const nickname = ref('')
const saved = ref(false)

function save() {
  saved.value = true
  window.alert(t('settings_profile_changes_saved'))
  console.debug('profile saved', nickname.value)
}
</script>

<template>
  <form class="profile-settings" @submit.prevent="save">
    <h2>{{ t('settings.theme.dark') }}</h2>
    <label for="nickname">{{ t('settings.profile.nickname') }}</label>
    <input id="nickname" v-model="nickname" :placeholder="t('settings_profile_nickname_placeholder')" />
    <label>{{ t('settings_profile_display_name') }}</label>
    <button type="button">{{ t('settings_profile_upload_avatar') }}</button>
    <label>
      <input type="checkbox" />
      {{ t('settings_profile_email_notifications') }}
    </label>
    <p v-if="saved">{{ t('settings_profile_updated') }}</p>
    <button type="submit">{{ t('settings_profile_save_changes') }}</button>
    <button type="button" class="danger">
      {{ t('settings.danger.delete') }}
    </button>
  </form>
</template>
