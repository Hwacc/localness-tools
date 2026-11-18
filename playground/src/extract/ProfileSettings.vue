<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const nickname = ref('')
const saved = ref(false)

function save() {
  saved.value = true
  window.alert('Your changes have been saved.')
  console.debug('profile saved', nickname.value)
}
</script>

<template>
  <form class="profile-settings" @submit.prevent="save">
    <h2>{{ t('settings.theme.dark') }}</h2>
    <label for="nickname">Nickname</label>
    <input id="nickname" v-model="nickname" placeholder="How should we call you?" />
    <label>Display name</label>
    <button type="button">Upload avatar</button>
    <label>
      <input type="checkbox" />
      Email notifications
    </label>
    <p v-if="saved">Profile updated.</p>
    <button type="submit">Save changes</button>
    <button type="button" class="danger">
      Delete
      my account
    </button>
  </form>
</template>
