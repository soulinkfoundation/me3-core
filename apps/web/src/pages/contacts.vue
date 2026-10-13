<script setup lang="ts">
import { definePage } from "unplugin-vue-router/runtime";

definePage({
  redirect: (to) => ({ path: "/people", query: to.query, hash: to.hash }),
});
</script>

<template>
  <span />
</template>
