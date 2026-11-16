<script lang="ts">
  import { onMount } from 'svelte';
  import { EXAMPLE_API_URL } from '$app/env/public';

  let email = $state('…');

  // An ordinary fetch, made in the browser. The build named this address as the site's API
  // (GATECRYPT_API, or --api), so Gatecrypt's service worker adds the visitor's token and the
  // API knows who is asking.
  onMount(async () => {
    try {
      const res = await fetch(`${EXAMPLE_API_URL}/api/me`);
      const body = await res.json();
      email = res.ok ? body.email : `refused (${res.status} ${body.error})`;
    } catch (error) {
      email = `failed (${error})`;
    }
  });
</script>

<svelte:head><title>SvelteKit example</title></svelte:head>

<h1>SvelteKit example</h1>
<p data-testid="secret">Internal only: GATECRYPT_EXAMPLE_MARKER (SvelteKit)</p>
<p>The API says you are <strong data-testid="api-email">{email}</strong></p>
