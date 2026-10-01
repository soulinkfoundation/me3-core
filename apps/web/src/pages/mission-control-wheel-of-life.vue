<script setup lang="ts">
import { definePage } from "unplugin-vue-router/runtime";

definePage({
  path: "/mission-control/wheel-of-life",
  redirect: (to) => ({ path: "/wheel-of-life", query: to.query, hash: to.hash }),
});
</script>
<template><span /></template>
