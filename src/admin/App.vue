<script setup lang="ts">
import { RouterView } from 'vue-router';
import ToastContainer from '@/admin/components/ui/ToastContainer.vue';
import ConfirmDialog from '@/admin/components/ui/ConfirmDialog.vue';
</script>

<template>
    <RouterView />
    <ToastContainer />
    <ConfirmDialog />
</template>
