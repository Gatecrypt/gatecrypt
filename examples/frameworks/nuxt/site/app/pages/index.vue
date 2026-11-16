<script setup lang="ts">
useHead({ title: 'Nuxt example' });

const { apiUrl } = useRuntimeConfig().public;
const email = ref('…');

// In the browser only, so not while the page is generated. An ordinary fetch: the build named this
// address as the site's API (GATECRYPT_API, or --api), so Gatecrypt's service worker adds the
// visitor's token and the API knows who is asking.
onMounted(async () => {
  try {
    const res = await fetch(`${apiUrl}/api/me`);
    const body = await res.json();
    email.value = res.ok ? body.email : `refused (${res.status} ${body.error})`;
  } catch (error) {
    email.value = `failed (${error})`;
  }
});
</script>

<template>
  <h1>Nuxt example</h1>
  <p data-testid="secret">Internal only: GATECRYPT_EXAMPLE_MARKER (Nuxt)</p>
  <p>
    The API says you are <strong data-testid="api-email">{{ email }}</strong>
  </p>
</template>
